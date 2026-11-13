import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fileUrlToPath } from "../version.js";
import {
  createSessionStore,
  DEFAULT_SPOOL_THRESHOLD,
  resolveSessionId,
  resolveThreshold,
  type SessionStore,
} from "../session/index.js";
import {
  type CreateMcpOptions,
  type McpToolDef,
  invokeMcpTool,
  listMcpTools,
  resolveMcpAllow,
  resolveMcpRoot,
  resolveMcpVersion,
  toolError,
  toolResultForError,
} from "./project.js";
import type { CallToolResult } from "./project.js";
import {
  handleResultQuery,
  handleResultRead,
  RESULT_QUERY_TOOL,
  RESULT_READ_TOOL,
  resultQueryInputSchema,
  resultReadInputSchema,
} from "./session-tools.js";
import { watchCommandTree } from "./watch.js";
import { rowTreesProvider } from "./row-trees.js";
import { invocationVia, logInvocation } from "../invocation-log.js";
import type { Readable, Writable } from "node:stream";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** Build an MCP Server with tools projected from the command tree. */
export async function createMcpServer(
  options: CreateMcpOptions,
): Promise<Server> {
  const state: { tools: McpToolDef[] } = { tools: await listMcpTools(options) };
  const byName = new Map(state.tools.map((t) => [t.name, t]));
  const version = resolveMcpVersion(options);
  const root = resolveMcpRoot(options);
  const allow = resolveMcpAllow(options);
  const env = options.env ?? process.env;
  const threshold = resolveThreshold(
    env,
    options.spoolThreshold,
    DEFAULT_SPOOL_THRESHOLD,
  );
  const store = createSessionStore({ root, threshold });
  store.evict();
  const sessionId = options.sessionId ?? resolveSessionId(env);
  const rowTrees =
    options.rowTrees ?? rowTreesProvider(options.name, () => state.tools, env);

  let instructions: string | undefined;
  try {
    instructions = (await options.instructions?.()) || undefined;
  } catch (err) {
    // Instructions are a convenience; a failure must not stop the server.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`clfly: mcp instructions failed: ${message}\n`);
  }
  const server = new Server(
    { name: options.name, version },
    { capabilities: { tools: { listChanged: true } }, ...(instructions ? { instructions } : {}) },
  );

  const replaceTools = (next: McpToolDef[]) => {
    state.tools = next;
    byName.clear();
    for (const tool of next) byName.set(tool.name, tool);
  };

  // Dev mode is a live scan. A baked manifest does not change under us.
  if (options.commandsDir && !options.manifest) {
    const commandsDir = fileUrlToPath(options.commandsDir);
    const stop = watchCommandTree(commandsDir, async () => {
      try {
        replaceTools(await listMcpTools(options));
        await server.sendToolListChanged();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`clfly: tool list refresh failed: ${message}\n`);
      }
    });
    const close = server.close.bind(server);
    server.close = () => {
      stop();
      return close();
    };
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...state.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
        ...(t.annotations ? { annotations: t.annotations } : {}),
      })),
      {
        name: RESULT_READ_TOOL,
        description:
          "Read a page from a spooled session result (array roots support offset/limit)",
        inputSchema: resultReadInputSchema(),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      {
        name: RESULT_QUERY_TOOL,
        description:
          "Run a jq program over a spooled session result (project, filter, group); large results spool to a new ref",
        inputSchema: resultQueryInputSchema(),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};

    if (name === RESULT_READ_TOOL) {
      return handleResultRead(store, args);
    }
    if (name === RESULT_QUERY_TOOL) {
      return handleResultQuery(store, args, env);
    }

    const tool = byName.get(name);
    if (!tool) {
      return toolError(`Unknown tool: ${name}`);
    }
    const started = Date.now();
    const logged = (result: CallToolResult, exitCode: number) => {
      logInvocation(env, {
        tree: options.name,
        command: tool.path.join(" "),
        via: invocationVia(env, true),
        ms: Date.now() - started,
        outBytes: Buffer.byteLength(JSON.stringify(result.content ?? [])),
        exitCode,
        ...(server.getClientVersion()?.name ? { client: server.getClientVersion()!.name } : {}),
      });
      return result;
    };
    try {
      const result = await invokeMcpTool(tool, args, {
        cwd: root,
        env,
        scoped: true,
        allow,
        sessionStore: store,
        sessionId,
        rowTrees,
      });
      return logged(result, result.isError ? 1 : 0);
    } catch (err) {
      const { result, exitCode } = toolResultForError(err);
      return logged(result, exitCode);
    }
  });

  return server;
}

/**
 * Serve the command tree over MCP stdio (stdout is the protocol channel).
 * When stdin ends, every request already received is still answered, then the
 * server closes (stopping the dev-mode watcher) so the process can exit:
 * `echo '<request>' | <tree> mcp serve` prints its replies and returns.
 */
export async function serveMcpStdio(
  options: CreateMcpOptions,
  io: { stdin?: Readable; stdout?: Writable } = {},
): Promise<Server> {
  const stdin = io.stdin ?? process.stdin;
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport(stdin, io.stdout ?? process.stdout);
  await server.connect(transport);

  // Track at the transport: request ids in, responses out. Handlers start
  // asynchronously inside the SDK, so counting inside them misses requests
  // that arrived in the same chunk as EOF.
  const pending = new Set<string | number>();
  let eof = false;
  let closed = false;
  const maybeClose = () => {
    if (eof && pending.size === 0 && !closed) {
      closed = true;
      void server.close();
    }
  };
  const onmessage = transport.onmessage;
  transport.onmessage = (message: JSONRPCMessage) => {
    if ("method" in message && "id" in message) pending.add(message.id);
    onmessage?.(message);
  };
  const send = transport.send.bind(transport);
  transport.send = async (message: JSONRPCMessage) => {
    await send(message);
    if (!("method" in message) && "id" in message && message.id !== undefined) {
      pending.delete(message.id);
      maybeClose();
    }
  };
  const onEof = () => {
    eof = true;
    // The transport parses buffered lines on "data"; let them dispatch first.
    setImmediate(maybeClose);
  };
  stdin.once("end", onEof);
  stdin.once("close", onEof);
  return server;
}

export type { SessionStore };

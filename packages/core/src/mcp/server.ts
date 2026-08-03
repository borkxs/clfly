import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ClflyError, ValidationError } from "../errors.js";
import {
  createSessionStore,
  DEFAULT_SPOOL_THRESHOLD,
  resolveSessionId,
  resolveThreshold,
  type SessionStore,
} from "../session/index.js";
import {
  type CreateMcpOptions,
  invokeMcpTool,
  listMcpTools,
  resolveMcpRoot,
  resolveMcpVersion,
  toolError,
} from "./project.js";
import {
  handleResultQuery,
  handleResultRead,
  RESULT_QUERY_TOOL,
  RESULT_READ_TOOL,
  resultQueryInputSchema,
  resultReadInputSchema,
} from "./session-tools.js";

/** Build an MCP Server with tools projected from the command tree. */
export async function createMcpServer(
  options: CreateMcpOptions,
): Promise<Server> {
  const tools = await listMcpTools(options);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const version = resolveMcpVersion(options);
  const root = resolveMcpRoot(options);
  const env = options.env ?? process.env;
  const threshold = resolveThreshold(
    env,
    options.spoolThreshold,
    DEFAULT_SPOOL_THRESHOLD,
  );
  const store = createSessionStore({ root, threshold });
  store.evict();
  const sessionId = options.sessionId ?? resolveSessionId(env);

  const server = new Server(
    { name: options.name, version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...tools.map((t) => ({
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
          "Query a spooled session result (stub — not implemented; see session-store ADR)",
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
      return handleResultQuery(store, args);
    }

    const tool = byName.get(name);
    if (!tool) {
      return toolError(`Unknown tool: ${name}`);
    }
    try {
      return await invokeMcpTool(tool, args, {
        cwd: root,
        env,
        scoped: true,
        sessionStore: store,
        sessionId,
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return toolError(err.message);
      }
      if (err instanceof ClflyError) {
        return toolError(err.message);
      }
      const message = err instanceof Error ? err.message : String(err);
      return toolError(message);
    }
  });

  return server;
}

/** Serve the command tree over MCP stdio (stdout is the protocol channel). */
export async function serveMcpStdio(options: CreateMcpOptions): Promise<void> {
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export type { SessionStore };

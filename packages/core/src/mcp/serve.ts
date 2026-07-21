import { Writable } from "node:stream";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CommandModule,
  Context,
  CreateCliOptions,
  Manifest,
  Meta,
  RouteNode,
} from "../types.js";
import { ClflyError, ValidationError } from "../errors.js";
import { listCommandFiles, loadAndValidateCommand, scanCommandsDir } from "../router/scan.js";
import { toJsonSchema, validateSchema } from "../schema/to-json-schema.js";
import { treeFromManifest } from "../manifest/load.js";
import { fileUrlToPath, resolvePackageVersion } from "../version.js";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export type JsonSchemaObject = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

export interface McpToolDef {
  /** MCP tool name derived from the command path (`users_list`, `users_show`). */
  name: string;
  description: string;
  /** JSON Schema (draft-07-ish) for tools/list inputSchema. */
  inputSchema: JsonSchemaObject;
  /** Manifest-style path (`:id` for dynamics). */
  path: string[];
  meta?: Meta;
  load: () => Promise<CommandModule>;
}

export interface CreateMcpOptions {
  name: string;
  version?: string;
  commandsDir?: string | URL;
  manifest?: Manifest;
  packageJsonPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** Collect MCP tool definitions from a live scan or manifest. */
export async function listMcpTools(
  options: CreateMcpOptions,
): Promise<McpToolDef[]> {
  assertNoReservedMcpCollision(options);
  if (options.manifest) {
    return toolsFromManifest(options.manifest, readCoreVersion());
  }
  if (!options.commandsDir) {
    throw new ClflyError("listMcpTools requires commandsDir or manifest");
  }
  return toolsFromCommandsDir(fileUrlToPath(options.commandsDir));
}

/** Build an MCP Server with tools projected from the command tree. */
export async function createMcpServer(
  options: CreateMcpOptions,
): Promise<Server> {
  const tools = await listMcpTools(options);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const version =
    options.version ??
    resolvePackageVersion(
      options.packageJsonPath
        ? dirname(options.packageJsonPath)
        : options.commandsDir
          ? fileUrlToPath(options.commandsDir)
          : (options.cwd ?? process.cwd()),
      options.packageJsonPath,
    );

  const server = new Server(
    { name: options.name, version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return toolError(`Unknown tool: ${request.params.name}`);
    }
    try {
      const result = await invokeMcpTool(tool, request.params.arguments ?? {}, {
        cwd: options.cwd ?? process.cwd(),
        env: options.env ?? process.env,
      });
      return result;
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

export async function invokeMcpTool(
  tool: McpToolDef,
  args: Record<string, unknown>,
  runtime: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<CallToolResult> {
  const mod = await tool.load();
  const pathParamNames = tool.path
    .filter((p) => p.startsWith(":"))
    .map((p) => p.slice(1));

  let opts: unknown = { ...args };
  if (mod.args) {
    const validated = await validateSchema(mod.args, args);
    if ("issues" in validated) {
      throw new ValidationError(
        validated.issues.map((i) => ({
          ...i,
          expected: undefined,
        })),
      );
    }
    opts = validated.value;
  }

  if (typeof opts === "object" && opts !== null) {
    const merged: Record<string, unknown> = { ...(opts as object) };
    for (const name of pathParamNames) {
      if (args[name] !== undefined) merged[name] = args[name];
    }
    opts = merged;
  }

  const chunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const stderrChunks: string[] = [];
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      stderrChunks.push(String(chunk));
      cb();
    },
  });

  const ctx: Context = {
    argv: ["mcp", "call", tool.name],
    cwd: runtime.cwd,
    env: runtime.env,
    commandPath: tool.path.map((p) =>
      p.startsWith(":") ? `<${p.slice(1)}>` : p,
    ),
    meta: mod.meta ?? tool.meta ?? {},
    json: true,
    stdout,
    stderr,
  };

  const value = await mod.default(opts, ctx);
  const textOut = chunks.join("");
  const text =
    value !== undefined
      ? typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2)
      : textOut || "(no output)";

  if (stderrChunks.length > 0) {
    return {
      content: [
        { type: "text", text },
        { type: "text", text: `stderr:\n${stderrChunks.join("")}` },
      ],
    };
  }

  return { content: [{ type: "text", text }] };
}

/** Map a command path to an MCP tool name. */
export function toolNameFromPath(path: string[]): string {
  if (path.length === 0) return "index";
  return path
    .filter((p) => !p.startsWith(":"))
    .map((p) => p.replace(/[^a-zA-Z0-9_-]/g, "_"))
    .join("_");
}

export function mergePathParamsIntoSchema(
  schema: JsonSchemaObject,
  pathParams: string[],
): JsonSchemaObject {
  const properties: Record<string, unknown> = {
    ...((schema.properties as Record<string, unknown> | undefined) ?? {}),
  };
  const required = new Set<string>(
    Array.isArray(schema.required) ? schema.required.map(String) : [],
  );

  for (const name of pathParams) {
    if (!(name in properties)) {
      properties[name] = {
        type: "string",
        description: `Path parameter <${name}>`,
      };
      required.add(name);
    }
  }

  // Strip $schema noise; MCP clients expect a plain object schema.
  const { $schema: _s, ...rest } = schema;
  return {
    ...rest,
    type: "object",
    properties,
    ...(required.size > 0 ? { required: [...required] } : {}),
  };
}

function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

async function toolsFromCommandsDir(commandsDir: string): Promise<McpToolDef[]> {
  const tree = scanCommandsDir(commandsDir);
  assertTreeNoMcp(tree);
  const files = listCommandFiles(tree);
  const tools: McpToolDef[] = [];

  for (const entry of files) {
    const manifestPath = entry.path.map((p) => {
      const m = /^\[([^\]]+)\]$/.exec(p);
      return m?.[1] ? `:${m[1]}` : p;
    });
    const labelPath = manifestPath.map((p) =>
      p.startsWith(":") ? p.slice(1) : p,
    );
    const mod = await loadAndValidateCommand(entry.file, labelPath);
    tools.push(toolDefFromModule(manifestPath, mod));
  }

  return dedupeToolNames(tools);
}

function toolsFromManifest(
  manifest: Manifest,
  coreVersion: string,
): McpToolDef[] {
  // Validate format; tree build also asserts.
  treeFromManifest(manifest, coreVersion);
  const tools = manifest.routes.map((route) => {
    const pathParams = route.path
      .filter((p) => p.startsWith(":"))
      .map((p) => p.slice(1));
    const baseSchema: JsonSchemaObject = route.inputSchema ?? {
      type: "object",
      properties: Object.fromEntries(
        route.flags.map((f) => [
          f.name,
          {
            type: f.type === "unknown" ? "string" : f.type,
            ...(f.description ? { description: f.description } : {}),
            ...(f.enum ? { enum: f.enum } : {}),
            ...(f.default !== undefined ? { default: f.default } : {}),
            ...(f.deprecated ? { deprecated: true } : {}),
          },
        ]),
      ),
    };
    const description = describeMeta(route.meta, route.path);
    return {
      name: toolNameFromPath(route.path),
      description,
      inputSchema: mergePathParamsIntoSchema(baseSchema, pathParams),
      path: route.path,
      meta: route.meta,
      load: async () => {
        const mod = (await route.load()) as CommandModule & {
          default: CommandModule["default"];
        };
        if (typeof mod.default !== "function") {
          throw new ClflyError(`Tool ${toolNameFromPath(route.path)} missing default export`);
        }
        return {
          meta: mod.meta,
          args: mod.args,
          positionals: mod.positionals,
          default: mod.default,
        };
      },
    } satisfies McpToolDef;
  });
  return dedupeToolNames(tools);
}

function toolDefFromModule(path: string[], mod: CommandModule): McpToolDef {
  const pathParams = path.filter((p) => p.startsWith(":")).map((p) => p.slice(1));
  const base: JsonSchemaObject = mod.args
    ? (toJsonSchema(mod.args) as JsonSchemaObject)
    : { type: "object", properties: {} };
  return {
    name: toolNameFromPath(path),
    description: describeMeta(mod.meta, path),
    inputSchema: mergePathParamsIntoSchema(base, pathParams),
    path,
    meta: mod.meta,
    load: async () => mod,
  };
}

function describeMeta(meta: Meta | undefined, path: string[]): string {
  const base =
    meta?.description ??
    (path.length === 0 ? "Root command" : path.filter((p) => !p.startsWith(":")).join(" "));
  if (!meta?.deprecated) return base;
  const reason =
    typeof meta.deprecated === "string" ? ` — ${meta.deprecated}` : "";
  return `DEPRECATED${reason}. ${base}`;
}

function dedupeToolNames(tools: McpToolDef[]): McpToolDef[] {
  const seen = new Map<string, number>();
  return tools.map((t) => {
    const n = (seen.get(t.name) ?? 0) + 1;
    seen.set(t.name, n);
    if (n === 1) return t;
    return { ...t, name: `${t.name}_${n}` };
  });
}

function assertNoReservedMcpCollision(options: CreateMcpOptions): void {
  if (options.manifest) {
    if (options.manifest.routes.some((r) => r.path[0] === "mcp")) {
      throw new ClflyError(
        'Command path "mcp" is reserved for the MCP transport (`mcp serve`).',
      );
    }
    return;
  }
  if (options.commandsDir) {
    const tree = scanCommandsDir(fileUrlToPath(options.commandsDir));
    assertTreeNoMcp(tree);
  }
}

function assertTreeNoMcp(tree: RouteNode): void {
  if (tree.children.has("mcp")) {
    throw new ClflyError(
      'Command "mcp" is reserved for the MCP transport (`mcp serve`). Rename your commands/mcp path.',
    );
  }
}

function readCoreVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [
      join(here, "..", "package.json"),
      join(here, "..", "..", "package.json"),
    ]) {
      try {
        const raw = readFileSync(candidate, "utf8");
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === "@clfly/core" && pkg.version) return pkg.version;
        if (pkg.version) return pkg.version;
      } catch {
        /* next */
      }
    }
  } catch {
    /* fallthrough */
  }
  return "0.0.0";
}

/** Detect `mcp serve` (framework-owned). */
export function isMcpServeArgv(argv: string[]): boolean {
  const tokens = argv.filter(
    (t) =>
      t !== "--" &&
      t !== "--help" &&
      t !== "-h" &&
      t !== "--version" &&
      t !== "-V" &&
      t !== "--json",
  );
  return tokens[0] === "mcp" && tokens[1] === "serve";
}

export function isMcpArgv(argv: string[]): boolean {
  const tokens = argv.filter((t) => !t.startsWith("-") && t !== "--");
  return tokens[0] === "mcp";
}

/** Narrow CreateCliOptions → CreateMcpOptions. */
export function mcpOptionsFromCli(
  options: CreateCliOptions,
): CreateMcpOptions {
  return {
    name: options.name,
    version: options.version,
    commandsDir: options.commandsDir,
    manifest: options.manifest,
    packageJsonPath: options.packageJsonPath,
    cwd: options.cwd,
    env: options.env,
  };
}

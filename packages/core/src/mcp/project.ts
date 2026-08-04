import { Writable } from "node:stream";
import type {
  CommandModule,
  CreateCliOptions,
  Manifest,
  Meta,
  RouteNode,
} from "../types.js";

/** MCP CallTool result shape (kept local so projection stays SDK-free). */
export interface CallToolResult {
  content: Array<{ type: "text"; text: string; [key: string]: unknown }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}
import { ClflyError, ValidationError } from "../errors.js";
import { listCommandFiles, loadAndValidateCommand, scanCommandsDir } from "../router/scan.js";
import {
  toJsonSchema,
  toOutputJsonSchema,
  validateSchema,
} from "../schema/to-json-schema.js";
import { treeFromManifest } from "../manifest/load.js";
import { fileUrlToPath, resolvePackageVersion } from "../version.js";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import {
  assertUniqueToolNames,
  toolNameFromPath,
} from "./tool-names.js";
import { createContext } from "../context.js";

export { toolNameFromPath, assertUniqueToolNames } from "./tool-names.js";
export {
  isMcpServeArgv,
  isMcpArgv,
  parseMcpServeFlags,
  type McpServeFlags,
} from "./parse-serve-argv.js";

export type JsonSchemaObject = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

/** MCP tool annotations (hints; untrusted unless from a trusted server). */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  title?: string;
}

export interface McpToolDef {
  /** MCP tool name derived from the command path (`users_list`, `users_show`). */
  name: string;
  description: string;
  /** JSON Schema (draft-07-ish) for tools/list inputSchema. */
  inputSchema: JsonSchemaObject;
  /** JSON Schema for tools/list outputSchema when the command exports `output`. */
  outputSchema?: JsonSchemaObject;
  /** Behavioral hints from `meta.{readOnly,destructive,idempotent}`. */
  annotations?: McpToolAnnotations;
  /** Manifest-style path (`:id` for dynamics). */
  path: string[];
  /** Source file path when known (dev scan); used in collision errors. */
  file?: string;
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
  /**
   * Filesystem root for tool invocations (`mcp serve --root`).
   * Defaults to `cwd` / process.cwd(). Sets `ctx.cwd` and enables scoping.
   */
  root?: string;
  /** Override spool threshold (bytes). Defaults to env / 64 KiB. */
  spoolThreshold?: number;
  /**
   * Explicit session handle for this serve process.
   * Defaults to `CLFLY_SESSION` or a minted id.
   */
  sessionId?: string;
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

export async function invokeMcpTool(
  tool: McpToolDef,
  args: Record<string, unknown>,
  runtime: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    scoped?: boolean;
    /** When set, large results spool and return a truncation envelope. */
    sessionStore?: import("../session/store.js").SessionStore;
    sessionId?: string;
  },
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

  const ctx = createContext({
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
    scoped: runtime.scoped ?? true,
  });

  const value = await mod.default(opts, ctx);
  const validatedValue = await validateOutput(mod, value);

  if (
    runtime.sessionStore &&
    runtime.sessionId &&
    validatedValue !== undefined &&
    runtime.sessionStore.exceedsThreshold(validatedValue)
  ) {
    const spooled = runtime.sessionStore.spool({
      sessionId: runtime.sessionId,
      command: tool.name,
      argv: ["mcp", "call", tool.name],
      value: validatedValue,
      schemaRef: mod.output ? "output" : undefined,
    });
    return buildToolResult(spooled.envelope, chunks.join(""), stderrChunks);
  }

  return buildToolResult(validatedValue, chunks.join(""), stderrChunks);
}

/** Exit code for `output` schema violations (producer bug; sysexits EX_SOFTWARE). */
export const OUTPUT_VALIDATION_EXIT = 70;

/** MCP structuredContent / outputSchema wrapper key for non-object roots. */
export const MCP_RESULT_KEY = "result";

/**
 * Project the true (manifest) output JSON Schema to MCP `outputSchema`.
 * Arrays are wrapped as `{ result: <array schema> }`; plain objects pass through;
 * primitives are omitted (no structuredContent eligibility).
 */
export function projectMcpOutputSchema(
  trueSchema: JsonSchemaObject | Record<string, unknown>,
): JsonSchemaObject | undefined {
  const schema = stripSchemaNoise(trueSchema as JsonSchemaObject);
  const t = schema.type;
  if (t === "array") {
    return {
      type: "object",
      properties: { [MCP_RESULT_KEY]: schema },
      required: [MCP_RESULT_KEY],
    };
  }
  if (t === "object" || (t === undefined && schema.properties)) {
    return schema;
  }
  if (
    t === "string" ||
    t === "number" ||
    t === "integer" ||
    t === "boolean" ||
    t === "null"
  ) {
    return undefined;
  }
  return schema;
}

/**
 * Shape a validated return value for MCP `structuredContent`.
 * Wrap is projection for valid non-object roots — never coercion for invalid ones
 * (callers must validate first).
 */
export function shapeStructuredContent(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return { [MCP_RESULT_KEY]: value };
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Validate a return value against an optional `output` schema. */
export async function validateOutput(
  mod: Pick<CommandModule, "output">,
  value: unknown,
): Promise<unknown> {
  if (!mod.output) return value;
  if (value === undefined) {
    throw new ClflyError(
      "Invalid output: command exported `output` but returned undefined",
      OUTPUT_VALIDATION_EXIT,
    );
  }
  const validated = await validateSchema(mod.output, value);
  if ("issues" in validated) {
    const body = validated.issues
      .map((i) => {
        const where = i.path.length ? i.path.join(".") : "(root)";
        return `  ${where}: ${i.message}`;
      })
      .join("\n");
    throw new ClflyError(
      `Invalid output:\n${body}`,
      OUTPUT_VALIDATION_EXIT,
    );
  }
  return validated.value;
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

/** Narrow CreateCliOptions → CreateMcpOptions (without serve flags). */
export function mcpOptionsFromCli(
  options: CreateCliOptions,
  serve?: { root?: string },
): CreateMcpOptions {
  return {
    name: options.name,
    version: options.version,
    commandsDir: options.commandsDir,
    manifest: options.manifest,
    packageJsonPath: options.packageJsonPath,
    cwd: options.cwd,
    env: options.env,
    root: serve?.root,
  };
}

export function resolveMcpRoot(options: CreateMcpOptions): string {
  const base = options.root ?? options.cwd ?? process.cwd();
  return resolve(base);
}

export function resolveMcpVersion(options: CreateMcpOptions): string {
  return (
    options.version ??
    resolvePackageVersion(
      options.packageJsonPath
        ? dirname(options.packageJsonPath)
        : options.commandsDir
          ? fileUrlToPath(options.commandsDir)
          : (options.cwd ?? process.cwd()),
      options.packageJsonPath,
    )
  );
}

export function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function buildToolResult(
  value: unknown,
  textOut: string,
  stderrChunks: string[],
): CallToolResult {
  const text =
    value !== undefined
      ? typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2)
      : textOut || "(no output)";

  const content: CallToolResult["content"] = [{ type: "text", text }];
  if (stderrChunks.length > 0) {
    content.push({
      type: "text",
      text: `stderr:\n${stderrChunks.join("")}`,
    });
  }

  const result: CallToolResult = { content };
  const structured = shapeStructuredContent(value);
  if (structured) {
    result.structuredContent = structured;
  }

  return result;
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
    if (toolNameFromPath(manifestPath) === null) continue;
    const labelPath = manifestPath.map((p) =>
      p.startsWith(":") ? p.slice(1) : p,
    );
    const mod = await loadAndValidateCommand(entry.file, labelPath);
    if (mod.meta?.interactive) continue;
    tools.push(toolDefFromModule(manifestPath, mod, entry.file));
  }

  assertUniqueToolNames(
    tools.map((t) => ({ path: t.path, file: t.file ?? t.name })),
  );
  return tools;
}

function toolsFromManifest(
  manifest: Manifest,
  coreVersion: string,
): McpToolDef[] {
  treeFromManifest(manifest, coreVersion);
  const tools: McpToolDef[] = [];
  for (const route of manifest.routes) {
    if (route.meta?.interactive) continue;
    const name = toolNameFromPath(route.path);
    if (name === null) continue;
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
    const file = route.importPath ?? name;
    const outputSchema = route.outputSchema
      ? projectMcpOutputSchema(route.outputSchema as JsonSchemaObject)
      : undefined;
    const annotations = annotationsFromMeta(route.meta);
    tools.push({
      name,
      description,
      inputSchema: mergePathParamsIntoSchema(baseSchema, pathParams),
      ...(outputSchema ? { outputSchema } : {}),
      ...(annotations ? { annotations } : {}),
      path: route.path,
      file,
      meta: route.meta,
      load: async () => {
        const mod = (await route.load()) as CommandModule & {
          default: CommandModule["default"];
        };
        if (typeof mod.default !== "function") {
          throw new ClflyError(`Tool ${name} missing default export`);
        }
        return {
          meta: mod.meta,
          args: mod.args,
          positionals: mod.positionals,
          output: mod.output,
          default: mod.default,
        };
      },
    });
  }
  assertUniqueToolNames(
    tools.map((t) => ({ path: t.path, file: t.file ?? t.name })),
  );
  return tools;
}

function toolDefFromModule(
  path: string[],
  mod: CommandModule,
  file: string,
): McpToolDef {
  const name = toolNameFromPath(path);
  if (name === null) {
    throw new ClflyError(`Refusing to project root index as an MCP tool (${file})`);
  }
  const pathParams = path.filter((p) => p.startsWith(":")).map((p) => p.slice(1));
  const base: JsonSchemaObject = mod.args
    ? (toJsonSchema(mod.args) as JsonSchemaObject)
    : { type: "object", properties: {} };
  const outputSchema = mod.output
    ? projectMcpOutputSchema(
        toOutputJsonSchema(mod.output) as JsonSchemaObject,
      )
    : undefined;
  const annotations = annotationsFromMeta(mod.meta);
  return {
    name,
    description: describeMeta(mod.meta, path),
    inputSchema: mergePathParamsIntoSchema(base, pathParams),
    ...(outputSchema ? { outputSchema } : {}),
    ...(annotations ? { annotations } : {}),
    path,
    file,
    meta: mod.meta,
    load: async () => mod,
  };
}

/** Project meta behavioral hints → MCP tool annotations (omit when unset). */
export function annotationsFromMeta(
  meta: Meta | undefined,
): McpToolAnnotations | undefined {
  if (!meta) return undefined;
  const ann: McpToolAnnotations = {};
  if (meta.readOnly !== undefined) ann.readOnlyHint = meta.readOnly;
  if (meta.destructive !== undefined) ann.destructiveHint = meta.destructive;
  if (meta.idempotent !== undefined) ann.idempotentHint = meta.idempotent;
  return Object.keys(ann).length > 0 ? ann : undefined;
}

function stripSchemaNoise(schema: JsonSchemaObject): JsonSchemaObject {
  const { $schema: _s, ...rest } = schema;
  return rest;
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

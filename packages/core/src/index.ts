export { createCli, resolveCommand, wantsJson, wantsSpool, type Cli } from "./run.js";
export { defineCommand } from "./define-command.js";
export { createContext } from "./context.js";
export {
  ClflyError,
  ValidationError,
  ReservedFlagError,
  ManifestVersionError,
} from "./errors.js";
export {
  MANIFEST_FORMAT_VERSION,
  type Manifest,
  type ManifestRoute,
  type Meta,
  type Context,
  type CommandModule,
  type CreateCliOptions,
  type RunResult,
  type AnySchema,
  type FlagInfo,
  type PositionalInfo,
  type PositionalSource,
  type RouteNode,
  type ResolvedRoute,
  type CompletionShell,
} from "./types.js";
export { assertManifestCompatible, coreMajorFromVersion } from "./version.js";
export { scanCommandsDir, loadCommandModule, listCommandFiles } from "./router/scan.js";
export { resolveRoute, listSubcommands } from "./router/resolve.js";
export { tokenize, mapToArgs, wantsHelp, wantsVersion } from "./parse/tokenize.js";
export { nearestMatch, levenshtein } from "./parse/suggest.js";
export {
  projectFlags,
  toJsonSchema,
  toOutputJsonSchema,
  validateSchema,
} from "./schema/to-json-schema.js";
export {
  projectPositionals,
  positionalNames,
  parseFlagAllowlist,
} from "./schema/project-positionals.js";
export { assertNoReservedFlags, RESERVED_FLAGS, RESERVED_ALIASES } from "./schema/reserved.js";
export { renderHelp, renderHelpExcerpt, formatPositionalToken } from "./help/render.js";
export { buildManifest, type BuildManifestOptions, type BuildManifestResult } from "./build/manifest.js";
export { treeFromManifest, completionIndexFromManifest } from "./manifest/load.js";
export { generateCompletions } from "./completions/generate.js";
export { writeJsonResult, writeJsonError } from "./json/output.js";
export { resolveUnderRoot, isInsideRoot } from "./fs/resolve-under-root.js";
export {
  createSessionStore,
  SessionStore,
  mintSessionId,
  resolveSessionId,
  parseRef,
  formatRef,
  jsonByteLength,
  buildEnvelope,
  buildPreview,
  DEFAULT_SPOOL_THRESHOLD,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_SESSION_MAX_BYTES,
  type TruncationEnvelope,
  type ManifestEntry,
  type SessionSummary,
  type SpoolResult,
} from "./session/index.js";
/** MCP projection helpers — SDK-free. Server APIs live at `@clfly/core/mcp`. */
export {
  listMcpTools,
  invokeMcpTool,
  mergePathParamsIntoSchema,
  mcpOptionsFromCli,
  validateOutput,
  projectMcpOutputSchema,
  shapeStructuredContent,
  annotationsFromMeta,
  OUTPUT_VALIDATION_EXIT,
  MCP_RESULT_KEY,
  toolNameFromPath,
  assertUniqueToolNames,
  isMcpServeArgv,
  isMcpArgv,
  parseMcpServeFlags,
  type McpToolDef,
  type McpToolAnnotations,
  type CreateMcpOptions,
  type McpServeFlags,
  type CallToolResult,
  type JsonSchemaObject,
} from "./mcp/project.js";
export { assignRestPositionals } from "./parse/rest-positionals.js";

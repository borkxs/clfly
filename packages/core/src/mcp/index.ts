/**
 * `@clfly/core/mcp` — MCP server surface.
 *
 * Importing this subpath loads `@modelcontextprotocol/sdk`. Prefer
 * `mycli mcp serve` (lazy via `createCli`) unless you need the server API
 * programmatically.
 */
export {
  createMcpServer,
  serveMcpStdio,
} from "./server.js";
export {
  listMcpTools,
  invokeMcpTool,
  mergePathParamsIntoSchema,
  mcpOptionsFromCli,
  validateOutput,
  projectMcpOutputSchema,
  shapeStructuredContent,
  OUTPUT_VALIDATION_EXIT,
  MCP_RESULT_KEY,
  toolNameFromPath,
  assertUniqueToolNames,
  isMcpServeArgv,
  isMcpArgv,
  parseMcpServeFlags,
  annotationsFromMeta,
  type McpToolDef,
  type McpToolAnnotations,
  type CreateMcpOptions,
  type McpServeFlags,
  type CallToolResult,
  type JsonSchemaObject,
} from "./project.js";
export {
  RESULT_READ_TOOL,
  RESULT_QUERY_TOOL,
  handleResultRead,
  handleResultQuery,
} from "./session-tools.js";
export {
  createSessionStore,
  SessionStore,
  resolveSessionId,
  DEFAULT_SPOOL_THRESHOLD,
} from "../session/index.js";

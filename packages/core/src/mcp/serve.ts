/**
 * Compatibility re-exports. Prefer `@clfly/core/mcp` for server APIs so the
 * main `@clfly/core` entry does not load the MCP SDK at import time.
 *
 * @deprecated Import projection helpers from `@clfly/core` and server APIs
 * from `@clfly/core/mcp`.
 */
export {
  listMcpTools,
  invokeMcpTool,
  mergePathParamsIntoSchema,
  mcpOptionsFromCli,
  validateOutput,
  toolNameFromPath,
  assertUniqueToolNames,
  isMcpServeArgv,
  isMcpArgv,
  parseMcpServeFlags,
  type McpToolDef,
  type CreateMcpOptions,
  type McpServeFlags,
  type CallToolResult,
  type JsonSchemaObject,
} from "./project.js";
export { createMcpServer, serveMcpStdio } from "./server.js";

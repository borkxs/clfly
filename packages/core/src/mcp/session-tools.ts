import type { CallToolResult, JsonSchemaObject } from "./project.js";
import { toolError } from "./project.js";
import type { SessionStore } from "../session/store.js";

/** Built-in MCP tools for clients without filesystem access to `.clfly/`. */
export const RESULT_READ_TOOL = "result_read";
export const RESULT_QUERY_TOOL = "result_query";

export function resultReadInputSchema(): JsonSchemaObject {
  return {
    type: "object",
    properties: {
      ref: {
        type: "string",
        description: "Session result ref (<sessionId>/<seq>)",
      },
      offset: {
        type: "number",
        description: "Array start index (default 0)",
        default: 0,
      },
      limit: {
        type: "number",
        description: "Max items to return (default 50, max 500)",
        default: 50,
      },
    },
    required: ["ref"],
  };
}

export function resultQueryInputSchema(): JsonSchemaObject {
  return {
    type: "object",
    properties: {
      ref: {
        type: "string",
        description: "Session result ref (<sessionId>/<seq>)",
      },
      selector: {
        type: "string",
        description:
          "Selector expression (deferred — JSONPath planned; not implemented in v1)",
      },
    },
    required: ["ref", "selector"],
  };
}

export function handleResultRead(
  store: SessionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const ref = args.ref;
  if (typeof ref !== "string" || !ref) {
    return toolError("result_read requires ref: string");
  }
  const offset = typeof args.offset === "number" ? args.offset : 0;
  const limit = typeof args.limit === "number" ? args.limit : 50;
  try {
    const sliced = store.readSlice(ref, offset, limit);
    const text = JSON.stringify(sliced, null, 2);
    return {
      content: [{ type: "text", text }],
      structuredContent: sliced as Record<string, unknown>,
    };
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

export function handleResultQuery(
  _store: SessionStore,
  _args: Record<string, unknown>,
): CallToolResult {
  return toolError(
    "result_query is not implemented yet. " +
      "v1 pages with result_read; agents with filesystem access may jq the spool path. " +
      "A JSONPath subset is planned (see docs/spec/session-store.md).",
  );
}

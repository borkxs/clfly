import { execFile } from "node:child_process";
import type { CallToolResult, JsonSchemaObject } from "./project.js";
import { shapeStructuredContent, toolError } from "./project.js";
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
          "jq program run over the spooled JSON. One output is returned as-is; several " +
          "outputs come back as an array. A result over the spool threshold is itself " +
          "spooled and returns a new ref. Examples: " +
          "`map({title, plays, last: .lastViewedAt[:10]})`, " +
          "`map(select(.year >= 2000)) | length`, " +
          "`group_by(.grandparentTitle, .season) | map({show: .[0].grandparentTitle, season: .[0].season, eps: length})`",
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

/** Overridable for tests and hosts without jq on PATH. */
export const JQ_BIN_ENV = "CLFLY_JQ";
export const RESULT_QUERY_TIMEOUT_MS = 10_000;
const JQ_MAX_BUFFER = 64 * 1024 * 1024;

export async function handleResultQuery(
  store: SessionStore,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CallToolResult> {
  const ref = args.ref;
  const selector = args.selector;
  if (typeof ref !== "string" || !ref) {
    return toolError("result_query requires ref: string");
  }
  if (typeof selector !== "string" || !selector.trim()) {
    return toolError("result_query requires selector: string (a jq program)");
  }

  let path: string;
  let sessionId: string;
  try {
    ({ path, sessionId } = store.resolveRefPath(ref));
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }

  const jq = env[JQ_BIN_ENV] || "jq";
  let stdout: string;
  try {
    stdout = await runJq(jq, selector, path);
  } catch (err) {
    return toolError(jqErrorMessage(err, jq));
  }

  let value: unknown;
  try {
    const outputs = stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as unknown);
    value = outputs.length === 1 ? outputs[0] : outputs;
  } catch {
    return toolError("result_query: jq output was not JSON");
  }

  if (store.exceedsThreshold(value)) {
    const spooled = store.spool({
      sessionId,
      command: RESULT_QUERY_TOOL,
      argv: [RESULT_QUERY_TOOL, ref, selector],
      value,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(spooled.envelope, null, 2) }],
      structuredContent: spooled.envelope as unknown as Record<string, unknown>,
    };
  }

  const result: CallToolResult = {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
  const structured = shapeStructuredContent(value);
  if (structured) result.structuredContent = structured;
  return result;
}

/** jq without a shell: the program is one argv entry, the spool file is the input. */
function runJq(bin: string, program: string, file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ["--compact-output", "--", program, file],
      { timeout: RESULT_QUERY_TIMEOUT_MS, maxBuffer: JQ_MAX_BUFFER, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) {
          reject(Object.assign(err, { stderr }));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function jqErrorMessage(err: unknown, bin: string): string {
  const e = err as NodeJS.ErrnoException & {
    stderr?: string;
    killed?: boolean;
    signal?: string;
  };
  if (e.code === "ENOENT") {
    return `result_query needs jq, and \`${bin}\` was not found. Install it with \`brew install jq\` (or set ${JQ_BIN_ENV}).`;
  }
  if (e.killed || e.signal === "SIGTERM") {
    return `result_query: jq timed out after ${RESULT_QUERY_TIMEOUT_MS / 1000}s`;
  }
  if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return "result_query: jq output exceeded 64 MiB; narrow the selector";
  }
  const detail = (e.stderr ?? "").trim() || e.message;
  return `result_query: jq failed: ${detail}`;
}

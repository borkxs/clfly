import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RouteNode } from "./types.js";

/**
 * One line per command run, so the cost of running a command directly can be
 * compared with the cost of an agent doing the same work. Argument values are
 * never recorded, only the command path.
 */
export interface Invocation {
  at: string;
  tree: string;
  command: string;
  /** `cli` (a person), `agent-shell` (an agent's Bash), or `mcp`. */
  via: "cli" | "agent-shell" | "mcp";
  ms: number;
  /** Bytes the caller received: stdout for the CLI, the tool result for MCP. */
  outBytes: number;
  exitCode: number;
  /** Claude Code session, when the caller is one; matches its transcript file name. */
  session?: string;
  /** MCP client that made the call (`claude-ai`, `claude-code`, ...), from the initialize handshake. */
  client?: string;
}

/** `CLFLY_USAGE_LOG=off` disables; any other value is the file path. */
export function invocationLogPath(env: NodeJS.ProcessEnv): string | undefined {
  const v = env.CLFLY_USAGE_LOG;
  if (v === "off" || v === "0") return undefined;
  if (v) return v;
  const state = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(state, "clfly", "invocations.jsonl");
}

export function invocationVia(env: NodeJS.ProcessEnv, mcp: boolean): Invocation["via"] {
  if (mcp) return "mcp";
  return env.CLAUDECODE || env.AI_AGENT ? "agent-shell" : "cli";
}

/** Never lets logging break a command. */
export function logInvocation(env: NodeJS.ProcessEnv, entry: Omit<Invocation, "at" | "session">): void {
  const path = invocationLogPath(env);
  if (!path) return;
  const line: Invocation = {
    at: new Date().toISOString(),
    ...entry,
    ...(env.CLAUDE_CODE_SESSION_ID ? { session: env.CLAUDE_CODE_SESSION_ID } : {}),
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(line)}\n`);
  } catch {
    // Unwritable state dir: skip.
  }
}

/** Static command path from argv (`pm search`), stopping at flags, args, or dynamic segments. */
export function commandPathFromArgv(tree: RouteNode, argv: string[]): string {
  const parts: string[] = [];
  let node = tree;
  for (const tok of argv) {
    if (tok.startsWith("-")) break;
    const next = node.children.get(tok);
    if (!next) break;
    parts.push(tok);
    node = next;
  }
  return parts.join(" ");
}

/**
 * The same stream with `write` counted. A proxy rather than a new Writable, so
 * `isTTY`, `columns` and the rest still describe the real terminal.
 */
export function countingStream(target: NodeJS.WritableStream): {
  stream: NodeJS.WritableStream;
  bytes: () => number;
} {
  let n = 0;
  const stream = new Proxy(target, {
    get(t, key) {
      if (key === "write") {
        return (chunk: string | Uint8Array, ...rest: unknown[]) => {
          n += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
          return (t.write as (...a: unknown[]) => boolean)(chunk, ...rest);
        };
      }
      const v = Reflect.get(t, key, t) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { stream, bytes: () => n };
}

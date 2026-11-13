import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandPathFromArgv,
  countingStream,
  invocationCaller,
  invocationLogPath,
  invocationVia,
  logInvocation,
  withParent,
} from "../src/invocation-log.js";
import type { RouteNode } from "../src/types.js";

const node = (children: Record<string, RouteNode> = {}): RouteNode =>
  ({ segment: null, children: new Map(Object.entries(children)) }) as RouteNode;

describe("invocation log", () => {
  it("records the static command path only, never argument values", () => {
    const tree = node({ pm: node({ search: node() }), sessions: node() });
    expect(commandPathFromArgv(tree, ["pm", "search", "Scary Movie 4", "--json"])).toBe("pm search");
    expect(commandPathFromArgv(tree, ["--help"])).toBe("");
  });

  it("appends one JSON line with the caller's session", () => {
    const file = join(mkdtempSync(join(tmpdir(), "clfly-log-")), "sub", "inv.jsonl");
    const env = { CLFLY_USAGE_LOG: file, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s1" };
    logInvocation(env, { tree: "pm", command: "search", via: invocationVia(env, false), ms: 5, outBytes: 10, exitCode: 0 });
    const line = JSON.parse(readFileSync(file, "utf8").trim());
    expect(line).toMatchObject({ tree: "pm", command: "search", via: "agent-shell", session: "s1" });
    expect(invocationLogPath({ CLFLY_USAGE_LOG: "off" })).toBeUndefined();
    expect(invocationVia({}, false)).toBe("cli");
    expect(invocationVia({}, true)).toBe("mcp");
  });

  it("tags who started a run that nobody typed", () => {
    expect(invocationCaller({}, 4242)).toBeUndefined();
    expect(invocationCaller({ CLFLY_CALLER: "tick" }, 1)).toBe("tick");
    expect(invocationCaller({ VITEST: "true" }, 4242)).toBe("test");
    expect(invocationCaller({ CI: "true" }, 4242)).toBe("test");
    expect(invocationCaller({}, 1)).toBe("launchd");
    const file = join(mkdtempSync(join(tmpdir(), "clfly-log-")), "inv.jsonl");
    logInvocation({ CLFLY_USAGE_LOG: file, CLFLY_CALLER: "tick" }, { tree: "usage", command: "sync", via: "cli", ms: 1, outBytes: 0, exitCode: 0 });
    expect(JSON.parse(readFileSync(file, "utf8").trim())).toMatchObject({ via: "cli", caller: "tick" });
  });

  it("passes the running command to its children as their parent", () => {
    const env: NodeJS.ProcessEnv = { CLFLY_PARENT: "tick run" };
    const undo = withParent([env, env], "usage sync");
    expect(env.CLFLY_PARENT).toBe("usage sync");
    expect(invocationCaller(env, 4242)).toBe("spawned");
    undo();
    expect(env.CLFLY_PARENT).toBe("tick run");
    const file = join(mkdtempSync(join(tmpdir(), "clfly-log-")), "inv.jsonl");
    logInvocation({ CLFLY_USAGE_LOG: file, CLFLY_PARENT: "cl start" }, { tree: "loop", command: "ls", via: "cli", ms: 1, outBytes: 0, exitCode: 0 });
    expect(JSON.parse(readFileSync(file, "utf8").trim())).toMatchObject({ caller: "spawned", parent: "cl start" });
  });

  it("counts bytes without hiding the target's properties", () => {
    const writes: string[] = [];
    const target = { isTTY: true, write: (s: string) => (writes.push(s), true) } as unknown as NodeJS.WritableStream;
    const { stream, bytes } = countingStream(target);
    stream.write("héllo");
    expect(bytes()).toBe(6);
    expect((stream as unknown as { isTTY: boolean }).isTTY).toBe(true);
    expect(writes).toEqual(["héllo"]);
  });
});

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import {
  createSessionStore,
  parseRefArg,
  resolveRefArgs,
} from "../src/session/index.js";
import { createCli } from "../src/run.js";
import { invokeMcpTool, listMcpTools } from "../src/mcp/project.js";

const ECHO = `import { z } from "zod";
export const meta = { description: "echo" };
export const args = z.object({
  input: z.union([z.string(), z.record(z.string(), z.unknown())]).describe("a value or @ref"),
  label: z.string().optional(),
});
export default async function (opts) { return { got: opts.input, label: opts.label ?? null }; }
`;

function collect() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  return { stream, text: () => chunks.join("") };
}

describe("parseRefArg / resolveRefArgs", () => {
  it("recognises @<sessionId>/<seq> and nothing else", () => {
    expect(parseRefArg("@abc123/001")).toBe("abc123/001");
    expect(parseRefArg("@clfly/core")).toBeUndefined();
    expect(parseRefArg("abc123/001")).toBeUndefined();
    expect(parseRefArg("@../x/001")).toBeUndefined();
    expect(parseRefArg("@a/1/2")).toBeUndefined();
    expect(parseRefArg(5)).toBeUndefined();
  });

  it("replaces ref args in place and leaves the rest", () => {
    const r = resolveRefArgs(
      { input: "@s1/002", label: "@not a ref", n: 3 },
      (ref) => ({ from: ref }),
    );
    expect(r.args).toEqual({ input: { from: "s1/002" }, label: "@not a ref", n: 3 });
    expect(r.refs).toEqual(["s1/002"]);
  });

  it("returns the same object when nothing binds", () => {
    const args = { a: "x" };
    expect(resolveRefArgs(args, () => null).args).toBe(args);
  });
});

describe("@ref binds a spooled result", () => {
  it("CLI: --input @ref reads the store under cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-refbind-cli-"));
    writeFileSync(join(dir, "echo.ts"), ECHO);
    const store = createSessionStore({ root: dir });
    const spooled = store.spool({
      sessionId: "s1",
      command: "du",
      argv: [],
      value: { name: "root", size: 7 },
    });
    const out = collect();
    const cli = createCli({
      name: "t",
      commandsDir: dir,
      cwd: dir,
      env: process.env,
      stdout: out.stream,
      stderr: collect().stream,
    });
    const result = await cli.run([
      "echo",
      "--input",
      `@${spooled.ref}`,
      "--label",
      "x",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(out.text())).toEqual({
      got: { name: "root", size: 7 },
      label: "x",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("CLI: an unknown ref is a usage error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-refbind-bad-"));
    writeFileSync(join(dir, "echo.ts"), ECHO);
    const err = collect();
    const cli = createCli({
      name: "t",
      commandsDir: dir,
      cwd: dir,
      env: process.env,
      stdout: collect().stream,
      stderr: err.stream,
    });
    const result = await cli.run(["echo", "--input", "@s1/099", "--json"]);
    expect(result.exitCode).toBe(2);
    expect(err.text()).toContain("s1/099");
    rmSync(dir, { recursive: true, force: true });
  });

  it("MCP: spool: true returns a ref for a small result, and @ref binds it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clfly-refbind-mcp-"));
    writeFileSync(join(dir, "echo.ts"), ECHO);
    const tools = await listMcpTools({ name: "t", commandsDir: dir });
    const echo = tools.find((t) => t.name === "echo")!;
    expect(
      (echo.inputSchema.properties as Record<string, unknown>).spool,
    ).toMatchObject({ type: "boolean" });

    const store = createSessionStore({ root: dir });
    const runtime = {
      cwd: dir,
      env: process.env,
      scoped: true,
      sessionStore: store,
      sessionId: "m1",
    };
    const first = await invokeMcpTool(
      echo,
      { input: { name: "root", size: 7 }, spool: true },
      runtime,
    );
    expect(first.structuredContent).toMatchObject({
      truncated: true,
      ref: "m1/001",
    });

    const second = await invokeMcpTool(echo, { input: "@m1/001" }, runtime);
    expect(second.structuredContent).toEqual({
      got: { got: { name: "root", size: 7 }, label: null },
      label: null,
    });

    const missing = await invokeMcpTool(echo, { input: "@m1/009" }, runtime).catch(
      (e: Error) => e.message,
    );
    expect(String(missing)).toContain("m1/009");
    rmSync(dir, { recursive: true, force: true });
  });
});

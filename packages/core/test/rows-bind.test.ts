import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { invokeMcpTool, listMcpTools, type McpToolDef } from "../src/mcp/project.js";
import { ownRowTree } from "../src/mcp/row-trees.js";
import { createCli } from "../src/run.js";
import { createSessionStore } from "../src/session/store.js";
import { parseRowRefArg, resolveRefArgs } from "../src/session/ref-args.js";
import type { RowTree } from "../src/rows/index.js";

const zodUrl = pathToFileURL(createRequire(import.meta.url).resolve("zod")).href;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A pm-shaped tree: `ls` yields pm.item rows, `du` takes folders, `rm` takes transfers, `echo` is untyped. */
function pmTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "clfly-rows-bind-"));
  dirs.push(dir);
  const files: Record<string, string> = {
    "ls.ts": `import { z } from "ZOD";
export const meta = { description: "List a folder", rows: { type: "pm.item", key: "[]", ref: "{path}/{name}", defaults: { path: "/" } } };
export const accepts = { path: { type: "pm.item", where: { type: "folder" } } };
export const args = z.object({ path: z.string().optional() });
export default async function () {
  return [{ name: "Heat.1995", type: "folder" }, { name: "a.mkv", type: "file" }];
}
`,
    "du.ts": `import { z } from "ZOD";
export const meta = { description: "Folder size" };
export const accepts = { path: { type: "pm.item", where: { type: "folder" } } };
export const args = z.object({ path: z.string() });
export default async function (o: { path: string }) { return { path: o.path, bytes: 1 }; }
`,
    "rm.ts": `import { z } from "ZOD";
export const accepts = { id: "pm.transfer" };
export const args = z.object({ id: z.string() });
export default async function (o: { id: string }) { return { removed: o.id }; }
`,
    "echo.ts": `import { z } from "ZOD";
export const args = z.object({ doc: z.unknown() });
export default async function (o: { doc: unknown }) { return { doc: o.doc }; }
`,
  };
  for (const [rel, body] of Object.entries(files)) {
    writeFileSync(join(dir, rel), body.replaceAll("ZOD", zodUrl));
  }
  return dir;
}

async function setup() {
  const dir = pmTree();
  const tools = await listMcpTools({ name: "pm", commandsDir: dir });
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  const store = createSessionStore({ root: dir });
  const other: RowTree = {
    name: "plex",
    routes: [{ path: ["scan"], flags: [{ name: "path", type: "string", optional: true, accepts: "pm.item" }], positionals: [] }],
  };
  const runtime = {
    cwd: dir,
    env: process.env,
    scoped: true,
    sessionStore: store,
    sessionId: "rows01",
    rowTrees: async () => [await ownRowTree("pm", tools), other],
  };
  const call = (t: McpToolDef, args: Record<string, unknown>) => invokeMcpTool(t, args, runtime);
  return { dir, tool, store, call };
}

describe("typed rows over MCP", () => {
  it("envelope carries rows {type, key, count} and acceptors per type", async () => {
    const { tool, call } = await setup();
    const res = await call(tool("ls"), { path: "/" });
    const env = res.structuredContent as Record<string, unknown>;
    expect(env).toMatchObject({
      truncated: false,
      ref: "rows01/001",
      rows: { type: "pm.item", key: "[]", count: 2 },
      preview: [{ name: "Heat.1995" }, { name: "a.mkv" }],
    });
    expect(env.acceptors).toEqual(
      expect.arrayContaining([
        { tree: "pm", route: ["du"], arg: "path", where: { type: "folder" } },
        { tree: "pm", route: ["ls"], arg: "path", where: { type: "folder" } },
        { tree: "plex", route: ["scan"], arg: "path" },
      ]),
    );
    expect(env.acceptors).toHaveLength(3);
  });

  it("untyped results are unchanged (no spool under threshold)", async () => {
    const { tool, call } = await setup();
    const res = await call(tool("du"), { path: "/x" });
    expect(res.structuredContent).toEqual({ path: "/x", bytes: 1 });
  });

  it("@<ref>#<n> binds row n's templated ref", async () => {
    const { tool, call } = await setup();
    await call(tool("ls"), { path: "/" });
    const res = await call(tool("du"), { path: "@rows01/001#0" });
    expect(res.structuredContent).toEqual({ path: "/Heat.1995", bytes: 1 });
  });

  it("where mismatch is a tool error", async () => {
    const { tool, call } = await setup();
    await call(tool("ls"), { path: "/" });
    await expect(call(tool("du"), { path: "@rows01/001#1" })).rejects.toThrow(/pm\.item row that fails "path"'s where/);
  });

  it("type mismatch names both types", async () => {
    const { tool, call } = await setup();
    await call(tool("ls"), {});
    await expect(call(tool("rm"), { id: "@rows01/001#0" })).rejects.toThrow(
      /is a pm\.item row, but "id" accepts pm\.transfer/,
    );
  });

  it("out-of-range n errors", async () => {
    const { tool, call } = await setup();
    await call(tool("ls"), {});
    await expect(call(tool("du"), { path: "@rows01/001#2" })).rejects.toThrow(/#2 is out of range: .* has 2 pm\.item rows/);
  });

  it("an untyped arg takes the row ref without a check; plain @ref binds the whole result", async () => {
    const { tool, call } = await setup();
    await call(tool("ls"), {});
    const one = await call(tool("echo"), { doc: "@rows01/001#1" });
    expect(one.structuredContent).toEqual({ doc: "/a.mkv" });
    const whole = await call(tool("echo"), { doc: "@rows01/001" });
    expect(whole.structuredContent).toEqual({ doc: [{ name: "Heat.1995", type: "folder" }, { name: "a.mkv", type: "file" }] });
  });

  it("a ref without typed rows refuses #n", async () => {
    const { store } = await setup();
    store.spool({ sessionId: "rows01", command: "x", argv: [], value: [1, 2] });
    expect(() => resolveRefArgs({ a: "@rows01/001#0" }, store)).toThrow(/has no typed rows/);
  });

  it("producer args fill placeholders the row lacks", async () => {
    const { tool, call } = await setup();
    await call(tool("ls"), { path: "/movies" });
    const res = await call(tool("du"), { path: "@rows01/001#0" });
    expect(res.structuredContent).toEqual({ path: "/movies/Heat.1995", bytes: 1 });
  });
});

describe("typed rows on the CLI", () => {
  it("--json --spool prints the ref with rows; #n binds on the next call", async () => {
    const dir = pmTree();
    const out = sink();
    const err = sink();
    const cli = createCli({
      name: "pm",
      commandsDir: dir,
      cwd: dir,
      env: { ...process.env, CLFLY_SESSION: "clirows" },
      stdout: out.stream,
      stderr: err.stream,
    });
    expect((await cli.run(["ls", "--json", "--spool"])).exitCode).toBe(0);
    expect(JSON.parse(out.text())).toMatchObject({
      ref: "clirows/001",
      truncated: false,
      rows: { type: "pm.item", count: 2 },
    });
    const out2 = sink();
    const cli2 = createCli({
      name: "pm",
      commandsDir: dir,
      cwd: dir,
      env: process.env,
      stdout: out2.stream,
      stderr: err.stream,
    });
    expect((await cli2.run(["du", "@clirows/001#0", "--json"])).exitCode).toBe(0);
    expect(JSON.parse(out2.text())).toEqual({ path: "/Heat.1995", bytes: 1 });
  });
});

describe("parseRowRefArg", () => {
  it("parses @sid/seq#n and leaves other values alone", () => {
    expect(parseRowRefArg("@abc/001#3")).toEqual({ ref: "abc/001", n: 3 });
    expect(parseRowRefArg("@abc/001")).toBeUndefined();
    expect(parseRowRefArg("@clfly/core#1")).toBeUndefined();
    expect(parseRowRefArg("abc/001#1")).toBeUndefined();
  });
});

function sink() {
  const chunks: string[] = [];
  return {
    stream: new Writable({
      write(c, _e, cb) {
        chunks.push(String(c));
        cb();
      },
    }),
    text: () => chunks.join(""),
  };
}


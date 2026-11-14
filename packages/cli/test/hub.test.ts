import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TreeClient } from "../src/hub/client.js";
import { type HubIndex, loadIndex, renderInstructions, resolveTool, searchIndex, unwrapCall } from "../src/hub/hub.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "clfly-hub-"));
  dirs.push(d);
  return d;
};

const index: HubIndex = {
  trees: [
    {
      name: "pm",
      path: "/x/pm",
      bin: "/bin/pm",
      description: "Premiumize.me CLI: search indexers, manage transfers",
      stamp: 1,
      tools: [
        { tree: "pm", name: "status", description: "List Premiumize transfers still running" },
        { tree: "pm", name: "rm", description: "Delete a Premiumize transfer", destructive: true },
        { tree: "pm", name: "prune_apply", description: "Delete reviewed units", destructive: true },
      ],
    },
    {
      name: "texts-cli",
      path: "/x/texts",
      bin: "/bin/texts-cli",
      description: "clfly tree that spawns the corpus and align CLIs",
      stamp: 1,
      tools: [{ tree: "texts-cli", name: "align_agree", description: "Agreement between two alignments" }],
    },
  ],
};

describe("clfly hub", () => {
  it("ranks command-word matches over description matches", () => {
    const hits = searchIndex(index, "premiumize transfers");
    expect(hits[0]?.name).toBe("status");
    expect(searchIndex(index, "align")[0]?.tree).toBe("texts-cli");
    expect(searchIndex(index, "zzz")).toEqual([]);
  });

  it("resolves every spelling of a tool and suggests near misses", () => {
    expect(resolveTool(index, "pm status").tool).toBe("status");
    expect(resolveTool(index, "pm_prune_apply").tool).toBe("prune_apply");
    expect(resolveTool(index, "mcp__pm__rm").known?.destructive).toBe(true);
    expect(resolveTool(index, "texts-cli align agree").tree.name).toBe("texts-cli");
    expect(resolveTool(index, "pm result_read").known).toBeUndefined();
    expect(() => resolveTool(index, "pm stauts")).toThrow(/Close: pm status/);
    expect(() => resolveTool(index, "nope ls")).toThrow(/No linked tree/);
  });

  it("renders a flat keyword line per tree without the clfly-tree boilerplate", () => {
    const text = renderInstructions(index);
    expect(text).toMatch(/^- pm \(Premiumize\.me CLI\): status rm prune apply$/m);
    expect(text).toContain("- texts-cli (spawns the corpus and align CLIs): align agree");
    expect(text).toMatch(/call-destructive/);
  });

  it("lists every command word, and a tree that failed to list with its error", () => {
    const tools = Array.from({ length: 13 }, (_, i) => ({ tree: "big", name: `w${i}`, description: "" }));
    const text = renderInstructions({
      trees: [
        { name: "big", path: "/x/big", bin: "/bin/big", stamp: 1, tools },
        { name: "dash", path: "/x/dash", bin: "dash", stamp: 1, tools: [], error: "/bin/dash mcp serve exited (2)" },
      ],
    });
    expect(text).toMatch(/^- big: w0 w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12$/m);
    expect(text).toMatch(/^- dash: unavailable \(\/bin\/dash mcp serve exited \(2\)\)$/m);
  });

  it("unwraps a tree's result and raises its errors", () => {
    expect(unwrapCall("pm du", { content: [{ type: "text", text: '{"a":1}' }] })).toEqual({ a: 1 });
    expect(unwrapCall("pm du", { content: [{ type: "text", text: "plain" }] })).toEqual({ text: "plain" });
    // An array return arrives wrapped in structuredContent; the command returned the array.
    expect(unwrapCall("plex watched", { content: [{ type: "text", text: '[{"t":1}]' }], structuredContent: { result: [{ t: 1 }] } })).toEqual([{ t: 1 }]);
    // An object that really has a single `result` key passes through as is.
    expect(unwrapCall("x y", { content: [{ type: "text", text: '{"result":[1]}' }], structuredContent: { result: [1] } })).toEqual({ result: [1] });
    expect(() => unwrapCall("pm du", { isError: true, content: [{ type: "text", text: "boom" }] })).toThrow(/pm du: boom/);
  });

  it("caches each tree's tools until its command files change", async () => {
    const home = temp();
    const tree = join(home, "ytid");
    mkdirSync(join(tree, "commands"), { recursive: true });
    writeFileSync(join(tree, "package.json"), JSON.stringify({ name: "ytid", description: "Video ids" }));
    writeFileSync(join(tree, "commands", "id.ts"), "");
    mkdirSync(join(home, "clfly"), { recursive: true });
    writeFileSync(
      join(home, "clfly", "registry.json"),
      JSON.stringify({ formatVersion: 1, trees: { ytid: { name: "ytid", path: tree, coreVersion: "0.3.0", registered: {} } } }),
    );
    const env = { ...process.env, CLFLY_HOME: join(home, "clfly"), XDG_CONFIG_HOME: home, XDG_STATE_HOME: join(home, "state") };
    let lists = 0;
    const listTools = async () => {
      lists++;
      return [{ name: "id", description: "Print the id", annotations: { readOnlyHint: true } }, { name: "result_read" }];
    };
    const opts = { env, listTools, whichFn: () => "/bin/ytid" };
    const first = await loadIndex(opts);
    expect(first.trees[0]?.tools).toEqual([{ tree: "ytid", name: "id", description: "Print the id", readOnly: true }]);
    await loadIndex(opts);
    expect(lists).toBe(1);
    const later = new Date(Date.now() + 5000);
    utimesSync(join(tree, "commands", "id.ts"), later, later);
    await loadIndex(opts);
    expect(lists).toBe(2);
  });

  it("talks JSON-RPC to a tree's mcp serve and keeps it up between calls", async () => {
    const bin = join(temp(), "fake-tree");
    writeFileSync(
      bin,
      `#!/usr/bin/env node
let n = 0, buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.id === undefined) continue;
    const result = m.method === "tools/list" ? { tools: [{ name: "echo" }] }
      : m.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify({ got: m.params.arguments, call: ++n }) }] }
      : {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
  }
});
`,
    );
    chmodSync(bin, 0o755);
    const client = new TreeClient(bin, tmpdir(), process.env);
    try {
      expect((await client.listTools()).map((t) => t.name)).toEqual(["echo"]);
      expect(unwrapCall("t echo", await client.callTool("echo", { x: 1 }))).toEqual({ got: { x: 1 }, call: 1 });
      expect(unwrapCall("t echo", await client.callTool("echo", {}))).toEqual({ got: {}, call: 2 });
    } finally {
      client.close();
    }
  });
});

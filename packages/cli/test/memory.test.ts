import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderMemory, summarizeTree, type ListTools } from "../src/skill/memory.js";

describe("clfly memory", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function treeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "clfly-memory-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "ytid", description: "Extract a YouTube video id" }));
    return dir;
  }

  it("lists each tree's commands with required args in a memory file", async () => {
    const listTools: ListTools = async () => [
      { name: "id", description: "Print the video id", inputSchema: { required: ["url"] } },
      { name: "cache_clear", description: "Drop the cache" },
    ];
    const tree = await summarizeTree({
      name: "ytid",
      path: treeDir(),
      harnesses: ["claude-code:user"],
      bin: "/bin/ytid",
      listTools,
    });
    expect(tree.error).toBeUndefined();
    const body = renderMemory({ name: "clfly-trees", trees: [tree] });
    expect(body).toContain("name: clfly-trees");
    expect(body).toContain("type: reference");
    expect(body).toContain("## ytid — Extract a YouTube video id");
    expect(body).toContain("- `ytid cache clear` — Drop the cache");
    expect(body).toContain("- `ytid id <url>` — Print the video id");
    expect(body).toContain("MCP: claude-code:user");
  });

  it("records a tree it cannot list instead of failing", async () => {
    const tree = await summarizeTree({ name: "ytid", path: treeDir(), harnesses: [], bin: null });
    expect(tree.error).toContain("not on PATH");
    expect(renderMemory({ name: "x", trees: [tree] })).toContain("could not list commands");
  });
});

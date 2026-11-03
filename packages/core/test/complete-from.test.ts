import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildManifest } from "../src/build/manifest.js";
import {
  completeFromArgv,
  readCompleteFrom,
  selectCompletions,
} from "../src/complete/index.js";

// Temp trees import zod from this package so the fixture needs no install.
const zodUrl = pathToFileURL(createRequire(import.meta.url).resolve("zod")).href;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "clfly-complete-"));
  tempDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, body.replaceAll("ZOD", zodUrl));
  }
  return dir;
}

const searchCf = { cmd: "pm search", args: { query: "$query", limit: 20 }, field: "hits[].infoHash", label: "title", sub: "indexer" };

describe("completeFrom in the manifest", () => {
  it("projects zod .meta({ completeFrom }) onto flags and positionals", async () => {
    const dir = tree({
      "add.mjs": `
        import { z } from "ZOD";
        export const positionals = z.object({
          magnet: z.string().meta({ completeFrom: ${JSON.stringify(searchCf)} }),
        });
        export const args = z.object({
          magnet: z.string(),
          query: z.string().optional(),
          tool: z.string().optional().meta({ completeFrom: { cmd: "tools", field: "[]" } }),
        });
        export default () => null;
      `,
    });
    const { manifest, outFile } = await buildManifest({ commandsDir: dir });
    expect(outFile).toBeUndefined();
    const route = manifest.routes.find((r) => r.path[0] === "add")!;
    expect(route.importPath).toBeUndefined();
    expect(route.positionals[0]).toMatchObject({ name: "magnet", completeFrom: searchCf });
    expect(route.flags.find((f) => f.name === "tool")?.completeFrom).toEqual({ cmd: "tools", field: "[]" });
    expect(route.flags.find((f) => f.name === "query")).not.toHaveProperty("completeFrom");
  });

  it("applies the module complete export to path params and serializes it", async () => {
    const dir = tree({
      "jobs/[job]/show.mjs": `
        export const complete = { job: { cmd: "ls", field: "jobs[].name", sub: "description" } };
        export default () => null;
      `,
    });
    const outFile = join(dir, "out", "manifest.mjs");
    const { manifest } = await buildManifest({ commandsDir: dir, outFile });
    expect(manifest.routes[0]!.positionals[0]).toMatchObject({
      name: "job",
      source: "path",
      completeFrom: { cmd: "ls", field: "jobs[].name", sub: "description" },
    });
    expect(existsSync(outFile)).toBe(true);
    const generated = (await import(outFile)).manifest;
    expect(generated.routes[0].positionals[0].completeFrom.field).toBe("jobs[].name");
  });

  it("rejects a complete export naming no arg", async () => {
    const dir = tree({
      "rm.mjs": `
        export const complete = { nmae: { cmd: "ls", field: "[]" } };
        export default () => null;
      `,
    });
    await expect(buildManifest({ commandsDir: dir })).rejects.toThrow(/"nmae", which is not a flag or positional/);
  });

  it("rejects a malformed completeFrom", async () => {
    const dir = tree({
      "rm.mjs": `
        import { z } from "ZOD";
        export const args = z.object({ id: z.string().meta({ completeFrom: { cmd: "ls" } }) });
        export default () => null;
      `,
    });
    await expect(buildManifest({ commandsDir: dir })).rejects.toThrow(/flag --id: `field`/);
  });
});

describe("completeFrom helpers", () => {
  it("readCompleteFrom passes absent values and trims", () => {
    expect(readCompleteFrom(undefined, "x")).toBeUndefined();
    expect(readCompleteFrom({ cmd: " ls ", field: "[]" }, "x")).toEqual({ cmd: "ls", field: "[]" });
    expect(() => readCompleteFrom({ cmd: "ls", field: "a", args: { a: [] } }, "x")).toThrow(/args.a/);
  });

  it("completeFromArgv strips the tree name and fills $refs", () => {
    expect(completeFromArgv(searchCf, "pm", { query: "dune" })).toEqual([
      "search", "--query", "dune", "--limit", "20", "--json",
    ]);
    // Unfilled refs drop the flag rather than sending an empty value.
    expect(completeFromArgv(searchCf, "pm")).toEqual(["search", "--limit", "20", "--json"]);
    expect(completeFromArgv({ cmd: "ls", field: "[]", args: { all: true, quiet: false } }, "run")).toEqual([
      "ls", "--all", "--json",
    ]);
  });

  it("selectCompletions maps over [] and resolves label/sub per element", () => {
    const out = {
      hits: [
        { infoHash: "aa", title: "Dune 2021", indexer: "x" },
        { infoHash: "bb", title: "Dune Part Two" },
        { infoHash: "aa", title: "dup" },
        { title: "no hash" },
      ],
    };
    expect(selectCompletions(out, searchCf)).toEqual([
      { value: "aa", label: "Dune 2021", sub: "x" },
      { value: "bb", label: "Dune Part Two" },
    ]);
    expect(selectCompletions(["a", "b", 3], { cmd: "x", field: "[]" })).toEqual([
      { value: "a" }, { value: "b" }, { value: "3" },
    ]);
    expect(
      selectCompletions({ rows: [{ meta: { id: "s1" }, name: "Songs" }] }, { cmd: "x", field: "rows[].meta.id", label: "name" }),
    ).toEqual([{ value: "s1", label: "Songs" }]);
    expect(selectCompletions({ rows: "nope" }, { cmd: "x", field: "rows[].id" })).toEqual([]);
  });
});

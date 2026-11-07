import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildManifest } from "../src/build/manifest.js";
import {
  acceptorsFor,
  producersFor,
  readAccepts,
  readRows,
  rowChoices,
  rowRef,
  rowsOf,
  type RowTree,
} from "../src/rows/index.js";

const zodUrl = pathToFileURL(createRequire(import.meta.url).resolve("zod")).href;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "clfly-rows-"));
  tempDirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, body.replaceAll("ZOD", zodUrl));
  }
  return dir;
}

const itemRows = { type: "pm.item", key: "[]", ref: "{path}/{name}", defaults: { path: "/" }, label: "name", sub: "type" };

/** A pm-shaped tree plus a second tree that joins by declaring `accepts`. */
const trees: RowTree[] = [
  {
    name: "pm",
    routes: [
      {
        path: ["ls"],
        meta: { description: "List a folder", rows: itemRows },
        flags: [{ name: "id", type: "string", optional: true }],
        positionals: [{ name: "path", source: "export", optional: true, accepts: "pm.item", where: { type: "folder" } }],
      },
      {
        path: ["download"],
        meta: { description: "Download a file" },
        flags: [],
        positionals: [{ name: "path", source: "export", optional: true, accepts: "pm.item", where: { type: "file" } }],
      },
      {
        path: ["status"],
        meta: { rows: { type: "pm.transfer", key: "[]", ref: "{id}" } },
        flags: [],
        positionals: [],
      },
      {
        path: ["links"],
        flags: [],
        positionals: [{ name: "transfer-id", source: "export", optional: true, accepts: "pm.transfer", where: { state: ["finished"] } }],
      },
      {
        path: ["rm"],
        flags: [],
        positionals: [{ name: "transfer-id", source: "export", optional: false, accepts: "pm.transfer" }],
      },
    ],
  },
  {
    name: "plex",
    routes: [
      {
        path: ["scan"],
        flags: [{ name: "path", type: "string", optional: true, accepts: "pm.item" }],
        positionals: [],
      },
    ],
  },
];

describe("rowRef", () => {
  it("fills from the row, then producer args, then defaults, without doubling a slash", () => {
    expect(rowRef(itemRows, { name: "Heat.1995" })).toBe("/Heat.1995");
    expect(rowRef(itemRows, { name: "Heat.1995" }, { path: "Library/Movies" })).toBe("Library/Movies/Heat.1995");
    expect(rowRef(itemRows, { name: "x" }, { path: "Library/" })).toBe("Library/x");
    expect(rowRef({ type: "a.b", key: "[]", ref: "{a.b}-{c}" }, { a: { b: 1 }, c: true })).toBe("1-true");
  });

  it("returns undefined when a placeholder has no value", () => {
    expect(rowRef({ type: "pm.hit", key: "hits[]", ref: "{magnet}" }, { title: "no magnet" })).toBeUndefined();
  });
});

describe("rowsOf", () => {
  it("reads rows at the key", () => {
    expect(rowsOf([{ a: 1 }, { a: 2 }], { key: "[]" })).toEqual([{ a: 1 }, { a: 2 }]);
    expect(rowsOf({ hits: [{ m: "x" }] }, { key: "hits[]" })).toEqual([{ m: "x" }]);
    expect(rowsOf({ hits: null }, { key: "hits[]" })).toEqual([]);
  });
});

describe("acceptorsFor", () => {
  it("offers every route in any tree whose arg accepts the row type and passes where", () => {
    const folder = acceptorsFor(trees, { tree: "pm", route: ["ls"] }, { name: "Heat.1995", type: "folder" });
    expect(folder).toEqual([
      { tree: "pm", route: ["ls"], arg: "path", value: "/Heat.1995", positional: true, description: "List a folder" },
      { tree: "plex", route: ["scan"], arg: "path", value: "/Heat.1995", positional: false },
    ]);
    const file = acceptorsFor(trees, { tree: "pm", route: ["ls"] }, { name: "a.mkv", type: "file" }, { path: "Movies" });
    expect(file.map((a) => [a.tree, a.route.join(" "), a.value])).toEqual([
      ["pm", "download", "Movies/a.mkv"],
      ["plex", "scan", "Movies/a.mkv"],
    ]);
  });

  it("matches where against an array of allowed values", () => {
    const running = acceptorsFor(trees, { tree: "pm", route: ["status"] }, { id: "t1", state: "downloading" });
    expect(running.map((a) => a.route[0])).toEqual(["rm"]);
    const done = acceptorsFor(trees, { tree: "pm", route: ["status"] }, { id: "t1", state: "finished" });
    expect(done.map((a) => `${a.route[0]}=${a.value}`)).toEqual(["links=t1", "rm=t1"]);
  });

  it("returns nothing for a producer without rows, a row failing when, or an unknown route", () => {
    expect(acceptorsFor(trees, { tree: "pm", route: ["rm"] }, { id: "x" })).toEqual([]);
    expect(acceptorsFor(trees, { tree: "nope", route: ["ls"] }, { name: "x" })).toEqual([]);
    const gated: RowTree[] = [
      { name: "t", routes: [{ path: ["ls"], meta: { rows: { ...itemRows, when: { type: "folder" } } }, flags: [], positionals: [] }, ...trees[0]!.routes.slice(1)] },
    ];
    expect(acceptorsFor(gated, { tree: "t", route: ["ls"] }, { name: "f", type: "file" })).toEqual([]);
  });
});

describe("producersFor / rowChoices", () => {
  it("finds producers by type and turns their output into choices for an acceptor", () => {
    expect(producersFor(trees, "pm.item")).toEqual([{ tree: "pm", route: ["ls"], rows: itemRows }]);
    const output = [
      { id: "1", name: "Movies", type: "folder" },
      { id: "2", name: "a.mkv", type: "file" },
      { id: "3", name: "Movies", type: "folder" },
    ];
    expect(rowChoices(output, itemRows, {}, { type: "folder" })).toEqual([
      { value: "/Movies", label: "Movies", sub: "folder" },
    ]);
  });
});

describe("validation", () => {
  it("normalizes and rejects malformed rows/accepts", () => {
    expect(readRows(undefined, "x")).toBeUndefined();
    expect(readRows({ type: "pm.hit", key: " hits[] ", ref: "{magnet}" }, "x")).toEqual({ type: "pm.hit", key: "hits[]", ref: "{magnet}" });
    expect(() => readRows({ type: "item", key: "[]", ref: "{id}" }, "x")).toThrow(/namespaced/);
    expect(() => readRows({ type: "pm.item", key: "rows", ref: "{id}" }, "x")).toThrow(/key/);
    expect(() => readRows({ type: "pm.item", key: "[]", ref: "id" }, "x")).toThrow(/ref/);
    expect(readAccepts("pm.item", "x")).toEqual({ accepts: "pm.item" });
    expect(readAccepts({ type: "pm.item", where: { type: "folder" } }, "x")).toEqual({ accepts: "pm.item", where: { type: "folder" } });
    expect(() => readAccepts({ type: "pm.item", where: { type: {} } }, "x")).toThrow(/where/);
  });
});

describe("rows/accepts in the manifest", () => {
  it("carries meta.rows, the accepts export and the accepts keyword onto routes", async () => {
    const dir = tree({
      "ls.mjs": `
        import { z } from "ZOD";
        export const meta = { description: "List", rows: { type: "pm.item", key: "[]", ref: "{path}/{name}", defaults: { path: "/" } } };
        export const positionals = z.object({ path: z.string().optional() });
        export const accepts = { path: { type: "pm.item", where: { type: "folder" } } };
        export const args = z.object({ path: z.string().optional() });
        export default () => [];
      `,
      "[job].mjs": `
        import { z } from "ZOD";
        export const accepts = { job: "run.job" };
        export const args = z.object({
          job: z.string(),
          to: z.string().optional().meta({ accepts: "pm.item", where: { type: "folder" } }),
        });
        export default () => null;
      `,
    });
    const { manifest } = await buildManifest({ commandsDir: dir });
    const ls = manifest.routes.find((r) => r.path[0] === "ls")!;
    expect(ls.meta?.rows).toEqual({ type: "pm.item", key: "[]", ref: "{path}/{name}", defaults: { path: "/" } });
    expect(ls.positionals[0]).toMatchObject({ name: "path", accepts: "pm.item", where: { type: "folder" } });
    const job = manifest.routes.find((r) => r.path[0] === ":job")!;
    expect(job.positionals[0]).toMatchObject({ name: "job", source: "path", accepts: "run.job" });
    expect(job.flags.find((f) => f.name === "to")).toMatchObject({ accepts: "pm.item", where: { type: "folder" } });
  });

  it("fails the build on a malformed rows or an accepts key naming no arg", async () => {
    const bad = tree({ "ls.mjs": `export const meta = { rows: { type: "pm.item", key: "[]" } }; export default () => [];` });
    await expect(buildManifest({ commandsDir: bad })).rejects.toThrow(/meta.rows on command "ls"/);
    const stale = tree({
      "rm.mjs": `
        import { z } from "ZOD";
        export const accepts = { gone: "pm.item" };
        export const args = z.object({ id: z.string() });
        export default () => null;
      `,
    });
    await expect(buildManifest({ commandsDir: stale })).rejects.toThrow(/names "gone"/);
  });
});

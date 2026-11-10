import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// src/rows.ts is TypeScript that imports the Raycast lib; bundle it (with the helpers the tests need) once.
const here = dirname(fileURLToPath(import.meta.url));
let m;
before(async () => {
  const out = join(mkdtempSync(join(tmpdir(), "pocket-rows-")), "rows.mjs");
  await build({
    stdin: {
      contents: `export * from "./src/rows"; export { analyze } from "../raycast/src/lib/line"; export { chainsFor, shapeOutput } from "../raycast/src/lib/model";`,
      resolveDir: join(here, ".."),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "silent",
  });
  m = await import(pathToFileURL(out).href);
});

// The fixture manifest predates typed rows: pm ls produces pm.item rows; ls and du take folders, download takes files.
const { trees: base } = JSON.parse(readFileSync(join(here, "../../raycast/test/fixtures/manifest.json"), "utf8"));
const trees = JSON.parse(JSON.stringify(base));
const pm = trees.find((t) => t.name === "pm");
const route = (p) => pm.routes.find((r) => r.path.join(" ") === p);
const ls = route("ls");
ls.meta = { ...ls.meta, rows: { type: "pm.item", key: "[]", ref: "{path}/{name}", defaults: { path: "/" }, label: "name" } };
Object.assign(ls.positionals[0], { accepts: "pm.item", where: { type: "folder" } });
Object.assign(route("du").positionals[0], { accepts: "pm.item", where: { type: "folder" } });
Object.assign(route("download").positionals[0], { accepts: "pm.item", where: { type: "file" } });

const rows = [
  { name: "Heat.1995", type: "folder" },
  { name: "Wizard People.iso", type: "file" },
];
const chains = () => m.chainsFor(pm, ls, m.shapeOutput(rows), { trees, args: {} });

test("↓ from the line moves into the rows; ↑ from the first row goes back", () => {
  assert.equal(m.typedRows(ls, rows), true);
  assert.equal(m.typedRows(route("status"), rows), false, "a route without rows keeps the old keys");
  const step = m.rowKey({ at: "line" }, "down", rows, chains());
  assert.deepEqual(step.focus, { at: "rows", sel: 0 });
  assert.deepEqual(m.rowKey(step.focus, "down", rows, chains()).focus, { at: "rows", sel: 1 });
  assert.deepEqual(m.rowKey({ at: "rows", sel: 1 }, "down", rows, chains()).focus, { at: "rows", sel: 1 });
  assert.deepEqual(m.rowKey({ at: "rows", sel: 0 }, "up", rows, chains()).focus, { at: "line" });
  assert.equal(m.rowKey({ at: "line" }, "enter", rows, chains()), undefined, "↵ on the line is the line's");
});

test("a row with one action: ↵ takes it directly, rewriting the line", () => {
  const step = m.rowKey({ at: "rows", sel: 1 }, "enter", rows, chains());
  assert.deepEqual(step.focus, { at: "line" });
  assert.equal(step.take, 'pm download "/Wizard People.iso" ');
});

test("a row with several actions: ↵ lists them as route + one-line description", () => {
  const acts = m.rowActions(chains(), rows[0]);
  assert.deepEqual(acts.map((a) => a.label).sort(), ["pm du", "pm ls"]);
  for (const a of acts) assert.ok(a.description && !a.description.includes("\n"));
  const step = m.rowKey({ at: "rows", sel: 0 }, "enter", rows, chains());
  assert.deepEqual(step.focus, { at: "actions", row: 0, sel: 0 });
  assert.equal(step.take, undefined);
});

test("↵ on an action rewrites the line, quoted, and the line runs when nothing else is required", () => {
  const acts = m.rowActions(chains(), rows[0]);
  const lsAt = acts.findIndex((a) => a.label === "pm ls");
  const step = m.rowKey({ at: "actions", row: 0, sel: lsAt }, "enter", rows, chains());
  assert.deepEqual(step.focus, { at: "line" });
  assert.equal(step.take, "pm ls /Heat.1995 ");
  assert.equal(m.analyze(trees, step.take).runnable, true);
  // A quoted value round-trips through the line parser.
  const file = m.rowKey({ at: "rows", sel: 1 }, "enter", rows, chains());
  assert.equal(m.analyze(trees, file.take).values.path, "/Wizard People.iso");
});

test("esc: actions → rows → line", () => {
  const back = m.rowKey({ at: "actions", row: 0, sel: 1 }, "escape", rows, chains());
  assert.deepEqual(back.focus, { at: "rows", sel: 0 });
  assert.deepEqual(m.rowKey(back.focus, "escape", rows, chains()).focus, { at: "line" });
});

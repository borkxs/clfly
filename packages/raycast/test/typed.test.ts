import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accept, analyze, candidates, onEnter, typedChoices, typedDir, typedSource } from "../src/lib/line";
import type { Tree } from "../src/lib/model";

// The fixture manifest predates typed rows: add pm ls's rows and the accepts it feeds.
const { trees: base } = JSON.parse(readFileSync(join(__dirname, "fixtures", "manifest.json"), "utf8")) as {
  trees: Tree[];
};
const trees: Tree[] = JSON.parse(JSON.stringify(base));
const pm = trees.find((t) => t.name === "pm")!;
const ls = pm.routes.find((r) => r.path.join(" ") === "ls")!;
const download = pm.routes.find((r) => r.path.join(" ") === "download")!;
ls.meta = {
  ...ls.meta,
  readOnly: true,
  rows: { type: "pm.item", key: "[]", ref: "{path}/{name}", defaults: { path: "/" }, label: "name", sub: "type" },
};
Object.assign(ls.positionals[0]!, { accepts: "pm.item", where: { type: "folder" } });
Object.assign(download.positionals[0]!, { accepts: "pm.item", where: { type: "file" } });

const root = [
  { name: "Les Miserables (2012)", type: "folder", id: "a" },
  { name: "Wizard People.iso", type: "file", id: "b", size: 18 },
];
const inside = [{ name: "Les.Mis.mkv", type: "file", id: "c" }];

describe("typed slots", () => {
  it("pm download takes a pm.item, fetched from pm ls at the folder typed so far", () => {
    const s = analyze(trees, "pm download ");
    expect(s.source).toBeUndefined();
    expect(s.typed).toEqual({ type: "pm.item", where: { type: "file" } });
    expect(typedSource(trees, s)?.argv).toEqual(["ls", "--json"]);
    const deeper = analyze(trees, 'pm download "Les Miserables (2012)/"');
    expect(typedSource(trees, deeper)?.argv).toEqual(["ls", "Les Miserables (2012)", "--json"]);
  });

  it("folders come first and stay open; files are what the slot takes", () => {
    const s = analyze(trees, "pm download ");
    const choices = typedChoices(root, typedSource(trees, s)!);
    expect(choices).toEqual([
      { value: "Les Miserables (2012)/", label: "Les Miserables (2012)", open: true },
      { value: "Wizard People.iso", label: "Wizard People.iso", sub: "file" },
    ]);
    const rows = candidates(s, trees, choices);
    expect(rows.find((c) => c.open)?.title).toBe("Les Miserables (2012)/");
  });

  it("walks into a folder, then picks a file and runs", () => {
    const s = analyze(trees, "pm download ");
    const folder = candidates(s, trees, typedChoices(root, typedSource(trees, s)!)).find((c) => c.open)!;
    const r1 = onEnter(trees, s, folder);
    expect(r1).toEqual({ line: 'pm download "Les Miserables (2012)/"' });
    const s2 = analyze(trees, (r1 as { line: string }).line);
    const src2 = typedSource(trees, s2)!;
    const file = candidates(s2, trees, typedChoices(inside, src2)).find((c) => c.text.endsWith(".mkv"))!;
    expect(file.text).toBe("Les Miserables (2012)/Les.Mis.mkv");
    expect(accept(s2, file)).toBe('pm download "Les Miserables (2012)/Les.Mis.mkv" ');
    const r2 = onEnter(trees, s2, file);
    expect("run" in r2 && r2.run.argv).toEqual(["download", "Les Miserables (2012)/Les.Mis.mkv", "--json"]);
  });

  it("pm download alone keeps the line open for the browser instead of running", () => {
    const s = analyze(trees, "pm down");
    const seg = candidates(s, trees).find((c) => c.text === "download")!;
    expect(onEnter(trees, s, seg)).toEqual({ line: "pm download " });
  });

  it("typedDir takes the folder part and ignores a leading slash", () => {
    expect(typedDir("Library/Mo")).toBe("Library");
    expect(typedDir("/Library/Movies/")).toBe("Library/Movies");
    expect(typedDir("Heat")).toBe("");
  });
});

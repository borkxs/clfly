import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze, candidates, fuzzyScore, isQuick, onEnter, quickCandidates, quickLines, type Choice } from "../src/lib/line";
import type { Tree } from "../src/lib/model";

const fixtures = join(__dirname, "fixtures");
const { trees } = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8")) as { trees: Tree[] };
const { choices } = JSON.parse(readFileSync(join(fixtures, "line-cases.json"), "utf8")) as {
  choices: Record<string, Choice[]>;
};
const lines = quickLines(trees, (e) => choices[e.cf.cmd]);
const top = (q: string, opts = {}) => quickCandidates(q, lines, opts).map((c) => c.text);

describe("quick mode", () => {
  it("expands short choice lists into whole lines, never destructive ones", () => {
    const all = lines.map((l) => l.line);
    expect(all).toContain("dash open film");
    expect(all).toContain("tick run health-check");
    expect(all).toContain("run transcribe-batch");
    expect(all.some((l) => l.startsWith("dash rm "))).toBe(false);
    expect(all.some((l) => l.startsWith("pm rm "))).toBe(false);
  });

  it("matches word starts in order", () => {
    expect(top("do")[0]).toBe("dash open");
    expect(top("dof")[0]).toBe("dash open film");
    expect(top("dos")[0]).toBe("dash open songs");
    expect(top("trh")[0]).toBe("tick run health-check");
    expect(top("rtb")[0]).toBe("run transcribe-batch");
    expect(top("pm")[0]).toBe("pm");
    expect(top("pmdo")[0]).toBe("pm download");
    expect(fuzzyScore("xz", "dash open")).toBeUndefined();
    expect(fuzzyScore("o", "dash open")).toBeDefined();
    expect(fuzzyScore("a", "dash open")).toBeUndefined(); // first letter must start a word
  });

  it("a learned pick wins its query", () => {
    expect(top("do", { picks: { do: "pm download" } })[0]).toBe("pm download");
  });

  it("is on until a tree name and a space", () => {
    expect(isQuick(analyze(trees, "do"))).toBe(true);
    expect(isQuick(analyze(trees, "do f"))).toBe(true);
    expect(isQuick(analyze(trees, "pm"))).toBe(true);
    expect(isQuick(analyze(trees, "pm "))).toBe(false);
    expect(isQuick(analyze(trees, ""))).toBe(false);
  });
});

describe("one enter", () => {
  const enter = (line: string, text: string, rows?: ReturnType<typeof candidates>) => {
    const state = analyze(trees, line);
    const all = rows ?? (isQuick(state) ? quickCandidates(line, lines) : candidates(state, trees, state.source ? choices[state.source.cmd] ?? [] : []));
    const row = all.find((r) => r.text === text);
    expect(row, `no row ${text}`).toBeDefined();
    const r = onEnter(trees, state, row!);
    return "run" in r ? { run: r.run.line.trim() } : r;
  };

  it("runs a complete quick line", () => expect(enter("dof", "dash open film")).toEqual({ run: "dash open film" }));
  it("keeps typing when an argument is still open", () => expect(enter("do", "dash open")).toEqual({ line: "dash open " }));
  it("runs when the picked choice completes the line", () => expect(enter("dash open f", "film")).toEqual({ run: "dash open film" }));
  it("runs a leaf command that runs bare", () => expect(enter("pm st", "status")).toEqual({ run: "pm status" }));
  it("doesn't run a command with subcommands under it", () => expect(enter("run q", "queue")).toEqual({ line: "run queue " }));
  it("a tree row opens the tree", () => expect(enter("pm", "pm")).toEqual({ line: "pm " }));
});

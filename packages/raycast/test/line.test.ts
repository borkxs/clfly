import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accept, analyze, candidates, type Choice } from "../src/lib/line";
import type { Tree } from "../src/lib/model";

const fixtures = join(__dirname, "fixtures");
const { trees } = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8")) as { trees: Tree[] };
interface Case {
  id: string;
  line: string;
  expect: {
    slot?: string;
    first?: string;
    includes?: string[];
    excludes?: string[];
    accept?: { pick: string; line: string };
    runnable?: boolean;
    argv?: string[];
    hint?: string[];
    live?: string;
    source?: string | null;
    destructive?: boolean;
    interactive?: boolean;
    error?: string;
  };
}
const { cases, choices } = JSON.parse(readFileSync(join(fixtures, "line-cases.json"), "utf8")) as {
  cases: Case[];
  choices: Record<string, Choice[]>;
};

describe("line cases", () => {
  for (const c of cases) {
    it(`${c.id}: ${JSON.stringify(c.line)}`, () => {
      const state = analyze(trees, c.line);
      const rows = candidates(state, trees, state.source ? choices[state.source.cmd] ?? [] : []);
      const texts = rows.map((r) => r.text);
      const e = c.expect;
      if (e.slot) expect(state.slot.kind).toBe(e.slot);
      if (e.first) expect(texts[0]).toBe(e.first);
      for (const t of e.includes ?? []) expect(texts).toContain(t);
      for (const t of e.excludes ?? []) expect(texts).not.toContain(t);
      if (e.accept) {
        const row = rows.find((r) => r.text === e.accept!.pick);
        expect(row, `no row ${e.accept.pick}`).toBeDefined();
        expect(accept(state, row!)).toBe(e.accept.line);
      }
      if (e.runnable !== undefined) expect(state.runnable).toBe(e.runnable);
      if (e.argv) expect(state.argv).toEqual(e.argv);
      if (e.hint) expect(state.hint).toEqual(e.hint);
      if (e.live) expect(state.live).toBe(e.live);
      if (e.source !== undefined) expect(state.source?.cmd ?? null).toBe(e.source);
      if (e.destructive !== undefined) expect(state.destructive).toBe(e.destructive);
      if (e.interactive !== undefined) expect(state.interactive).toBe(e.interactive);
      if (e.error) expect(state.error).toBe(e.error);
    });
  }
});

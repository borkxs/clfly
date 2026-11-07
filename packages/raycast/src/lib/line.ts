/**
 * The line editor's engine: given everything typed so far (`pm search dune --res 10`),
 * say what the word under the cursor can be, which choices to fetch, and whether the
 * line can run. Pure, so the cases in test/fixtures/line-cases.json run under vitest,
 * and so the HTML prototype and a future `clfly serve` can share it.
 */
import type { CompleteFrom, FlagInfo } from "@clfly/core";
import {
  buildArgv,
  childrenAt,
  formPositionals,
  isDestructive,
  isDynamic,
  isLiveSearch,
  missingParams,
  paramCompleteFrom,
  paramName,
  parseWords,
  routeAt,
  runsBare,
  sourceRunnable,
  tokenize,
  type FormValues,
  type Route,
  type Tree,
} from "./model";

export interface Choice {
  value: string;
  label?: string;
  sub?: string;
}

export type Slot =
  | { kind: "tree" }
  /** Next path segment; `positional` when the command ending here also takes one. */
  | { kind: "segment"; positional?: string }
  | { kind: "positional"; name: string }
  | { kind: "flag" }
  | { kind: "flagValue"; flag: FlagInfo }
  | { kind: "none" };

export interface Candidate {
  kind: "tree" | "segment" | "choice" | "flag" | "value" | "run" | "search" | "line";
  /** The word it puts on the line (`run` and `search` rows are actions instead). */
  text: string;
  title: string;
  subtitle?: string;
  /** For `search` and quick-mode `line` rows: the whole line it switches to. */
  line?: string;
}

export interface LineState {
  line: string;
  /** The word being typed; empty right after a space. */
  prefix: string;
  slot: Slot;
  tree?: Tree;
  route?: Route;
  params: Record<string, string>;
  values: FormValues;
  /** A runnable `completeFrom` source to fetch choices for this slot. */
  source?: CompleteFrom;
  /** Query for a live search (`pm search dune`). */
  live?: string;
  /** Required arguments still missing, by name. */
  hint: string[];
  runnable: boolean;
  argv?: string[];
  destructive: boolean;
  interactive: boolean;
  error?: string;
}

export function analyze(trees: Tree[], line: string): LineState {
  const words = tokenize(line);
  const trailing = line === "" || /\s$/.test(line);
  const prefix = trailing ? "" : (words.pop() ?? "").replace(/^["']/, "");
  const base: LineState = {
    line,
    prefix,
    slot: { kind: "tree" },
    params: {},
    values: {},
    hint: [],
    runnable: false,
    destructive: false,
    interactive: false,
  };
  if (words.length === 0) return base;

  const tree = trees.find((t) => t.name === words[0]);
  if (!tree) return { ...base, slot: { kind: "none" }, error: `No tree named ${words[0]}` };
  if (tree.error) return { ...base, tree, slot: { kind: "none" }, error: tree.error };

  // Structure from the finished words; values and runnability from everything typed.
  const done = parseWords(tree, words.slice(1));
  const all = prefix ? parseWords(tree, [...words.slice(1), prefix]) : done;
  const state: LineState = { ...base, tree, route: all.route, params: all.params, values: all.values };

  if (all.route) {
    const r = all.route;
    state.interactive = r.meta?.interactive === true;
    state.destructive = isDestructive(r);
    state.hint = [
      ...missingParams(r, all.params),
      ...formPositionals(r)
        .filter((p) => !p.optional && !filled(all.values[p.name]))
        .map((p) => p.name),
      ...r.flags
        .filter((f) => !f.optional && f.default === undefined && f.type !== "boolean" && !filled(all.values[f.name]))
        .map((f) => `--${f.name}`),
    ];
    state.runnable = !state.interactive && !all.pendingFlag && runsBare(r, all.params, all.values);
    if (state.runnable) state.argv = buildArgv(r, all.params, all.values);
    const query = all.values.query;
    if (isLiveSearch(r) && typeof query === "string" && query.trim()) state.live = query.trim();
  }

  const route = done.route;
  if (done.pendingFlag) {
    state.slot = { kind: "flagValue", flag: done.pendingFlag };
    const cf = done.pendingFlag.completeFrom;
    if (cf && sourceRunnable(tree, cf)) state.source = cf;
  } else if (prefix.startsWith("-") && route) {
    state.slot = { kind: "flag" };
  } else if (done.loose.length === 0 && !Object.keys(done.values).length && hasChildren(tree, done.template)) {
    const positional = route ? formPositionals(route)[0] : undefined;
    state.slot = { kind: "segment", ...(positional ? { positional: positional.name } : {}) };
    const dyn = childrenAt(tree, done.template).find((c) => isDynamic(c.segment));
    const cf = dyn
      ? paramCompleteFrom(tree, [...done.template, dyn.segment], paramName(dyn.segment))
      : positional?.completeFrom;
    if (cf && sourceRunnable(tree, cf)) state.source = cf;
  } else if (route) {
    const positionals = formPositionals(route);
    const p = positionals[Math.min(done.loose.length, positionals.length - 1)];
    const extra = done.loose.length >= positionals.length && !p?.variadic && p?.name !== "query";
    if (p && !extra) {
      state.slot = { kind: "positional", name: p.name };
      if (p.completeFrom && sourceRunnable(tree, p.completeFrom)) state.source = p.completeFrom;
    } else {
      state.slot = { kind: "none" };
    }
  } else {
    state.slot = { kind: "none" };
  }
  return state;
}

/** Rows for the list under the line. `choices` is what `state.source` returned, if fetched. */
export function candidates(state: LineState, trees: Tree[], choices: Choice[] = []): Candidate[] {
  const { prefix, slot, tree } = state;
  const out: Candidate[] = [];
  if (state.runnable && prefix === "" && slot.kind !== "flagValue") {
    out.push({
      kind: "run",
      text: "run",
      title: state.line.trim(),
      subtitle: state.destructive ? "Run (asks first)" : "Run",
    });
  }
  switch (slot.kind) {
    case "tree":
      for (const t of trees) {
        if (startsWith(t.name, prefix))
          out.push({ kind: "tree", text: t.name, title: t.name, subtitle: firstLine(t.description) });
      }
      break;
    case "segment": {
      const template = templateOf(state);
      for (const c of childrenAt(tree!, template)) {
        if (isDynamic(c.segment) || !startsWith(c.segment, prefix)) continue;
        out.push({
          kind: "segment",
          text: c.segment,
          title: c.segment,
          subtitle: firstLine(c.leaf?.meta?.description) ?? `${c.count} commands`,
        });
      }
      out.push(...choiceRows(choices, prefix));
      break;
    }
    case "positional":
      out.push(...choiceRows(choices, prefix));
      break;
    case "none":
      // Required flags still missing (`run transcribe-batch` needs --on).
      for (const name of state.hint.filter((h) => h.startsWith("--"))) {
        if (startsWith(name, prefix)) out.push({ kind: "flag", text: name, title: name, subtitle: "required" });
      }
      break;
    case "flag": {
      const route = state.route ?? routeAt(tree!, templateOf(state));
      for (const f of route?.flags ?? []) {
        const name = `--${f.name}`;
        if (startsWith(name, prefix) && state.values[f.name] === undefined) {
          out.push({ kind: "flag", text: name, title: name, subtitle: firstLine(f.description) });
        }
      }
      break;
    }
    case "flagValue":
      for (const e of slot.flag.enum ?? []) {
        if (startsWith(String(e), prefix)) out.push({ kind: "value", text: String(e), title: String(e) });
      }
      out.push(...choiceRows(choices, prefix));
      break;
  }
  const search = searchRow(state);
  if (search) out.push(search);
  return out;
}

/** The line after taking `c`. */
export function accept(state: LineState, c: Candidate): string {
  if ((c.kind === "search" || c.kind === "line") && c.line) return c.line;
  if (c.kind === "run") return state.line;
  const raw = state.prefix ? state.line.match(/\S*$/)?.[0] ?? "" : "";
  return `${state.line.slice(0, state.line.length - raw.length)}${quote(c.text)} `;
}

/** A line that puts `value` into argument `arg` of `route` (a chain from a result row). */
export function chainLine(
  tree: Tree,
  route: Route,
  arg: string,
  source: "path" | "positional" | "flag",
  value: string
): string {
  const path = route.path.map((s) =>
    isDynamic(s) ? (source === "path" && paramName(s) === arg ? value : `<${paramName(s)}>`) : s
  );
  const tail = source === "flag" ? [`--${arg}`, value] : source === "positional" ? [value] : [];
  return `${[tree.name, ...path, ...tail].map(quote).join(" ")} `;
}

// --- quick mode: fuzzy over whole lines ------------------------------------
//
// `doc` → `dash open chartbook`, `trh` → `tick run health-check`. When the line does not
// start with a tree name and a space, every command (and each choice of a short choice
// list, spelled out) is a candidate line, scored by letters in order with word starts
// weighted, the way command palettes do it. ↵ on a complete line runs it.

/** A choice list longer than this stays a picker instead of becoming lines. */
export const MAX_EXPAND = 15;

/** A route whose one required argument comes from a runnable, harmless choice source. */
export interface Expansion {
  tree: Tree;
  route: Route;
  /** The argument the choices fill: a `:param` path segment or a positional. */
  arg: string;
  cf: CompleteFrom;
}

export function expansions(trees: Tree[]): Expansion[] {
  const out: Expansion[] = [];
  for (const tree of trees) {
    if (tree.error) continue;
    for (const route of tree.routes) {
      if (isDestructive(route) || route.meta?.interactive) continue;
      const fed = route.positionals.filter(
        (p) => p.completeFrom && (p.source === "path" || !p.optional) && sourceRunnable(tree, p.completeFrom)
      );
      if (fed.length === 1) out.push({ tree, route, arg: fed[0]!.name, cf: fed[0]!.completeFrom! });
    }
  }
  return out;
}

export interface QuickLine {
  line: string;
  subtitle?: string;
}

/**
 * Every line quick mode can offer: trees, each command with a fixed path, and each
 * choice of an expansion. `choicesOf` returns the fetched choices for an expansion.
 */
export function quickLines(trees: Tree[], choicesOf: (e: Expansion) => Choice[] | undefined): QuickLine[] {
  const out: QuickLine[] = [];
  const byRoute = new Map(expansions(trees).map((e) => [e.route, e]));
  for (const tree of trees) {
    if (tree.error) continue;
    out.push({ line: tree.name, subtitle: firstLine(tree.description) });
    for (const route of tree.routes) {
      if (route.path.length === 0) continue;
      const desc = firstLine(route.meta?.description);
      const exp = byRoute.get(route);
      const fixed = route.path.every((s) => !isDynamic(s));
      if (fixed) out.push({ line: [tree.name, ...route.path].join(" "), subtitle: desc });
      if (!exp) continue;
      const choices = choicesOf(exp) ?? [];
      if (choices.length === 0 || choices.length > MAX_EXPAND) continue;
      for (const c of choices) {
        const path = route.path.map((s) => (isDynamic(s) && paramName(s) === exp.arg ? c.value : s));
        const words = fixed ? [...path, c.value] : path;
        out.push({ line: [tree.name, ...words].map(quote).join(" "), subtitle: [c.label, c.sub].filter(Boolean).join(" · ") || desc });
      }
    }
  }
  return out;
}

/**
 * Score `query` against `text`: its letters in order (spaces ignored), the first on a word
 * start. Word starts and runs score high, gaps cost a little, longer texts a little less.
 * `undefined` when it doesn't match.
 */
export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = text.toLowerCase();
  if (!q) return undefined;
  const start = (j: number) => j === 0 || /[\s\-_/:.]/.test(t[j - 1]!);
  let prev: number[] = [];
  for (let i = 0; i < q.length; i++) {
    const cur = new Array<number>(t.length).fill(-Infinity);
    let best = -Infinity; // best prev[k] for k < j - 1
    for (let j = 0; j < t.length; j++) {
      if (i > 0 && j >= 2) best = Math.max(best, prev[j - 2]!);
      if (t[j] !== q[i]) continue;
      const bonus = start(j) ? 10 : 1;
      if (i === 0) {
        if (start(j)) cur[j] = bonus - j * 0.05;
      } else {
        const run = j > 0 ? prev[j - 1]! + 6 : -Infinity;
        cur[j] = bonus + Math.max(run, best - 1);
      }
    }
    prev = cur;
  }
  const top = Math.max(...prev);
  if (top === -Infinity) return undefined;
  // Typed literally (`pm`, `dash o`): the plain prefix wins over a scatter of word starts.
  const typed = query.toLowerCase().trim();
  const literal = t === typed ? 25 : t.startsWith(typed) ? 15 : 0;
  return top + literal - t.length * 0.02;
}

/** Quick-mode rows for `query`, best first. `picks` maps a past query to the line chosen for it. */
export function quickCandidates(
  query: string,
  lines: QuickLine[],
  opts: { recent?: string[]; picks?: Record<string, string>; limit?: number } = {}
): Candidate[] {
  const q = query.trim();
  const recent = opts.recent ?? [];
  const learned = opts.picks?.[q.toLowerCase()];
  return lines
    .map((l) => {
      let score = fuzzyScore(q, l.line);
      if (score === undefined) return undefined;
      const r = recent.indexOf(l.line);
      if (r >= 0) score += 8 - Math.min(r, 7);
      if (learned === l.line) score += 40;
      return { l, score };
    })
    .filter((x): x is { l: QuickLine; score: number } => x !== undefined)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 30)
    .map(({ l }) => ({ kind: "line" as const, text: l.line, title: l.line, subtitle: l.subtitle, line: `${l.line} ` }));
}

/** Quick mode is on while the first word is not (yet) a tree followed by a space. */
export function isQuick(state: LineState): boolean {
  return (state.slot.kind === "tree" && state.prefix !== "") || (state.slot.kind === "none" && !state.tree);
}

/**
 * What ↵ on a row does: run the line it completes, or put it on the line to keep typing.
 * A row runs when the line it makes can run and has nothing left to pick (no subcommands
 * under it, no choices for an argument that is still open).
 */
export function onEnter(trees: Tree[], state: LineState, c: Candidate): { run: LineState } | { line: string } {
  if (c.kind === "run") return { run: state };
  if (c.kind === "search" || c.kind === "flag") return { line: accept(state, c) };
  const next = c.kind === "line" ? c.line! : accept(state, c);
  const ns = analyze(trees, next);
  const more =
    (ns.slot.kind === "segment" && childrenAt(ns.tree!, templateOf(ns)).some((x) => !isDynamic(x.segment))) ||
    ((ns.slot.kind === "segment" || ns.slot.kind === "positional") && ns.source !== undefined);
  return ns.runnable && !more ? { run: ns } : { line: next };
}

// --- helpers ----------------------------------------------------------------

/** Words not a command (`pm the brave one 2007`) can be a search in that tree. */
function searchRow(state: LineState): Candidate | undefined {
  const { tree } = state;
  if (!tree || state.route || state.slot.kind === "tree") return undefined;
  const words = tokenize(state.line).slice(1);
  if (!words.length || childrenAt(tree, []).some((c) => c.segment === words[0])) return undefined;
  const search = tree.routes.find((r) => r.path.length === 1 && isLiveSearch(r));
  if (!search) return undefined;
  const query = words.join(" ");
  return {
    kind: "search",
    text: search.path[0]!,
    title: `${tree.name} ${search.path[0]} ${query}`,
    line: `${tree.name} ${search.path[0]} ${query}`,
  };
}

function choiceRows(choices: Choice[], prefix: string): Candidate[] {
  const p = prefix.toLowerCase();
  const scored = choices
    .map((c) => {
      const v = c.value.toLowerCase();
      const label = (c.label ?? "").toLowerCase();
      const score = v.startsWith(p) ? 0 : v.includes(p) || label.includes(p) ? 1 : -1;
      return { c, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score);
  return scored.map(({ c }) => ({
    kind: "choice" as const,
    text: c.value,
    title: c.label ?? c.value,
    subtitle: [c.label ? c.value : undefined, c.sub].filter(Boolean).join(" · ") || undefined,
  }));
}

function templateOf(state: LineState): string[] {
  const words = tokenize(state.line).slice(1);
  if (state.prefix) words.pop();
  return state.tree ? parseWords(state.tree, words).template : [];
}

function hasChildren(tree: Tree, template: string[]): boolean {
  return childrenAt(tree, template).length > 0;
}

function startsWith(s: string, prefix: string): boolean {
  return s.toLowerCase().startsWith(prefix.toLowerCase());
}

function filled(v: unknown): boolean {
  return typeof v === "string" ? v.trim() !== "" : v !== undefined;
}

/** A row subtitle from a description: its first clause, without a "clfly tree that" lead-in or end punctuation. */
export function firstLine(text?: string): string | undefined {
  if (!text) return undefined;
  const clause = (text.split(/(?<=[.:;])\s/)[0] ?? "").replace(/[.:;]$/, "");
  return clause.replace(/^clfly tree (that )?/i, "") || undefined;
}

function quote(word: string): string {
  return /[\s"']/.test(word) ? `"${word.replace(/"/g, "'")}"` : word;
}

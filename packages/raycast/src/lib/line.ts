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
  kind: "tree" | "segment" | "choice" | "flag" | "value" | "run" | "search";
  /** The word it puts on the line (`run` and `search` rows are actions instead). */
  text: string;
  title: string;
  subtitle?: string;
  /** For `search`: the whole line it switches to. */
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
  if (c.kind === "search" && c.line) return c.line;
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

function firstLine(text?: string): string | undefined {
  return text ? text.split(/(?<=[.:;])\s/)[0] : undefined;
}

function quote(word: string): string {
  return /[\s"']/.test(word) ? `"${word.replace(/"/g, "'")}"` : word;
}

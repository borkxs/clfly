// HIERARCHY
// P1: the line — what is being typed. One per screen, largest type, full contrast.
// P2: the rows under it (next words, search hits, result rows) and the one highlighted row.
// P3: subtitles, section labels, the needs-hint, key legend, the runs list.
//
// The browser face of the clfly line editor. Pure logic comes from the Raycast
// package's lib (line.ts, model.ts, live.ts); this file is DOM, keys, and the
// calls to server.mjs (/api/manifest, /api/exec, /api/run, /api/runs).

import type { CompleteFrom } from "@clfly/core";
import { completeFromArgv, selectCompletions } from "@clfly/core/complete";
import {
  accept,
  analyze,
  candidates,
  chainLine,
  expansions,
  isQuick,
  onEnter,
  quickCandidates,
  quickLines,
  type Candidate,
  type Choice,
  type Expansion,
  type LineState,
} from "../../raycast/src/lib/line";
import { DEFAULT_POLICY, LiveSearcher, type LiveState } from "../../raycast/src/lib/live";
import {
  buildArgv,
  chainsFor,
  commandLine,
  rowAccessories,
  rowSubtitle,
  rowTitle,
  shapeOutput,
  type Chain,
  type FormValues,
  type Route,
  type Shaped,
  type Tree,
} from "../../raycast/src/lib/model";

// --- types -------------------------------------------------------------------

interface Run {
  id: string;
  tree: string;
  argv: string[];
  line: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  endedAt?: string;
  code?: number;
  ms?: number;
  error?: string;
  hasJson?: boolean;
  hasText?: boolean;
}
interface RunFull extends Run {
  stdout?: string;
  stderr?: string;
  json?: unknown;
}
interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  json?: unknown;
  error?: string;
  ms: number;
}

type Item =
  | { kind: "cand"; c: Candidate }
  | { kind: "recent"; line: string }
  | { kind: "hit"; row: unknown; chains: Chain[] };

interface Section {
  title: string;
  items: Item[];
}

interface Result {
  run: RunFull;
  tree?: Tree;
  route?: Route;
  shaped?: Shaped;
  chains: Chain[];
}

// --- state -------------------------------------------------------------------

let trees: Tree[] = [];
let manifestError: string | undefined;
let line = "";
let sel = 0;
let state: LineState = analyze([], "");
let pendingConfirm: LineState | undefined;
let runs: Run[] = [];
let result: Result | undefined;
let watching: { id: string; tree: Tree; route: Route } | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let lines: ReturnType<typeof quickLines> = [];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>("line");

// --- server ------------------------------------------------------------------

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? res.statusText), { status: res.status, data });
  return data;
}

async function exec(tree: Tree, argv: string[]): Promise<ExecResult> {
  return api<ExecResult>("/api/exec", { tree: tree.name, argv });
}

// --- choices (completeFrom sources), cached per argv -------------------------

const choiceCache = new Map<string, Choice[] | Promise<Choice[]>>();

function choiceKey(tree: Tree, argv: string[]) {
  return `${tree.name}\0${JSON.stringify(argv)}`;
}

/** Choices for a source, or undefined while they load (a render follows when they land). */
function choicesFor(tree: Tree, cf: CompleteFrom, values: FormValues): Choice[] | undefined {
  const argv = completeFromArgv(cf, tree.name, values);
  const key = choiceKey(tree, argv);
  const hit = choiceCache.get(key);
  if (Array.isArray(hit)) return hit;
  if (hit) return undefined;
  const p = exec(tree, argv)
    .then((res) => {
      if (res.code !== 0) throw new Error(res.error ?? `exited ${res.code}`);
      return selectCompletions(res.json, cf) as Choice[];
    })
    .catch(() => [] as Choice[])
    .then((list) => {
      choiceCache.set(key, list);
      lines = quickLines(trees, expansionChoices);
      render();
      return list;
    });
  choiceCache.set(key, p);
  return undefined;
}

const expansionChoices = (e: Expansion) => choicesFor(e.tree, e.cf, {});

// --- recent lines (frecency, this browser) -----------------------------------

interface RecentEntry {
  n: number;
  t: number;
}
const RECENT_KEY = "pocket.recent";
const PICKS_KEY = "pocket.picks";

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

/** Empty line with the tree list open (⇥ or ↓); typing or esc closes it. */
let browse = false;
let recent = loadJSON<Record<string, RecentEntry>>(RECENT_KEY, {});
let picks = loadJSON<Record<string, string>>(PICKS_KEY, {});

/** Newest first, like ↑ in a shell: the empty line's History. */
function historyLines(limit = 8): string[] {
  return Object.entries(recent)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, limit)
    .map(([l]) => l);
}

/** The engine's run log merged into Recent, so the panel, the browser and the phone share one history. */
async function loadHistory() {
  try {
    const { history } = await api<{ history: { line: string; n: number; t: number }[] }>("/api/history");
    for (const e of history) {
      if (e.line.split(/\s+/).some(isResultId) || forgotten.has(e.line)) continue;
      const cur = recent[e.line];
      recent[e.line] = { n: Math.max(cur?.n ?? 0, e.n), t: Math.max(cur?.t ?? 0, e.t) };
    }
    saveJSON(RECENT_KEY, recent);
    render();
  } catch {
    /* engine without /api/history: local Recent only */
  }
}

/** Frecency: the palette's ranking once you type. */
function recentLines(limit = 8): string[] {
  const now = Date.now();
  return Object.entries(recent)
    .map(([l, e]) => ({ l, score: e.n * Math.pow(0.5, (now - e.t) / (7 * 86_400_000)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.l);
}

/** A hash or transfer id from a result row: one-off lines stay out of Recent. */
function isResultId(word: string): boolean {
  const w = word.replace(/^["']|["']$/g, "");
  if (/^[0-9a-f]{32,}$/i.test(w)) return true;
  return /^[A-Za-z0-9_-]{22}$/.test(w) && /[A-Z]/.test(w) && /[a-z]/.test(w) && /\d/.test(w);
}

function remember(l: string) {
  const t = l.trim();
  if (!t || t.split(/\s+/).some(isResultId)) return;
  forgotten.delete(t);
  const e = recent[t] ?? { n: 0, t: 0 };
  recent[t] = { n: e.n + 1, t: Date.now() };
  saveJSON(RECENT_KEY, recent);
}

const FORGOTTEN_KEY = "clfly.pocket.forgotten";
const forgotten = new Set(loadJSON<string[]>(FORGOTTEN_KEY, []));

function forget(l: string) {
  delete recent[l];
  forgotten.add(l);  // the run log still has it; keep it out on the next merge
  saveJSON(RECENT_KEY, recent);
  saveJSON(FORGOTTEN_KEY, [...forgotten]);
  render();
}

// --- live search -------------------------------------------------------------

let liveKey = "";
let searcher: LiveSearcher<Shaped> | undefined;
let live: LiveState<Shaped> = { status: "idle" };

function syncLive(s: LineState) {
  const { tree, route, params, values } = s;
  const key = tree && route ? `${tree.name} ${route.path.join(" ")} ${JSON.stringify({ ...values, query: undefined })}` : "";
  if (key !== liveKey) {
    searcher?.dispose();
    liveKey = key;
    live = { status: "idle" };
    searcher =
      tree && route
        ? new LiveSearcher<Shaped>(
            async (q) => {
              const extra: FormValues = route.flags.some((f) => f.name === "limit") && !values.limit ? { limit: "25" } : {};
              const res = await exec(tree, buildArgv(route, params, { ...values, ...extra, query: q }));
              if (res.code !== 0) throw new Error(res.error ?? `exited ${res.code}`);
              return shapeOutput(res.json);
            },
            (st) => {
              live = st;
              render();
            },
            DEFAULT_POLICY,
          )
        : undefined;
  }
  if (searcher && s.live) searcher.type(s.live);
  else if (live.status !== "idle" && !s.live) live = { status: "idle" };
}

function liveRows(): { rows: unknown[]; chains: Chain[]; query: string; loading: boolean } | undefined {
  if (!state.live || !state.tree || !state.route) return undefined;
  const shaped = live.status === "done" ? live.value : live.status === "loading" ? live.previous : undefined;
  const rows = shaped?.kind === "rows" ? shaped.rows : [];
  const chains = shaped ? chainsFor(state.tree, state.route, shaped) : [];
  return { rows, chains, query: live.status === "idle" ? state.live : live.query, loading: live.status === "loading" };
}

// --- runs --------------------------------------------------------------------

async function run(s: LineState, confirmed = false) {
  const { tree, route } = s;
  if (!tree || !route || !s.runnable || !s.argv) return;
  if (s.destructive && !confirmed) {
    pendingConfirm = s;
    render();
    return;
  }
  pendingConfirm = undefined;
  remember(s.line);
  try {
    const r = await api<Run>("/api/run", { tree: tree.name, argv: s.argv, line: s.line.trim(), confirmed });
    runs = [r, ...runs.filter((x) => x.id !== r.id)];
    watching = { id: r.id, tree, route };
    result = undefined;
    setLine("");
    poll();
  } catch (e) {
    manifestError = e instanceof Error ? e.message : String(e);
    render();
  }
}

async function poll() {
  clearTimeout(pollTimer);
  try {
    const data = await api<{ runs: Run[] }>("/api/runs");
    runs = data.runs;
  } catch {
    /* server away; try again */
  }
  if (watching) {
    const r = runs.find((x) => x.id === watching!.id);
    if (r && r.status !== "running") {
      await showRun(r.id, watching.tree, watching.route);
      watching = undefined;
    }
  }
  render();
  if (runs.some((r) => r.status === "running") || watching) pollTimer = setTimeout(poll, 1000);
}

async function showRun(id: string, tree?: Tree, route?: Route) {
  const full = await api<RunFull>(`/api/runs/${id}`);
  const t = tree ?? trees.find((x) => x.name === full.tree);
  const rt = route ?? (t ? routeFor(t, full.argv) : undefined);
  const shaped = full.json !== undefined ? shapeOutput(full.json) : undefined;
  result = { run: full, tree: t, route: rt, shaped, chains: t && rt && shaped ? chainsFor(t, rt, shaped) : [] };
  render();
  window.scrollTo({ top: 0 });
}

function keepSelVisible() {
  $("list").querySelector("li.sel")?.scrollIntoView({ block: "nearest" });
}

function routeFor(tree: Tree, argv: string[]): Route | undefined {
  const words = argv.filter((w) => !w.startsWith("-"));
  let best: Route | undefined;
  for (const r of tree.routes) {
    if (r.path.length > words.length) continue;
    if (!r.path.every((s, i) => s.startsWith(":") || s === words[i])) continue;
    if (!best || r.path.length > best.path.length) best = r;
  }
  return best;
}

// --- the list ----------------------------------------------------------------

function sections(): Section[] {
  const out: Section[] = [];
  if (manifestError && trees.length === 0) return out;
  if (line.trim() === "") {
    const rec = historyLines();
    if (rec.length) out.push({ title: "History", items: rec.map((l) => ({ kind: "recent", line: l })) });
    // The tree list is long; it waits for ↓ or ⇥ (browse), and never covers an open result.
    if (browse && !result) out.push({ title: "Trees", items: candidates(state, trees).map((c) => ({ kind: "cand", c })) });
    return out;
  }
  const quick = isQuick(state);
  const cands = quick
    ? quickCandidates(line, lines, { recent: recentLines(20), picks })
    : candidates(state, trees, state.tree && state.source ? choicesFor(state.tree, state.source, state.values) ?? [] : []);
  const lv = liveRows();
  // A search in progress: hits first, the words second (case 30).
  const hitSection: Section | undefined =
    lv && (lv.rows.length || lv.loading)
      ? {
          title: `${lv.rows.length ? `${lv.rows.length} hits` : "searching"} for “${lv.query}”`,
          items: lv.rows.map((row) => ({ kind: "hit", row, chains: lv.chains })),
        }
      : undefined;
  const wordSection: Section = { title: sectionTitle(state, quick), items: cands.map((c) => ({ kind: "cand", c })) };
  if (hitSection) out.push(hitSection);
  if (wordSection.items.length) out.push(wordSection);
  return out;
}

function sectionTitle(s: LineState, quick: boolean): string {
  if (quick) return "Commands";
  switch (s.slot.kind) {
    case "tree":
      return "Trees";
    case "segment":
      return s.slot.positional ? `Commands or ‹${s.slot.positional}›` : "Commands";
    case "positional":
      return `‹${s.slot.name}›${s.source ? ` from ${s.source.cmd}` : ""}`;
    case "flag":
      return "Flags";
    case "flagValue":
      return `--${s.slot.flag.name}`;
    default:
      return s.runnable ? "Ready" : "";
  }
}

function flatItems(secs: Section[]): Item[] {
  return secs.flatMap((s) => s.items);
}

/** What ⇥ puts on the line for the highlighted item (never runs). */
function takeItem(it: Item) {
  if (it.kind === "cand") {
    if (it.c.kind === "run") return;
    setLine(accept(state, it.c));
  } else if (it.kind === "recent") {
    setLine(`${it.line} `);
  } else {
    chainHit(it);
  }
}

/** What ↵ does on the highlighted item: run when the line is complete, else take the word. */
function enterItem(it: Item) {
  if (it.kind === "cand") {
    if (isQuick(state) && it.c.kind === "line") {
      picks = { ...picks, [line.trim().toLowerCase()]: it.c.text };
      saveJSON(PICKS_KEY, picks);
    }
    const r = onEnter(trees, state, it.c);
    if ("run" in r) void run(r.run);
    else setLine(r.line);
  } else if (it.kind === "recent") {
    const ns = analyze(trees, it.line);
    if (ns.runnable) void run(ns);
    else setLine(`${it.line} `);
  } else {
    chainHit(it);
  }
}

function chainHit(it: Extract<Item, { kind: "hit" }>, which = 0) {
  const ch = it.chains[which];
  const value = ch?.valueOf(it.row);
  if (!ch || !value || !state.tree) return;
  remember(line);
  setLine(chainLine(state.tree, ch.route, ch.arg, ch.source, value));
}

/** Grey completion after the caret: the highlighted word's remainder when it extends what was typed. */
function ghostText(items: Item[]): string {
  const it = items[sel];
  if (!it || it.kind !== "cand" || !state.prefix) return "";
  const { c } = it;
  if (!["tree", "segment", "choice", "flag", "value"].includes(c.kind)) return "";
  return c.text.toLowerCase().startsWith(state.prefix.toLowerCase()) ? c.text.slice(state.prefix.length) : "";
}

// --- render ------------------------------------------------------------------

const h = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const ICON: Record<Candidate["kind"], string> = {
  tree: "▸",
  segment: "›",
  choice: "·",
  flag: "–",
  value: "·",
  run: "↵",
  search: "⌕",
  line: "›",
};

function render() {
  const secs = sections();
  const items = flatItems(secs);
  if (sel >= items.length) sel = Math.max(0, items.length - 1);

  // Ghost text and hint beside the line.
  $("ghost-typed").textContent = line;
  $("ghost-rest").textContent = ghostText(items);
  const hint = $("hint");
  if (pendingConfirm) {
    hint.innerHTML = `<span class="danger">Run <b>${h(pendingConfirm.line.trim())}</b>? ↵ confirms, esc cancels</span>`;
  } else if (state.error && !isQuick(state) && line.trim()) {
    hint.innerHTML = `<span class="muted">${h(state.error)}</span>`;
  } else if (state.interactive) {
    hint.innerHTML = `<span class="muted">interactive: run it in a terminal</span>`;
  } else if (state.hint.length) {
    hint.innerHTML = `<span class="muted">needs</span> ${state.hint.map((x) => (x.startsWith("--") ? h(x) : `‹${h(x)}›`)).join(" ")}`;
  } else if (items[sel]?.kind === "hit") {
    const it = items[sel] as Extract<Item, { kind: "hit" }>;
    const ch = it.chains[0];
    hint.innerHTML = ch && state.tree
      ? `<span class="muted">↵</span> ${h(state.tree.name)} ${h(ch.route.path.join(" "))} ‹${h(ch.arg)}› <span class="muted">· ⌘↵ runs the search</span>`
      : `<span class="muted">⌘↵ runs the search</span>`;
  } else if (state.runnable) {
    hint.innerHTML = `<span class="muted">↵ runs${state.destructive ? " (asks first)" : ""}</span>`;
  } else if (line === "" && !browse && !result && trees.length) {
    hint.innerHTML = `<span class="muted">${trees.length} trees · ⇥ lists them</span>`;
  } else {
    hint.textContent = "";
  }

  // Rows.
  let i = 0;
  const html = secs
    .map(
      (s) => `<section><h2>${h(s.title)}</h2><ul>${s.items
        .map((it) => {
          const idx = i++;
          const cls = idx === sel ? ' class="sel"' : "";
          if (it.kind === "cand") {
            const { c } = it;
            return `<li${cls} data-i="${idx}"><span class="ic">${ICON[c.kind]}</span><span class="t">${h(c.title)}</span>${c.subtitle ? `<span class="s">${h(c.subtitle)}</span>` : ""}</li>`;
          }
          if (it.kind === "recent") {
            return `<li${cls} data-i="${idx}"><span class="ic">↺</span><span class="t">${h(it.line)}</span><button class="x" data-forget="${h(it.line)}" title="Forget">×</button></li>`;
          }
          const acc = rowAccessories(it.row)
            .map(([k, v]) => `<span class="acc" title="${h(k)}">${h(v)}</span>`)
            .join("");
          const sub = rowSubtitle(it.row);
          const chain = it.chains[0];
          const label = chain && state.tree ? `${state.tree.name} ${chain.route.path.join(" ")}` : "";
          return `<li${cls} data-i="${idx}"><span class="ic">⌕</span><span class="t">${h(rowTitle(it.row))}</span>${sub ? `<span class="s">${h(sub)}</span>` : ""}<span class="accs">${acc}</span>${label ? `<span class="chain">↵ ${h(label)}</span>` : ""}</li>`;
        })
        .join("")}</ul></section>`,
    )
    .join("");
  const list = $("list");
  list.innerHTML =
    html ||
    (manifestError
      ? `<p class="empty danger">${h(manifestError)}</p>`
      : line.trim()
        ? `<p class="empty muted">nothing matches</p>`
        : "");
  renderResult();
  renderRuns();
}

function renderResult() {
  const el = $("result");
  if (!result) {
    el.innerHTML = "";
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const { run: r, shaped, chains, tree } = result;
  const status = r.status === "failed" ? `<span class="danger">failed</span>` : `<span class="ok">done</span>`;
  const meta = `${status} <span class="muted">· ${r.ms ?? 0} ms</span>`;
  let body = "";
  if (r.status === "failed") body = `<pre>${h(r.error ?? r.stderr ?? "")}</pre>`;
  else if (shaped?.kind === "rows") {
    const extras = Object.entries(shaped.extras)
      .map(([k, v]) => `<span class="acc">${h(k)} ${h(v)}</span>`)
      .join("");
    body = `${extras ? `<p class="extras">${extras}</p>` : ""}<ul class="rows">${shaped.rows
      .slice(0, 200)
      .map((row, idx) => {
        const sub = rowSubtitle(row);
        const acc = rowAccessories(row)
          .map(([k, v]) => `<span class="acc" title="${h(k)}">${h(v)}</span>`)
          .join("");
        const btns = chains
          .map((ch, ci) => {
            const v = ch.valueOf(row);
            return v && tree ? `<button class="chain-btn" data-row="${idx}" data-chain="${ci}">${h(tree.name)} ${h(ch.route.path.join(" "))}</button>` : "";
          })
          .join("");
        return `<li><span class="t">${h(rowTitle(row))}</span>${sub ? `<span class="s">${h(sub)}</span>` : ""}<span class="accs">${acc}</span>${btns ? `<span class="chains">${btns}</span>` : ""}</li>`;
      })
      .join("")}</ul>${shaped.rows.length > 200 ? `<p class="muted">… ${shaped.rows.length - 200} more</p>` : ""}`;
  } else if (shaped?.kind === "value") {
    body = `<pre class="json">${jsonHTML(shaped.value)}</pre>`;
  } else {
    const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    body = text ? `<pre>${h(text)}</pre>` : `<p class="muted">no output</p>`;
  }
  const copy = r.json !== undefined
    ? `<button class="icon" id="copy-json" title="Copy result as JSON" aria-label="Copy result as JSON">${COPY_ICON}</button>`
    : "";
  el.innerHTML = `<header><span class="t">${h(r.line)}</span>${meta}<span class="actions">${copy}<button class="x" id="close-result" title="Close">×</button></span></header>${body}`;
}

const COPY_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Pretty JSON with keys, strings and literals told apart by colour (escaped first, then tokenised). */
function jsonHTML(value: unknown): string {
  return h(JSON.stringify(value, null, 2)).replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, lit, num) =>
      str ? (colon ? `<span class="j-k">${str}</span>${colon}` : `<span class="j-s">${str}</span>`)
      : lit ? `<span class="j-l">${lit}</span>`
      : num ? `<span class="j-n">${num}</span>`
      : m,
  );
}

function renderRuns() {
  const el = $("runs");
  if (!runs.length) {
    el.innerHTML = "";
    return;
  }
  const show = runs.slice(0, 6);
  el.innerHTML = `<h2>Runs</h2><ul>${show
    .map((r) => {
      const dot = r.status === "running" ? "run" : r.status === "failed" ? "bad" : "ok";
      return `<li data-run="${h(r.id)}"><span class="dot ${dot}"></span><span class="t">${h(r.line)}</span><span class="s">${r.status === "running" ? "running" : `${r.ms ?? 0} ms`}</span></li>`;
    })
    .join("")}</ul>`;
}

// --- input -------------------------------------------------------------------

function setLine(next: string, resetSel = true) {
  line = next;
  browse = false;
  input.value = next;
  if (resetSel) sel = 0;
  state = analyze(trees, line);
  syncLive(state);
  if (pendingConfirm && pendingConfirm.line !== line) pendingConfirm = undefined;
  render();
  input.focus();
  input.setSelectionRange(line.length, line.length);
}

input.addEventListener("input", () => {
  line = input.value;
  browse = false;
  sel = 0;
  state = analyze(trees, line);
  syncLive(state);
  pendingConfirm = undefined;
  render();
});

input.addEventListener("keydown", (e) => {
  const items = flatItems(sections());
  // Empty line: ⇥, or ↓ past the last row, opens the tree list.
  const atEnd = sel >= items.length - 1;
  if (line === "" && !browse && !result && (e.key === "Tab" || (e.key === "ArrowDown" && atEnd))) {
    e.preventDefault();
    browse = true;
    if (items.length) sel = items.length;  // land on the first tree
    return render();
  }
  if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
    e.preventDefault();
    sel = Math.min(sel + 1, Math.max(0, items.length - 1));
    render();
    keepSelVisible();
  } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
    e.preventDefault();
    sel = Math.max(sel - 1, 0);
    render();
    keepSelVisible();
  } else if (e.key === "Tab") {
    e.preventDefault();
    const it = items[sel];
    if (it) takeItem(it);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (pendingConfirm) return void run(pendingConfirm, true);
    if (e.metaKey || e.ctrlKey) return void run(state);
    const it = items[sel];
    if (it) enterItem(it);
    else if (state.runnable) void run(state);
    else if (state.live && searcher) searcher.submit(state.live);
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (pendingConfirm) {
      pendingConfirm = undefined;
      render();
    } else if (browse && line === "") {
      browse = false;
      sel = 0;
      render();
    } else if (result) {
      result = undefined;
      render();
    } else if (line === "" && panel) panel.postMessage("hide");
    else setLine("");
  } else if (e.key === "Backspace" && (e.metaKey || e.altKey) && e.shiftKey) {
    e.preventDefault();
    setLine("");
  }
});

$("list").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const forgetBtn = t.closest<HTMLElement>("[data-forget]");
  if (forgetBtn) return forget(forgetBtn.dataset.forget!);
  const li = t.closest<HTMLElement>("li[data-i]");
  if (!li) return;
  sel = Number(li.dataset.i);
  const it = flatItems(sections())[sel];
  if (it) enterItem(it);
});

$("result").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const copyBtn = t.closest<HTMLElement>("#copy-json");
  if (copyBtn && result?.run.json !== undefined) {
    void navigator.clipboard?.writeText(JSON.stringify(result.run.json, null, 2)).then(() => {
      copyBtn.innerHTML = CHECK_ICON;
      copyBtn.classList.add("ok");
      setTimeout(() => {
        copyBtn.innerHTML = COPY_ICON;
        copyBtn.classList.remove("ok");
      }, 1200);
    });
    return;
  }
  if (t.id === "close-result") {
    result = undefined;
    render();
    input.focus();
    return;
  }
  const btn = t.closest<HTMLElement>("button.chain-btn");
  if (!btn || !result?.shaped || result.shaped.kind !== "rows" || !result.tree) return;
  const row = result.shaped.rows[Number(btn.dataset.row)];
  const ch = result.chains[Number(btn.dataset.chain)];
  const v = ch?.valueOf(row);
  if (ch && v) setLine(chainLine(result.tree, ch.route, ch.arg, ch.source, v));
});

$("runs").addEventListener("click", (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-run]");
  if (li) void showRun(li.dataset.run!);
});

// Copy the line as a terminal command (⌘⇧C).
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "c" && state.tree && state.route) {
    e.preventDefault();
    const argv = buildArgv(state.route, state.params, state.values).slice(0, -1);
    void navigator.clipboard?.writeText(commandLine(state.tree.name, argv));
  }
  if (e.key === "/" && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
  }
});

// --- panel (the ⌥Space Mac app in packages/panel hosts this page with ?panel=1) ---

const panel = new URLSearchParams(location.search).has("panel")
  ? (window as unknown as { webkit?: { messageHandlers?: { clfly?: { postMessage(m: string): void } } } }).webkit?.messageHandlers?.clfly
  : undefined;
if (panel) document.documentElement.classList.add("panel");
// Called by the app each time the panel opens: the line takes focus with its text selected, so typing replaces it.
(window as unknown as { clflyPanelShown?: () => void }).clflyPanelShown = () => {
  input.focus();
  input.select();
};

// --- boot --------------------------------------------------------------------

async function boot() {
  try {
    const m = await api<{ trees: Tree[]; error?: string }>("/api/manifest");
    trees = m.trees;
    manifestError = m.error;
  } catch (e) {
    manifestError = e instanceof Error ? e.message : String(e);
  }
  state = analyze(trees, line);
  // Quick mode needs every short, harmless choice list (dash open film, tick run x).
  for (const e of expansions(trees)) expansionChoices(e);
  lines = quickLines(trees, expansionChoices);
  if (matchMedia("(max-width: 480px)").matches) input.placeholder = "pm oceans eight";
  const q = new URLSearchParams(location.search).get("q");
  if (q) setLine(q);
  else render();
  input.focus();
  void poll();
  void loadHistory();
}

void boot();

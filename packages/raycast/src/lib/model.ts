/**
 * Pure logic over `clfly manifest --json` output: route drill-down, argv
 * building, output shaping, and result → next-command chains. No Raycast
 * imports, so it runs under vitest.
 */
import type { CompleteFrom, FlagInfo, Meta, PositionalInfo } from "@clfly/core";
import { acceptorsFor, type RowAction } from "@clfly/core/rows";

export interface Route {
  path: string[];
  meta?: Meta;
  flags: FlagInfo[];
  positionals: PositionalInfo[];
}

export interface Tree {
  name: string;
  bin: string;
  root: string;
  description?: string;
  routes: Route[];
  error?: string;
}

/** Form state keyed by arg name. Arrays and variadics are typed as text. */
export type FormValues = Record<string, string | boolean>;

export const isDynamic = (segment: string) => segment.startsWith(":");
export const paramName = (segment: string) => segment.slice(1);

/** `run :job show` with `{ job: "x" }` → `run x show`; unfilled params stay as `<job>`. */
export function displayPath(template: string[], params: Record<string, string> = {}): string {
  return template.map((s) => (isDynamic(s) ? params[paramName(s)] ?? `<${paramName(s)}>` : s)).join(" ");
}

export interface Child {
  segment: string;
  /** Route whose path ends exactly at this segment. */
  leaf?: Route;
  /** True when longer routes continue below this segment. */
  hasChildren: boolean;
  /** Commands at or below this segment, for the subtitle. */
  count: number;
}

/** Route at exactly `template` (an `index` command), if any. */
export function routeAt(tree: Tree, template: string[]): Route | undefined {
  return tree.routes.find((r) => samePath(r.path, template));
}

/** Next segments below `template`, statics first, then dynamics. */
export function childrenAt(tree: Tree, template: string[]): Child[] {
  const bySegment = new Map<string, Child>();
  for (const route of tree.routes) {
    if (route.path.length <= template.length || !startsWith(route.path, template)) continue;
    const segment = route.path[template.length]!;
    const child = bySegment.get(segment) ?? { segment, hasChildren: false, count: 0 };
    child.count++;
    if (route.path.length === template.length + 1) child.leaf = route;
    else child.hasChildren = true;
    bySegment.set(segment, child);
  }
  return [...bySegment.values()].sort(
    (a, b) => Number(isDynamic(a.segment)) - Number(isDynamic(b.segment)) || a.segment.localeCompare(b.segment)
  );
}

/** First `completeFrom` declared for path param `name` on any route below `template`. */
export function paramCompleteFrom(tree: Tree, template: string[], name: string): CompleteFrom | undefined {
  for (const route of tree.routes) {
    if (!startsWith(route.path, template)) continue;
    const p = route.positionals.find((x) => x.source === "path" && x.name === name && x.completeFrom);
    if (p?.completeFrom) return p.completeFrom;
  }
  return undefined;
}

/** Positionals the form asks for: path params are picked while drilling, so only `export` ones. */
export function formPositionals(route: Route): PositionalInfo[] {
  return route.positionals.filter((p) => p.source === "export");
}

/** Path params of a route that `params` does not fill yet. */
export function missingParams(route: Route, params: Record<string, string>): string[] {
  return route.path
    .filter(isDynamic)
    .map(paramName)
    .filter((n) => !params[n]);
}

/**
 * Argv for the tree's bin (no shell): path with params filled, export
 * positionals in order, then flags, then `--json`.
 */
export function buildArgv(route: Route, params: Record<string, string>, values: FormValues): string[] {
  const argv = route.path.map((s) => (isDynamic(s) ? params[paramName(s)] ?? "" : s));
  for (const p of formPositionals(route)) {
    const raw = values[p.name];
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) break; // a later positional cannot be given without this one
    if (p.variadic) argv.push(...tokenize(text));
    else if (text.startsWith("-") && p.alsoFlag) argv.push(`--${p.name}=${text}`);
    else argv.push(text);
  }
  for (const f of route.flags) {
    const raw = values[f.name];
    if (f.type === "boolean") {
      const on = raw === true;
      if (on && f.default !== true) argv.push(`--${f.name}`);
      if (raw === false && f.default === true) argv.push(`--no-${f.name}`);
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) continue;
    if (f.type === "array") {
      for (const item of text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean))
        argv.push(`--${f.name}`, item);
    } else {
      argv.push(`--${f.name}`, text);
    }
  }
  argv.push("--json");
  return argv;
}

/** Text the user can paste into a terminal. Display only; nothing here runs through a shell. */
export function commandLine(treeName: string, argv: string[]): string {
  return [treeName, ...argv].map(shellQuote).join(" ");
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

function quoteWord(word: string): string {
  return /\s/.test(word) ? `"${word}"` : word;
}

/** Last static segments that mean "this changes or removes state". */
const DESTRUCTIVE_LEAVES = new Set([
  "rm",
  "remove",
  "delete",
  "apply",
  "reset",
  "down",
  "uninstall",
  "unlink",
  "clean",
]);

/** `meta.destructive`, or a destructive-sounding leaf on a command not marked read-only. */
const OPENING_LEAVES = new Set(["open"]);

/** Commands whose job is to open something elsewhere (`dash open film`): nothing to read back in Raycast. */
export function isOpener(route: Route): boolean {
  const last = [...route.path].reverse().find((s) => !isDynamic(s));
  return last !== undefined && OPENING_LEAVES.has(last);
}

export function isDestructive(route: Route): boolean {
  if (route.meta?.destructive) return true;
  if (route.meta?.readOnly) return false;
  const last = [...route.path].reverse().find((s) => !isDynamic(s));
  return last !== undefined && DESTRUCTIVE_LEAVES.has(last);
}

/** Routes worth a search-as-you-type view: read-only with a `query` positional. */
export function isLiveSearch(route: Route): boolean {
  return route.meta?.readOnly === true && formPositionals(route)[0]?.name === "query";
}

// --- output shaping ---------------------------------------------------------

export type Shaped =
  | { kind: "rows"; key: string | null; rows: unknown[]; extras: Record<string, unknown> }
  | { kind: "value"; value: unknown };

/**
 * A bare array is rows. An object with array properties shows its longest
 * array of objects (or of anything) as rows, with scalar siblings as extras.
 * Anything else is a single value.
 */
export function shapeOutput(out: unknown): Shaped {
  if (Array.isArray(out)) return { kind: "rows", key: null, rows: out, extras: {} };
  if (out && typeof out === "object") {
    const entries = Object.entries(out as Record<string, unknown>);
    const arrays = entries.filter((e): e is [string, unknown[]] => Array.isArray(e[1]) && e[1].length > 0);
    const objectArrays = arrays.filter(([, v]) => v.some((x) => x && typeof x === "object"));
    const pool = objectArrays.length ? objectArrays : arrays;
    const best = pool.sort((a, b) => b[1].length - a[1].length)[0];
    if (best) {
      const extras = Object.fromEntries(entries.filter(([k, v]) => k !== best[0] && isScalar(v)));
      return { kind: "rows", key: best[0], rows: best[1], extras };
    }
  }
  return { kind: "value", value: out };
}

const TITLE_KEYS = ["title", "name", "id", "label", "key", "path", "file", "url"];
const SUBTITLE_KEYS = ["description", "summary", "status", "state", "kind", "schedule", "message"];

export function rowTitle(row: unknown): string {
  if (isScalar(row)) return String(row);
  const obj = asObject(row);
  for (const k of TITLE_KEYS) if (isScalar(obj[k]) && String(obj[k])) return String(obj[k]);
  const first = Object.values(obj).find((v) => typeof v === "string" && v);
  return first ? String(first) : JSON.stringify(row).slice(0, 80);
}

export function rowSubtitle(row: unknown): string | undefined {
  const obj = asObject(row);
  const title = rowTitle(row);
  for (const k of SUBTITLE_KEYS)
    if (isScalar(obj[k]) && String(obj[k]) && String(obj[k]) !== title) return String(obj[k]);
  return undefined;
}

/** Up to three short scalar fields not already shown, as `[key, text]`. */
export function rowAccessories(row: unknown): Array<[string, string]> {
  const obj = asObject(row);
  const shown = new Set([rowTitle(row), rowSubtitle(row)]);
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj)) {
    if (out.length >= 3) break;
    if (!isScalar(v) || v === null || v === "") continue;
    const text = typeof v === "number" ? formatNumber(k, v) : String(v);
    if (shown.has(text) || text.length > 24) continue;
    out.push([k, text]);
  }
  return out;
}

/** Scalar fields of a row for "Copy <field>" actions. */
export function scalarFields(row: unknown): Array<[string, string]> {
  return Object.entries(asObject(row))
    .filter(([, v]) => isScalar(v) && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)]);
}

function formatNumber(key: string, n: number): string {
  if (/bytes$/i.test(key)) return formatBytes(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`;
}

// --- chains -----------------------------------------------------------------

export interface Chain {
  /** Tree that `route` is in: the producer's own for `completeFrom`, any linked one for typed rows. */
  tree: Tree;
  route: Route;
  arg: string;
  /** `path` fills a path param; otherwise the form value of `arg`. */
  source: "path" | "positional" | "flag";
  /** Value for `arg` taken from one output row (undefined: this row offers no such action). */
  valueOf: (row: unknown) => string | undefined;
}

export interface ChainOptions {
  /** Every linked tree, so a typed row reaches acceptors outside the producer's tree. Defaults to `[tree]`. */
  trees?: Tree[];
  /** Args the producer ran with (`{ path: "/Movies" }` for `pm ls /Movies`), for `{path}` in a `rows.ref`. */
  args?: Record<string, unknown>;
}

type Slot = { name: string; source: Chain["source"]; cf?: CompleteFrom; accepts?: string };

function slotsOf(route: Route): Slot[] {
  return [
    ...route.positionals.map((p) => ({
      name: p.name,
      cf: p.completeFrom,
      accepts: p.accepts,
      source: p.source === "path" ? ("path" as const) : ("positional" as const),
    })),
    ...route.flags.map((f) => ({ name: f.name, cf: f.completeFrom, accepts: f.accepts, source: "flag" as const })),
  ];
}

/** A path chain only works when this param is the route's only one. */
const chainable = (route: Route, source: Chain["source"]) =>
  source !== "path" || route.path.filter(isDynamic).length === 1;

/**
 * Next commands for the rows `shaped` shows, each a row action that opens
 * that command with the row's value filled in. Two sources:
 * - typed rows: `from.meta.rows` names a row type, and any route in any of
 *   `opts.trees` whose arg `accepts` it gets the row's templated `ref`
 *   (via `acceptorsFor`, so `when`/`where` decide per row);
 * - `completeFrom`: a route in `tree` whose `completeFrom` points at `from`
 *   with a `field` under these rows.
 * When both give the same tree/route/arg, the typed row wins (its ref is the
 * full reference; a field is only one column), in the `completeFrom` slot.
 */
export function chainsFor(tree: Tree, from: Route, shaped: Shaped, opts: ChainOptions = {}): Chain[] {
  if (shaped.kind !== "rows") return [];
  const prefix = shaped.key === null ? "[]" : `${shaped.key}[]`;
  const out: Chain[] = [];
  const at = new Map<string, number>();
  const put = (c: Chain, wins: boolean) => {
    const key = `${c.tree.name}\0${c.route.path.join(" ")}\0${c.arg}`;
    const i = at.get(key);
    if (i === undefined) {
      at.set(key, out.push(c) - 1);
    } else if (wins) out[i] = c;
  };

  for (const route of tree.routes) {
    for (const { name, cf, source } of slotsOf(route)) {
      if (!cf || !samePath(cmdPath(cf.cmd, tree.name), from.path)) continue;
      if (cf.field !== prefix && !cf.field.startsWith(`${prefix}.`)) continue;
      if (!chainable(route, source)) continue;
      const rest = cf.field.slice(prefix.length + 1);
      put(
        {
          tree,
          route,
          arg: name,
          source,
          valueOf: (row) => {
            const v = rest ? getPath(row, rest) : row;
            return isScalar(v) && v !== null && v !== "" ? String(v) : undefined;
          },
        },
        false
      );
    }
  }

  const rows = from.meta?.rows;
  if (rows && rows.key === prefix) {
    const trees = (opts.trees ?? [tree]).filter((t) => !t.error);
    if (!trees.some((t) => t.name === tree.name)) trees.unshift(tree);
    const producer = { tree: tree.name, route: from.path };
    // One acceptorsFor call per row, shared by every chain's valueOf.
    const cache = new Map<unknown, RowAction[]>();
    const actionsOf = (row: unknown) => {
      let got = cache.get(row);
      if (!got) cache.set(row, (got = acceptorsFor(trees, producer, row, opts.args ?? {})));
      return got;
    };
    for (const t of trees) {
      for (const route of t.routes) {
        for (const { name, accepts, source } of slotsOf(route)) {
          if (accepts !== rows.type || !chainable(route, source)) continue;
          put(
            {
              tree: t,
              route,
              arg: name,
              source,
              valueOf: (row) =>
                actionsOf(row).find((a) => a.tree === t.name && a.arg === name && samePath(a.route, route.path))?.value,
            },
            true
          );
        }
      }
    }
  }
  return out;
}

/** Producer args as they ran: path params and form values, blanks dropped. */
export function runArgs(params: Record<string, string>, values: FormValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...values, ...params })) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/**
 * Whether a `completeFrom` source can run on its own: its route exists and
 * `args` supplies every required positional. `pm add`'s magnet comes from
 * `pm search`, which needs a query, so that one is chain-only (filled from
 * search results, not fetched into the form).
 */
export function sourceRunnable(tree: Tree, cf: CompleteFrom): boolean {
  const source = tree.routes.find((r) => samePath(r.path, cmdPath(cf.cmd, tree.name)));
  if (!source) return false;
  return formPositionals(source).every((p) => p.optional || cf.args?.[p.name] !== undefined);
}

/** `"pm search"` in tree `pm` → `["search"]`. */
export function cmdPath(cmd: string, treeName: string): string[] {
  const path = cmd.split(/\s+/).filter(Boolean);
  if (path[0] === treeName && path.length > 1) path.shift();
  return path;
}

// --- helpers ----------------------------------------------------------------

export function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

function startsWith(path: string[], prefix: string[]): boolean {
  return prefix.every((s, i) => path[i] === s);
}

function getPath(node: unknown, path: string): unknown {
  let cur = node;
  for (const key of path.split(".").filter(Boolean)) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function isScalar(v: unknown): v is string | number | boolean | null {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Where typed text like `ls --all` lands in a tree. */
export interface Typed {
  /** Deepest path reached (statics and filled params). */
  template: string[];
  params: Record<string, string>;
  /** The command at `template`, if one ends there. */
  route?: Route;
  values: FormValues;
  /** True when every required positional and flag has a value, so it can run without a form. */
  ready: boolean;
}

/** Shell-like split: whitespace separates, single or double quotes group. No escapes or expansion. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

/**
 * Resolve typed words against a tree: walk static segments (dynamic ones take
 * the word as a param), then read `--flag value`, `--flag=value`, `--no-flag`
 * and positionals for the command reached. Extra words join into the last positional.
 */
export function parseTyped(tree: Tree, text: string): Typed {
  return parseWords(tree, tokenize(text));
}

export interface ParsedWords extends Typed {
  /** Words that were not path segments or flags: the positionals, in order. */
  loose: string[];
  /** A value-taking flag that ended the words without its value (`--res`). */
  pendingFlag?: FlagInfo;
}

/** `parseTyped` over already-split words. */
export function parseWords(tree: Tree, words: string[]): ParsedWords {
  const template: string[] = [];
  const params: Record<string, string> = {};
  let i = 0;
  for (; i < words.length && !words[i]!.startsWith("-"); i++) {
    const children = childrenAt(tree, template);
    const fixed = children.find((c) => c.segment === words[i]);
    const dynamic = children.find((c) => isDynamic(c.segment));
    // A dynamic segment takes the word unless the command ending here wants it as a positional.
    const here = routeAt(tree, template);
    const next = fixed ?? (here && formPositionals(here).length ? undefined : dynamic);
    if (!next) break;
    template.push(next.segment);
    if (isDynamic(next.segment)) params[paramName(next.segment)] = words[i]!;
  }
  const route = routeAt(tree, template);
  const values: FormValues = {};
  const loose: string[] = [];
  if (!route) return { template, params, values, ready: false, loose: words.slice(i) };

  let pendingFlag: FlagInfo | undefined;
  for (; i < words.length; i++) {
    const w = words[i]!;
    if (!w.startsWith("--") || w === "--") {
      loose.push(w);
      continue;
    }
    const [rawName, inline] = w.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    const negated = rawName.startsWith("no-") && !route.flags.some((f) => f.name === rawName);
    const name = negated ? rawName.slice(3) : rawName;
    const flag = route.flags.find((f) => f.name === name || f.alias === name);
    const key = flag?.name ?? route.positionals.find((p) => p.alsoFlag && p.name === name)?.name ?? name;
    if (flag?.type === "boolean") values[key] = inline !== undefined ? inline !== "false" : !negated;
    else if (inline !== undefined) values[key] = inline;
    else if (i + 1 < words.length) values[key] = words[++i]!;
    else if (flag) pendingFlag = flag;
    else values[key] = true;
  }
  const positionals = formPositionals(route);
  positionals.forEach((p, n) => {
    if (n >= loose.length) return;
    const last = n === positionals.length - 1;
    // Variadic words keep their quotes so `"in/cone off.flac"` stays one argument.
    values[p.name] = !last
      ? loose[n]!
      : p.variadic
      ? loose.slice(n).map(quoteWord).join(" ")
      : loose.slice(n).join(" ");
  });

  return { template, params, route, values, ready: runsBare(route, params, values), loose, pendingFlag };
}

/** Every path param, required positional and required flag has a value (or a default), so the command can run without its form. */
export function runsBare(route: Route, params: Record<string, string>, values: FormValues = {}): boolean {
  const filled = (v: unknown) => (typeof v === "string" ? v.trim() !== "" : v !== undefined);
  return (
    missingParams(route, params).length === 0 &&
    formPositionals(route).every((p) => p.optional || filled(values[p.name])) &&
    route.flags.every((f) => f.optional || f.default !== undefined || f.type === "boolean" || filled(values[f.name]))
  );
}

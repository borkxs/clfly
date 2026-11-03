/**
 * Pure logic over `clfly manifest --json` output: route drill-down, argv
 * building, output shaping, and result → next-command chains. No Raycast
 * imports, so it runs under vitest.
 */
import type { CompleteFrom, FlagInfo, Meta, PositionalInfo } from "@clfly/core";

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
  return template
    .map((s) => (isDynamic(s) ? (params[paramName(s)] ?? `<${paramName(s)}>`) : s))
    .join(" ");
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
    (a, b) => Number(isDynamic(a.segment)) - Number(isDynamic(b.segment)) || a.segment.localeCompare(b.segment),
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
  return route.path.filter(isDynamic).map(paramName).filter((n) => !params[n]);
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
    if (p.variadic) argv.push(...splitWords(text));
    else if (text.startsWith("-") && p.alsoFlag) argv.push(`--${p.name}=${text}`);
    else argv.push(text);
  }
  for (const f of route.flags) {
    const raw = values[f.name];
    if (f.type === "boolean") {
      const on = raw === true;
      if (on && f.default !== true) argv.push(`--${f.name}`);
      if (!on && f.default === true) argv.push(`--no-${f.name}`);
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) continue;
    if (f.type === "array") {
      for (const item of text.split(",").map((s) => s.trim()).filter(Boolean)) argv.push(`--${f.name}`, item);
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

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Last static segments that mean "this changes or removes state". */
const DESTRUCTIVE_LEAVES = new Set(["rm", "remove", "delete", "apply", "reset", "down", "uninstall", "unlink", "clean"]);

/** `meta.destructive`, or a destructive-sounding leaf on a command not marked read-only. */
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
  for (const k of SUBTITLE_KEYS) if (isScalar(obj[k]) && String(obj[k]) && String(obj[k]) !== title) return String(obj[k]);
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
  route: Route;
  arg: string;
  /** `path` fills a path param; otherwise the form value of `arg`. */
  source: "path" | "positional" | "flag";
  /** Value for `arg` taken from one output row. */
  valueOf: (row: unknown) => string | undefined;
}

/**
 * Commands in `tree` whose `completeFrom` points at `from` and whose `field`
 * selects from the rows `shaped` shows. Each becomes a row action that opens
 * that command with the row's value filled in.
 */
export function chainsFor(tree: Tree, from: Route, shaped: Shaped): Chain[] {
  if (shaped.kind !== "rows") return [];
  const prefix = shaped.key === null ? "[]" : `${shaped.key}[]`;
  const out: Chain[] = [];
  for (const route of tree.routes) {
    const args: Array<{ name: string; cf?: CompleteFrom; source: Chain["source"] }> = [
      ...route.positionals.map((p) => ({ name: p.name, cf: p.completeFrom, source: p.source === "path" ? ("path" as const) : ("positional" as const) })),
      ...route.flags.map((f) => ({ name: f.name, cf: f.completeFrom, source: "flag" as const })),
    ];
    for (const { name, cf, source } of args) {
      if (!cf || !samePath(cmdPath(cf.cmd, tree.name), from.path)) continue;
      if (cf.field !== prefix && !cf.field.startsWith(`${prefix}.`)) continue;
      // A path chain only works when this param is the route's only one.
      if (source === "path" && route.path.filter(isDynamic).length !== 1) continue;
      const rest = cf.field.slice(prefix.length + 1);
      out.push({
        route,
        arg: name,
        source,
        valueOf: (row) => {
          const v = rest ? getPath(row, rest) : row;
          return isScalar(v) && v !== null && v !== "" ? String(v) : undefined;
        },
      });
    }
  }
  return out;
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

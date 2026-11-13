import type {
  Accepts,
  FlagInfo,
  ManifestRoute,
  PositionalInfo,
  RowMatch,
  RowsMeta,
  RowScalar,
} from "../types.js";
import { ClflyError } from "../errors.js";
import type { CompletionChoice } from "../complete/index.js";

/**
 * Typed rows: a producer route's `meta.rows` says what its result rows are; a
 * consumer arg's `accepts` says which row type it takes. Everything here is
 * pure: callers (launchers, phone UIs) run the producer and hand over rows.
 */

/** A linked tree as `clfly manifest` returns it (only what matching needs). */
export interface RowTree {
  name: string;
  routes: Array<Pick<ManifestRoute, "path" | "meta" | "flags" | "positionals">>;
}

/** One thing a result row can do: run `tree route` with `arg` set to `value`. */
export interface RowAction {
  tree: string;
  /** Route path as in the manifest (`[":job"]` for a path param). */
  route: string[];
  arg: string;
  /** The row's `ref`, templated. */
  value: string;
  /** True when `arg` is a positional (path param or `positionals` export). */
  positional: boolean;
  /** The acceptor's `meta.description`, for a one-line action label. */
  description?: string;
}

export interface RowProducer {
  tree: string;
  route: string[];
  rows: RowsMeta;
}

// ---------------------------------------------------------------- validation

function isScalar(v: unknown): v is RowScalar {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function readMatch(value: unknown, bad: (why: string) => Error, key: string): RowMatch | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad(`\`${key}\` must be an object`);
  const out: RowMatch = {};
  for (const [k, v] of Object.entries(value)) {
    if (isScalar(v)) out[k] = v;
    else if (Array.isArray(v) && v.length > 0 && v.every(isScalar)) out[k] = v;
    else throw bad(`\`${key}.${k}\` must be a string, number, boolean, or a non-empty array of them`);
  }
  return out;
}

const TYPE_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** True for a namespaced row type name (`pm.item`, not `item`). */
export function isRowType(value: string): boolean {
  return TYPE_RE.test(value);
}

function readType(value: unknown, bad: (why: string) => Error): string {
  if (typeof value !== "string" || !TYPE_RE.test(value.trim())) {
    throw bad('`type` must be a namespaced name like "pm.item"');
  }
  return value.trim();
}

/**
 * Validate a route's `meta.rows`. Returns undefined when absent; throws on a
 * malformed one so a typo fails the build instead of dropping the actions.
 */
export function readRows(value: unknown, where: string): RowsMeta | undefined {
  if (value === undefined) return undefined;
  const bad = (why: string) => new ClflyError(`meta.rows on ${where}: ${why}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw bad("must be an object { type, key, ref, when?, defaults?, label?, sub? }");
  }
  const v = value as Record<string, unknown>;
  const type = readType(v.type, bad);
  if (typeof v.key !== "string" || !v.key.trim().endsWith("[]")) {
    throw bad('`key` must be a field path ending in `[]` ("[]", "hits[]")');
  }
  if (typeof v.ref !== "string" || !/\{[^}]+\}/.test(v.ref)) {
    throw bad('`ref` must be a template with at least one `{field}` ("{id}", "{path}/{name}")');
  }
  for (const key of ["label", "sub"] as const) {
    if (v[key] !== undefined && typeof v[key] !== "string") throw bad(`\`${key}\` must be a string`);
  }
  if (v.example !== undefined && (!v.example || typeof v.example !== "object" || Array.isArray(v.example))) {
    throw bad("`example` must be an object (one sample row)");
  }
  const when = readMatch(v.when, bad, "when");
  let defaults: Record<string, string> | undefined;
  if (v.defaults !== undefined) {
    if (!v.defaults || typeof v.defaults !== "object" || Array.isArray(v.defaults)) throw bad("`defaults` must be an object");
    defaults = {};
    for (const [k, d] of Object.entries(v.defaults)) {
      if (!isScalar(d)) throw bad(`\`defaults.${k}\` must be a string, number, or boolean`);
      defaults[k] = String(d);
    }
  }
  return {
    type,
    key: v.key.trim(),
    ref: v.ref,
    ...(when ? { when } : {}),
    ...(defaults ? { defaults } : {}),
    ...(typeof v.label === "string" ? { label: v.label } : {}),
    ...(typeof v.sub === "string" ? { sub: v.sub } : {}),
    ...(v.example ? { example: v.example as Record<string, unknown> } : {}),
  };
}

/** Validate an `accepts` value: a type string, or `{ type, where? }`. */
export function readAccepts(
  value: unknown,
  where: string,
  whereKeyword?: unknown,
): Accepts | undefined {
  if (value === undefined) return undefined;
  const bad = (why: string) => new ClflyError(`accepts on ${where}: ${why}`);
  if (typeof value === "string") {
    const w = readMatch(whereKeyword, bad, "where");
    return { accepts: readType(value, bad), ...(w ? { where: w } : {}) };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw bad('must be a type string ("pm.item") or { type, where? }');
  }
  const v = value as Record<string, unknown>;
  const w = readMatch(v.where, bad, "where");
  return { accepts: readType(v.type, bad), ...(w ? { where: w } : {}) };
}

/**
 * Overlay a module's `accepts` export (keyed by arg name) onto projected
 * flags/positionals. Throws when a key names no arg.
 */
export function applyAcceptsExport(
  accepts: Record<string, unknown> | undefined,
  flags: FlagInfo[],
  positionals: PositionalInfo[],
  where: string,
): void {
  if (!accepts) return;
  for (const [name, raw] of Object.entries(accepts)) {
    const a = readAccepts(raw, `${where} arg "${name}"`);
    const target = positionals.find((p) => p.name === name) ?? flags.find((f) => f.name === name);
    if (!target) {
      throw new ClflyError(`accepts export on ${where} names "${name}", which is not a flag or positional`);
    }
    if (!a) continue;
    target.accepts = a.accepts;
    if (a.where) target.where = a.where;
    else delete target.where;
  }
}

// ---------------------------------------------------------------- matching

/** True when every key in `match` equals the row's field (an array means any of). */
export function rowMatches(row: unknown, match: RowMatch | undefined): boolean {
  if (!match) return true;
  for (const [path, want] of Object.entries(match)) {
    const got = getPath(row, path);
    if (!isScalar(got)) return false;
    const options = Array.isArray(want) ? want : [want];
    if (!options.some((o) => String(o) === String(got))) return false;
  }
  return true;
}

/**
 * Template `rows.ref` over the row's fields, then the producer's args, then
 * `rows.defaults`. Returns undefined when a placeholder has no value. A value
 * ending in `/` followed by a literal `/` is not doubled (`{path}/{name}` with
 * path `/` gives `/name`).
 */
export function rowRef(
  rows: RowsMeta,
  row: unknown,
  args: Record<string, unknown> = {},
): string | undefined {
  let missing = false;
  const parts: string[] = [];
  const re = /\{([^}]+)\}/g;
  let last = 0;
  for (let m = re.exec(rows.ref); m; m = re.exec(rows.ref)) {
    parts.push(rows.ref.slice(last, m.index));
    const name = m[1]!.trim();
    let value: unknown = getPath(row, name);
    if (!isScalar(value) || value === "") value = args[name];
    if (!isScalar(value) || value === "") value = rows.defaults?.[name];
    if (!isScalar(value) || value === "") {
      missing = true;
      value = "";
    }
    parts.push(String(value));
    last = m.index + m[0].length;
  }
  parts.push(rows.ref.slice(last));
  if (missing) return undefined;
  let out = "";
  for (const part of parts) {
    out += out.endsWith("/") && part.startsWith("/") ? part.slice(1) : part;
  }
  return out;
}

/** The rows of a producer's JSON output, at `rows.key`, typed or not. */
export function rowsOf(output: unknown, rows: Pick<RowsMeta, "key">): unknown[] {
  const steps = rows.key.split(".").filter(Boolean);
  let nodes: unknown[] = [output];
  for (const part of steps) {
    const each = part.endsWith("[]");
    const key = each ? part.slice(0, -2) : part;
    const next: unknown[] = [];
    for (const node of nodes) {
      let v = node;
      if (key) {
        if (!v || typeof v !== "object") continue;
        v = (v as Record<string, unknown>)[key];
      }
      if (each) {
        if (Array.isArray(v)) next.push(...v);
      } else next.push(v);
    }
    nodes = next;
  }
  return nodes;
}

function findRoute(trees: RowTree[], tree: string, route: string[]) {
  const t = trees.find((x) => x.name === tree);
  return t?.routes.find((r) => r.path.length === route.length && r.path.every((p, i) => p === route[i]));
}

/**
 * Every action, in any tree, whose arg accepts this producer row's type:
 * `{ tree, route, arg, value }` with `value` the row's templated `ref`.
 * Empty when the producer has no `rows`, the row fails `rows.when`, or the
 * ref has an unfilled placeholder. Acceptors whose `where` fails are skipped.
 */
export function acceptorsFor(
  trees: RowTree[],
  producer: { tree: string; route: string[] },
  row: unknown,
  args: Record<string, unknown> = {},
): RowAction[] {
  const rows = findRoute(trees, producer.tree, producer.route)?.meta?.rows;
  if (!rows || !rowMatches(row, rows.when)) return [];
  const value = rowRef(rows, row, args);
  if (value === undefined) return [];
  const out: RowAction[] = [];
  for (const tree of trees) {
    for (const route of tree.routes) {
      const slots: Array<[PositionalInfo | FlagInfo, boolean]> = [
        ...route.positionals.map((p) => [p, true] as [PositionalInfo, boolean]),
        ...route.flags.map((f) => [f, false] as [FlagInfo, boolean]),
      ];
      for (const [info, positional] of slots) {
        if (info.accepts !== rows.type || !rowMatches(row, info.where)) continue;
        out.push({
          tree: tree.name,
          route: route.path,
          arg: info.name,
          value,
          positional,
          ...(route.meta?.description ? { description: route.meta.description } : {}),
        });
      }
    }
  }
  return out;
}

/** Producer routes, in any tree, whose rows are of `type`. */
export function producersFor(trees: RowTree[], type: string): RowProducer[] {
  const out: RowProducer[] = [];
  for (const tree of trees) {
    for (const route of tree.routes) {
      const rows = route.meta?.rows;
      if (rows?.type === type) out.push({ tree: tree.name, route: route.path, rows });
    }
  }
  return out;
}

/**
 * A producer's output as choices for an acceptor arg: each typed row that
 * passes `rows.when` and the acceptor's `where` becomes `{ value: ref }`, with
 * `label`/`sub` from `rows.label`/`rows.sub`. Duplicates by value are dropped.
 */
export function rowChoices(
  output: unknown,
  rows: RowsMeta,
  args: Record<string, unknown> = {},
  where?: RowMatch,
): CompletionChoice[] {
  const out: CompletionChoice[] = [];
  const seen = new Set<string>();
  for (const row of rowsOf(output, rows)) {
    if (!rowMatches(row, rows.when) || !rowMatches(row, where)) continue;
    const value = rowRef(rows, row, args);
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    const label = rows.label ? scalar(getPath(row, rows.label)) : undefined;
    const sub = rows.sub ? scalar(getPath(row, rows.sub)) : undefined;
    out.push({ value, ...(label ? { label } : {}), ...(sub ? { sub } : {}) });
  }
  return out;
}

function getPath(node: unknown, path: string): unknown {
  let cur = node;
  for (const key of path.split(".").filter(Boolean)) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function scalar(v: unknown): string | undefined {
  if (!isScalar(v)) return undefined;
  const s = String(v);
  return s || undefined;
}

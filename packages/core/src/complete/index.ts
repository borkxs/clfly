import type { CompleteFrom, FlagInfo, PositionalInfo } from "../types.js";
import { ClflyError } from "../errors.js";

/** One choice picked out of a `completeFrom` command's output. */
export interface CompletionChoice {
  value: string;
  label?: string;
  sub?: string;
}

/**
 * Validate a `completeFrom` value from JSON Schema metadata or a module's
 * `complete` export. Returns undefined when absent; throws on a malformed one
 * so a typo fails the build instead of silently dropping the picker.
 */
export function readCompleteFrom(
  value: unknown,
  where: string,
): CompleteFrom | undefined {
  if (value === undefined) return undefined;
  const bad = (why: string) =>
    new ClflyError(`completeFrom on ${where}: ${why}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw bad("must be an object { cmd, field, args?, label?, sub? }");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.cmd !== "string" || !v.cmd.trim()) throw bad("`cmd` must be a non-empty string");
  if (typeof v.field !== "string" || !v.field.trim()) throw bad("`field` must be a non-empty string");
  for (const key of ["label", "sub"] as const) {
    if (v[key] !== undefined && typeof v[key] !== "string") throw bad(`\`${key}\` must be a string`);
  }
  if (v.args !== undefined) {
    if (!v.args || typeof v.args !== "object" || Array.isArray(v.args)) {
      throw bad("`args` must be an object");
    }
    for (const [k, a] of Object.entries(v.args)) {
      if (!["string", "number", "boolean"].includes(typeof a)) {
        throw bad(`\`args.${k}\` must be a string, number, or boolean`);
      }
    }
  }
  return {
    cmd: v.cmd.trim(),
    field: v.field.trim(),
    ...(v.args ? { args: v.args as CompleteFrom["args"] } : {}),
    ...(typeof v.label === "string" ? { label: v.label } : {}),
    ...(typeof v.sub === "string" ? { sub: v.sub } : {}),
  };
}

/**
 * Overlay a module's `complete` export onto projected flags/positionals.
 * Throws when a key names no arg, so a rename cannot leave a stale entry.
 */
export function applyCompleteExport(
  complete: Record<string, unknown> | undefined,
  flags: FlagInfo[],
  positionals: PositionalInfo[],
  where: string,
): void {
  if (!complete) return;
  for (const [name, raw] of Object.entries(complete)) {
    const cf = readCompleteFrom(raw, `${where} arg "${name}"`);
    const target =
      positionals.find((p) => p.name === name) ?? flags.find((f) => f.name === name);
    if (!target) {
      throw new ClflyError(
        `complete export on ${where} names "${name}", which is not a flag or positional`,
      );
    }
    target.completeFrom = cf;
  }
}

/**
 * Argv for running a `completeFrom` source with `--json`, relative to the
 * tree's bin. `treeName` lets `cmd` carry an optional leading tree name.
 * `values` fills `"$name"` references; unfilled references drop that flag.
 */
export function completeFromArgv(
  cf: CompleteFrom,
  treeName: string,
  values: Record<string, unknown> = {},
): string[] {
  const path = cf.cmd.split(/\s+/).filter(Boolean);
  if (path[0] === treeName && path.length > 1) path.shift();
  const argv = [...path];
  for (const [key, raw] of Object.entries(cf.args ?? {})) {
    let value: unknown = raw;
    if (typeof raw === "string" && raw.startsWith("$")) {
      value = values[raw.slice(1)];
      if (value === undefined || value === "") continue;
    }
    if (value === true) argv.push(`--${key}`);
    else if (value === false) continue;
    else argv.push(`--${key}`, String(value));
  }
  argv.push("--json");
  return argv;
}

/** Pick choices out of a `completeFrom` source's JSON output. Duplicates by value are dropped. */
export function selectCompletions(
  output: unknown,
  cf: CompleteFrom,
): CompletionChoice[] {
  const out: CompletionChoice[] = [];
  const seen = new Set<string>();
  for (const { item, value } of walkField(output, splitField(cf.field))) {
    if (value === undefined || value === null || typeof value === "object") continue;
    const v = String(value);
    if (seen.has(v)) continue;
    seen.add(v);
    const label = cf.label ? scalar(getPath(item, cf.label)) : undefined;
    const sub = cf.sub ? scalar(getPath(item, cf.sub)) : undefined;
    out.push({ value: v, ...(label ? { label } : {}), ...(sub ? { sub } : {}) });
  }
  return out;
}

type Step = { key: string; each: boolean };

function splitField(field: string): Step[] {
  return field
    .split(".")
    .filter(Boolean)
    .map((part) => {
      const each = part.endsWith("[]");
      return { key: each ? part.slice(0, -2) : part, each };
    });
}

/**
 * Walk `steps`, mapping over arrays at `[]`. `item` is the innermost array
 * element `[]` landed on (the root when there is none); `label` and `sub`
 * resolve against it.
 */
function* walkField(
  root: unknown,
  steps: Step[],
): Generator<{ item: unknown; value: unknown }> {
  function* go(node: unknown, i: number, item: unknown): Generator<{ item: unknown; value: unknown }> {
    if (i === steps.length) {
      yield { item, value: node };
      return;
    }
    const step = steps[i]!;
    let next = node;
    if (step.key) {
      if (!next || typeof next !== "object") return;
      next = (next as Record<string, unknown>)[step.key];
    }
    if (step.each) {
      if (!Array.isArray(next)) return;
      for (const el of next) yield* go(el, i + 1, el);
    } else {
      yield* go(next, i + 1, item);
    }
  }
  yield* go(root, 0, root);
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
  if (v === undefined || v === null || typeof v === "object") return undefined;
  const s = String(v);
  return s || undefined;
}

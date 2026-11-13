import { ClflyError } from "../errors.js";
import { rowMatches } from "../rows/index.js";
import type { Accepts } from "../types.js";
import { REF_RE, ROW_REF_RE } from "./types.js";

/**
 * `@<sessionId>/<seq>` as an argument value stands for a spooled result.
 * Returns the bare ref, or undefined when the value is anything else
 * (`@clfly/core`, a path, a number, `@<ref>#<n>`, …).
 */
export function parseRefArg(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 4 || value[0] !== "@") {
    return undefined;
  }
  const ref = value.slice(1);
  return REF_RE.test(ref) ? ref : undefined;
}

/** `@<sessionId>/<seq>#<n>` → `{ ref, n }`: row n of a typed-rows result. */
export function parseRowRefArg(value: unknown): { ref: string; n: number } | undefined {
  if (typeof value !== "string" || value[0] !== "@") return undefined;
  const m = ROW_REF_RE.exec(value.slice(1));
  return m ? { ref: m[1]!, n: Number(m[2]) } : undefined;
}

/** What `resolveRefArgs` needs from the session store. */
export interface RefReader {
  readRefValue(ref: string): unknown;
  readRowRef(ref: string, n: number): { value: string; type: string; row: unknown };
}

/**
 * Replace every top-level `@<ref>` argument with the spooled document it
 * names, and every `@<ref>#<n>` with row n's templated `ref` value. Runs
 * before schema validation on both the CLI and MCP paths, so the consumer
 * validates the bound value exactly as it would a `-` stdin bind.
 *
 * `acceptsOf(arg)` gives the target arg's `accepts`; when set, a row bind
 * must match its type and `where`, else a ClflyError names both types.
 * `read` may be a plain function (whole-result binds only, as before).
 */
export function resolveRefArgs(
  args: Record<string, unknown>,
  read: RefReader | ((ref: string) => unknown),
  acceptsOf: (arg: string) => Accepts | undefined = () => undefined,
): { args: Record<string, unknown>; refs: string[] } {
  let out: Record<string, unknown> | undefined;
  const refs: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const ref = parseRefArg(value);
    if (ref !== undefined) {
      out ??= { ...args };
      out[key] = typeof read === "function" ? read(ref) : read.readRefValue(ref);
      refs.push(ref);
      continue;
    }
    const row = parseRowRefArg(value);
    if (row === undefined) continue;
    if (typeof read === "function") {
      throw new ClflyError(`Row refs (${String(value)}) need a session store`, 2);
    }
    const bound = read.readRowRef(row.ref, row.n);
    const want = acceptsOf(key);
    if (want) {
      if (want.accepts !== bound.type) {
        throw new ClflyError(
          `${String(value)} is a ${bound.type} row, but "${key}" accepts ${want.accepts}`,
          2,
        );
      }
      if (!rowMatches(bound.row, want.where)) {
        throw new ClflyError(
          `${String(value)} is a ${bound.type} row that fails "${key}"'s where ${JSON.stringify(want.where)}`,
          2,
        );
      }
    }
    out ??= { ...args };
    out[key] = bound.value;
    refs.push(`${row.ref}#${row.n}`);
  }
  return { args: out ?? args, refs };
}

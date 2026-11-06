import { REF_RE } from "./types.js";

/**
 * `@<sessionId>/<seq>` as an argument value stands for a spooled result.
 * Returns the bare ref, or undefined when the value is anything else
 * (`@clfly/core`, a path, a number, …).
 */
export function parseRefArg(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 4 || value[0] !== "@") {
    return undefined;
  }
  const ref = value.slice(1);
  return REF_RE.test(ref) ? ref : undefined;
}

/**
 * Replace every top-level `@<ref>` argument with the spooled document it
 * names, via `read` (the session store; it throws on unknown refs). Runs
 * before schema validation on both the CLI and MCP paths, so the consumer
 * validates the bound document exactly as it would a `-` stdin bind.
 */
export function resolveRefArgs(
  args: Record<string, unknown>,
  read: (ref: string) => unknown,
): { args: Record<string, unknown>; refs: string[] } {
  let out: Record<string, unknown> | undefined;
  const refs: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const ref = parseRefArg(value);
    if (ref === undefined) continue;
    out ??= { ...args };
    out[key] = read(ref);
    refs.push(ref);
  }
  return { args: out ?? args, refs };
}

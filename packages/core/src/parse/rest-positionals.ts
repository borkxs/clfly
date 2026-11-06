import type { AnySchema, PositionalInfo } from "../types.js";
import { toJsonSchema } from "../schema/to-json-schema.js";

type JsonSchemaObject = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  [key: string]: unknown;
};

export interface RestAssignment {
  args: Record<string, unknown>;
  /** Tokens no positional could take. Callers treat these as a usage error. */
  leftover: string[];
}

/**
 * Assign leftover argv positionals into the args candidate object:
 * 0. If the command declares a `positionals` export, only those names take
 *    tokens, in declared order (a variadic one takes the rest). Anything past
 *    them is leftover — it never spills into a flag like `--res`.
 * 1. Else exactly one array-typed property → rest fills that array (e.g. `paths`).
 * 2. Else zip rest into unset string-typed properties in key order (e.g. `name`).
 */
export function assignRestPositionals(
  args: Record<string, unknown>,
  rest: string[],
  schema: AnySchema | undefined,
  declared: PositionalInfo[] = [],
): RestAssignment {
  if (rest.length === 0) return { args, leftover: [] };
  if (!schema) return { args, leftover: rest };

  const exported = declared.filter((p) => p.source === "export");
  if (exported.length > 0) {
    const out = { ...args };
    let i = 0;
    for (const pos of exported) {
      if (i >= rest.length) break;
      if (out[pos.name] !== undefined) continue;
      if (pos.variadic) {
        out[pos.name] = rest.slice(i);
        i = rest.length;
      } else {
        out[pos.name] = rest[i++];
      }
    }
    return { args: out, leftover: rest.slice(i) };
  }

  const json = toJsonSchema(schema) as JsonSchemaObject;
  const properties = json.properties ?? {};
  const keys = Object.keys(properties);
  const arrayKeys = keys.filter((k) => isType(properties[k], "array"));
  if (arrayKeys.length === 1) {
    const key = arrayKeys[0]!;
    if (args[key] === undefined) {
      return { args: { ...args, [key]: rest }, leftover: [] };
    }
    return { args, leftover: rest };
  }

  const out = { ...args };
  let i = 0;
  for (const key of keys) {
    if (i >= rest.length) break;
    if (!isType(properties[key], "string")) continue;
    if (out[key] !== undefined) continue;
    out[key] = rest[i++];
  }
  return { args: out, leftover: rest.slice(i) };
}

function isType(schema: JsonSchemaObject | undefined, t: string): boolean {
  if (!schema) return false;
  if (schema.type === t) return true;
  if (Array.isArray(schema.type) && schema.type.includes(t)) return true;
  return false;
}

import type { AnySchema } from "../types.js";
import { toJsonSchema } from "../schema/to-json-schema.js";

type JsonSchemaObject = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  [key: string]: unknown;
};

/**
 * Assign leftover argv positionals into the args candidate object:
 * 1. Exactly one array-typed property → rest fills that array (e.g. `paths`).
 * 2. Else zip rest into unset string-typed properties in key order (e.g. `name`).
 */
export function assignRestPositionals(
  args: Record<string, unknown>,
  rest: string[],
  schema: AnySchema | undefined,
): Record<string, unknown> {
  if (rest.length === 0 || !schema) return args;
  const json = toJsonSchema(schema) as JsonSchemaObject;
  const properties = json.properties ?? {};
  const keys = Object.keys(properties);
  const arrayKeys = keys.filter((k) => isType(properties[k], "array"));
  if (arrayKeys.length === 1) {
    const key = arrayKeys[0]!;
    if (args[key] === undefined) {
      return { ...args, [key]: rest };
    }
    return args;
  }

  const out = { ...args };
  let i = 0;
  for (const key of keys) {
    if (i >= rest.length) break;
    if (!isType(properties[key], "string")) continue;
    if (out[key] !== undefined) continue;
    out[key] = rest[i++];
  }
  return out;
}

function isType(schema: JsonSchemaObject | undefined, t: string): boolean {
  if (!schema) return false;
  if (schema.type === t) return true;
  if (Array.isArray(schema.type) && schema.type.includes(t)) return true;
  return false;
}

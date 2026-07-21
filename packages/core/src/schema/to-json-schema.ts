import type { AnySchema, FlagInfo } from "../types.js";
import { ClflyError } from "../errors.js";

export type JsonSchema = Record<string, unknown>;

/** Project a Standard Schema to JSON Schema (input shape). Prefer draft-07 for MCP later. */
export function toJsonSchema(schema: AnySchema): JsonSchema {
  const std = schema["~standard"];
  if (std.jsonSchema?.input) {
    return std.jsonSchema.input({ target: "draft-07" }) as JsonSchema;
  }
  throw new ClflyError(
    `Schema (vendor: ${std.vendor}) does not implement Standard JSON Schema ` +
      `(~standard.jsonSchema). Use Zod 4, ArkType, or Valibot with JSON Schema support.`,
  );
}

export function projectFlags(schema: AnySchema): FlagInfo[] {
  const json = toJsonSchema(schema);
  return flagsFromJsonSchema(json, schema);
}

export function flagsFromJsonSchema(
  json: JsonSchema,
  sourceSchema?: AnySchema,
): FlagInfo[] {
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set(
    Array.isArray(json.required) ? (json.required as string[]) : [],
  );
  const aliasMap = sourceSchema ? readZodAliases(sourceSchema) : new Map();

  const flags: FlagInfo[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    const aliasFromMeta =
      typeof prop.alias === "string"
        ? prop.alias
        : typeof prop["x-alias"] === "string"
          ? (prop["x-alias"] as string)
          : aliasMap.get(name);

    flags.push({
      name,
      type: inferFlagType(prop),
      description: typeof prop.description === "string" ? prop.description : undefined,
      optional: !required.has(name) || prop.default !== undefined,
      default: prop.default,
      enum: Array.isArray(prop.enum) ? prop.enum : undefined,
      alias: aliasFromMeta,
      deprecated: prop.deprecated === true,
    });
  }
  return flags;
}

function inferFlagType(prop: JsonSchema): FlagInfo["type"] {
  const t = prop.type;
  if (t === "boolean") return "boolean";
  if (t === "number" || t === "integer") return "number";
  if (t === "string") return "string";
  if (t === "array") return "array";
  // Zod coerce.number often becomes string input schema — treat enum/default hints
  if (Array.isArray(prop.enum)) {
    const sample = prop.enum[0];
    if (typeof sample === "number") return "number";
    if (typeof sample === "boolean") return "boolean";
    return "string";
  }
  return "unknown";
}

/** Best-effort Zod 4 shape walk for `.meta({ alias })`. */
function readZodAliases(schema: AnySchema): Map<string, string> {
  const out = new Map<string, string>();
  const shape = getZodShape(schema);
  if (!shape) return out;
  for (const [key, value] of Object.entries(shape)) {
    const meta = getZodMeta(value);
    if (meta && typeof meta.alias === "string") {
      out.set(key, meta.alias);
    }
  }
  return out;
}

function getZodShape(schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as { shape?: unknown; _zod?: { def?: { shape?: unknown } } };
  if (s.shape && typeof s.shape === "object") {
    return s.shape as Record<string, unknown>;
  }
  const defShape = s._zod?.def?.shape;
  if (defShape && typeof defShape === "object") {
    return defShape as Record<string, unknown>;
  }
  return null;
}

function getZodMeta(schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as {
    meta?: (() => Record<string, unknown> | undefined) | Record<string, unknown>;
  };
  if (typeof s.meta === "function") {
    return s.meta() ?? null;
  }
  if (s.meta && typeof s.meta === "object") return s.meta;
  return null;
}

export async function validateSchema<T>(
  schema: AnySchema,
  value: unknown,
): Promise<{ value: T } | { issues: import("../errors.js").ValidationIssue[] }> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    return {
      issues: result.issues.map((issue) => ({
        path: issue.path?.map((p) =>
          typeof p === "object" && p !== null && "key" in p
            ? (p as { key: PropertyKey }).key
            : (p as PropertyKey),
        ) ?? [],
        message: issue.message,
      })),
    };
  }
  return { value: result.value as T };
}

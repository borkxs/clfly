import type { AnySchema, PositionalInfo } from "../types.js";
import { toJsonSchema, type JsonSchema } from "./to-json-schema.js";

export interface ProjectPositionalsInput {
  /** Ordered names from `[segment]` directory params (manifest `":name"`). */
  pathParamNames: string[];
  /** Command `args` schema — used for descriptions and `alsoFlag`. */
  args?: AnySchema;
  /** Optional `positionals` export (tuple / array / object). */
  positionals?: AnySchema;
}

/**
 * Project path params + `positionals` export into a distinct positional list.
 * Keys that appear here must not be listed as flags in help/manifest.
 */
export function projectPositionals(
  input: ProjectPositionalsInput,
): PositionalInfo[] {
  const argsJson = input.args
    ? (toJsonSchema(input.args) as JsonSchema)
    : undefined;
  const argsProps = (argsJson?.properties ?? {}) as Record<string, JsonSchema>;

  const out: PositionalInfo[] = [];

  for (const name of input.pathParamNames) {
    const prop = argsProps[name];
    out.push({
      name,
      source: "path",
      optional: false,
      description:
        typeof prop?.description === "string" ? prop.description : undefined,
      alsoFlag: prop !== undefined,
    });
  }

  if (input.positionals) {
    out.push(...projectExportPositionals(input.positionals, argsProps));
  }

  return out;
}

/** Flag names that are actually positionals (exclude from Options / completions). */
export function positionalNames(positionals: PositionalInfo[]): Set<string> {
  return new Set(positionals.map((p) => p.name));
}

/**
 * Names still accepted as `--flag` at parse time (path/export positional with
 * a twin on `args`, or ordinary flags).
 */
export function parseFlagAllowlist(
  flags: { name: string; alias?: string }[],
  positionals: PositionalInfo[],
): Set<string> {
  const known = new Set<string>(["help", "version", "json", "h", "V"]);
  for (const f of flags) {
    known.add(f.name);
    if (f.alias) known.add(f.alias);
  }
  for (const p of positionals) {
    if (p.alsoFlag) known.add(p.name);
  }
  return known;
}

function projectExportPositionals(
  schema: AnySchema,
  argsProps: Record<string, JsonSchema>,
): PositionalInfo[] {
  const json = toJsonSchema(schema) as JsonSchema;
  const out: PositionalInfo[] = [];

  // Tuple: prefixItems (draft 2019+) or items as array (draft-07).
  const prefixItems = Array.isArray(json.prefixItems)
    ? (json.prefixItems as JsonSchema[])
    : Array.isArray(json.items)
      ? (json.items as JsonSchema[])
      : null;

  if (prefixItems) {
    const minItems =
      typeof json.minItems === "number" ? json.minItems : prefixItems.length;
    for (let i = 0; i < prefixItems.length; i++) {
      const item = prefixItems[i]!;
      const name = tupleElementName(item, i);
      out.push({
        name,
        source: "export",
        optional: i >= minItems,
        description:
          typeof item.description === "string" ? item.description : undefined,
        alsoFlag: argsProps[name] !== undefined,
      });
    }
    // Rest items after a fixed tuple (draft-07 `items` as a single schema).
    const rest =
      json.items && !Array.isArray(json.items)
        ? (json.items as JsonSchema)
        : undefined;
    if (rest) {
      const name =
        typeof rest.title === "string" && rest.title.trim()
          ? rest.title
          : "rest";
      out.push({
        name,
        source: "export",
        optional: true,
        variadic: true,
        description:
          typeof rest.description === "string" ? rest.description : undefined,
        alsoFlag: argsProps[name] !== undefined,
      });
    }
    return out;
  }

  // Single variadic array.
  if (json.type === "array" || (Array.isArray(json.type) && json.type.includes("array"))) {
    const minItems = typeof json.minItems === "number" ? json.minItems : 0;
    const items = (json.items ?? {}) as JsonSchema;
    const name =
      typeof json.title === "string"
        ? json.title
        : typeof items.title === "string"
          ? items.title
          : "args";
    out.push({
      name,
      source: "export",
      optional: minItems === 0,
      variadic: true,
      description:
        typeof json.description === "string"
          ? json.description
          : typeof items.description === "string"
            ? items.description
            : undefined,
      alsoFlag: argsProps[name] !== undefined,
    });
    return out;
  }

  // Object of named positionals (sequential by key order).
  if (json.properties && typeof json.properties === "object") {
    const required = new Set(
      Array.isArray(json.required) ? (json.required as string[]) : [],
    );
    for (const [name, prop] of Object.entries(
      json.properties as Record<string, JsonSchema>,
    )) {
      const isArray =
        prop.type === "array" ||
        (Array.isArray(prop.type) && prop.type.includes("array"));
      out.push({
        name,
        source: "export",
        optional: !required.has(name) || prop.default !== undefined,
        variadic: isArray || undefined,
        description:
          typeof prop.description === "string" ? prop.description : undefined,
        alsoFlag: argsProps[name] !== undefined,
      });
    }
  }

  return out;
}

function tupleElementName(item: JsonSchema, index: number): string {
  if (typeof item.title === "string" && item.title.trim()) return item.title;
  if (typeof item.description === "string") {
    const slug = slugFromDescription(item.description);
    if (slug) return slug;
  }
  return `arg${index + 1}`;
}

function slugFromDescription(description: string): string {
  const word = description
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")[0];
  return word || "";
}

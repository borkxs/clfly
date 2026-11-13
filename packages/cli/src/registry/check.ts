import { isRowType, producersFor, type RowTree } from "@clfly/core/rows";
import type { RowsMeta } from "@clfly/core";
import type { TreeManifest } from "./manifest.js";

/**
 * `clfly manifest --check`: a linker for typed rows. A row type is only a
 * name, so whether a producer's fields fit each acceptor is convention until
 * this checks it. Pure: give it built manifests, get one problem per mismatch.
 */

export type CheckKind = "build" | "no-producer" | "missing-field" | "field-sets" | "namespace" | "no-fields" | "example";

export interface CheckProblem {
  kind: CheckKind;
  tree: string;
  /** Route path joined by spaces (`""` for the root or a tree-level problem). */
  route: string;
  arg?: string;
  message: string;
}

/** `tree route[ arg]: message`, one line. */
export function formatProblem(p: CheckProblem): string {
  const where = [p.tree, p.route].filter(Boolean).join(" ");
  return `${where}${p.arg ? ` arg ${p.arg}` : ""}: ${p.message}`;
}

// ---------------------------------------------------------------- fields

type Schema = Record<string, unknown>;
/** true: the field is there; false: it never is; undefined: the schema is open there. */
type Has = boolean | undefined;

interface Fields {
  source: "schema" | "example";
  has(path: string): Has;
}

function resolveRef(s: Schema, root: Schema): Schema {
  let cur = s;
  for (let i = 0; i < 20 && typeof cur.$ref === "string"; i++) {
    const ref = cur.$ref as string;
    if (!ref.startsWith("#/")) return {};
    let node: unknown = root;
    for (const part of ref.slice(2).split("/")) node = (node as Schema | undefined)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    cur = node && typeof node === "object" ? (node as Schema) : {};
  }
  return cur;
}

/** A schema's alternatives, with $ref, anyOf, oneOf and allOf flattened. */
function branches(s: unknown, root: Schema): Schema[] {
  if (!s || typeof s !== "object") return [];
  const node = resolveRef(s as Schema, root);
  const subs = ["anyOf", "oneOf", "allOf"].flatMap((k) => (Array.isArray(node[k]) ? (node[k] as unknown[]) : []));
  if (!subs.length) return [node];
  const own = { ...node };
  for (const k of ["anyOf", "oneOf", "allOf"]) delete own[k];
  const rest = subs.flatMap((x) => branches(x, root));
  return own.properties ? [own, ...rest] : rest;
}

function typesOf(s: Schema): string[] | undefined {
  if (typeof s.type === "string") return [s.type];
  if (Array.isArray(s.type)) return s.type as string[];
  return undefined;
}

/** Child schemas of `key` across branches; `open` when some branch does not say. */
function childOf(nodes: Schema[], key: string, root: Schema): { nodes: Schema[]; open: boolean } {
  const out: Schema[] = [];
  let open = false;
  for (const b of nodes) {
    const types = typesOf(b);
    if (types && !types.includes("object")) continue;
    const props = b.properties as Record<string, unknown> | undefined;
    if (props && key in props) out.push(...branches(props[key], root));
    else if (b.additionalProperties !== false) open = true;
  }
  return { nodes: out, open };
}

function itemsOf(nodes: Schema[], root: Schema): { nodes: Schema[]; open: boolean } {
  const out: Schema[] = [];
  let open = false;
  for (const b of nodes) {
    const types = typesOf(b);
    if (types && !types.includes("array")) continue;
    if (b.items && typeof b.items === "object" && !Array.isArray(b.items)) out.push(...branches(b.items, root));
    else open = true;
  }
  return { nodes: out, open };
}

/** The row schemas at `rows.key` ("[]", "hits[]", "a.b[]"), or undefined when the schema is open on the way. */
function rowSchemas(schema: Schema, key: string): Schema[] | undefined {
  let nodes = branches(schema, schema);
  for (const part of key.split(".").filter(Boolean)) {
    const each = part.endsWith("[]");
    const name = each ? part.slice(0, -2) : part;
    if (name) {
      const next = childOf(nodes, name, schema);
      if (next.open && !next.nodes.length) return undefined;
      nodes = next.nodes;
    }
    if (each) {
      const next = itemsOf(nodes, schema);
      if (next.open && !next.nodes.length) return undefined;
      nodes = next.nodes;
    }
  }
  return nodes;
}

function schemaFields(schema: Schema, key: string): Fields | undefined {
  const rows = rowSchemas(schema, key);
  if (!rows) return undefined;
  return {
    source: "schema",
    has(path) {
      let nodes = rows;
      for (const part of path.split(".").filter(Boolean)) {
        const next = childOf(nodes, part, schema);
        if (next.nodes.length) nodes = next.nodes;
        else return next.open ? undefined : false;
      }
      return true;
    },
  };
}

function exampleFields(example: Record<string, unknown>): Fields {
  return {
    source: "example",
    has(path) {
      let cur: unknown = example;
      for (const part of path.split(".").filter(Boolean)) {
        if (!cur || typeof cur !== "object" || !(part in (cur as object))) return false;
        cur = (cur as Record<string, unknown>)[part];
      }
      return true;
    },
  };
}

/** Field paths of an example row, as dot paths to its leaves and objects. */
function examplePaths(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [];
  return Object.entries(node).flatMap(([k, v]) => [`${prefix}${k}`, ...examplePaths(v, `${prefix}${k}.`)]);
}

const placeholders = (template: string) => [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!.trim());

// ---------------------------------------------------------------- check

interface Producer {
  tree: string;
  route: string;
  rows: RowsMeta;
  fields?: Fields;
  args: Set<string>;
  /** Row fields this producer's own rows meta uses (ref placeholders it cannot fill from args/defaults, label, sub, when). */
  uses: Array<{ field: string; what: string }>;
}

export function checkRows(trees: TreeManifest[]): CheckProblem[] {
  const problems: CheckProblem[] = [];
  const built: RowTree[] = [];
  for (const t of trees) {
    if (t.error) problems.push({ kind: "build", tree: t.name, route: "", message: `tree does not build: ${t.error.split("\n")[0]}` });
    else built.push({ name: t.name, routes: t.routes });
  }

  // Producers, with where their field list comes from.
  const producers: Producer[] = [];
  for (const t of trees) {
    for (const r of t.routes) {
      const rows = r.meta?.rows;
      if (!rows) continue;
      const route = r.path.join(" ");
      const at = { tree: t.name, route };
      if (!isRowType(rows.type)) {
        problems.push({ kind: "namespace", ...at, message: `row type "${rows.type}" is not namespaced (want "<tree>.${rows.type}")` });
      }
      const fromSchema = r.outputSchema ? schemaFields(r.outputSchema as Schema, rows.key) : undefined;
      const fields = fromSchema ?? (rows.example ? exampleFields(rows.example) : undefined);
      if (!fields) {
        problems.push({
          kind: "no-fields",
          ...at,
          message: `${rows.type} rows have no known fields: declare an \`output\` schema or a \`rows.example\` row`,
        });
      }
      if (fromSchema && rows.example) {
        for (const path of examplePaths(rows.example)) {
          if (fromSchema.has(path) === false) {
            problems.push({ kind: "example", ...at, message: `rows.example field "${path}" is not in the output schema` });
          }
        }
      }
      const args = new Set([...r.flags, ...r.positionals].map((a) => a.name));
      const uses: Producer["uses"] = [];
      for (const p of placeholders(rows.ref)) {
        if (fields?.has(p) === false && (args.has(p) || rows.defaults?.[p] !== undefined)) continue;
        uses.push({ field: p, what: `ref "${rows.ref}"` });
      }
      if (rows.label) uses.push({ field: rows.label, what: "label" });
      if (rows.sub) uses.push({ field: rows.sub, what: "sub" });
      for (const k of Object.keys(rows.when ?? {})) uses.push({ field: k, what: "when" });
      for (const u of uses) {
        if (fields?.has(u.field) === false) {
          problems.push({
            kind: "missing-field",
            ...at,
            message: `rows ${u.what} names "${u.field}", which ${rows.type} rows never have (${fields.source})`,
          });
        }
      }
      producers.push({ ...at, rows, fields, args, uses });
    }
  }

  // One type, one field set: every producer of a type carries the fields any of them relies on.
  const byType = new Map<string, Producer[]>();
  for (const p of producers) byType.set(p.rows.type, [...(byType.get(p.rows.type) ?? []), p]);
  for (const [type, list] of byType) {
    if (list.length < 2) continue;
    for (const a of list) {
      for (const u of a.uses) {
        if (a.fields?.has(u.field) === false) continue; // already reported on a
        for (const b of list) {
          if (b === a || b.fields?.has(u.field) !== false) continue;
          problems.push({
            kind: "field-sets",
            tree: b.tree,
            route: b.route,
            message: `${type} rows lack "${u.field}", which ${a.tree} ${a.route}'s ${u.what} uses: one type, two field sets`,
          });
        }
      }
    }
  }

  // Acceptors: a producer exists, and every `where` key is a field of its rows.
  for (const t of trees) {
    for (const r of t.routes) {
      const route = r.path.join(" ");
      for (const arg of [...r.positionals, ...r.flags]) {
        if (!arg.accepts) continue;
        const at = { tree: t.name, route, arg: arg.name };
        if (!isRowType(arg.accepts)) {
          problems.push({ kind: "namespace", ...at, message: `accepts "${arg.accepts}", which is not namespaced` });
        }
        const found = producersFor(built, arg.accepts);
        if (!found.length) {
          problems.push({ kind: "no-producer", ...at, message: `accepts ${arg.accepts}, which no linked tree produces` });
          continue;
        }
        for (const key of Object.keys(arg.where ?? {})) {
          for (const f of found) {
            const p = producers.find((x) => x.tree === f.tree && x.route === f.route.join(" "));
            if (p?.fields?.has(key) !== false) continue;
            problems.push({
              kind: "missing-field",
              ...at,
              message: `where "${key}": ${p.tree} ${p.route}'s ${arg.accepts} rows never have it (${p.fields.source})`,
            });
          }
        }
      }
    }
  }
  return problems;
}

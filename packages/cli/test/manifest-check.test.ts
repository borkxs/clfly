import { describe, expect, it } from "vitest";
import type { TreeManifest, TreeRoute } from "../src/registry/manifest.js";
import { checkRows, formatProblem } from "../src/registry/check.js";

// Manifests built by hand: checkRows is pure, so the fixtures are the routes.
const itemSchema = {
  type: "array",
  items: {
    type: "object",
    properties: { id: { type: "string" }, name: { type: "string" }, kind: { type: "string" } },
    required: ["id", "name", "kind"],
    additionalProperties: false,
  },
};

function route(path: string[], extra: Partial<TreeRoute> = {}): TreeRoute {
  return { path, flags: [], positionals: [], ...extra };
}

function producer(rows: Record<string, unknown>, extra: Partial<TreeRoute> = {}): TreeRoute {
  return route(["ls"], { meta: { rows: { type: "pm.item", key: "[]", ref: "{id}", ...rows } as never }, outputSchema: itemSchema, ...extra });
}

function acceptor(accepts: string, where?: Record<string, string>): TreeRoute {
  return route(["rm"], {
    positionals: [{ name: "id", source: "positional", required: true, type: "string", accepts, ...(where ? { where } : {}) } as never],
  });
}

const tree = (name: string, routes: TreeRoute[], error?: string): TreeManifest => ({
  name,
  bin: `/bin/${name}`,
  root: `/r/${name}`,
  routes,
  ...(error ? { error } : {}),
});

const lines = (trees: TreeManifest[]) => checkRows(trees).map(formatProblem);

describe("clfly manifest --check", () => {
  it("passes a producer whose fields fit every acceptor", () => {
    expect(lines([tree("pm", [producer({ label: "name", sub: "kind" }), acceptor("pm.item", { kind: "folder" })])])).toEqual([]);
  });

  it("fails an accepts type no tree produces", () => {
    expect(lines([tree("pm", [producer({}), acceptor("pm.hit")])])).toEqual(["pm rm arg id: accepts pm.hit, which no linked tree produces"]);
  });

  it("fails a ref, label or sub field the rows never have", () => {
    expect(lines([tree("pm", [producer({ ref: "{uuid}", label: "title", sub: "kind" })])])).toEqual([
      'pm ls: rows ref "{uuid}" names "uuid", which pm.item rows never have (schema)',
      'pm ls: rows label names "title", which pm.item rows never have (schema)',
    ]);
  });

  it("lets a ref placeholder come from the producer's args or defaults", () => {
    const withArg = producer({ ref: "{path}/{name}" }, { positionals: [{ name: "path", source: "positional", required: false, type: "string" } as never] });
    const withDefault = producer({ ref: "{path}/{name}", defaults: { path: "/" } });
    expect(lines([tree("pm", [withArg])])).toEqual([]);
    expect(lines([tree("pm", [withDefault])])).toEqual([]);
  });

  it("fails an acceptor's where key the producer's rows never have", () => {
    expect(lines([tree("pm", [producer({}), acceptor("pm.item", { type: "folder" })])])).toEqual([
      `pm rm arg id: where "type": pm ls's pm.item rows never have it (schema)`,
    ]);
  });

  it("falls back to rows.example when there is no output schema", () => {
    const p = producer({ label: "title", example: { id: "1", name: "x" } }, { outputSchema: undefined });
    expect(lines([tree("pm", [p, acceptor("pm.item", { kind: "file" })])])).toEqual([
      'pm ls: rows label names "title", which pm.item rows never have (example)',
      `pm rm arg id: where "kind": pm ls's pm.item rows never have it (example)`,
    ]);
  });

  it("fails a producer with neither an output schema nor an example, and an example that drifted from the schema", () => {
    expect(lines([tree("pm", [producer({}, { outputSchema: undefined })])])).toEqual([
      "pm ls: pm.item rows have no known fields: declare an `output` schema or a `rows.example` row",
    ]);
    expect(lines([tree("pm", [producer({ example: { id: "1", nmae: "x" } })])])).toEqual([
      'pm ls: rows.example field "nmae" is not in the output schema',
    ]);
  });

  it("fails one type declared with two field sets", () => {
    const other = route(["find"], {
      meta: { rows: { type: "pm.item", key: "hits[]", ref: "{id}", label: "title" } },
      outputSchema: {
        type: "object",
        properties: { hits: { type: "array", items: { type: "object", properties: { id: {}, title: {} }, additionalProperties: false } } },
        additionalProperties: false,
      },
    });
    expect(lines([tree("pm", [producer({ label: "name" }), other])])).toEqual([
      `pm find: pm.item rows lack "name", which pm ls's label uses: one type, two field sets`,
      `pm ls: pm.item rows lack "title", which pm find's label uses: one type, two field sets`,
    ]);
  });

  it("fails an un-namespaced type, and a tree that does not build", () => {
    const bare = route(["ls"], { meta: { rows: { type: "item", key: "[]", ref: "{id}" } }, outputSchema: itemSchema });
    expect(lines([tree("pm", [bare, acceptor("item")]), tree("dash", [], "boom\nstack")])).toEqual([
      "dash: tree does not build: boom",
      'pm ls: row type "item" is not namespaced (want "<tree>.item")',
      'pm rm arg id: accepts "item", which is not namespaced',
    ]);
  });

  it("treats an open schema (a record, no properties) as unknown, not missing", () => {
    const open = producer({ label: "anything" }, { outputSchema: { type: "array", items: { type: "object", additionalProperties: { type: "string" } } } });
    expect(lines([tree("pm", [open])])).toEqual([]);
  });
});

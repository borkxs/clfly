# Build manifest specification

The build manifest is a **public contract**. Ecosystem packages (`@clfly/docs`, `@clfly/palette`, and anything else) consume it without importing `@clfly/core` internals. See [ecosystem.md](./ecosystem.md).

This document describes format version **1** (`formatVersion: 1`), matching `MANIFEST_FORMAT_VERSION` in `@clfly/core`.

## Stability policy

- Fields are **additive** within a `formatVersion`. Consumers must ignore unknown fields.
- Removals, renames, or semantic changes to existing fields require a `formatVersion` bump.
- `formatVersion` tracks `@clfly/core` majors (or an explicit breaking manifest change called out in the release notes). The loader hard-fails on mismatch — it never silently reinterpret a foreign format.

## Top-level shape

```ts
interface Manifest {
  formatVersion: number; // currently 1
  coreMajor: number;     // major of @clfly/core that wrote this file
  routes: ManifestRoute[];
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `formatVersion` | `number` | yes | Manifest schema version. Must equal the runtime's expected version. |
| `coreMajor` | `number` | yes | Major version of `@clfly/core` that emitted the file. Used in mismatch error text. |
| `routes` | `ManifestRoute[]` | yes | One entry per executable command leaf (including `index` commands). |

## `ManifestRoute`

| Field | Type | Required | Description |
|---|---|---|---|
| `path` | `string[]` | yes | Path segments from the commands tree. Static segments are bare names (`"users"`). Dynamic `[param]` directory segments are stored as `":param"` (e.g. `":id"`). Root `index` is represented as an empty path `[]`. |
| `meta` | `Meta` | no | Command metadata. Absent when the module exports none. |
| `flags` | `FlagInfo[]` | yes | Flat flag projection of `args` for completions/help without loading the module. **Excludes** keys that are positionals (path params / `positionals` export). Empty array when there are no flag args. |
| `positionals` | `PositionalInfo[]` | yes | **Additive in formatVersion 1.** Path params and the optional `positionals` export, distinct from `flags`. Empty array when the command has neither. Older manifests may omit this field; loaders should treat absence as `[]`. |
| `inputSchema` | `object` | no | JSON Schema projection of the command's `args` schema. When `args` is absent, codegen emits `{ type: "object", properties: {} }`. Path params are **not** merged into this object in the manifest (MCP may merge them at serve time). |
| `outputSchema` | `object` | no | **Additive in formatVersion 1.** JSON Schema projection of an optional `output` export. Absent means the return value is untyped JSON everywhere. |
| `importPath` | `string` | no | Relative import specifier written by codegen (for the generated module). Ecosystem UIs should not rely on this. |
| `load` | `() => Promise<unknown>` | runtime | Lazy import thunk. Present in the generated JS module; not a serializable JSON field for third parties. |

### `Meta`

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | `string` | no | Human/agent-facing summary. Projects into `--help`, MCP tool descriptions, and docs. |
| `deprecated` | `boolean \| string` | no | `true` or a reason string. Projects into help, JSON Schema `deprecated`, and MCP descriptions. |
| `interactive` | `boolean` | no | When true, command is CLI-only (TTY interaction in the body). Excluded from MCP tools and OpenAPI; noted in help. |
| `rows` | `RowsMeta` | no | **Additive in formatVersion 1.** What this command's result rows are, for args that `accepts` them. See [Typed rows](#typed-rows). |

### `FlagInfo`

Derived convenience view of `args` properties that are **not** positionals (not a second source of truth — prefer `inputSchema` when you need full schema fidelity).

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | yes | Flag name without leading `--`. |
| `type` | `"boolean" \| "string" \| "number" \| "array" \| "unknown"` | yes | Coarse type for shells/completions. |
| `description` | `string` | no | From schema `.describe()` / JSON Schema `description`. |
| `optional` | `boolean` | yes | Whether the flag may be omitted. |
| `default` | `unknown` | no | Default value when present on the schema. |
| `enum` | `unknown[]` | no | Allowed values when enumerable. |
| `alias` | `string` | no | Short alias if any. |
| `deprecated` | `boolean` | no | Flag-level deprecation. |
| `completeFrom` | `CompleteFrom` | no | **Additive in formatVersion 1.** Where the flag's choices come from. See below. |
| `accepts` | `string` | no | **Additive in formatVersion 1.** Row type this flag takes (`"pm.item"`). See [Typed rows](#typed-rows). |
| `where` | `Record<string, scalar \| scalar[]>` | no | Only rows whose fields match. |

### `PositionalInfo`

**Additive in formatVersion 1** (no bump). Distinct from `flags` so help, docs, and completions do not project path params as `--flags`.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | yes | Positional name (no brackets). |
| `source` | `"path" \| "export"` | yes | `path` = `[name]` directory segment; `export` = command module `positionals` schema. |
| `optional` | `boolean` | yes | Synopsis: `<name>` when false, `[name]` when true. |
| `variadic` | `boolean` | no | When true, synopsis uses `name...`. |
| `description` | `string` | no | From args / positionals schema descriptions when available. |
| `alsoFlag` | `boolean` | no | When true, `--name` is still accepted at parse time (same key on `args`). Help shows `(also --name)`. |
| `completeFrom` | `CompleteFrom` | no | **Additive in formatVersion 1.** Where the positional's choices come from. See below. |
| `accepts` | `string` | no | **Additive in formatVersion 1.** Row type this positional takes (`"pm.item"`). See [Typed rows](#typed-rows). |
| `where` | `Record<string, scalar \| scalar[]>` | no | Only rows whose fields match. |

### `CompleteFrom`

**Additive in formatVersion 1.** Declares that an arg's choices are the output of another command in the same tree. A consumer (a launcher, a phone UI, shell completions) runs `cmd` with `--json` and picks values out of the result. Shell completions ignore it for now.

| Field | Type | Required | Description |
|---|---|---|---|
| `cmd` | `string` | yes | Command path in the same tree, space-separated. A leading tree name is optional: `"pm search"` and `"search"` mean the same thing in the `pm` tree. |
| `args` | `Record<string, string \| number \| boolean>` | no | Flags passed to `cmd` (`{ limit: 20 }` → `--limit 20`; `true` → bare `--flag`; `false` omits it). A string `"$name"` stands for the current value of arg `name` on the command being completed; when that value is empty, the flag is dropped. |
| `field` | `string` | yes | Path to each choice's value in the JSON output. Dot-separated keys; `[]` maps over an array: `"hits[].infoHash"`, `"rows[].name"`, `"[]"` for a bare array of scalars. Non-scalar values are skipped and duplicates dropped. |
| `label` | `string` | no | Path to a display label, relative to the innermost element `field` mapped over (the output root when `field` has no `[]`). |
| `sub` | `string` | no | Path to a secondary line, relative to the same element as `label`. |

Declare it in either of two ways. The module export wins when both name the same arg, and a key that names no flag or positional fails the build.

```ts
// 1. Schema metadata (Zod 4 copies .meta() into the JSON Schema; other
//    libraries work if their JSON Schema output carries a `completeFrom` keyword).
export const positionals = z.object({
  magnet: z.string().meta({
    completeFrom: { cmd: "pm search", args: { query: "$query" }, field: "hits[].infoHash", label: "title", sub: "indexer" },
  }),
});

// 2. Module export keyed by arg name. Use this for `[segment]` path params,
//    which have no schema of their own.
export const complete = {
  job: { cmd: "run ls", field: "jobs[].name", sub: "description" },
};
```

`@clfly/core/complete` exports the dependency-free helpers consumers use: `completeFromArgv(cf, treeName, values)` builds the argv to run, and `selectCompletions(output, cf)` returns `{ value, label?, sub? }[]`.

### Typed rows

**Additive in formatVersion 1.** `completeFrom` is declared on the consumer and stays inside one tree. Typed rows flip it: a producer route says what its rows are (`meta.rows`), a consumer arg says what it takes (`accepts`), and a launcher offers every accepting route, in any linked tree, as an action on a result row. A new tree joins by declaring `accepts`; the producer never changes.

`RowsMeta` (on `meta.rows`, validated at build):

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `string` | yes | Namespaced row type: `"pm.item"`, `"dash.project"`; a shared one like `"fs.path"` crosses trees. |
| `key` | `string` | yes | Where the rows sit in the JSON output, ending in `[]`: `"[]"`, `"hits[]"`. |
| `ref` | `string` | yes | Template for the value an acceptor gets. `{field}` reads the row (dot paths ok), then the producer's own args, then `defaults`: `"{path}/{name}"`. A doubled `/` is collapsed. |
| `when` | `Record<string, scalar \| scalar[]>` | no | Only matching rows are typed. |
| `defaults` | `Record<string, string>` | no | Fallbacks for producer args a `ref` names (`{ path: "/" }`). |
| `label`, `sub` | `string` | no | Row fields for a choice label / secondary line. |

```ts
// Producer: commands/ls.ts
export const meta = {
  readOnly: true,
  rows: { type: "pm.item", key: "[]", ref: "{path}/{name}", defaults: { path: "/" }, label: "name", sub: "type" },
};

// Consumer: commands/du.ts. A module export keyed by arg (wins), or `.meta({ accepts, where })` on the schema.
export const accepts = { path: { type: "pm.item", where: { type: "folder" } } };
```

`@clfly/core/rows` (also re-exported from the root) has the pure matcher: `acceptorsFor(trees, { tree, route }, row, args?)` returns `{ tree, route, arg, value, positional, description? }` for every arg accepting the row; `producersFor`, `rowChoices` (a producer's output as choices for an acceptor), `rowsOf`, `rowRef`, `rowMatches`.

## Naming projections (derived, not stored)

Consumers should use these conventions so they stay aligned with core transports:

| Surface | Rule | Example (`path: ["users", ":id", "show"]`) |
|---|---|---|
| CLI invocation | join statics with spaces; dynamics as `<name>` | `users <id> show` |
| MCP tool name | drop dynamic segments; join remaining with `_`; sanitize non `[a-zA-Z0-9_-]` → `_` | `users_show` |
| HTTP (M4) | `POST /` + segments joined by `/`; `:name` → `{name}` | `POST /users/{id}/show` |

If a consumer needs a derived name that isn't expressible from `path` + these rules, extend the manifest — do not special-case inside an ecosystem package.

## What formatVersion 1 does **not** yet carry

Audit against the ecosystem UI checklist (command paths, names, descriptions, deprecation, JSON Schema for args and output, positional info):

| Need | Status in v1 today |
|---|---|
| Command paths | ✅ `path` |
| Names / invocation | ⚠️ Derivable from `path` via the table above; not stored as a string |
| Descriptions | ✅ `meta.description` |
| Deprecation | ✅ `meta.deprecated` |
| Args JSON Schema | ✅ `inputSchema` |
| Output JSON Schema | ✅ Optional `output` → `outputSchema` (absent when untyped) |
| Positional / path-param info | ✅ `positionals: PositionalInfo[]` (additive; older files may omit → treat as `[]`). Dynamics also remain as `":name"` in `path`. |
| CLI binary name | ❌ Not on the manifest (comes from `createCli({ name })` / package bin). `clfly manifest <tree> --json` adds it from the registry. |
| Choice sources for args | ✅ `completeFrom` on `FlagInfo` / `PositionalInfo` (additive) |
| Result rows as inputs | ✅ `meta.rows` + `accepts`/`where` on `FlagInfo` / `PositionalInfo` (additive) |

Gaps above are candidates for additive fields before palette/docs ship — never for coupling to core.

## Related conventions

Process exit codes and other runtime conventions live in [conventions.md](./conventions.md).

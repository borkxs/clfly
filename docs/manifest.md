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
| `flags` | `FlagInfo[]` | yes | Flat flag projection of `args` for completions/help without loading the module. Empty array when there is no `args` schema. |
| `inputSchema` | `object` | no | JSON Schema projection of the command's `args` schema. When `args` is absent, codegen emits `{ type: "object", properties: {} }`. Path params are **not** merged into this object in the manifest (MCP may merge them at serve time). |
| `outputSchema` | `object` | no | **Planned (additive in v1).** JSON Schema projection of an optional `output` export. Absent means the return value is untyped JSON everywhere. |
| `importPath` | `string` | no | Relative import specifier written by codegen (for the generated module). Ecosystem UIs should not rely on this. |
| `load` | `() => Promise<unknown>` | runtime | Lazy import thunk. Present in the generated JS module; not a serializable JSON field for third parties. |

### `Meta`

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | `string` | no | Human/agent-facing summary. Projects into `--help`, MCP tool descriptions, and docs. |
| `deprecated` | `boolean \| string` | no | `true` or a reason string. Projects into help, JSON Schema `deprecated`, and MCP descriptions. |

### `FlagInfo`

Derived convenience view of `args` properties (not a second source of truth — prefer `inputSchema` when you need full schema fidelity).

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

## Naming projections (derived, not stored)

Consumers should use these conventions so they stay aligned with core transports:

| Surface | Rule | Example (`path: ["users", ":id", "show"]`) |
|---|---|---|
| CLI invocation | join statics with spaces; dynamics as `<name>` | `users <id> show` |
| MCP tool name | join with `_`; strip leading `:` from dynamics | `users_id_show` |
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
| Output JSON Schema | ❌ Planned via optional `output` → `outputSchema` |
| Positional / path-param info | ⚠️ Dynamics appear only as `":name"` in `path`. No descriptions, no separate param list, no projection of the optional `positionals` export |
| CLI binary name | ❌ Not on the manifest (comes from `createCli({ name })` / package bin) |

Gaps above are candidates for additive fields before palette/docs ship — never for coupling to core.

## Related conventions

Process exit codes and other runtime conventions live in [conventions.md](./conventions.md).

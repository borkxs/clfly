# Scaffolder (`init` / `add`) — resolved spec

Resolved from the v0.0.3 train. Implementation lives in `@clfly/cli` (dogfooded command tree) with a thin `@clfly/create` alias for `npm create clfly`.

## Package layout

| Package | Role |
|---|---|
| `@clfly/core` | Library only — router, parse, build, completions, MCP. **No `bin`.** |
| `@clfly/cli` (`0.0.3+`) | Product binary `clfly`. `createCli` + `commands/` tree. Depends on core. |
| `@clfly/create` | Thin alias: same `init` implementation, no drift. Enables `npm create clfly`. |

Library functions (`buildManifest`, `generateCompletions`) stay exported from core. CLI command modules call them; only argv/UX lives in the command tree.

## `clfly init`

Scaffold a new clfly CLI (or retrofit into an existing directory).

### Args

| Arg | Kind | Default | Notes |
|---|---|---|---|
| `name` | optional positional | — | Target is `./<name>` when set, else `cwd` |
| `--validator` | `zod` \| `valibot` \| `arktype` | `zod` | Written to `package.json` → `"clfly": { "validator": "…" }` |
| `--pm` | `npm` \| `pnpm` \| `yarn` \| `bun` | detect lockfile/env, else `npm` | Recorded for install hints; does not run install unless we add that later |
| `--force` | boolean | `false` | Retrofit mode — see below |

### Target & emptiness

- Refuse a **non-empty** target without `--force` (exit 2).
- Empty means no entries other than possible `.` / `..` (and we treat missing dir as empty / creatable).

### `--force` (never overwrite)

- Write **only** files that do not already exist.
- Report every skip.
- **Never** overwrite existing file contents.

### `package.json` when it already exists

**Adopted:** non-destructive merge + report.

- Do **not** replace the file wholesale.
- Add missing keys only:
  - `dependencies` / `devDependencies`: add `@clfly/core` and the chosen validator if absent; **do not** change existing version ranges.
  - `clfly.validator` if `clfly` / `validator` missing.
  - `type: "module"` only if `type` is absent.
  - `bin.<cliName>` only if that bin key is absent.
- **Do not** modify existing `scripts` values; print suggested script lines the user may copy.
- Return / print a summary of `added`, `skipped`, and `suggested`.

### Template (minimal)

```
commands/
  index.ts     # root overview — excluded from MCP tool projection (naming rule)
  hello.ts     # .describe(), enum, default — typechecks under chosen validator
bin/<name>.ts  # createCli wiring
package.json
tsconfig.json
README.md
```

Dynamic segments are taught by `clfly add`, not the starter. `examples/demo-cli` remains the full showcase.

### Return

`{ created: string[]; skipped?: string[]; packageJson?: { added: string[]; skipped: string[]; suggested: string[] } }`

Plain mode: one created path per line (skipped/package notes on stderr). `--json` / MCP: the object.

## `clfly add`

Add command file stubs to an existing (or just-init'd) tree.

### DSL

- **Primary form:** `:param` (documented).
- **Also accepted:** literal `[param]` if the shell delivers it.
- Both translate to `[param]` directories on disk.
- Static segments → files `seg.ts` or nested dirs as needed.
- Final segment is the command file; intermediate statics are directories; dynamics are `[name]/` dirs.

Examples:

| Input | Disk |
|---|---|
| `hello` | `commands/hello.ts` |
| `user/list` | `commands/user/list.ts` |
| `user/:id/report` | `commands/user/[id]/report.ts` |
| `user/[id]/report` | same |

### Args

| Arg | Kind | Notes |
|---|---|---|
| `paths` | variadic rest positionals, **min 1** | Command path DSL strings |
| `--force` | boolean | Allow writing when the target file already exists (overwrite that file). Still subject to batch validation. |
| `--output` | boolean | Include an `output` schema stub in generated files |

### All-or-nothing batches

Before writing anything, validate **every** path:

1. Parse / normalize DSL → disk relative path.
2. Invalid segments (empty, `.`, `..`, path separators in a segment, bad param names).
3. Reserved names — top-level `mcp` (and any other reserved surface).
4. Exists-collisions: target file already exists (unless `--force`).
5. **Tool-name collisions** against the existing tree **and** within the batch, per the MCP naming rule (hard-fail, no `_2` suffixes). Root `index` is not a tool; nested `index` → parent name.

Any failure → per-path error list, **exit 2**, **zero files written**.

### Generated stubs

Must typecheck as generated under the project's validator (`package.json` `clfly.validator`, else zod). Include `meta.description`, `args` with at least one `.describe()`, and default export. With `--output`, add a stub `output` schema export.

### Return

`{ created: string[] }` — repo-relative paths (from `ctx.cwd` / project root).

Plain: one path per line on stdout. `--json` and MCP tool result: the object.

## `@clfly/create`

Thin real alias: parse create-style argv / directory hint, call the same `init` implementation `@clfly/cli` uses. No second template.

## Rest positionals (core)

Leftover argv tokens after the command path fill args as follows (implemented in core `run`):

1. If the args JSON Schema has **exactly one** `type: "array"` property, assign the rest array to it (e.g. `paths`).
2. Else, assign rest tokens in order to unset `type: "string"` properties (e.g. optional `name` on `init`).

## Out of scope here (v0.0.4+)

Root scoping (`--root`), MCP E2E against init/add, `meta.interactive`, SDK lazy-import / `@clfly/core/mcp` subpath, generalized MCP harden. Naming hard-fail + root-index exclusion are specified with the scaffolder because `add` must validate tool names; full MCP projection posture lands in v0.0.4.

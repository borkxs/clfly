# Decision log

Lightweight ADRs. One short *why* per entry. New significant decisions get an entry going forward.

Status: **Accepted** unless marked **Open**.

---

### yargs-parser over minimist

**Accepted.** Argv tokenization needs aliases, `--key=value`, `--no-*` negation, and consistent handling of unknown flags without us reinventing a mini-parser. `yargs-parser` covers that surface; `minimist` is thinner and would push edge cases into framework code. Schema still owns coercion and validation — the parser only tokenizes.

---

### Standard Schema + JSON Schema as the compatibility contract

**Accepted.** Binding the framework to Zod's major version is how prior zod-CLI libraries got orphaned on the 3→4 break. The public contract is Standard Schema (accept any compliant validator) plus JSON Schema as the interchange format for help, completions, MCP `inputSchema`, and OpenAPI. Zod 4 is the documented first-class path and an optional peer, not a hard dependency.

---

### Dev-scan / prod-compile (answer to stricli)

**Accepted.** Stricli's critique of filesystem routing — cold-start scanning and magic outside the JS runtime — is correct as an objection to *runtime* scanning. The answer is the Next.js pattern: live scan in development, `clfly build` emits a lazy manifest with `import()` thunks for production. Invoking one leaf does not load the tree.

---

### Reserved flags hard-fail

**Accepted.** `--help`/`-h`, `--version`/`-V`, `--json`, `--spool`, and the top-level `mcp` / `sessions` commands are framework-owned. A schema that collides fails at build/load time with a loud error, never silently at parse time. Silent reservation is how users lose flags and blame the wrong layer.

---

### RPC-over-POST HTTP mapping

**Accepted.** Commands are RPC, not REST. Every command maps to `POST /<path segments>` with `args` as a JSON body; `[param]` segments become OpenAPI path params (`{id}`). No GET inference, no query-param mapping. Precedent: PostgREST `/rpc/fn_name`. Fixed now so OpenAPI export (M4a) and `clfly http serve` (M4b) cannot drift.

---

### Manifest `formatVersion` policy

**Accepted.** The manifest is a public ecosystem contract, not an internal cache. Fields are additive within a `formatVersion`; removals/renames require a bump, which tracks `@clfly/core` majors (or an explicit breaking manifest change). Loaders hard-fail on mismatch.

---

### Ecosystem two-artifact rule

**Accepted.** Ecosystem packages consume exactly the build manifest and the exported OpenAPI document. They never import `@clfly/core` internals. Missing data → extend the projection. Full text: [ecosystem.md](./ecosystem.md).

---

### Optional `output` export → OpenAPI / MCP / `--json` validation

**Accepted (shape).** Commands may export an optional `output` schema. When present it projects to OpenAPI 200 responses, MCP `outputSchema` / structured content, and runtime validation of return values in `--json` mode. When absent, output is untyped JSON with no warning.

### When to validate `output` return values

**Accepted.** Always validate when `output` is exported, on all transports (MCP, HTTP later, `--json`). Rationale: output is opt-in, payloads are CLI-scale, and machine consumers must never receive schema-violating structured content. No dev/prod divergence.

### MCP `result` wrap + exit 70 for bad output

**Accepted.** Manifest `outputSchema` is the true return schema. MCP `outputSchema` / `structuredContent` wrap array (non-object) roots as `{ result: … }`; object roots pass through. Wrap is projection after successful validation — never coercion for invalid returns. Input misuse exits `2`; `output` schema violations exit `70` (`EX_SOFTWARE`). Full text: [spec/output.md](./spec/output.md).

---

### First npm publish (`0.0.1`) is manual; changesets start afterward

**Accepted.** The initial `0.0.1` publish of the public CLI package is a pre-release stub and predates the changesets release flow. Publish that version manually (`npm publish` from the package directory). Do not drive it through changesets, and do not add CI publish scripts for it. Starting at the next version, bumps and changelogs go through `@changesets/cli` as usual.

### Public CLI package is `@clfly/cli` (bin still `clfly`)

**Accepted.** npm rejected the unscoped name `clfly` as too similar to existing `mlly` (typosquat / similarity policy). Ship the CLI as `@clfly/cli` under the `clfly` org, with `bin.clfly` so installs still expose the `clfly` command. Revisit a bare-name appeal with npm support later if desired; do not block the release on it.

---

### Product binary vs library (`@clfly/cli` vs `@clfly/core`)

**Accepted.** `@clfly/core` is library-only (no `bin`). The `clfly` product binary lives in `@clfly/cli` as a dogfooded `createCli` command tree. `@clfly/create` is a thin alias over the same `init` implementation (`npm create clfly`). Scaffolder details: [scaffolder.md](./scaffolder.md).

---

### MCP tool naming — hard-fail collisions; exclude root index

**Accepted.** Tool names are public API: path segments minus dynamics, joined with `_`; sanitize non `[a-zA-Z0-9_-]` to `_`. Root `commands/index.ts` is **not** projected (no tool named `index`). Nested `users/index.ts` → `users`. Two files mapping to the same name hard-fail at scan/build/add with both files named in the error — never `_2` suffixes.

---

### MCP root scoping

**Accepted.** `ctx.cwd` is transport-supplied. CLI mode uses process cwd and is unscoped (normal CLI trust). MCP mode takes `mcp serve --root <dir>` (default: cwd at server launch); `ctx.cwd` becomes that root and `ctx.scoped` is true. Commands that touch the filesystem should resolve via `ctx.resolvePath`, which rejects `..`, absolute paths outside root, and symlink escapes. Framework guarantee for every clfly CLI, not just `@clfly/cli`.

---

### MCP SDK lives behind `@clfly/core/mcp`

**Accepted.** Keep reserved `mcp serve` in core (headline feature). The main `@clfly/core` entry's runtime import graph stays free of `@modelcontextprotocol/sdk` until `mcp serve` (or an explicit `@clfly/core/mcp` import) loads it. Install size of `@clfly/core` still includes the SDK because `mcp serve` is inherited by every CLI — that is intentional. The SDK's transitive Zod is SDK-internal and does not affect clfly's optional Zod peer story.

---

### `meta.interactive` excludes non-CLI projections

**Accepted.** `meta.interactive: true` marks a command whose body does its own TTY interaction. It is excluded from MCP tools and (later) OpenAPI; help notes it as CLI-only. Interactivity belongs to the resolver; purity belongs to the function.

---

### Session store & reference-based results

**Accepted.** Large validated results spool under a shared repo-local `.clfly/sessions/` tree. Session identity is an explicit filesystem-safe handle (minted by `mcp serve` or `CLFLY_SESSION`), not an MCP transport session (2026-07-28 / SEP-2567). Threshold unit is UTF-8 JSON bytes (default 64 KiB). Refs are `<sessionId>/<seq>` resolved only via the manifest. CLI `--spool` and MCP auto-spool share one ledger. Full text: [spec/session-store.md](./spec/session-store.md).

### Stdin merge / bind

**Accepted.** Non-TTY non-empty stdin supplies args: merge mode (default) filters to declared keys then loses to argv; bind mode (`-` sentinel) assigns the entire decoded JSON value to one field and disables merge. NDJSON / multi-value / merge-mode non-objects → exit 2. Full text: [spec/stdio.md](./spec/stdio.md).

### `meta.{readOnly,destructive,idempotent}` → MCP tool annotations

**Accepted.** Optional meta booleans project to MCP `annotations.readOnlyHint` / `destructiveHint` / `idempotentHint`. Absent means omit (clients keep spec defaults). Hints are advisory.

### Elicitation via MRTR / Tasks extension

**Open (stubs).** Interactive commands via MRTR and long-runners via SEP-2663 tasks are decision-pending — see [spec/elicitation-mrtr.md](./spec/elicitation-mrtr.md) and [spec/tasks.md](./spec/tasks.md). Do not implement.

### Mounts / pack composition

**Open (stub).** Mounts are a product scalpel (publishable bridge vs private `pm`), not an extract-everything backlog. Hard problems for core: config namespacing per mount, MCP tool naming across mounts. Sequencing: stdin → 0.2.0, then forkspace dogfood, then librarian extraction as mounts dogfood. Full text: [spec/mounts.md](./spec/mounts.md).

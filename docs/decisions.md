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

**Accepted.** `--help`/`-h`, `--version`/`-V`, `--json`, and the top-level `mcp` command are framework-owned. A schema that collides fails at build/load time with a loud error, never silently at parse time. Silent reservation is how users lose flags and blame the wrong layer.

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

**Open — choose one:**

| Option | Pros | Cons |
|---|---|---|
| **A. Always validate** in `--json` mode (dev and prod) | Same behavior everywhere; agents/clients never see schema-violating payloads; bugs surface at the boundary | Extra CPU on every JSON response; large payloads pay a tax in prod |
| **B. Dev-only validation** (skip in prod / compiled manifest runs) | Keeps prod hot path cheap; still catches drift during development | Prod can emit invalid JSON that MCP/OpenAPI consumers reject; “works in prod, fails in the client” class of bug |

Call needed before M3 wires `outputSchema` and before M4a freezes response schemas.

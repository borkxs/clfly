# Handoff: interchange + session store

Pickup doc for the next agent. Read this first, then the linked ADRs/fixtures — do not re-litigate settled decisions unless a fixture proves them wrong.

## Where we are

Dependency order for this workstream:

| # | Work | Status |
|---|---|---|
| 1a | ADR: `output` schemas → manifest / MCP | **Paper settled** — [output.md](./output.md) |
| 1b | ADR: stdio (merge / bind / unknown keys) | **Paper settled** — [stdio.md](./stdio.md) |
| 1c | ADR: session store & reference-based results | **Accepted + implemented** — [session-store.md](./session-store.md) |
| 1d | ADR stubs: elicitation-MRTR / Tasks | **Stubs only** — [elicitation-mrtr.md](./elicitation-mrtr.md), [tasks.md](./tasks.md) |
| 2 | Implement output schemas + MCP structured results + exit codes | **Done in tree** |
| 2b | Session store + `--spool` + `result_read` + annotations | **Done in tree** |
| 3 | Implement stdin convention | **Done** — fixtures active |
| 3b | Cut **0.2.0** | **Done on branch** — `@clfly/core@0.2.0`, `@clfly/cli`/`create@0.0.6` (publish when ready) |
| 4 | Second dogfood CLI (forkspace) | **Next** — different rough edges than `pm` |
| 5 | Mounts dogfood: librarian / Premiumize→Plex bridge | Parked — commercial motive; see [mounts.md](./mounts.md) |
| 6 | Launch essay (parallel, not blocked) | Not started |

Parked (do not build): mounts / composition (stub only — [mounts.md](./mounts.md)), eject/resolver ideas, Python port, fan-out (one invocation per NDJSON line), elicitation/Tasks (stubs only).

**Do not** treat a census table as an extract-everything backlog. Mounts earn existence when a pack has a second consumer or ships independently; most of `pm` stays private. The forcing function is the publishable bridge vs private search half — not hygiene.

## What just landed (stdin merge / bind)

- Non-TTY non-empty stdin merges as a filtered JSON object (argv wins); TTY / empty ignored.
- Exactly one `-` binds the entire decoded JSON value to that field (merge off); second `-` → exit 2.
- NDJSON / multi-value / merge-mode arrays / invalid JSON → exit 2.
- Injectable `createCli({ stdinText, stdinIsTTY })` for tests; MCP still does not read process stdin.

Key code: `packages/core/src/stdin/assemble.ts`, wired in `run.ts` before `validateSchema`.

Verify: `pnpm --filter @clfly/core test` — conformance fixtures all active/green.

## What landed earlier (session store)

- Shared `.clfly/sessions/<id>/` ledger; explicit handles (`CLFLY_SESSION` / serve-minted); threshold = UTF-8 JSON **bytes** (default 64 KiB).
- MCP auto-spool over threshold → truncation envelope; CLI `--spool` opt-in (unified ledger).
- Fallback tools: `result_read` (live), `result_query` (stub — JSONPath deferred).
- `sessions list|clean` builtin; init/add gitignore `.clfly/`.
- `meta.{readOnly,destructive,idempotent}` → MCP `annotations.*Hint`.

Key code: `packages/core/src/session/`, `packages/core/src/mcp/session-tools.ts`, spool hooks in `run.ts` / `mcp/server.ts`.

Verify: `pnpm --filter @clfly/core test` — session tests + help snapshots green; **9 stdin cases still skipped**.

## What landed earlier (step 2)

Specs and code agree on:

- Optional `output` → manifest `outputSchema` (true schema), MCP `outputSchema` / `structuredContent`, validate on `--json` + MCP.
- MCP wrap key is **`result`**: valid array roots become `{ result: […] }` for MCP only; `--json` / manifest stay unwrapped. Object roots pass through.
- Wrap is **projection after validation**, never coercion. Object-schema + array return → exit **70**, not a helpful wrap.
- Exit **2** = input/usage misuse; exit **70** = `output` schema violation (`EX_SOFTWARE`); exit **1** = other runtime. See [../conventions.md](../conventions.md).

Key code:

- `packages/core/src/mcp/project.ts` — `validateOutput`, `projectMcpOutputSchema`, `shapeStructuredContent`, `OUTPUT_VALIDATION_EXIT`, `MCP_RESULT_KEY`
- `packages/core/src/errors.ts` — `ValidationError` exits `2`
- `packages/core/src/run.ts` — unknown flags exit `2`; `--json` path calls `validateOutput`
- Conformance runner: `packages/core/test/conformance.test.ts` loads `docs/spec/fixtures/*.json`

## Next: forkspace dogfood

Interchange is released as **0.2.0** on this branch (publish when ready). Next case study: migrate forkspace and capture rough edges `pm` did not surface.

### Stdin rules (settled — do not invent parallels)

1. **When to read stdin** — not a TTY and non-empty after trim. TTY / empty → ignore.
2. **Merge precedence** — schema defaults < stdin object (filtered) < argv. Shallow. Then one `validateSchema`.
3. **Unknown keys** — drop undeclared stdin keys (lenient). Argv stays strict.
4. **Merge XOR bind** — default merge; exactly one `-` binds entire JSON to that field. Second `-` → exit 2.
5. **NDJSON / multi-value** → exit 2. `--slurp` name reserved.
6. **List output** — `--json` stays one document; consumers use bind (`--items -`).

## After 0.2.0 (not now unless asked)

- **Step 4:** forkspace as second clfly migration — surface rough edges `pm` did not.
- **Step 5:** librarian / bridge extraction as mounts dogfood — `@you/premiumize` + `@you/plex` adapters, publishable bridge CLI, private `pm` mounts those plus search. Motive and hard problems: [mounts.md](./mounts.md). Cheap prep inside `pm`: keep `premiumize.ts` / `plex.ts` / `tmdb.ts` data-in/data-out (no `process.exit`, no `@clack`, no `console.log` below `src/commands/`).
- **Step 6:** Launch essay — "what Unix got right, what PowerShell got right, why agents need both" (weekend writing; sharpens spec defenses).

## Explicitly out of scope

- Mounts / pack composition in core (**until** step 5 / Accepted [mounts.md](./mounts.md))
- Per-line NDJSON fan-out
- Config-file merging, plugins, interactive prompts in command bodies
- Changing the wrapper key away from `result`
- Extracting packs from `pm` for aesthetic hygiene

## Quick commands

```bash
pnpm --filter @clfly/core test
pnpm --filter @clfly/core test test/conformance.test.ts
```

If conformance discovery fails, check that `docs/spec/fixtures/` resolves from `packages/core/test/conformance.test.ts` (`../../../docs/spec/fixtures`).

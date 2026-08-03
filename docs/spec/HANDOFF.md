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
| 3 | Implement stdin convention | **Next** — fixtures written, all `pending` → unlocks **0.2.0** |
| 4 | Second dogfood CLI (forkspace) | Not started — different rough edges than `pm` |
| 5 | Mounts dogfood: librarian / Premiumize→Plex bridge | Parked — commercial motive; see [mounts.md](./mounts.md) |
| 6 | Launch essay (parallel, not blocked) | Not started |

Parked (do not build): mounts / composition (stub only — [mounts.md](./mounts.md)), eject/resolver ideas, Python port, fan-out (one invocation per NDJSON line), elicitation/Tasks (stubs only).

**Do not** treat a census table as an extract-everything backlog. Mounts earn existence when a pack has a second consumer or ships independently; most of `pm` stays private. The forcing function is the publishable bridge vs private search half — not hygiene.

## What just landed (session store)

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

## Your job (step 3): stdin merge / bind

Implement [stdio.md](./stdio.md) until the pending fixtures flip to `active` and pass. Spec is the contract; fixtures are the acceptance tests. Session spool files are already valid bind documents (true `--json` body).


### Settled rules (do not invent parallels)

1. **When to read stdin** — not a TTY and non-empty after trim (`process.stdin.isTTY` falsy covers pipes *and* `cmd < file.json`). TTY / empty → ignore stdin.
2. **Merge precedence** — schema defaults < stdin object (filtered) < argv (path params, positionals, flags actually present). Shallow top-level only. Then one `validateSchema` pass.
3. **Unknown keys** — drop stdin keys not in args schema declared properties (lenient). Argv stays strict.
4. **Merge XOR bind** — default = merge (stdin must be one JSON **object**). Exactly one argv value `-` binds the **entire** decoded JSON value to that field and **disables merge**. Second `-` → exit 2. `-` is decoded JSON only; raw bytes out of scope v1.
5. **NDJSON / multi-value** → exit 2 (no first-line grab, no fan-out). `--slurp` name reserved if multi-value is ever added later.
6. **List output** — `--json` stays one document (already true). Arrays as output are fine; consumers use bind (`--items -`), not merge.

### Suggested implementation shape

Keep assembly pure and fixture-testable:

1. Add something like `assembleInput({ argvFlags, stdinText, stdinIsTTY, declaredKeys, bindField })` (name freely) that returns either the merged/bound object or a usage error.
2. Wire it in `packages/core/src/run.ts` **before** `validateSchema`, with injectable stdin for tests (`createCli` options or the conformance harness).
3. Conformance runner today materializes temp command modules and calls `createCli` — extend it to feed `stdin` / `stdinIsTTY` from each case (those fields are already on the fixtures).
4. Flip each stdin fixture's `"status": "pending"` → `"active"` as behavior lands (or all at once when green).
5. Do **not** change MCP invoke to read process stdin; MCP already gets a JSON args object. Stdin is a CLI-transport concern.

### Fixtures to turn green

| File | Rule |
|---|---|
| [fixtures/stdin-non-tty.json](./fixtures/stdin-non-tty.json) | TTY / redirect / empty / argv-wins / NDJSON→2 |
| [fixtures/stdin-unknown-keys.json](./fixtures/stdin-unknown-keys.json) | Filter extras; argv unknown flag already `active` |
| [fixtures/stdin-bind.json](./fixtures/stdin-bind.json) | `--items -`, bind disables merge, two sentinels → 2 |

Format: [fixtures/README.md](./fixtures/README.md).

One active case already passes without stdin: `stdin-unknown-keys.json` → `argv-unknown-flag-exit-2`.

### Edge cases worth a fixture if missing while you implement

- Bind with non-JSON stdin → exit 2.
- Merge with JSON array (no `-`) → exit 2.
- Defaults apply only after merge (key absent from both stdin and argv).

## After stdin (not now unless asked)

- **Step 4:** forkspace as second clfly migration — surface rough edges `pm` did not.
- **Step 5:** librarian / bridge extraction as mounts dogfood — `@you/premiumize` + `@you/plex` adapters, publishable bridge CLI, private `pm` mounts those plus search. Motive and hard problems: [mounts.md](./mounts.md). Cheap prep inside `pm`: keep `premiumize.ts` / `plex.ts` / `tmdb.ts` data-in/data-out (no `process.exit`, no `@clack`, no `console.log` below `src/commands/`).
- **Step 6:** Launch essay — "what Unix got right, what PowerShell got right, why agents need both" (weekend writing; sharpens spec defenses).
- Thin leftover in [output.md](./output.md): OpenAPI 200 uses **manifest** schema (not MCP-wrapped); primitive `output` roots omit MCP `outputSchema`.

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

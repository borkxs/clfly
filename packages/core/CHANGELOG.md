# @clfly/core

## 0.4.0

### Minor Changes

- 9da15d6: Add `completeFrom`: an arg can declare that its choices come from another command's `--json` output (`{ cmd, field, args?, label?, sub? }`), via Zod `.meta({ completeFrom })` or a module `complete` export. It projects onto `FlagInfo` / `PositionalInfo` in the manifest (additive in formatVersion 1). `@clfly/core/complete` exports `completeFromArgv` and `selectCompletions` for consumers. `buildManifest` now builds in memory when `outFile` is omitted, and `clfly manifest [tree]` prints linked trees' routes as JSON for launchers and UIs.
- d26d19c: Ported from borkxs-mono: every CLI run and MCP tool call appends one line (tree, command path, via, ms, output bytes, exit code; never argument values) to `~/.local/state/clfly/invocations.jsonl` (`CLFLY_USAGE_LOG=off` disables, any other value is the path). `result_query` runs a jq program over a spooled result (large output spools to a new ref; `CLFLY_JQ` overrides the binary). `mcp serve` answers every request already received and exits when stdin ends. `Cli.runUnlogged(argv, stdout)` runs without the log.
- 7586244: Ported from borkxs-mono (PRs 160, 162, 166, 196):

  - **Strict positionals:** words left over after every positional is filled exit 2 ("Unexpected argument …") instead of filling a flag.
  - **`@<sessionId>/<seq>` binds a spooled result** in place of any argument value, on the CLI and over MCP, before validation. Every projected MCP tool takes the reserved `spool: true` to return a ref even for a small result. See `docs/spec/session-store.md`.
  - **`ReportedExit`** (exported): a command whose output already said why throws it instead of calling `process.exit`. The CLI prints nothing and returns its code (`--json` still writes `{error:{message}}` for a failure); over MCP a failure is a tool error and exit 0 (a cancel) a plain result. A `ClflyError` with an empty message now prints `Failed (exit N).` instead of a blank line.

- 8395548: **Breaking:** stdin is read only on an explicit `-` sentinel. Piped stdin is no longer merged into args by default. `producer | cmd` now ignores stdin, so write `producer | cmd --args -` to merge one JSON object (undeclared keys dropped, argv wins). Field binds (`--field -`, positional `-`) are unchanged. `args` is now a reserved flag. Without a sentinel the CLI never touches stdin, so agent shells that hand commands a never-closed pipe no longer hang them.
- bfe0816: Typed rows, ported from borkxs-mono (PR 218). A producer route declares `meta.rows: { type, key, ref, when?, defaults?, label?, sub? }` (validated at build, carried into the manifest); a consumer arg declares `accepts` (a module `accepts` export keyed by arg, `"pm.item"` or `{ type, where? }`, or an `accepts`/`where` JSON Schema keyword via `.meta()`), projected onto flags and positionals as `accepts` + `where`. New `@clfly/core/rows` subpath (also re-exported from the root): `acceptorsFor(trees, producer, row, args?)`, `producersFor`, `rowChoices`, `rowsOf`, `rowRef`, `rowMatches`, `readRows`, `readAccepts`. `completeFrom` is unchanged. `clfly manifest` carries rows/accepts. The Raycast extension's result-row chains now include every accepting route in any linked tree, with the ref templated from the producer's run args; a route both rows and `completeFrom` reach is offered once.

## 0.3.0

### Minor Changes

- bf8a6be: Refresh the MCP tool list when a dev-mode command tree changes, and treat a trailing `[param].ts` file as its own command.

## 0.2.0

### Minor Changes

- a31ddb5: Harden `mcp serve`: `--root` scoping, optional `output` → MCP `outputSchema`/structured content, `meta.interactive` exclusion, and `@clfly/core/mcp` subpath with lazy SDK load.
- a31ddb5: Session store for large results (`.clfly/sessions/`, `--spool`, MCP auto-spool + `result_read`), plus `meta.{readOnly,destructive,idempotent}` → MCP tool annotations.
- e9d8609: Implement stdin merge/bind: non-TTY JSON merge (lenient unknown keys), `-` bind sentinel, and conformance fixtures.

### Patch Changes

- Show subcommand `meta.description` in help (load in dev scan; use manifest meta in prod).

## 0.1.1

### Patch Changes

- Skip `.d.ts` files when scanning commands (fake `add.d` routes) and print root help on bare argv when there is no root index command.

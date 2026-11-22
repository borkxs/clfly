# @clfly/cli

## 0.1.0

### Minor Changes

- d26d19c: `clfly changelog [--since 7d] [--json] [--snapshot]`: one dated, newest-first list of capability changes on this machine (skills, linked trees and their command files, repo `CHANGELOG.md` lines, MCP servers, hooks, tick jobs, dash cards), from a snapshot diff kept under `~/.local/state/clfly/`. Ported from borkxs-mono #199. `clfly link`/`unlink` spawn npm/pnpm through the shell and use `where.exe` on Windows, and the registry write retries a rename over a busy file there.
- 9da15d6: Add `completeFrom`: an arg can declare that its choices come from another command's `--json` output (`{ cmd, field, args?, label?, sub? }`), via Zod `.meta({ completeFrom })` or a module `complete` export. It projects onto `FlagInfo` / `PositionalInfo` in the manifest (additive in formatVersion 1). `@clfly/core/complete` exports `completeFromArgv` and `selectCompletions` for consumers. `buildManifest` now builds in memory when `outFile` is omitted, and `clfly manifest [tree]` prints linked trees' routes as JSON for launchers and UIs.
- 43d9ce0: Add `clfly register --harness <h>` for claude-code, cursor, vscode, codex, gemini, and claude-desktop. It writes or removes one MCP server entry and leaves every other entry alone. `--self` registers clfly itself, `--dry-run` prints the diff, and `--tree` picks a registry name or package directory. When `claude` (or, for user scope, `codex`) is on PATH, an apply goes through that CLI instead of editing the file.
- 43d9ce0: Add `clfly link`, `clfly unlink`, and `clfly ls`. `link` runs the package manager's global link and records the tree in `$CLFLY_HOME/registry.json`; `ls` shows whether each bin resolves and where it is registered. `init` now prints `Then: clfly link` and still does not link.

### Patch Changes

- 3bcd145: `clfly add --dir <tree>` writes stubs into that tree's package instead of cwd. MCP callers need it: the `clfly` server's cwd is wherever the harness launched it, not the caller's worktree.
- 9cb275e: `clfly link` and `clfly unlink` use pnpm for a package inside a pnpm workspace, instead of falling back to `npm link` because the package has no lockfile of its own.
- 967c18c: `clfly memory --out <file>` writes a Claude Code memory file listing every linked tree and its commands, read from each tree's own `mcp serve` tool list. It rewrites the file only when the content changes, so a scheduler can run it often.
- cdd52dc: `clfly register --scope user` runs `.js`/`.mjs`/`.cjs` bins through the absolute node that ran clfly, so Claude Desktop and other GUI harnesses without a shell PATH can start them.
- bfe0816: Typed rows, ported from borkxs-mono (PR 218). A producer route declares `meta.rows: { type, key, ref, when?, defaults?, label?, sub? }` (validated at build, carried into the manifest); a consumer arg declares `accepts` (a module `accepts` export keyed by arg, `"pm.item"` or `{ type, where? }`, or an `accepts`/`where` JSON Schema keyword via `.meta()`), projected onto flags and positionals as `accepts` + `where`. New `@clfly/core/rows` subpath (also re-exported from the root): `acceptorsFor(trees, producer, row, args?)`, `producersFor`, `rowChoices`, `rowsOf`, `rowRef`, `rowMatches`, `readRows`, `readAccepts`. `completeFrom` is unchanged. `clfly manifest` carries rows/accepts. The Raycast extension's result-row chains now include every accepting route in any linked tree, with the ref templated from the producer's run args; a route both rows and `completeFrom` reach is offered once.
- Updated dependencies [9da15d6]
- Updated dependencies [d26d19c]
- Updated dependencies [7586244]
- Updated dependencies [8395548]
- Updated dependencies [bfe0816]
  - @clfly/core@0.4.0

## 0.0.7

### Patch Changes

- bf8a6be: Add `clfly skill export`. Scaffolded CLIs get a `bin/<name>.mjs` launcher that registers tsx, so `npm link` runs on Node 20.
- Updated dependencies [bf8a6be]
  - @clfly/core@0.3.0

## 0.0.6

### Patch Changes

- a31ddb5: Harden `mcp serve`: `--root` scoping, optional `output` → MCP `outputSchema`/structured content, `meta.interactive` exclusion, and `@clfly/core/mcp` subpath with lazy SDK load.
- a31ddb5: Session store for large results (`.clfly/sessions/`, `--spool`, MCP auto-spool + `result_read`), plus `meta.{readOnly,destructive,idempotent}` → MCP tool annotations.
- Updated dependencies [a31ddb5]
- Updated dependencies [a31ddb5]
- Updated dependencies [e9d8609]
  - @clfly/core@0.2.0

## 0.0.5

### Patch Changes

- Skip `.d.ts` files when scanning commands (fake `add.d` routes) and print root help on bare argv when there is no root index command.
- Updated dependencies
  - @clfly/core@0.1.1

# Runtime conventions

## Exit codes

sysexits-ish convention for the process wrapper and any spawned CLI:

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Runtime error (handler throw, I/O failure, unexpected failure) |
| `2` | Usage / **input** validation error (bad argv, unknown flag, stdin usage, args schema failure, unknown command) |
| `70` | **Output** validation failure — command returned a value that violates its own `output` schema (`EX_SOFTWARE`; producer bug, not caller misuse). See [spec/output.md](./spec/output.md). |

Reserved for future (do not reuse casually):

| Code | Intended meaning |
|---|---|
| *(TBD)* | Build / manifest mismatch (e.g. `formatVersion` incompatible) — pick a dedicated code when wiring loud mismatch exits in the bin |

Commands return values or throw; the bin wrapper owns `process.exit`. In `--json` mode, success values go to stdout and errors become `{ "error": … }` on stderr with the same exit-code rules. Agents should treat `2` as "fix the call" and `70` as "command is broken."

## Root scoping / `ctx.resolvePath`

- **CLI:** `ctx.cwd` is the process cwd. `ctx.scoped` is false — absolute paths via `resolve` are allowed (normal CLI trust). Prefer `ctx.resolvePath` for relative project paths anyway.
- **MCP:** `mcp serve --root <dir>` (default: launch cwd) sets `ctx.cwd` to that root and `ctx.scoped` to true. `ctx.resolvePath(userPath)` rejects escapes (`..`, absolute paths outside root, symlink tricks) with a clear error.

Every filesystem-touching command should resolve user-supplied paths through `ctx.resolvePath` so agent-driven CLIs inherit the jail automatically.

## Interactivity vs purity

Interactivity belongs to the resolver; purity belongs to the function. Command bodies are `args → result`. Arg-gathering UX (TTY prompting, future `@clfly/prompts`) lives in the resolver layer. Mark bodies that still do their own TTY work with `meta.interactive: true` so they are excluded from MCP / OpenAPI.

## Behavioral meta → MCP annotations

Optional `meta.readOnly` / `meta.destructive` / `meta.idempotent` project to MCP tool `annotations.readOnlyHint` / `destructiveHint` / `idempotentHint`. Absent means omit (clients keep protocol defaults). Hints are advisory.

## Session store / large results

Large validated results may spool under `.clfly/sessions/` (shared by all clfly CLIs under the active root/cwd). See [spec/session-store.md](./spec/session-store.md).

- **MCP:** auto-spool when compact JSON exceeds the byte threshold (default 64 KiB); return a truncation envelope with `ref`.
- **CLI:** `--json` unchanged by default; `--spool` writes the full document to the session ledger and prints the path (or an envelope with `--json` when over threshold).
- **Identity:** `CLFLY_SESSION` or a minted handle — not MCP transport sessions.
- **Builtins:** `sessions list|clean`; MCP fallback tools `result_read` / stub `result_query`.

## Optional `output` export

When a command exports `output`, return values are always validated on machine-facing transports (`--json`, MCP, and later HTTP). Validated MCP results also set `structuredContent` when the value is a non-null object. Absent `output`, return values stay untyped JSON with no warning.

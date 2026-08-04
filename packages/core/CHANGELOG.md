# @clfly/core

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

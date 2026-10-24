# @clfly/cli

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

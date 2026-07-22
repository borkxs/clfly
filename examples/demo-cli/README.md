# demo-cli

Reference clfly app: a small `commands/` tree projected to a CLI and an MCP server.

```
commands/
  users/
    list.ts              → demo users list       → MCP tool users_list
    [id]/
      show.ts            → demo users <id> show  → MCP tool users_show
  deploy.ts              → demo deploy           → MCP tool deploy
```

## Setup

From the repo root:

```bash
pnpm install
pnpm --filter @clfly/core build
```

`@clfly/core` must be built — this package imports it from `dist/`.

## Run

The entrypoint is TypeScript (`bin/demo.ts`). Use the package scripts (tsx), not a bare `node` / `npm link` yet:

```bash
# from repo root
pnpm --filter demo-cli demo -- users list --status active
pnpm --filter demo-cli demo -- users list --json
pnpm --filter demo-cli demo -- users list --help

# MCP over stdio (point an MCP host at this process)
pnpm --filter demo-cli demo -- mcp serve
# or
pnpm --filter demo-cli mcp
```

From this directory:

```bash
pnpm demo -- users list --status active
pnpm mcp
```

## Notes

- Binary name in package.json is `demo`, but it points at `.ts` — `npm link` will not work until there is a built JS entry (or a `tsx` shebang with tsx on PATH).
- Manifest / completions: `pnpm build:manifest`, `pnpm completions` (after core is built and `clfly` is on the path via the workspace).

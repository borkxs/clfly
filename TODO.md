# TODO

## Pre-README-publish gate — dogfood the `clfly` binary

The README claims the `clfly` binary (`build`, `completions`, `mcp`, later `export`, `docs`, `palette`) is itself a clfly command tree. Today `packages/core/src/cli.ts` is a hand-rolled switch. Restructure it onto a `commands/` tree in this repo before the README ships as launch copy. No asterisks.

## `@clfly/create` — self-bootstrapping scaffolder

The scaffolder should itself be a clfly CLI. Dogfood as the first real product binary.

- Replace the `packages/create` stub with a real `commands/` tree on `@clfly/core`.
- Ship as `npm create clfly` / bin `create-clfly` (keep package name `@clfly/create`).
- Commands write a new CLI package: `package.json`, `bin`, `src/index.ts` wiring `createCli`, a starter `commands/` tree (hello + one nested example), and README snippet.
- Optional later: `clfly create …` if we also expose a `clfly` binary; for now `create-clfly` / `npm create clfly` is enough.
- README can then say this CLI was built with clfly — straight face, no asterisk.

## Spec folded in (don't build until go)

See `docs/decisions.md`, `docs/manifest.md`, `docs/ecosystem.md`, `docs/conventions.md`.

- **Optional `output` export** — add to `CommandModule` / types; project to manifest `outputSchema`, MCP, OpenAPI; validate returns in `--json` mode (open: always vs dev-only).
- **HTTP mapping** — RPC `POST /…` only; document now, implement at M4a/M4b.
- **Manifest gaps for palette/docs** — additive fields as needed (`outputSchema`, richer positional info, maybe cli name); never couple ecosystem to core.

## Milestones (later)

- **M4a:** `clfly export openapi` — OpenAPI 3.1 from the tree; acceptance: imports cleanly into Postman and Bruno, renders in Scalar.
- **M4b:** `clfly http serve` — same mapping live; auth required by default; security notes before code.
- **M5:** `@clfly/docs`, `clfly palette` (TUI), `@clfly/palette` (web). Parked: Raycast extension generator from the manifest.

## Non-goals (still)

Plugins, interactive prompts, i18n, config-file merging, telemetry. Plus: GET/query-param HTTP mapping, content negotiation, streaming responses; web palette auth beyond bearer pass-through; hosted anything.

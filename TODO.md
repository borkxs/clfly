# TODO

## Spec folded in (don't build until go)

See `docs/decisions.md`, `docs/manifest.md`, `docs/ecosystem.md`, `docs/conventions.md`, `docs/scaffolder.md`.

- **v0.0.4** — root scoping, agent conventions, MCP harden (outputSchema, collision ADR docs, SDK lazy-import / `@clfly/core/mcp`), real MCP E2E against init/add. See conversation lock-ins.
- **Optional `output` export** — types + projection (validation: always when exported). Part of v0.0.4 / M3 generalized.
- **HTTP mapping** — RPC `POST /…` only; document now, implement at M4a/M4b.
- **Manifest gaps for palette/docs** — additive fields as needed; never couple ecosystem to core.
- **`clfly dev mcp [dir]`** — backlog.

## Milestones (later)

- **M4a:** `clfly export openapi` — OpenAPI 3.1 from the tree; acceptance: imports cleanly into Postman and Bruno, renders in Scalar.
- **M4b:** `clfly http serve` — same mapping live; auth required by default; security notes before code.
- **M5:** `@clfly/docs`, `clfly palette` (TUI), `@clfly/palette` (web). Parked: Raycast extension generator from the manifest.

## Non-goals (still)

Plugins, i18n, config-file merging, telemetry. The framework does not ship interactive prompts; the resolver seam for them is reserved. Plus: GET/query-param HTTP mapping, content negotiation, streaming responses; web palette auth beyond bearer pass-through; hosted anything.

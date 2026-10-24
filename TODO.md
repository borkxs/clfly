# TODO

## Active handoff

**Demo loop on `feat/publish-demo-loop`.** `@clfly/core` minor: dev-mode `tools/list_changed`, trailing `[param].ts` stays a child tool. `@clfly/cli` patch: `skill export`, and `init` writes `bin/<name>.mjs` so `npm link` runs on Node 20. Next: merge and publish so the recording uses the registry, not a `file:` link. Mounts parked ([`docs/spec/mounts.md`](./docs/spec/mounts.md)).

## Spec folded in (don't build until go)

See `docs/decisions.md`, `docs/manifest.md`, `docs/ecosystem.md`, `docs/conventions.md`, `docs/scaffolder.md`, `docs/spec/`.

- **Optional polish** — shared CLI/MCP error-formatting helper if messages drift. Dev-mode `listChanged` ships with the demo release.
- **HTTP mapping** — RPC `POST /…` only; document now, implement at M4a/M4b.
- **Manifest gaps for palette/docs** — additive fields as needed; never couple ecosystem to core.
- **`clfly dev mcp [dir]`** — backlog.

## Milestones (later)

- **M4a:** `clfly export openapi` — OpenAPI 3.1 from the tree; acceptance: imports cleanly into Postman and Bruno, renders in Scalar.
- **M4b:** `clfly http serve` — same mapping live; auth required by default; security notes before code.
- **M5:** `@clfly/docs`, `clfly palette` (TUI), `@clfly/palette` (web). Parked: Raycast extension generator from the manifest.

## Non-goals (still)

Plugins, i18n, config-file merging, telemetry. The framework does not ship interactive prompts; the resolver seam for them is reserved. Plus: GET/query-param HTTP mapping, content negotiation, streaming responses; web palette auth beyond bearer pass-through; hosted anything.

# TODO

## Active handoff

**Loop phases 1–2 landed.** `clfly link` / `unlink` / `ls` and `clfly register` (six harnesses, `--self`, `--tree`, `--dry-run`, `--remove`) are in `@clfly/cli` with golden tests per harness×scope; two changesets wait for `changeset version`. Published baseline remains `@clfly/core@0.3.0` / `@clfly/cli@0.0.7`. Next: phase 3, rewrite `BOOTSTRAP.md` as the two-session runbook and run it once on `examples/demo-cli` — its bin is `./bin/demo.ts`, so registered entries run `node ./bin/demo.ts`, which Node 20 cannot load; give it a `bin/demo.mjs` tsx shim like `init` writes before recording. Groom, export, and the hub ADR are not started. Mounts parked ([`docs/spec/mounts.md`](./docs/spec/mounts.md)).

**Stdin hang (partly fixed).** Core now skips the stdin read when there is no `-` bind and argv already sets every declared field, so an agent shell's never-closed pipe no longer hangs those commands (changeset waiting). Commands with unset optional fields, such as `clfly register` (`name`, `self`, `remove`), still read to EOF under the stdio ADR and still hang in agent shells. This needs an ADR call: per-command opt-out (`meta.stdin: false`), an env opt-out, or reading stdin only on an explicit `-`. Related: borkxs-mono CAPTURES "pm mcp serve EOF".

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

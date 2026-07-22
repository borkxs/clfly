# Ecosystem contract

Ecosystem packages (`@clfly/docs`, `@clfly/palette`, and anything else in that tier) consume **exactly two artifacts**:

1. **The build manifest** — see [manifest.md](./manifest.md)
2. **The exported OpenAPI document** — produced by `clfly export openapi` (M4a)

They **never** import `@clfly/core` internals.

If building an ecosystem package requires data that isn't in those projections, the fix is to **extend the projection** — never to couple to core.

## Why

The manifest and OpenAPI doc are the portable, versioned surfaces. Coupling ecosystem UIs to router/scan/MCP internals would:

- force every palette/docs release to track core internals
- make language-agnostic or out-of-process consumers impossible
- undermine the same “schema as data” bet that CLI / MCP / HTTP already make

Core may still *produce* those artifacts. Ecosystem packages only *read* them.

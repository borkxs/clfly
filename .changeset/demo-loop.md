---
"@clfly/core": minor
"@clfly/cli": patch
---

Refresh the MCP tool list when a dev-mode command tree changes, treat a trailing `[param].ts` file as its own command, and add `clfly skill export`. Scaffolded CLIs get a `bin/<name>.mjs` launcher that registers tsx, so `npm link` runs on Node 20.

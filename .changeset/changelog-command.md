---
"@clfly/cli": minor
---

`clfly changelog [--since 7d] [--json] [--snapshot]`: one dated, newest-first list of capability changes on this machine (skills, linked trees and their command files, repo `CHANGELOG.md` lines, MCP servers, hooks, tick jobs, dash cards), from a snapshot diff kept under `~/.local/state/clfly/`. Ported from borkxs-mono #199. `clfly link`/`unlink` spawn npm/pnpm through the shell and use `where.exe` on Windows, and the registry write retries a rename over a busy file there.

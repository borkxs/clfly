---
"@clfly/cli": minor
---

Add `clfly register --harness <h>` for claude-code, cursor, vscode, codex, gemini, and claude-desktop. It writes or removes one MCP server entry and leaves every other entry alone. `--self` registers clfly itself, `--dry-run` prints the diff, and `--tree` picks a registry name or package directory. When `claude` (or, for user scope, `codex`) is on PATH, an apply goes through that CLI instead of editing the file.

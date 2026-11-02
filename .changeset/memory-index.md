---
"@clfly/cli": patch
---

`clfly memory --out <file>` writes a Claude Code memory file listing every linked tree and its commands, read from each tree's own `mcp serve` tool list. It rewrites the file only when the content changes, so a scheduler can run it often.

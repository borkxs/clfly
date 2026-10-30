---
"@clfly/cli": patch
---

`clfly add --dir <tree>` writes stubs into that tree's package instead of cwd. MCP callers need it: the `clfly` server's cwd is wherever the harness launched it, not the caller's worktree.

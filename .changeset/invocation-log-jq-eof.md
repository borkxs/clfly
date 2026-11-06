---
"@clfly/core": minor
---

Ported from borkxs-mono: every CLI run and MCP tool call appends one line (tree, command path, via, ms, output bytes, exit code; never argument values) to `~/.local/state/clfly/invocations.jsonl` (`CLFLY_USAGE_LOG=off` disables, any other value is the path). `result_query` runs a jq program over a spooled result (large output spools to a new ref; `CLFLY_JQ` overrides the binary). `mcp serve` answers every request already received and exits when stdin ends. `Cli.runUnlogged(argv, stdout)` runs without the log.

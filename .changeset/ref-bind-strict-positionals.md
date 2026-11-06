---
"@clfly/core": minor
---

Ported from borkxs-mono (PRs 160, 162, 166, 196):

- **Strict positionals:** words left over after every positional is filled exit 2 ("Unexpected argument …") instead of filling a flag.
- **`@<sessionId>/<seq>` binds a spooled result** in place of any argument value, on the CLI and over MCP, before validation. Every projected MCP tool takes the reserved `spool: true` to return a ref even for a small result. See `docs/spec/session-store.md`.
- **`ReportedExit`** (exported): a command whose output already said why throws it instead of calling `process.exit`. The CLI prints nothing and returns its code (`--json` still writes `{error:{message}}` for a failure); over MCP a failure is a tool error and exit 0 (a cancel) a plain result. A `ClflyError` with an empty message now prints `Failed (exit N).` instead of a blank line.

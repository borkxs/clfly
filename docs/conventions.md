# Runtime conventions

## Exit codes

sysexits-ish convention for the process wrapper and any spawned CLI:

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Runtime error (handler throw, I/O failure, unexpected failure) |
| `2` | Usage / validation error (bad argv, schema validation failure, unknown command used as usage) |

Reserved for future (do not reuse casually):

| Code | Intended meaning |
|---|---|
| *(TBD)* | Build / manifest mismatch (e.g. `formatVersion` incompatible) — pick a dedicated code when wiring loud mismatch exits in the bin |

Commands return values or throw; the bin wrapper owns `process.exit`. In `--json` mode, success values go to stdout and errors become `{ "error": … }` on stderr with the same exit-code rules.

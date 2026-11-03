---
"@clfly/core": minor
"@clfly/cli": minor
---

Add `completeFrom`: an arg can declare that its choices come from another command's `--json` output (`{ cmd, field, args?, label?, sub? }`), via Zod `.meta({ completeFrom })` or a module `complete` export. It projects onto `FlagInfo` / `PositionalInfo` in the manifest (additive in formatVersion 1). `@clfly/core/complete` exports `completeFromArgv` and `selectCompletions` for consumers. `buildManifest` now builds in memory when `outFile` is omitted, and `clfly manifest [tree]` prints linked trees' routes as JSON for launchers and UIs.

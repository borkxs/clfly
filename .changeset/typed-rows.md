---
"@clfly/core": minor
"@clfly/cli": patch
---

Typed rows, ported from borkxs-mono (PR 218). A producer route declares `meta.rows: { type, key, ref, when?, defaults?, label?, sub? }` (validated at build, carried into the manifest); a consumer arg declares `accepts` (a module `accepts` export keyed by arg, `"pm.item"` or `{ type, where? }`, or an `accepts`/`where` JSON Schema keyword via `.meta()`), projected onto flags and positionals as `accepts` + `where`. New `@clfly/core/rows` subpath (also re-exported from the root): `acceptorsFor(trees, producer, row, args?)`, `producersFor`, `rowChoices`, `rowsOf`, `rowRef`, `rowMatches`, `readRows`, `readAccepts`. `completeFrom` is unchanged. `clfly manifest` carries rows/accepts. The Raycast extension's result-row chains now include every accepting route in any linked tree, with the ref templated from the producer's run args; a route both rows and `completeFrom` reach is offered once.

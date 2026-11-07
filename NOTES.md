# NOTES

- raycast line editor (#12, branch feat/raycast-tree-commands): one-command line editor + docs/launcher-cases.md pushed 2026-11-06 → Erik checks pm search / dash open film / run transcribe-batch in Raycast, then merge; next build is the HTML prototype (~/git/_handoffs/clfly-line-prototype.md)
- typed rows (step B, ported from borkxs-mono PR 218): core `meta.rows` / `accepts` + `@clfly/core/rows`; raycast `chainsFor(tree, from, shaped, { trees, args })` offers acceptors across trees (ledger ~/git/_handoffs/typed-rows-loop.md) → step C: Pocket result-row selection + actions view after PRs 17/18; nothing calls `rowChoices` yet (forms still fetch via completeFrom)

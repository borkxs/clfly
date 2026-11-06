# NOTES

- raycast launcher: #12 merged 2026-11-06 (quick mode, one ↵, open closes Raycast). Branch feat/root-defaults holds 65a48fc (Recent keeps live searches), pushed, no PR yet (auto-mode blocked create+merge) → open PR + merge; next: tree root commands as defaults once Erik OKs the table (~/git/_handoffs/clfly-line-prototype.md)
- typed rows (step B, ported from borkxs-mono PR 218): core `meta.rows` / `accepts` + `@clfly/core/rows`; raycast `chainsFor(tree, from, shaped, { trees, args })` offers acceptors across trees (ledger ~/git/_handoffs/typed-rows-loop.md) → step C: Pocket result-row selection + actions view after PRs 17/18; nothing calls `rowChoices` yet (forms still fetch via completeFrom)

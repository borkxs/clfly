# Launcher cases

What the clfly launcher (the line editor in Raycast, the HTML prototype, later the phone page) must do.
Cases marked **[test]** are encoded in `packages/raycast/test/fixtures/line-cases.json` and run against
`src/lib/line.ts`. The rest are interaction cases to try by hand in each face. Add a case here before changing behaviour.

Keys: ↵ takes the highlighted row (a word, a choice, or Run); ⌘↵ runs the line as typed.

## Getting to a command
1. **[test] empty**: the empty line lists trees. *Later:* recent lines first (Raycast: done), then favourites.
2. **[test] tree-prefix**: `p` offers pm, plex, not dash.
3. **[test] tree-space**: `pm ` lists pm's commands with their one-line descriptions.
4. **[test] segment-prefix**: `pm st` ↵ gives `pm status `.
5. **[test] run-jobs-beside-segments**: `run ` mixes fixed words (ls, queue) with job ids from `run ls`.
6. **[test] unknown-tree**: `foo ` says there is no such tree.
7. Typing `pm` in Raycast root search and pressing ↵ opens the editor with `pm ` already typed (per-tree commands).
8. Root-search fallback: `pm search dune` typed in Raycast root, then the `clfly` fallback row, opens the editor with that line.

## Running
9. **[test] runs-bare**: `pm status ` puts Run first; ↵ runs it.
10. **[test] flag-names / flag-set**: `pm status --` lists flags; `pm status --all ` runs with `--all`.
11. **[test] run-job-needs-on / run-job**: `run transcribe-batch ` shows "needs --on" and offers `--on` first; with `--on laptop` it runs.
12. **[test] destructive-ready**: `pm rm abc123 ` runs only after a confirmation.
13. **[test] interactive**: `pm setup plex ` doesn't run here; copy it for a terminal.
14. **[test] quoted-path**: `pm upload "in/cone off.flac" --to Mashups` keeps the quoted file as one argument.
15. A run that takes minutes (`pm add --watch`, `plex scan --wait`) keeps going after the window closes and notifies when done. *Not built.*

## Choosing values
16. **[test] dash-open-choices / -prefix / -ready**: `dash open ` lists dashboards from `dash ls` with their status; `fi` ↵ gives `dash open film `; ↵ runs.
17. **[test] choices-from-status**: `pm rm ` lists transfers from `pm status`, labelled by name.
18. **[test] tick-run-prefix**: `tick run he` picks health-check.
19. **[test] enum-values / enum-prefix**: `pm search dune --res ` offers 720p/1080p/2160p; `10` ↵ gives 1080p.
20. **[test] chain-only-source**: `pm add ` needs a magnet, which comes from pm search results, not a fetch; the editor says so instead of spinning.

## Search and chains
21. **[test] live-search**: `pm search dune 2021` shows live hits under the line (300 ms debounce, 3+ chars, one search in flight, ≥1 s apart).
22. **[test] words-not-a-command**: `pm the brave one 2007` offers `pm search the brave one 2007` as the first row instead of guessing.
23. ↵ on a hit rewrites the line to `pm add <magnet> `; then `--w` ↵, ↵ runs it. The ideal is a few keys from title to download.
24. "pm the brave one 2007" as one intent: search, take the top 1080p hit with the most seeders, `pm add --watch`, report when done. Is this a saved line, `pm get`, or a chain default? *Open.*
25. After `pm add --watch` finishes, offer `plex scan`. *Not built.*

## Saved and repeated
26. Saved lines with blanks: `pm search ‹q› --res 1080p` asks only for q. *Not built.*
27. Most-used lines float up (frecency), per device. *Not built.*

## Phone (Pocket)
28. The same line and rows with taps; big tap targets; the keyboard stays up while picking words.
29. Runs go to the Mac over Tailscale; destructive ones confirm on the phone; every run is logged.

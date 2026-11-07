# @clfly/pocket

The clfly line editor as a web page, served by a small local engine. One line with completion,
recent lines by frecency, search-as-you-type, and results whose rows chain into the next command.
Free of Raycast's limits (⇥ and ghost text work), and the same page is meant for the phone and a
Mac hotkey panel later (`~/git/_handoffs/idea-launcher-ideal.md`).

## Run

```sh
pnpm --filter @clfly/core build      # once; the page bundles core's complete helpers
pnpm --filter @clfly/pocket start    # builds public/app.js, serves http://127.0.0.1:4180
```

`clfly` on PATH must have the `manifest` command. `POCKET_PORT`, `POCKET_HOST` (default
`127.0.0.1`; set `0.0.0.0` only behind Tailscale) and `CLFLY_BIN` override the defaults.
`pnpm --filter @clfly/pocket watch` rebuilds on edit; the server reads files on each request.

## What it does

- **Line**: type `pm oceans eight`, `dash open film`, `run ls`. The rows under the line are what
  the next word can be: trees, commands, flags, enum values, choices fetched from `completeFrom`
  sources (`dash open ` lists dashboards from `dash ls`). The highlighted row's remainder shows
  as grey ghost text after the caret.
- **Keys**: ⇥ takes the highlighted word; ↵ takes it, or runs when the line is complete and has
  nothing left to pick; ⌘↵ runs the line as typed; ↑↓ move; esc clears (or closes the result);
  ⌘⇧C copies the line as a terminal command; `/` focuses the line.
- **Quick mode**: while the first word is not a tree, the rows are whole commands matched fuzzily
  (`doc` → `dash open chartbook`). The pick for a query is remembered.
- **Search**: a read-only command with a `query` positional (`pm search dune`), or a tree name
  followed by words that aren't a command (`pm the brave one 2007`), searches as you type with
  the pacing in `live.ts` (300 ms debounce, 3+ chars, one in flight, 1 s apart). Hits come
  first; ↵ on a hit rewrites the line to the chained command (`pm add <hash> `).
- **Runs**: ↵ on a complete line POSTs the argv to the engine, which runs the tree's bin
  directly (no shell) and keeps going if the page closes. Destructive commands ask once, inline.
  The result shows as rows with chain buttons, or as text. Recent runs sit at the bottom; click
  one to see its output.
- **History**: the empty line lists lines that ran, newest first, merged from the engine's run log
  (`GET /api/history`), so the panel, browser and phone share it. Typing ranks lines by frecency.
  One-off lines carrying a hash or id stay out; × forgets a line in this browser.
- **Trees on demand**: the empty line hides the tree list; ⇥, or ↓ past the last row, opens it.
- **Typed arguments browse**: an argument that `accepts` a row type and has no `completeFrom`
  lists rows from a read-only producer of that type. When the producer takes that type itself
  (`pm ls <folder>`), its containers come first with a trailing `/`: ↵ walks in and lists that
  folder, so `pm download ` browses the Premiumize cloud and ↵ on a file downloads it. Result
  rows chain into acceptors in any tree (`pm ls` folder → `pm ls`/`pm du`, file → `pm download`).
- **Trees stay current**: the page fetches the manifest again each time the panel opens, when the
  tab comes back, and every 5 minutes, so a merged tree change shows up without restarting.
  Fetched choice lists refetch after 60 s (the old list shows meanwhile).
- **JSON results** render coloured; the copy icon in the result header copies the run's JSON.
- **Panel mode** (`?panel=1`, used by `packages/panel`): pinned line, no legend, esc on an empty
  line hides the panel.

## Engine (`server.mjs`)

| Route | Does |
|---|---|
| `GET /api/manifest` | `clfly manifest --json`, cached 15 s (`?refresh` forces) |
| `POST /api/exec {tree, argv}` | runs and waits; read-only commands only (choice sources, live search) |
| `POST /api/run {tree, argv, line, confirmed?}` | starts a run; destructive commands need `confirmed: true` |
| `GET /api/history` | every logged line with count and last time, newest first |
| `GET /api/runs`, `GET /api/runs/:id` | recent runs (summary), one run with its output |

Each finished run appends a line to `~/.local/state/clfly/pocket-runs.jsonl`.
The tree and its route are checked against the manifest; a bin path never comes from the client.

## Design

Hierarchy, as a comment at the top of `src/app.ts`: P1 is the line, P2 the rows and the one
highlighted row, P3 subtitles, section labels, hint, legend and runs. The accent colour appears
only on the highlighted row's marker, the caret, and a running job's dot.

```
Tokens file:        public/index.html (:root), light and dark
Type scale:         12 / 14 / 16 / 20 / 24  (--fs-*)
Spacing scale:      4 / 8 / 12 / 16 / 24 / 32  (--sp-*)
Text colors:        primary=--fg secondary=--fg-2 muted=--fg-3 (≥4.5:1 on --bg in both themes)
Brand primary:      --accent — highlighted row marker, caret, running dot only
Elevation scale:    none; grouping by spacing, one faint rule above the result
Primitives:         li rows (44px min), button.chain-btn (pill), button.x, kbd
```

## Cases

`docs/launcher-cases.md` is the spec; the engine it shares with the Raycast face is
`packages/raycast/src/lib/line.ts` and its tests. Built here: 1–6, 9–14, 16–23, 27, 30 (hits
first). Not yet: 15 (notify when a long run ends), 24/31 (add then scan), 26 (saved lines with
blanks), 28–29 (phone over Tailscale), 32–37.

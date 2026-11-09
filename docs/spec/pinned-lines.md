# Pinned lines (proposal)

Status: proposal, not scheduled. Nothing here is built.

## Problem

Erik wants several views up at once: test output, usage gauges and pace charts (today a Grafana
dashboard on :3000), run logs. They come from different tools and render differently (terminal
text vs web charts). A tiling window manager plus a terminal multiplexer already puts them side by
side, so tiling alone isn't a reason to build. The reason to build is that the panels could act:
a row in one becomes the next command, the same way superbar results chain today.

## Idea

A panel is a superbar line that stays on screen.

1. In ⌥Space, run a line (`usage cost --since 7d`, `run ls`, `vitest run`).
2. Pin it. The line, plus a refresh rule, goes into a pinned-lines file.
3. A board page served by the Pocket engine (`/board`) shows each pin as a tile with its latest
   run, refreshed by the engine.
4. Clicking a row in a tile puts its chained command into the superbar line (or runs it, with the
   usual destructive-command confirm).

## Tile rendering by result type, not by tool

| Result | Tile |
|---|---|
| typed rows (`meta.rows`) | table; rows chain as in the superbar |
| time series rows (new row type: `{t, series, value}`) | line or bar chart |
| a single number or percentage | stat or gauge |
| text | scrolling log, tail end visible |
| URL (opt-in tile type) | iframe, e.g. a Grafana panel in kiosk mode |

With a time-series row type, the `usage` tree can feed the gauges and pace charts directly and
Grafana becomes optional.

## Engine changes

- `pins.json` in `~/.local/state/clfly/`: `{id, tree, argv, line, refresh}`, where `refresh` is
  `{every: "5m"}`, `{watch: [globs]}` or `manual`.
- Pin routes: `GET/POST/DELETE /api/pins`; the engine schedules reruns and keeps the latest run
  per pin.
- **Streaming is the main cost.** Runs are buffered today (`execFile` with a callback in
  `server.mjs`), so output only exists once a run ends. Rerun-to-completion tiles work as is. A
  live log tile (a watch-mode test runner, a long job) needs spawn plus an SSE route
  (`GET /api/runs/:id/stream`). Phase 2.
- Only read-only commands can refresh on a schedule; destructive ones can be pinned but run only
  by hand.

## Out of scope

- A terminal emulator or PTY hosting. A watch-mode tool becomes a rerun on file change with a
  machine-readable reporter (`vitest run --reporter=json`), or a streamed text tile.
- Window management. The board is one page with a CSS grid. If it has to sit beside a real
  terminal, that's the window manager's job (AeroSpace).

## Phases

1. Pins file and routes, interval refresh, board page with table, text and stat tiles, and a "pin"
   action in the superbar result header.
2. Row clicks on the board drive the superbar line.
3. Time-series row type and chart tile; port the usage dashboard's gauges and pace lines.
4. Streaming runs (spawn plus SSE) for live log tiles, and file-watch refresh.

## Open questions

- Does the board live in the panel app (a second `NSPanel` or window) or in a browser tab? The
  browser tab is cheaper and works on the phone over Tailscale.
- Where does the time-series row type live: clfly `contracts`, or the `usage` tree?
- Is a pin per machine, or shared through the run log like history?

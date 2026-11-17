# Typed rows: one command's output as another's input

**Accepted 2026-11-07 (Erik), not built.** Supersedes hand-written `completeFrom` pairings as the way results chain.

## Problem
Chains today are declared on the consumer: `pm add`'s magnet has `completeFrom: {cmd: "pm search", field: "hits[].magnet"}`.
Every pairing is written by hand, stays inside one tree, and can only copy a field. `pm ls` rows
(`id, name, type, size, link`) feed nothing: `pm ls|download|du <path>` need `<listed path>/<name>`, which no field holds.

## Model
- **Producer** route meta declares what its rows are and how to make a reference from one:
  `rows: { type: "pm.item", key: "[]", ref: "{path}/{name}", when?: { type: "folder" } }`.
  `ref` is a template over the row's fields plus the producer's own args (`{path}` = the `path` it was run with, default `/`).
- **Consumer** positional or flag declares what it accepts: `accepts: "pm.item"` (optionally `where: { type: "folder" }`).
- A result row offers every route, in any linked tree, whose arg accepts the row's type: one row type, many actions, no edits to
  the producer when a consumer is added (BYOAI: a new tree joins by declaring `accepts`).
- `completeFrom` stays for fetching choices into a form; a producer with `rows` doubles as a choice source for its acceptors.
- Types are namespaced by tree (`pm.item`, `pm.transfer`, `pm.hit`, `dash.project`, `run.job`); a shared type (`fs.path`)
  lets `pm download` output feed `plex scan --path` later.

## First pass
| Producer | rows type | ref | Acceptors |
|---|---|---|---|
| `pm ls [path]` | `pm.item` | `{path}/{name}` | `pm ls <path>` (folders), `pm download <path>`, `pm du <path>` |
| `pm status` | `pm.transfer` | `{id}` | `pm rm <transfer-id>`, `pm links <transfer-id>` |
| `pm search <query>` | `pm.hit` | `{magnet}` | `pm add <magnet>` |
| `dash ls` | `dash.project` | `{id}` | `dash open`, `dash up`, `dash down`, `dash rm` |

## Keys (Pocket / panel)
↓ from the line moves into the result's rows; ↵ on a row replaces the list with that row's actions (route + one-line
description); ↵ on an action rewrites the line (`pm ls "/Heat.1995…"`) and runs it when nothing else is required;
esc goes back to the rows, then to the line. One action only: ↵ on the row takes it.

## Agents (MCP)
An agent reaches rows through the spool, not the panel (borkxs-mono PR 353):
- **Envelope.** A command with `meta.rows` always spools over MCP, since the ref is what `#n` binds. The envelope gains
  `rows: {type, key, count}` and `acceptors: [{tree, route, arg, where?}]`, one entry per accepting arg (not per row),
  from this tree's routes plus every linked tree (`clfly manifest --json`, spawned lazily, cached 60 s, best-effort;
  `CLFLY_ROWS_LINKED=0` skips it). Under the spool threshold `truncated` is `false` and `preview` is the whole value, so
  the agent sees every row and its index. On the CLI, `cmd --json --spool` prints the envelope (without acceptors).
- **`#n` binding.** `@<sessionId>/<seq>#<n>` (CLI and MCP) binds row n's `ref`, templated from the row, then the
  producer's args (recorded in the spool manifest), then `defaults`, the same as the panel's `rowRef`. Plain `@<ref>`
  still binds the whole result.
- **Checks.** When the target arg declares `accepts`, the row's type and the arg's `where` are checked; a mismatch is a
  usage error (a tool error over MCP) naming both types. Out-of-range n, a row failing `rows.when`, or a ref with no
  typed rows errors too. An arg without `accepts` takes the string unchecked.

## Where it lands
- clfly core: `rows`/`accepts` in `types.ts` + manifest output; `chainsFor` in `packages/raycast/src/lib/model.ts` matches on them.
- borkxs-mono: `rows`/`accepts` on the pm, dash, run trees (next to their `completeFrom` comments).
- Pocket `src/app.ts`: result-row selection and the actions view.

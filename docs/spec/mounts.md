# ADR stub: mounts / pack composition

Status: **Decision pending** — stub only; **do not implement**.
Motive (settled enough to write down): product scalpel, not architectural hygiene.

Depends on: interchange (stdin merge/bind → 0.2.0), a second dogfood CLI
(forkspace — different rough edges than `pm`), then a commercial extraction
(librarian / Premiumize→Plex bridge) as the mounts dogfood.

---

## Problem the census actually surfaces

An undifferentiated monolith is the debt — not "one tree." Most of `pm` never
needs extracting: indexer providers stay private-forever, failover is fine as
application code, and a flat config bag is only debt once **two packages fight
over it**.

The forcing function is the row already labeled "second product":
`src/librarian/*` — the Premiumize→Plex bridge. Today the publishable product
and the private-forever product share one tree, one config, one MCP surface.
Mount composition is the seam that separates them without a rewrite:

| Package / CLI | Role |
|---|---|
| `@you/premiumize` | Adapter pack (API ops as schema+call) |
| `@you/plex` | Adapter pack (scoped config) |
| `bridge` (name TBD) | Publishable CLI — own `commands/` importing the adapters |
| `pm` | Private CLI — mounts the same packs **plus** unpublishable search |

Same adapter code, two products, one seam: `createCli({ mounts })`.

## Why not yet

Mounts earn existence when a pack has a **second consumer** or ships
independently. Until the bridge is the product under construction, extracting
`@you/premiumize` for aesthetics invents composition before the seam has a job.

## Hard problems (content of the eventual Accepted ADR)

These are **core** design questions, not `pm` chores:

1. **Config namespacing per mount** — when two packs share a process, who owns
   `config.plex` vs a flat bag? Collision rules, env prefixing, `--root` + store.
2. **MCP tool naming across mounts** — `plex_scan` vs today's flat
   `librarian_evict`. Prefix / namespace / hard-fail collisions (same spirit as
   today's unique tool-name rule).

Secondary: how mounts appear in help, completions, and the build manifest.

## Encouraging half-done work (in `pm`, not core)

- `src/premiumize.ts` — function-per-operation with apikey threaded — is already
  the "ten-line schema+call adapter" shape; unlabeled.
- Plex is nearly as clean (class + `config.plex`).
- TMDB is buried but small.
- Librarian coordinator already imports adapter-ish modules — desired model
  matches current wiring; refactor is mostly relabeling once mounts exist.

## Cheap prep (pays regardless of when mounts land)

Keep adapter modules **pure** below `src/commands/`:

- no `process.exit`
- no `@clack`
- no `console.log`

Data-in / data-out only. Throw-never-exit + render-seam conversions enforce
most of this incidentally.

## Session store interaction

Shared `.clfly/` (one convention across all clfly CLIs) means a future `bridge`
and `pm` in the same repo write one ledger. The two-products split does **not**
fragment the agent-facing story — that was the argument for shared-over-per-tool
dot folders; this is the first concrete payoff case. See
[session-store.md](./session-store.md).

## Sequencing (do not reorder casually)

1. **stdin merge/bind** → complete interchange → unlock **0.2.0**
2. **forkspace** as second migration case study (different rough edges than `pm`)
3. **librarian / bridge extraction** as mounts dogfood (commercial motive)
4. Only then: Accepted mounts ADR + `createCli({ mounts })`

## Non-goals for this stub

- No `mounts` API, no pack layout, no MCP prefix implementation.
- Do not extract `@you/premiumize` solely because the census table exists.
- Fan-out (one invocation per NDJSON line) stays parked with composition.

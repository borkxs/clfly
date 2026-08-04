# ADR: Session store & reference-based results

Status: **Accepted** — design settled; implementation in `@clfly/core`.
Companion: [stdio.md](./stdio.md) (bind dual-use), [output.md](./output.md) (validation before spool).
MCP grounding: [2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (SEP-2567: protocol sessions removed; servers that need cross-call state mint **explicit handles** as ordinary tool arguments / result fields).

Parked companions (stubs only): [elicitation-mrtr.md](./elicitation-mrtr.md), [tasks.md](./tasks.md).

---

## Why

Large validated `--json` / MCP tool results blow agent context. Agents need a **stable handle** to page, bind, or re-consume later — without relying on MCP transport sessions (removed in 2026-07-28) or sticky routing.

clfly answers with a **repo-local session store**: one shared `.clfly/` convention for every clfly-built CLI, explicit session handles, and dual-use spool files that are valid stdin bind inputs.

---

## Layout (shared across all clfly CLIs)

```
.clfly/
  sessions/
    <session-id>/
      manifest.jsonl
      001-<command>.json
      002-<command>.json
      …
```

- **One convention, not per-tool.** Every CLI (`pm`, `clfly`, demo, …) uses `.clfly/` under the active root/cwd.
- **Files** mode `0600`, session dirs `0700`.
- **`manifest.jsonl`** — one JSON object per line:

```json
{ "seq": 1, "command": "status", "argv": ["status", "--json"], "ts": "2026-08-02T12:00:00.000Z", "bytes": 128000, "exit": 0, "schemaRef": "output" }
```

- Spool files are named `NNN-<command>.json` where `NNN` is the zero-padded `seq` (3+ digits) and `<command>` is a filesystem-safe slug of the command path / tool name.
- **File body = true `--json` document** (manifest truth from [output.md](./output.md)): unwrapped array/object as the command returned it. **Not** the MCP `{ result: … }` wrap. **Not** the truncation envelope. This makes every spool a valid `-` bind input ([stdio.md](./stdio.md)).

---

## Session identity (explicit handles, not transport sessions)

2026-07-28 removes protocol-level sessions (`Mcp-Session-Id`, initialize handshake). Cross-call state must use **server-minted handles**.

| Surface | How the session id is obtained |
|---|---|
| `mcp serve` | Mint once at serve start (or reuse `CLFLY_SESSION` if set and valid). Include `sessionId` in every **truncated** result envelope. Clients pass the handle back only via `ref` / `result_read` args — never as a transport header. |
| Shell / CLI | `CLFLY_SESSION=<id>` if set and valid; else mint a new id on first `--spool` / auto-spool write. Documented fallback: mint. |

Handles are opaque, filesystem-safe strings: lowercase hex, 16 chars (`crypto.randomBytes(8)`). Reject anything outside `[a-z0-9_-]{1,64}`.

---

## When to spool

| Transport | Trigger |
|---|---|
| MCP tool result | After successful `output` validation (or untyped return), if serialized byte length **> threshold** → write spool + return envelope. Under threshold → current behavior unchanged. |
| CLI | Opt-in `--spool`. Always writes the full document + manifest line. With `--json`: over threshold → print envelope to stdout; under → print full document (and still write the file). Without `--json`: print the absolute spool **file path** (one line) for redirect/bind. Default `--json` without `--spool` is unchanged. |

**No streaming. No cross-session refs. No remote/shared stores.**

---

## Threshold (open question → decision)

**Unit: UTF-8 byte length of `JSON.stringify(value)` (compact).**

| Candidate | Rejected because |
|---|---|
| Estimated tokens | Model-dependent; not measurable without a tokenizer; drifts across clients. |
| Item count | Useless for object roots and nested payloads; a 3-item array of huge objects still blows context. |
| **Bytes** | Deterministic, OS-aligned, matches “payload too large for this hop.” |

**Default: `65536` (64 KiB).** Typical agent tool results stay under this; list endpoints that return hundreds of rows will spool. Configurable via `CLFLY_SPOOL_THRESHOLD` (decimal integer bytes) and `CreateMcpOptions.spoolThreshold` / future CLI flag if needed.

---

## Truncation envelope

Returned instead of the full document when spooling on the machine-facing path (MCP always when over threshold; CLI `--json --spool` when over threshold):

```json
{
  "truncated": true,
  "ref": "a1b2c3d4e5f60718/001",
  "sessionId": "a1b2c3d4e5f60718",
  "seq": 1,
  "totalCount": 240,
  "preview": [ { "…": "first N items" } ],
  "schemaPointer": "output",
  "bytes": 128000,
  "path": "/abs/…/.clfly/sessions/a1b2c3d4e5f60718/001-status.json"
}
```

| Field | Rule |
|---|---|
| `truncated` | Always `true` on this shape. |
| `ref` | See ref format below. |
| `totalCount` | Array roots only — `value.length`. Omitted for non-arrays. |
| `preview` | **Array roots:** first `PREVIEW_ITEMS` (default **5**) elements. **Object roots:** a shallow copy of the first `PREVIEW_KEYS` (default **20**) own enumerable keys; string values longer than 200 chars are truncated with `…`; nested objects/arrays become `{ "_truncated": true, "type": "object"|"array", "keys"|"length": N }`. **Primitives:** the value itself. |
| `schemaPointer` | `"output"` when the command exported `output`; otherwise omitted. |
| `path` | Absolute filesystem path of the spool file (agents with FS access can bind directly). |

MCP: envelope is a plain object → eligible for `structuredContent` as-is. Clients **MUST NOT** treat a `truncated: true` payload as satisfying the tool's normal `outputSchema`. Text content carries the same JSON.

---

## Ref format (open question → decision)

**Format:** `<sessionId>/<seqPadded>` e.g. `a1b2c3d4e5f60718/001`.

| Option | Trade-off |
|---|---|
| Opaque id only (`r_9f3…`) | Safest against path intuition; opaque to agents debugging pipelines. |
| Raw relative path | Agent-legible but invites `../` traversal if ever joined naïvely. |
| **`<sid>/<seq>` handle** | Legible (session + ordinal) **and** safe: resolve **only** via manifest lookup inside the store API. Never `path.join(root, ref)` from client input. |

Resolution algorithm:

1. Parse `^([a-z0-9_-]{1,64})/(\d{1,10})$`.
2. Open `.clfly/sessions/<sid>/manifest.jsonl`; find line with matching `seq`.
3. Derive filename from that line (`NNN-<command>.json`); confirm the file is inside the session dir via `resolveUnderRoot`.
4. Reject anything else (unknown seq, missing file, bad charset, path separators beyond the single `/`).

---

## CLI ↔ MCP ledger (open question → decision)

**Unify.** `--spool` and MCP auto-spool write to the same `.clfly/sessions/<id>/` tree and append the same `manifest.jsonl`. One `CLFLY_SESSION` (or serve-minted id) spans both. Agents that mix shell pipes and MCP tools share refs.

---

## Fallback MCP tools (no filesystem access)

Registered on every `mcp serve` alongside projected commands:

### `result_read`

```
{ ref: string, offset?: number, limit?: number }
```

- Resolves `ref` through the store.
- **Array roots:** return `{ items, offset, limit, totalCount, ref }` slicing `[offset, offset+limit)` (defaults: `offset=0`, `limit=50`, max `limit=500`).
- **Non-array roots:** ignore offset/limit; return `{ value, ref }` (full document — caller should have used a tighter producer if this is huge).

### `result_query` — **stub (v1)**

```
{ ref: string, selector: string }
```

Returns a tool error: not implemented.

**Selector language (deferred):** Prefer a **JSONPath** subset later (RFC 9535) — structured, no shell, maps cleanly to “pick fields from a bound document.” A jq subset is more familiar to CLI users but needs an interpreter sandbox and invites Turing-complete footguns. Revisit when a second consumer needs field projection without a local `jq` binary; until then agents with FS access run `jq` against `path`, and FS-less agents page with `result_read`.

---

## Containment

- Session store root = `<root>/.clfly/sessions` when `mcp serve --root` is set; otherwise `<cwd>/.clfly/sessions`.
- The store directory **must** live inside `--root` when scoped. Refs outside it are rejected.
- Refs are handles, never raw client paths.

---

## Retention

| Knob | Default | Env |
|---|---|---|
| TTL | 7 days (from session dir mtime / newest manifest `ts`) | `CLFLY_SESSION_TTL_MS` |
| Max bytes | 256 MiB across all sessions under the store root | `CLFLY_SESSION_MAX_BYTES` |

Eviction runs **opportunistically** on `mcp serve` start and on `sessions clean`. Policy: delete whole session dirs oldest-first until under max-bytes and past-TTL sessions are gone.

---

## Built-in: `sessions`

Framework-owned (like `mcp`), reserved top-level name:

| Invocations | Behavior |
|---|---|
| `sessions` / `sessions list` | List sessions (id, bytes, entries, mtime). `--json` → array. |
| `sessions clean` | Run eviction now; print what was removed. |

Shown in root help alongside `mcp`.

---

## Scaffolder

`clfly init` (and `add` when a `.gitignore` exists or is created) appends `.clfly/` to `.gitignore` **idempotently** — same pattern premiumize/pm used by hand for `.claude/`.

---

## Non-goals

- Streaming / progressive results
- Cross-session or remote stores
- Implementing elicitation or Tasks (see stubs)
- Changing default `--json` stdout behavior without `--spool`

---

## Resolved open questions (summary)

1. **Threshold unit → bytes** (default 64 KiB). Tokens and item counts rejected above.
2. **Object preview →** first 20 keys, shallow; long strings / nested containers truncated with markers; no fake `totalCount`.
3. **`--spool` → unified ledger** with MCP under `.clfly/sessions/`.
4. **Ref → `<sessionId>/<seqPadded>`**, manifest-resolved only.

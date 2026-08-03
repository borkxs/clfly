# ADR stub: Tasks (SEP-2663) for long-running commands

Status: **Decision pending** — stub only; **do not implement**.

Depends on: [session-store.md](./session-store.md) (local handles / retention
patterns). Spec home: MCP extension `io.modelcontextprotocol/tasks`
([SEP-2663](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2663);
moved out of core in 2026-07-28).

---

## Problem

Some commands run longer than a single RPC budget (`--watch`, librarian
daemon work, large downloads). Blocking `tools/call` until completion is a poor
fit for agents and for horizontally scaled serve.

SEP-2663 redesigns tasks as an **official extension**: poll via `tasks/get`,
client-to-server input via `tasks/update`, unsolicited task handles allowed
without per-request opt-in. Blocking `tasks/result` is gone.

---

## Direction (unsettled)

- Detect long-runners via meta (`meta.longRunning` / duration hints) or
  explicit `meta.task: true`.
- Return a task handle from `tools/call`; poll for status / result.
- Persist task state under `.clfly/` (likely beside sessions) with the same
  containment / TTL / 0600 rules — **not** protocol sessions.
- CLI keeps foreground semantics unless the user opts into a detach flag.

## Open before accepting

1. Extension negotiation: advertise `io.modelcontextprotocol/tasks` only when
   the SDK + client support it; fallback?
2. How does a task result interact with the session-store spool envelope?
3. Cancellation / `tasks/update` mapping onto AbortSignal in command bodies.

## Non-goals for this stub

- No task runtime, no polling endpoints, no meta flag until Accepted.

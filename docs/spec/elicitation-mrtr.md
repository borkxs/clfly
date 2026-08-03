# ADR stub: elicitation via MRTR for `meta.interactive`

Status: **Decision pending** — stub only; **do not implement**.

Depends on: [session-store.md](./session-store.md) (explicit handles), MCP
[2026-07-28 MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)
(SEP-2322). Supersedes any plan that used server-initiated `elicitation/create`
over a held-open bidirectional stream (removed / redesigned in 2026-07-28).

---

## Problem

Today `meta.interactive: true` **excludes** a command from MCP / OpenAPI
([decisions.md](../decisions.md)). Bodies that prompt on a TTY are CLI-only.
Agents cannot run those flows at all.

MRTR lets a tool return `resultType: "input_required"` with `inputRequests` +
opaque `requestState`; the client retries with `inputResponses`. That is the
stateless replacement for mid-call elicitation.

---

## Direction (unsettled)

- Project `meta.interactive` commands as MCP tools that may return
  `input_required` instead of excluding them.
- Map prompt steps onto MRTR `inputRequests` (form / URL elicitation shapes).
- Encode progress in `requestState` (and/or a session-store handle) so any
  serve instance can continue the retry — no protocol session affinity.
- Keep CLI TTY behavior unchanged; MRTR is the MCP projection of the same
  interactive intent.

## Open before accepting

1. Does every `meta.interactive` command auto-project, or opt in via a new
   meta flag (`meta.elicit`)?
2. Who owns the prompt schema — command module vs `@clfly/prompts` resolver?
3. How do we test without a full MCP client MRTR loop?

## Non-goals for this stub

- No code, no fixtures, no SDK MRTR wiring until this ADR is Accepted.

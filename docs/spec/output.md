# ADR: `output` schemas → manifest / MCP structured results

Status: **Accepted** — shape, MCP wrap, failure codes, OpenAPI projection rule, and primitive omission settled.
Conformance: [fixtures/output-exit-codes.json](./fixtures/output-exit-codes.json), [fixtures/output-mcp-result-wrap.json](./fixtures/output-mcp-result-wrap.json).

Companion: [stdio.md](./stdio.md). Background acceptances: [decisions.md](../decisions.md).

Closes the projection gap when MCP tools were text-only: optional `output` → manifest `outputSchema`, MCP `outputSchema` / `structuredContent`, and validated return values on machine-facing transports.

---

## Settled

- `output` is opt-in; absent ⇒ untyped JSON, no warning.
- When present: always validate on machine-facing transports (`--json`, MCP; HTTP later). No dev/prod divergence.
- Manifest `outputSchema` is the **true** return schema (additive in formatVersion 1) — what the command actually returns on `--json` / HTTP.
- MCP `structuredContent` is spec'd as a JSON **object**. Non-null plain objects pass through. **Arrays (and other non-object roots we choose to structure) are wrapped** before structured content and before the MCP-facing `outputSchema` (see below). **Primitives and `null` stay text-only** — no `structuredContent`, and MCP `outputSchema` is **omitted** for those roots (prefer omit over a never-satisfied schema). Manifest still carries the true schema.

### MCP wrap contract (`result`)

When the validated return value is not a non-null object (today: arrays; later any non-object root we choose to structure), MCP projection wraps it:

```json
{ "result": <value> }
```

| Artifact | Schema / payload |
|---|---|
| Manifest `outputSchema` | True schema (e.g. `{ "type": "array", "items": … }` or `{ "type": "string" }`) |
| MCP `outputSchema` | Array roots: `{ "type": "object", "properties": { "result": <true schema> }, "required": ["result"] }`. Object roots: true schema. **Primitive / null roots: omitted.** |
| MCP `structuredContent` | `{ "result": <value> }` for arrays; object passthrough; **absent** for primitives / null |
| `--json` stdout | Unwrapped `<value>` (manifest truth) |
| OpenAPI 200 (M4a) | **Manifest** (true) schema — never the MCP-wrapped form |

Wrapper key is **`result`** — public contract, chosen to rhyme with jc's `--meta-out` envelope. Do not invent a parallel key per transport. Object-rooted returns are **not** wrapped (no `{ "result": { … } }` indirection).

### Validation failure codes (consumer vs producer)

| Failure | Exit | Envelope (`--json` stderr) | Who erred |
|---|---|---|---|
| Input: bad argv, unknown flag, stdin usage (non-object in merge mode, bad JSON, two `-`, etc.), args schema validation | **2** | `{ "error": { "message", "issues"? } }` | Caller |
| Output: command returned a value that fails its own `output` schema | **70** (`EX_SOFTWARE`) | same JSON error shape; message makes clear it is invalid *output* | Command author |
| Other runtime (handler throw, I/O) | **1** | same | Runtime |

Exit 2 is "I called it wrong." Exit 70 is "it's broken." Agents must be able to tell those apart; collapsing output failures into 2 (or into generic 1 without a distinct code) loses that. See [conventions.md](../conventions.md).

Absent `output`, return values are not validated — no 70 path.

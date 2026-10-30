# ADR: stdio interchange (stdin merge + list-shaped JSON)

Status: **Accepted** — hinge + unknown-keys + merge/bind implemented. **Amended 2026-10-30:** stdin is read only on an explicit `-` (see [Explicit `-` only](#explicit---only)).
Conformance: [fixtures/stdin-*.json](./fixtures/) (`active`).

Companion (write first): [output.md](./output.md) — `output` schemas → manifest / MCP structured results.
Prior art consulted: [jc](https://github.com/kellyjonbrazil/jc) (stdin → one JSON document by default; streaming parsers emit NDJSON; `--slurp` aggregates multi-item input into one array), [jq](https://jqlang.org/manual/) (stream of JSON values; `--slurp` → one array; right-hand object wins on `+` merge).

---

## Merge precedence (hinge)

Input assembly is a shallow, top-level merge into the command's args object, then a single schema validation pass. Sources, from weakest to strongest:

1. **Schema defaults** — applied by the validator for keys still absent after the merge (same as today's argv-only path).
2. **Stdin JSON** — consulted only when argv carries a `-` sentinel (`--args -` to merge, `--field -` or positional `-` to bind) **and** stdin is **not a TTY** (Node: `process.stdin.isTTY` is falsy for both pipes and file redirects — `cmd --args - < saved.json` must work; gating on FIFO/pipe alone is a bug). Without a sentinel stdin is never read, piped or not. With one, a TTY or empty stdin is a usage error (exit 2). In **merge mode** (`--args -`) the decoded value must be a **single JSON object**; its keys are filtered then copied into the args object.
3. **CLI surface** — path params, positionals, and flags actually present on argv. Every key supplied here overwrites the same key from stdin. Absence on argv does **not** clear a stdin-provided key.

Conflicts are key-by-key at the top level only (no deep merge). After the overlay, `validateSchema` runs once; coercion and defaults are the schema's job, not the merge's. Invalid JSON on stdin read through a sentinel is a usage error (exit 2).

**NDJSON / multi-value stdin vs a single-object command.** clfly invokes a command once per process. If stdin decodes to more than one JSON value (NDJSON / JSON Lines / concatenated values — jq's default stream shape), that is a **usage error (exit 2)** in both modes: do not take the first line, do not silently drop the rest, do not fan-out one invocation per line. Fan-out is composition (parked with mounts). If multi-value stdin is ever added, steal jq/jc's name — `--slurp` — as the aggregation escape hatch; it is not the default merge path.

---

## Unknown keys (lenient stdin, strict argv)

Real producers over-supply: a `list --json` item may carry a dozen fields; a downstream command wants two. Before merge, **drop stdin keys that are not among the command args schema's declared properties**. Surviving keys still lose to argv on conflict and still go through schema validation (type/required/enum).

Argv stays strict: unknown flags are errors (today's behavior). The asymmetry is intentional — humans typo on argv; machines over-supply on stdin. Without the filter, every pipeline needs a `jq '{magnet}'` adapter and the interop story dies of friction.

Nested content inside a kept value is not stripped by this rule; the field's schema decides (Zod strip / passthrough / strict, etc.).

---

## Merge vs bind (one mode switch)

Stdin is either **merged** or **bound**, never both.

| Mode | How entered | Stdin meaning |
|---|---|---|
| **Merge** | `--args -` (reserved flag) | Decoded value must be one JSON **object**; keys filtered to declared properties, then shallow-merged (see above). |
| **Bind** | exactly one field's argv value is the sentinel `-` | That flag/positional names the target field. The **entire** decoded JSON value (object, array, or other JSON type) is assigned to that field and validated against **that field's** schema. Merge is disabled for the invocation. |

Rules:

- No `-` on argv → stdin is not read at all.
- At most one `-` per invocation, `--args -` included; a second is a usage error (exit 2).
- A field bind disables merge entirely — no key overlay from stdin onto other fields.
- `args` is a reserved flag name (like `json` and `spool`); commands cannot declare it. It accepts only `-`.
- `-` binds **decoded JSON**, not raw bytes. Raw/binary file content needs a schema-level binary marker (or similar) and is **out of scope for v1**; until then, non-JSON stdin with `-` is exit 2.

This single switch covers array documents (`pm filter --items - < list.json`), file-valued args that are JSON, and the old "both at once" interaction question (impossible by construction).


### Explicit `-` only

Until 2026-10-30, merge was the default: any non-TTY, non-empty stdin was read to EOF and merged. Agent harnesses run shell commands with a stdin pipe that stays open and is never written, so every clfly command hung before running. Detecting "no data yet" needs a timeout, which races slow producers. A per-command opt-out leaves every new command hanging by default. So stdin is read only when argv asks for it with a `-`, the same rule `cat -` and `jq` filters follow. Implicit merge (`producer | cmd`) became `producer | cmd --args -`. That's a breaking change in `@clfly/core` 0.4.0.
---

## List-shaped output (producer side)

`--json` emits **one** JSON document per invocation (current behavior; arrays are one document, not NDJSON). Rhymes with jc's non-streaming parsers. NDJSON emission is opt-in later, never the default. Downstream array consumers use bind mode (`--items -`), not merge.

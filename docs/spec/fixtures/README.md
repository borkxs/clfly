# Interchange conformance fixtures

Language-agnostic cases for [output.md](../output.md) and [stdio.md](../stdio.md).
Each file is one rule; `cases[]` covers the edges. `@clfly/core` runs them via
`packages/core/test/conformance.test.ts`.

## Status

| Value | Meaning |
|---|---|
| `active` | Must pass against the current implementation |
| `pending` | Spec-settled; skipped until the feature lands |

## Case shape

```json
{
  "id": "unique-within-file",
  "status": "active",
  "transport": "cli" | "mcp",
  "module": {
    "meta": { "description": "…" },
    "args": { "type": "object", "properties": { … }, "required": [] },
    "output": { … },
    "returns": …,
    "default": …
  },
  "argv": ["cmd", "--json"],
  "stdin": "{…}",
  "stdinIsTTY": false,
  "mcpArgs": {},
  "expect": {
    "exitCode": 70,
    "stderrMessageIncludes": "Invalid output",
    "stdoutJson": …,
    "assembledArgs": { … },
    "structuredContent": { … },
    "mcpOutputSchema": { … },
    "manifestOutputSchema": { … }
  }
}
```

`args` / `output` are JSON Schema (draft-07-ish). Runners materialize a
validator in their language; the Node harness maps a restricted subset to Zod.
`returns` is what the command body returns (for output/MCP cases). `default` is
an optional static return when `returns` is omitted.

`assembledArgs` is the post-merge/bind object **before** schema defaults that
only the validator would fill — or after full validation when easier; each case
notes which. Pending stdin cases document the intended object.

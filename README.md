# clfly

PostgREST for CLIs: a filesystem tree of `(schema, function)` pairs is the single source of truth, and the CLI, `--help`, shell completions, an MCP server, and (later) an HTTP API are all derived projections of it — nobody hand-writes an interface layer.

```ts
// commands/users/list.ts
import { z } from "zod";

export const meta = {
  description: "List users in the workspace",
};

export const args = z.object({
  status: z.enum(["active", "churned"]).optional().describe("Filter by status"),
  limit: z.coerce.number().default(50).describe("Max rows"),
  json: z.boolean().default(false).describe("Emit JSON"),
});

export default async function (opts: z.infer<typeof args>, ctx) {
  // ...
}
```

```
commands/
  users/
    list.ts              → demo users list
    [id]/
      show.ts            → demo users <id> show
  deploy.ts              → demo deploy
  index.ts               → demo
```

```bash
pnpm --filter demo-cli demo -- users list --status active
pnpm --filter demo-cli demo -- --version   # → 1.2.3
pnpm --filter demo-cli demo -- users list --help
```

Write a folder of functions, get a CLI now — and an MCP server in M3 (`demo mcp serve`).

## Status

**M1 (this release):** filesystem router (dev-mode scan), `yargs-parser` tokenization, Standard Schema validation (Zod 4 reference), derived `--help`, reserved `--version` / `-V` (bare `x.y.z\n`), reserved-flag collision hard errors, working `examples/demo-cli`.

**Next:** M2 manifest codegen + completions; M3 MCP transport.

## Design notes

- **Schema as portable data.** Validators must project to JSON Schema (`~standard.jsonSchema`). Help, completions, and MCP tool defs all derive from that — not from framework-internal types.
- **Validator-agnostic.** Zod is `peerDependencies: "^4"` and optional. The compatibility contract is [Standard Schema](https://standardschema.dev) + [Standard JSON Schema](https://standardschema.dev/json-schema). Zod 5 (or Valibot/ArkType) works if it still implements that contract.
- **Reserved flags.** `--help`/`-h` and `--version`/`-V` are framework-owned. If a command schema defines `help`, `version`, or claims `-h`/`-V` via `.meta({ alias })`, scan/load **hard-fails** — no silent shadowing.
- **`--version` output.** Bare version string plus newline (`1.2.3\n`). No name prefix, no ANSI — safe for `$(demo --version)` in CI.
- **`meta.deprecated`.** `true` or a reason string; projects into help and JSON Schema `"deprecated": true`.
- **Manifest format (M2).** Codegen'd manifests carry `formatVersion` + `coreMajor`. The loader hard-fails on mismatch (`Run clfly build`). Format version is tied to `@clfly/core` major.

## Packages

| Package | Role |
|---|---|
| `@clfly/core` | Router, parser, help, run |
| `@clfly/create` | Scaffolder (stub) |
| `examples/demo-cli` | Reference CLI |

Releases use [changesets](https://github.com/changesets/changesets) with **independent** package versions.

## Quick start

```bash
pnpm install
pnpm --filter @clfly/core build
pnpm --filter demo-cli demo -- users list --help
```

```ts
import { createCli } from "@clfly/core";

const cli = createCli({
  name: "demo",
  commandsDir: new URL("./commands", import.meta.url),
});
await cli.run(process.argv.slice(2));
```

Optional typed wrapper (plain exports remain canonical):

```ts
import { defineCommand } from "@clfly/core";
import { z } from "zod";

export default defineCommand({
  meta: { description: "Ping" },
  args: z.object({ loud: z.boolean().default(false) }),
  run: async (opts, ctx) => {
    ctx.stdout.write(opts.loud ? "PONG\n" : "pong\n");
  },
}).default;
```

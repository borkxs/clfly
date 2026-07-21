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
});

export default async function (opts: z.infer<typeof args>, ctx) {
  const rows = /* ... */;
  if (ctx.json) return rows; // global --json serializes the return value
  for (const row of rows) ctx.stdout.write(`${row.id}\t${row.status}\n`);
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
pnpm --filter demo-cli demo -- --version          # → 1.2.3
pnpm --filter demo-cli demo -- users list --json  # → structured JSON
pnpm --filter demo-cli demo -- users list --help

# Prod: codegen a lazy manifest + shell completions
pnpm --filter @clfly/core exec clfly build --dir examples/demo-cli/commands --out examples/demo-cli/.clfly/manifest.js
pnpm --filter @clfly/core exec clfly completions zsh --name demo --dir examples/demo-cli/commands
```

Write a folder of functions, get a CLI (and completions) now — MCP server in M3 (`demo mcp serve`).

## Status

**M1:** filesystem router (dev-mode scan), `yargs-parser`, Standard Schema (Zod 4), derived `--help`, reserved `--version` / `-V` (bare `x.y.z\n`), reserved-flag hard errors, `examples/demo-cli`.

**M2 (this release):** `clfly build` lazy manifest + `formatVersion` hard-fail loader, bash/zsh/fish completions from JSON Schema, global `--json` output convention.

**Next:** M3 MCP transport.

## Design notes

- **Schema as portable data.** Validators must project to JSON Schema (`~standard.jsonSchema`). Help, completions, and MCP tool defs all derive from that — not from framework-internal types.
- **Validator-agnostic.** Zod is `peerDependencies: "^4"` and optional. The compatibility contract is [Standard Schema](https://standardschema.dev) + [Standard JSON Schema](https://standardschema.dev/json-schema). Zod 5 (or Valibot/ArkType) works if it still implements that contract.
- **Reserved flags.** `--help`/`-h`, `--version`/`-V`, and `--json` are framework-owned. If a command schema defines `help`, `version`, `json`, or claims `-h`/`-V` via `.meta({ alias })`, scan/build **hard-fails** — no silent shadowing.
- **`--version` output.** Bare version string plus newline (`1.2.3\n`). No name prefix, no ANSI — safe for `$(demo --version)` in CI.
- **`--json`.** Global flag. Handlers return a value; the runtime pretty-prints it. Errors become `{ "error": { "message", "issues?" } }` on stderr.
- **`meta.deprecated`.** `true` or a reason string; projects into help and JSON Schema `"deprecated": true`.
- **Manifest format.** Codegen'd manifests carry `formatVersion` + `coreMajor`. The loader hard-fails on mismatch (`Run clfly build`). Format version is tied to `@clfly/core` major.

## Packages

| Package | Role |
|---|---|
| `@clfly/core` | Router, parser, help, run, `clfly` bin (build + completions) |
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

// Dev: live scan
const cli = createCli({
  name: "demo",
  commandsDir: new URL("./commands", import.meta.url),
});

// Prod: lazy manifest (after `clfly build`)
import { manifest } from "./.clfly/manifest.js";
const prod = createCli({ name: "demo", manifest });

await cli.run(process.argv.slice(2));
```

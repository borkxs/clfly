# clfly

PostgREST for CLIs: a filesystem tree of `(schema, function)` pairs is the single source of truth — the CLI, `--help`, shell completions, and an **MCP server** are all derived projections of it. Nobody hand-writes an interface layer.

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
  if (ctx.json) return rows;
  for (const row of rows) ctx.stdout.write(`${row.id}\t${row.status}\n`);
}
```

```
commands/
  users/
    list.ts              → demo users list       → MCP tool users_list
    [id]/
      show.ts            → demo users <id> show  → MCP tool users_show
  deploy.ts              → demo deploy           → MCP tool deploy
```

```bash
# CLI
pnpm --filter demo-cli demo -- users list --status active
pnpm --filter demo-cli demo -- users list --json

# Same folder → MCP server (stdio)
pnpm --filter demo-cli demo -- mcp serve
```

**Write a folder of functions, get a CLI and an MCP server.**

## Status

- **M1:** FS router, yargs-parser, Standard Schema (Zod 4), `--help` / `--version`, reserved-flag hard errors
- **M2:** `clfly build` lazy manifest + formatVersion guard, bash/zsh/fish completions, global `--json`
- **M3 (this release):** `mycli mcp serve` — every command is an MCP tool (name from path, `inputSchema` from JSON Schema, handler = default export)

## Design notes

- **Schema as portable data.** JSON Schema is the interchange format for help, completions, and MCP tool defs.
- **Validator-agnostic.** Zod `peerDependencies: "^4"` (optional). Contract is Standard Schema + Standard JSON Schema.
- **Reserved flags.** `--help`/`-h`, `--version`/`-V`, `--json` — schema collisions hard-fail at scan/build.
- **Reserved command.** Top-level `mcp` is framework-owned (`mcp serve`). A `commands/mcp` path hard-fails.
- **`--version`.** Bare `x.y.z\n`. **`--json`.** Return a value; runtime pretty-prints. Errors → `{ "error": … }` on stderr.
- **`meta.deprecated`.** Projects to help + JSON Schema `deprecated` + MCP tool description prefix.
- **Manifest.** `formatVersion` + `coreMajor`; loader hard-fails on mismatch.

## Packages

| Package | Role |
|---|---|
| `@clfly/core` | Router, parser, help, build, completions, `mcp serve` |
| `@clfly/create` | Scaffolder (stub) |
| `examples/demo-cli` | Reference CLI + MCP server |

## Quick start

```bash
pnpm install
pnpm --filter @clfly/core build
pnpm --filter demo-cli demo -- users list --help
pnpm --filter demo-cli demo -- mcp serve   # point an MCP host at this process
```

```ts
import { createCli, listMcpTools, serveMcpStdio } from "@clfly/core";

const cli = createCli({
  name: "demo",
  commandsDir: new URL("./commands", import.meta.url),
});

await cli.run(process.argv.slice(2));
// demo mcp serve → same tree as MCP tools over stdio

// Or programmatically:
const tools = await listMcpTools({ name: "demo", commandsDir: "./commands" });
// await serveMcpStdio({ name: "demo", commandsDir: "./commands" });
```

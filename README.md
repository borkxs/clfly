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
    list.ts              → mycli users list       → MCP tool users_list
    [id]/
      show.ts            → mycli users <id> show  → MCP tool users_show
  deploy.ts              → mycli deploy           → MCP tool deploy
```

```bash
mycli users list --status active
mycli users list --json

# Same commands/ tree → MCP server (stdio)
mycli mcp serve
```

**Write a folder of functions, get a CLI and an MCP server.**

## Status

- **M1:** FS router, yargs-parser, Standard Schema (Zod 4), `--help` / `--version`, reserved-flag hard errors
- **M2:** `clfly build` lazy manifest + formatVersion guard, bash/zsh/fish completions, global `--json`
- **M3 (this release):** `mycli mcp serve` — every command is an MCP tool (name from path, `inputSchema` from JSON Schema, handler = default export)

## Prior art (and why this exists)

clfly stands on a lot of good work — none of it quite does this.

- **[oclif](https://oclif.io)** proved filesystem routing for CLIs (`src/commands/foo/bar.ts` → `cli foo bar`) and manifests for fast startup. But commands are classes with framework-specific static flag definitions — the schema is entangled code you can't hand to anything else.
- **[trpc-cli](https://github.com/mmkal/trpc-cli)** proved the schema pipeline: Standard Schema in, JSON Schema as the interchange, CLI flags out, validator-agnostic. But the command tree is a tRPC router object you assemble by hand.
- **[stricli](https://bloomberg.github.io/stricli/)** wrote the best critique of filesystem routing — runtime directory scanning is slow and magic. We think the objection is right and the conclusion is wrong: clfly scans in dev and compiles a lazy, versioned manifest for production, the same answer Next.js gives for routes.
- **[citty](https://github.com/unjs/citty), [brocli](https://github.com/drizzle-team/brocli), zod-opts** each nail a piece — `defineCommand` ergonomics, schema-driven flags, `.describe()` → help — without filesystem routing or a portable schema layer.
- **[express-file-routing](https://github.com/matthiaaas/express-file-routing)** and Next.js showed that a file tree with `[param]` segments is a perfectly good router. For HTTP. Nobody applied it to argv.

What no package does: treat a directory of `(schema, function)` pairs as the **single source of truth** and derive every interface from it. Your command modules export plain data — a Standard Schema and a default function — and clfly projects that tree into a CLI, `--help`, shell completions, and an MCP server, with an HTTP transport on the roadmap. The schema is portable JSON Schema all the way down, so the same file that answers `mycli users list --status active` is, unmodified, a validated MCP tool an agent can call. Everyone building agent tooling today writes that schema twice. You write a folder of functions once.

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

To run the reference CLI in this repo, see [`examples/demo-cli`](./examples/demo-cli).

Wire your own:

```ts
import { createCli, listMcpTools, serveMcpStdio } from "@clfly/core";

const cli = createCli({
  name: "mycli",
  commandsDir: new URL("./commands", import.meta.url),
});

await cli.run(process.argv.slice(2));
// mycli mcp serve → same tree as MCP tools over stdio

// Or programmatically:
const tools = await listMcpTools({ name: "mycli", commandsDir: "./commands" });
// await serveMcpStdio({ name: "mycli", commandsDir: "./commands" });
```

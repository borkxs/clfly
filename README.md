# clfly

**File-based routing for CLIs. Write a folder of functions — get a command-line tool, `--help`, shell completions, and an MCP server from the same tree.**

clfly is a TypeScript CLI framework where a `commands/` directory is the single source of truth. Each file exports a schema (Zod 4, Valibot, ArkType — anything [Standard Schema](https://standardschema.dev)) and a default function. Everything else is derived: argument parsing, validation, help text, completions, and an MCP server that exposes every command as a tool AI agents can call.

If you know Next.js routing or PostgREST, it's that idea pointed at argv: the tree *is* the interface. If you don't — you never write a parser, a help screen, or a tool manifest again.

```ts
// commands/users/list.ts
import { z } from "zod";

export const meta = { description: "List users in the workspace" };

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
mycli mcp serve          # same tree, now it's an MCP server over stdio
```

## Why

If you're building tooling that both humans and AI agents use, you're currently writing every schema twice — once for your CLI parser, once for your MCP tool definitions — and keeping them in sync by hand. clfly makes that structurally impossible to get wrong: there is only one schema, colocated with the function it validates, and every interface is a projection of it.

The schema is portable JSON Schema all the way down. The same file that answers `mycli users list --status active` at a terminal is, unmodified, a validated tool in Claude Desktop, Cursor, or any MCP client.

## Quick start

```bash
pnpm add @clfly/core zod
```

```ts
// bin/mycli.ts
import { createCli } from "@clfly/core";

const cli = createCli({
  name: "mycli",
  commandsDir: new URL("../commands", import.meta.url),
});

await cli.run(process.argv.slice(2));
```

Add files under `commands/`. That's the framework. A working reference lives in [`examples/demo-cli`](./examples/demo-cli).

For production startup speed, `clfly build` compiles the tree into a lazy, versioned manifest — no directory scanning at runtime, no loading commands you didn't invoke.

## How it works

Each layer does one job, and the seams are standard formats rather than framework internals:

- **[yargs-parser](https://github.com/yargs/yargs-parser)** tokenizes argv (`--flag`, `--key=value`, aliases, `--no-*`).
- **Your schema** owns types, coercion, defaults, enums, refinements, and error messages.
- **The file tree** is the router — directories nest subcommands, `[param]` segments become positional arguments.
- **JSON Schema** is the interchange format: help text, shell completions, and MCP `inputSchema` are all projected from it, never hand-maintained.

Command modules are plain data plus a function — no classes, no builder chains, no registration calls. Every command file is independently importable and unit-testable with zero framework imports.

## Design decisions

- **Validator-agnostic by contract.** The compatibility surface is Standard Schema + JSON Schema, not any validator's major version. Zod is an optional peer dependency (`^4`); Valibot and ArkType work identically.
- **Dev scans, prod compiles.** Filesystem routing's known costs — cold-start scanning, "magic" outside the JS runtime — are solved the way Next.js solves them: live scanning in dev, a codegen'd manifest with lazy `import()` thunks in production. The manifest carries a `formatVersion`, and the loader hard-fails on mismatch instead of misbehaving quietly.
- **Reserved surface is loud.** `--help`/`-h`, `--version`/`-V`, `--json`, and the top-level `mcp` command are framework-owned. A schema that collides with them fails at build time, not silently at parse time.
- **Deprecation is a first-class field.** `meta.deprecated` projects into help output, JSON Schema's `deprecated` keyword, and MCP tool descriptions — a graceful path before removal, for humans and agents alike.
- **Testable core.** Commands return values or throw typed errors; the bin wrapper owns `process.exit`. `--json` mode serializes return values; errors become `{ "error": … }` on stderr.

clfly is dogfooded: the `clfly` binary itself (`build`, `completions`, `mcp`) is defined as a clfly command tree in this repo.

## Prior art

clfly stands on a lot of good work — none of it quite does this.

- **[oclif](https://oclif.io)** proved filesystem routing and manifests for CLIs, but commands are classes with framework-specific flag definitions — the schema is entangled code you can't hand to anything else.
- **[trpc-cli](https://github.com/mmkal/trpc-cli)** proved the schema pipeline (Standard Schema → JSON Schema → flags, validator-agnostic), but the command tree is a tRPC router you assemble by hand.
- **[stricli](https://bloomberg.github.io/stricli/)** wrote the best critique of filesystem routing — scanning is slow and magic. The objection is right; the conclusion isn't. Compile the tree.
- **[citty](https://github.com/unjs/citty)**, **[brocli](https://github.com/drizzle-team/brocli)**, **zod-opts** each nail a piece — `defineCommand` ergonomics, schema-driven flags, `.describe()` → help — without filesystem routing or a portable schema layer.
- **Next.js / [express-file-routing](https://github.com/matthiaaas/express-file-routing)** showed a file tree with `[param]` segments is a perfectly good router. For HTTP. Nobody had applied it to argv.

The gap all of them leave: no package treats a directory of `(schema, function)` pairs as the single source of truth and derives *every* interface — CLI, help, completions, MCP, and (roadmap) HTTP / OpenAPI — from that one tree.

## Roadmap

- ✅ **M1** — router, parsing, validation, `--help`/`--version`, reserved-flag errors
- ✅ **M2** — `clfly build` manifest, bash/zsh/fish completions, global `--json`
- ✅ **M3** — `mycli mcp serve`: every command as an MCP tool
- ⬜ **M4a** — `clfly export openapi`: OpenAPI 3.1 from the tree (RPC-over-POST paths; no server)
- ⬜ **M4b** — `clfly http serve`: the same mapping as a live JSON API (auth on by default)
- ⬜ **M5** — ecosystem packages: `@clfly/docs`, `clfly palette` (TUI), `@clfly/palette` (web ⌘K)

Ecosystem packages consume only the [build manifest](./docs/manifest.md) and the exported OpenAPI document — never `@clfly/core` internals ([ecosystem contract](./docs/ecosystem.md)). Decisions live in [`docs/decisions.md`](./docs/decisions.md).

### Non-goals

Plugins, interactive prompts, i18n, config-file merging, telemetry. Also out of scope: GET/query-param HTTP mapping, content negotiation, streaming responses; web palette auth flows beyond passing a bearer token through; hosted anything — every transport is self-serve.

## Packages

| Package | Role |
|---|---|
| [`@clfly/core`](./packages/core) | Router, parser, help, build, completions, `mcp serve` |
| [`@clfly/create`](./packages/create) | Project scaffolder |
| [`examples/demo-cli`](./examples/demo-cli) | Reference CLI + MCP server |
# Project bootstrap prompt

Paste everything below this line into Claude Code (or your agent of choice) from an empty directory.

---

I'm building a TypeScript CLI framework. Working title: clfly

Read this whole spec before writing any code, then propose a plan and wait for my approval before scaffolding.

## The idea in one sentence

PostgREST for CLIs: a filesystem tree of `(schema, function)` pairs is the single source of truth, and the CLI, `--help`, shell completions, an MCP server, and (later) an HTTP API are all derived projections of it — nobody hand-writes an interface layer.

## Core convention

A `commands/` directory is the command tree, Next.js-style:

```
commands/
  users/
    list.ts        → mycli users list
    [id]/
      show.ts      → mycli users <id> show   (dynamic segment = positional arg)
  deploy.ts        → mycli deploy
  index.ts         → mycli                    (root command, optional)
```

Each command file exports data, not framework classes:

```ts
import { z } from "zod";

export const meta = {
  description: "List users in the workspace",
};

export const args = z.object({
  status: z.enum(["active", "churned"]).optional().describe("Filter by status"),
  limit: z.coerce.number().default(50).describe("Max rows"),
  json: z.boolean().default(false).describe("Emit JSON"),
});

export default async function (opts: z.infer<typeof args>, ctx: Context) {
  // ...
}
```

Design principles, in priority order:

1. **Schema as portable data.** The exported schema must project to JSON Schema (Zod 4 has native `z.toJSONSchema()`). JSON Schema is the interchange format that help text, completions, and MCP tool definitions are all derived from. Never let framework-internal representations become the source of truth (this is the mistake oclif made — schema entangled with class statics and its own combinators).
2. **Validator-agnostic via Standard Schema.** Accept anything implementing the Standard Schema spec (Zod, Valibot, ArkType) as long as it converts to JSON Schema — the same call trpc-cli made. Zod 4 is the first-class documented path, not a hard dependency. This is deliberate future-proofing: the Zod 3→4 break orphaned most prior zod-CLI libraries; don't repeat that coupling.
3. **Files export plain data + a default function.** No classes, no builder chains, no registration calls. A command file should be independently importable and testable with zero framework imports beyond the validator.
4. **Derived, never hand-written:** `--help` (from `.describe()` + meta), shell completions (bash/zsh/fish), `--json` output mode, and the MCP tool manifest.

## Parsing

Tokenize argv with `yargs-parser` (or `minimist` — evaluate and pick one, tell me why). Then map tokens through the schema for coercion and validation — the parser handles `--flag`, `--key=value`, `--key value`, aliases, `--no-flag` negation; the schema owns types, defaults, enums, refinements, and error messages. Positional args come from `[segment]` directory names plus an optional exported `positionals` tuple schema.

## Known objections to solve (don't skip these)

Bloomberg's stricli rejected fs-implicit routing for two reasons; both need answers, not hand-waving:

- **Cold start.** Scanning a directory tree at runtime is slow. Solve with a codegen step (like Next's route manifest): a `build` command that emits a static manifest with lazy `import()` thunks per command, so invoking one leaf doesn't load the whole tree. Dev mode can scan live.
- **Type safety across the seam.** The default export's parameter type should be checked against the exported `args` schema. Do this with a helper the file can optionally use (`defineCommand({ args, run })` as an *optional* ergonomic wrapper over the plain-exports convention) and/or a typecheck in the codegen step. Plain exports must remain the canonical form.

## Prior art — study, don't reinvent

Before writing the parser/router, skim these and note in the plan what you're borrowing vs. rejecting:

- **trpc-cli** (mmkal) — closest neighbor: schema→CLI via JSON Schema interchange, validator-agnostic, runs a plain module of exported functions. We differ by using the filesystem as the router instead of a tRPC router object.
- **oclif** — the fs-routing precedent; reject its class/static-property schema model.
- **stricli** — read their "Alternatives Considered" page; their objections are our requirements list.
- **citty, brocli, zod-opts, zcli (both of them)** — ergonomics survey; note anything worth stealing.
- **express-file-routing** — the HTTP-transport half already proven separately.

## Milestones

- **M1 — core:** fs router (dev-mode scan), yargs-parser tokenizing, Standard Schema validation with Zod 4 reference impl, derived `--help`, good error messages (show the failing flag, its expected type, and the relevant help excerpt). Working example CLI in `examples/`.
- **M2 — manifest codegen + completions:** `build` command emitting the lazy manifest; bash/zsh/fish completion generation from JSON Schema; `--json` structured output convention.
- **M3 — MCP transport:** `mycli mcp serve` (stdio) exposing every command as an MCP tool — name from the path, inputSchema from the JSON Schema projection, handler = the default export. This is the headline feature; the README leads with "write a folder of functions, get a CLI and an MCP server."
- **M4 (later, don't build yet):** HTTP transport.

## Non-goals for now

Plugins, interactive prompts, i18n, config-file merging, telemetry. Keep the dependency count near zero: yargs-parser + a JSON-schema-from-standard-schema shim; Zod as a peer dep only.

## Repo shape & quality bar

- pnpm monorepo: `packages/core`, `packages/create` (scaffolder, can be a stub), `examples/demo-cli`.
- TypeScript strict, ESM-first, tsup or zshy for builds, vitest for tests.
- Tests are part of every milestone, not a follow-up: parser mapping table tests (argv string → expected object), router resolution tests (path → command), schema projection snapshot tests (zod → JSON Schema → help text), and an end-to-end test that spawns the example CLI.
- A README written for launch: the one-sentence pitch, the 15-line example above, and the CLI+MCP demo. Treat the README as a deliverable of M1, refined at M3.

## Process

1. First: restate the design back to me in your own words, list the borrowed/rejected decisions from the prior-art skim, flag anything in this spec you think is wrong or underspecified, and propose the M1 file layout.
2. Wait for my go-ahead.
3. Build M1 only. Small commits, conventional-commit messages.
# clfly

> ⚠️ **Pre-release** — install as `@clfly/cli`; the `clfly` binary is included. Watch the repo for the real release.

clfly is a TypeScript CLI framework where a `commands/` directory is the single source of truth. Each file exports a schema (Zod 4, Valibot, ArkType — anything [Standard Schema](https://standardschema.dev)) and a default function. Everything else is derived: argument parsing, validation, help text, completions, and an MCP server that exposes every command as a tool AI agents can call.

```bash
npm i -g @clfly/cli
clfly --help
```

**Repository:** https://github.com/borkxs/clfly

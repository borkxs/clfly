# TODO

## `@clfly/create` — self-bootstrapping scaffolder

The scaffolder should itself be a clfly CLI. Dogfood as the first real product binary.

- Replace the `packages/create` stub with a real `commands/` tree on `@clfly/core`.
- Ship as `npm create clfly` / bin `create-clfly` (keep package name `@clfly/create`).
- Commands write a new CLI package: `package.json`, `bin`, `src/index.ts` wiring `createCli`, a starter `commands/` tree (hello + one nested example), and README snippet.
- Optional later: `clfly create …` if we also expose a `clfly` binary; for now `create-clfly` / `npm create clfly` is enough.
- README can then say this CLI was built with clfly — straight face, no asterisk.

## Later (from BOOTSTRAP)

- **M4:** HTTP transport (don't build yet).
- Non-goals still: plugins, interactive prompts, i18n, config-file merging, telemetry.

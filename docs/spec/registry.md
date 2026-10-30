# Local tree registry (`clfly link`)

Status: **Accepted.**
`init` does not link. Linking is an explicit command so a scaffold can exist without changing PATH or a harness config.

Companion: [register.md](./register.md).

---

## File

`$CLFLY_HOME/registry.json` when `CLFLY_HOME` is set. Otherwise `$XDG_CONFIG_HOME/clfly/registry.json`, or `~/.config/clfly/registry.json` when `XDG_CONFIG_HOME` is unset.

```json
{
  "formatVersion": 1,
  "trees": {
    "<name>": {
      "path": "/abs/package",
      "bin": "/abs/bin/<name>.mjs",
      "name": "<name>",
      "coreVersion": "0.3.0",
      "manifest": null,
      "root": "/abs/package",
      "linkedAt": "ISO-8601",
      "registered": { "<harness>:<scope>": "ISO-8601" }
    }
  }
}
```

`formatVersion` other than `1` refuses to read or write. `name` is the bin name from `package.json#bin` (same source as `serveInvocation()`). `path` and `root` are the package directory. `coreVersion` is the installed `@clfly/core` version, or the dependency specifier when it is not installed. `manifest` is `<path>/.clfly/manifest.json` when that file exists, else `null`. `linkedAt` is set by `link` and left `null` when `register` records a tree that was never linked. `registered` is updated by `clfly register`.

A second `link` of the same `name` at a different `path` exits 2 and prints the existing path. The same path updates the entry and keeps `registered`.

## Commands

- `clfly link [dir]` — `dir` defaults to cwd. pnpm (lockfile or `npm_config_user_agent`) runs `pnpm link --global`. Every other package manager runs `npm link`. Yarn and bun do not get their own link verbs; the bin only has to land on PATH. The registry is written only after the package manager exits 0.
- `clfly unlink <name>` — runs the matching global unlink, then deletes the registry entry. A missing name exits 2. A package-manager failure leaves the registry entry in place.
- `clfly ls [--json] [--prune]` — columns are name, core version, whether `which <name>` resolves, harness keys, and path. A missing `path` is shown and kept. `--prune` deletes those stale entries and prints their names. `--json` returns the rows and writes nothing else.

Writes use a temp file in the same directory plus `rename`.

## Scaffolder

`clfly init` does not link. After the install hint it prints `Then: clfly link`.

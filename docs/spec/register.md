# `clfly register`

Status: **Accepted.**
Projects one tree into one named harness entry. It does not edit any other server. It does not phone home.

Depends on the registry record when the tree was linked, and works without one: the cwd package is derived the same way as `link` (`package.json#bin`, package directory as `root`).

First example, and step 1 of the loop:

```sh
clfly register --self --harness cursor --scope user
```

`--self` registers the running `@clfly/cli` package so a later agent sees `clfly_add`, `clfly_init`, and `clfly_skill_export`. It upserts the registry entry and does not run the package manager.

## Invocation

```sh
clfly register --harness <h> [--scope project|user] [--tree name|dir] [--name n] [--dry-run] [--remove] [--self]
```

`--tree` picks the tree: a registry name, or a package directory resolved against cwd. It defaults to cwd. The project-scope file always goes under cwd, so `clfly register --harness cursor --tree packages/treemap` from a monorepo root writes the repo's `.cursor/mcp.json`.

`--scope` defaults to `project`. `--harness` is required. `claude-desktop` rejects `project` (user scope only).

| Harness | Project file | User file | Key |
|---|---|---|---|
| `claude-code` | `.mcp.json` | `~/.claude.json` | `mcpServers` |
| `cursor` | `.cursor/mcp.json` | `~/.cursor/mcp.json` | `mcpServers` |
| `vscode` | `.vscode/mcp.json` | platform `Code/User/mcp.json` | `servers` |
| `codex` | `.codex/config.toml` | `~/.codex/config.toml` | `[mcp_servers.<name>]` |
| `gemini` | `.gemini/settings.json` | `~/.gemini/settings.json` | `mcpServers` |
| `claude-desktop` | — | platform `Claude/claude_desktop_config.json` | `mcpServers` |

VS Code and Claude Desktop user paths: macOS `~/Library/Application Support/...`, Windows `%APPDATA%/...`, elsewhere `$XDG_CONFIG_HOME` or `~/.config`. VS Code entries set `"type": "stdio"`. The others are `command` / `args` only.

## Projection

One record: `{ name, command, args, env?, cwd? }`.

- Linked tree: `args` are `["mcp", "serve", "--root", root]`. `--root` is the package directory so the jail and `.clfly/sessions/` follow the tree, not whatever cwd the client happens to use.
- `--self`: `args` are `["mcp", "serve"]` with no `--root`. `clfly add` and `clfly init` write the caller's project; a jail at the clfly package would reject those paths.
- `command` is the absolute bin when it is executable, except a `.js`/`.mjs`/`.cjs` bin at user scope. Otherwise the bin is `args[0]` and `command` is `process.execPath` at user scope or `node` at project scope. GUI harnesses (Claude Desktop, editors launched from the dock) do not inherit a shell PATH, so a `#!/usr/bin/env node` bin cannot find an nvm or Homebrew node there; a checked-in project file should not pin one machine's node.
- Project scope: the bin and `--root` are written `./`-relative when they are inside the project. The client is assumed to launch project servers with cwd at the project. User scope stays absolute.
- `--name` changes only the harness entry name.

Re-running replaces that one name. `--remove` deletes it. Other names and unrelated keys stay. JSON is rewritten with two-space indent. A file that is not an object (or TOML that does not parse) exits 1 and is left untouched.

Codex is parsed and stringified with `smol-toml` (about 6 kB, ESM, parse + stringify, no extra parser). A hand-rolled writer cannot update one table idempotently without a parser. Comments in an existing Codex file are not preserved; entries are.

On success the registry entry's `registered["<harness>:<scope>"]` becomes the current ISO time. `--remove` deletes that key. `--dry-run` does neither, prints a unified diff of the file projection, and exits 0.

When `claude` is on `PATH`, an apply (not a dry-run) runs `claude mcp add --transport stdio --scope <scope> <name> -- <command> <args>` or `claude mcp remove <name> --scope <scope>` instead of editing the file. An add runs the matching remove first and ignores its failure, because neither CLI replaces an existing name. User-scope Codex does the same with `codex mcp add <name> -- <command> <args>` and `codex mcp remove <name>`. Dry-run always shows the file diff, including when those binaries exist, so the diff stays deterministic.

# clfly for Raycast

A local Raycast extension that turns every linked clfly tree (`clfly ls`) into an arrow-key command builder. One generic extension; trees and routes come from `clfly manifest --json`, so a new or changed tree shows up without touching this package. Development only: it is never published to the Raycast store.

## Load it

1. Install Raycast (free) from raycast.com.
2. Make sure the `clfly` on your PATH has the `manifest` command: `pnpm --filter @clfly/cli build` in the clfly checkout it links to, then `clfly manifest` should list your trees.
3. Build core once (the extension bundles `@clfly/core/complete`): `pnpm --filter @clfly/core build`.
4. Here: `npm install`, then `npm run dev`. Raycast picks the extension up and keeps it loaded after you stop the dev server.

Raycast does not read your shell profile. The extension adds nvm's newest node, `~/Library/pnpm`, `~/.local/bin`, and Homebrew to PATH; anything else goes in the **Extra PATH** preference (or set **clfly executable** to an absolute path).

## Commands

- **clfly Trees**: trees at the root; typing also matches every command in every tree. Enter drills into subcommands; dynamic segments (`:job`, `:env`) open a picker filled from the param's `completeFrom` source, or take typed text.
- **Root-search commands, generated** by `npm run gen-trees` from `clfly manifest --json` (it runs before `npm run dev` and `npm run build`; uses `../cli/dist/bin.js`, set `CLFLY_BIN` to override). The `tree-*.tsx` / `cmd-*.tsx` files are gitignored; the `package.json` command list is rewritten each run.
  - **One per tree** (`pm`, `dash`, …) opens its command list.
  - **One per route** (`pm status`, `pm search`, `run queue add`). Raycast arguments only for required positionals without a choice source: `pm search` ⇥ query ↵. Safe commands with nothing left to ask run at once; otherwise the form or param picker opens.
  - **One per choice of a short `completeFrom` list** (≤15, not destructive), fetched at gen time: `dash open film`, `run transcribe-batch`, `tick run health-check`. Rerun gen-trees (a tick job does it hourly) when those lists change.
  - **`clfly`** takes free text (`pm status --all`, `run job nightly rm`). Enable it as a Raycast fallback command to run whatever is in root search. Words walk the route, then `--flag value`, `--flag=value`, `--no-flag` and positionals; if anything required is missing, or the command is destructive, the form opens pre-filled.
  - Raycast's Store schema allows 100 commands; this private extension generates more (lint flags it, build and dev mode do not).
- **Enter runs** a command once nothing required is missing (`pm status`, `dash ls`); ⌘E in the result opens the form for optional flags. Destructive commands and ones with required args still open the **form** first.
- Leaf commands open a **form**: enums → dropdowns, booleans → checkboxes, text/number → fields, and args with `completeFrom` → dropdowns filled by running that command with `--json` (typing adds a free-text entry). ⌘↵ runs the tree's bin with an argv array, never through a shell.
- **Results**: a JSON array, or the longest array in an object, shows as rows (⌘D toggles the JSON detail); anything else as a Detail. Row actions copy the title, the row, or any field, and **chain** into every command whose `completeFrom` reads from this command's output (`tick ls` → `tick rm ‹name›`).
- **Destructive commands** (`meta.destructive`, or a leaf named `rm`, `apply`, `reset`, `down`, `delete`, `uninstall`, `unlink`, `clean` that is not `readOnly`) ask through `confirmAlert` before running. Declining runs nothing.
- **Favorites**: ⌘P pins a command with its current values; **clfly Favorites** lists them. ⇧⌘P (**Create Quicklink**) makes a Raycast quicklink to the `run` command; quicklinks show in root search and take an alias or hotkey in Raycast settings.
- **Search as you type**: a read-only command whose first positional is `query` (`pm search`) opens a live list. Keystrokes are debounced 300 ms, need 3+ characters, run one at a time at least 1 s apart, are cached per query, and stop after three failures in a row until ⌘↵ (the indexers behind `pm search` are rate-limited). Release titles are normalized (resolution, codec, source, group, punctuation stripped) and the most common title/year/season shows as **Complete to**, with its best-seeded hit as **Best pick**. ⌘→ completes the query.

## Declaring choice sources in a tree

See `completeFrom` in [docs/manifest.md](../../docs/manifest.md). For example, in a `tick` command with a `[name]` path param:

```ts
export const complete = { name: { cmd: "tick ls", field: "rows[].name", sub: "schedule" } };
```

## Develop

`npm run typecheck`, `npm test` (pure logic in `src/lib`), `npm run build`. The package sits outside the pnpm workspace so Raycast's tooling owns its `node_modules`.

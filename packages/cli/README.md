# clfly

> The real CLI — `init`, `add`, `build`, `completions`, `skill export`, and inherited `mcp serve`.

```bash
npm i -g @clfly/cli
# or: pnpm add -g @clfly/cli

clfly init mycli
cd mycli && pnpm install
pnpm exec tsx bin/mycli.ts --help
```

Scaffold into the current directory, or retrofit safely:

```bash
clfly init --force
clfly add user/list user/:id/report
```

## `clfly changelog`

One dated, newest-first list of capability changes on this machine, all derived, nothing
hand-typed:

```bash
clfly changelog                 # last 7 days
clfly changelog --since 2w      # 12h, 2w, or a date
clfly changelog --json
clfly changelog --snapshot      # only take the snapshot (for the hourly tick job)
```

```
2026-11-06        command  loop ready  #192 new `loop` tree: items in `~/.local/state/loop/items.jsonl`; lists ready items…
2026-11-05 13:46  skill    phone-resume  linked into ~/.claude/skills, new dir in ~/git/_agent-shared/skills
```

Sources, and how each is dated:

- **skills**: dirs holding `SKILL.md` under `~/.claude/skills` and `~/git/_agent-shared/skills`,
  dated by the dir's (or symlink's) birth time, or its mtime when that is earlier.
  `_agent-shared` is not in git, so the filesystem date is the only signal there is.
- **commands**: the root `CHANGELOG.md` of every git repo that hosts a linked tree
  (`## YYYY-MM-DD` heading, `` - `tree command` — text `` bullets), dated by the heading.
  Per-package `CHANGELOG.md` files (changesets, undated) are not read.
- **trees, command files, MCP servers, hooks, tick jobs, dash cards**: each run snapshots
  `clfly` registry trees and their `commands/` (or `src/commands/`) files, `~/.claude.json`
  `mcpServers`, `~/.claude/settings.json` hooks, `tick ls --json` and `dash ls --json` into
  `~/.local/state/clfly/changelog-snapshot.json` (`$XDG_STATE_HOME/clfly` when set). Differences
  from the previous snapshot are appended to `changelog-events.jsonl` there, dated to the
  snapshot that saw them; `-kind` marks a removal. The first run only writes the baseline. A
  source that can't be read (`tick` missing, say) keeps its previous contents, so a flaky read
  logs no removals. A command file whose command already has a CHANGELOG line is not repeated.

Dates are as good as the snapshot cadence, so take one hourly, as a sibling of the
`clfly-memory` tick job:

```bash
tick add clfly-changelog --every 1h --cmd "clfly changelog --snapshot"
```

**Repository:** https://github.com/borkxs/clfly

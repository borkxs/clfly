# clfly

> The real CLI — `init`, `add`, `build`, `completions`, and inherited `mcp serve`.

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

**Repository:** https://github.com/borkxs/clfly

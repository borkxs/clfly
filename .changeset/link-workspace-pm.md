---
"@clfly/cli": patch
---

`clfly link` and `clfly unlink` use pnpm for a package inside a pnpm workspace, instead of falling back to `npm link` because the package has no lockfile of its own.

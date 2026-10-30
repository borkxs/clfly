---
"@clfly/cli": minor
---

Add `clfly link`, `clfly unlink`, and `clfly ls`. `link` runs the package manager's global link and records the tree in `$CLFLY_HOME/registry.json`; `ls` shows whether each bin resolves and where it is registered. `init` now prints `Then: clfly link` and still does not link.

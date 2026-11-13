# Contributing

`packages/core`, `packages/cli` and `packages/create` are a mirror. Their working copy lives in a
private monorepo: every change to them lands there first and reaches this repo only through an
export (`clfly upstream push`), which also writes `.mono-sync` (the source commit and date).
Nobody edits those three packages here by hand: an edit on this side makes the next export refuse
until the change is moved to the working copy. Open an issue or a PR as a proposal and it will be
ported there.

The export copies `src/`, `test/` and `package.json` of each package. In package.json the
publishing fields (`version`, `main`, `types`, `exports`, `bin`, `files`, `publishConfig`, `scripts`) stay as they are here.
Releases (changesets, npm publish) happen in this repo.

`packages/panel`, `packages/pocket` and `packages/raycast` live only here: change them here as
usual. They build against the mirrored core.

This file is written by the export; edit the template in the working copy, not here.

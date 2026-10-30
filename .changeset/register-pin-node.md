---
"@clfly/cli": patch
---

`clfly register --scope user` runs `.js`/`.mjs`/`.cjs` bins through the absolute node that ran clfly, so Claude Desktop and other GUI harnesses without a shell PATH can start them.

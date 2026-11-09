# @clfly/panel

The clfly line editor as a Mac app. ⌥Space opens a floating panel over whatever you're in, like
Spotlight or Raycast. Esc on an empty line, or a click elsewhere, closes it. The panel is a
native `NSPanel` hosting a `WKWebView` on the Pocket page (`../pocket`, `?panel=1`), so the line,
completion, ghost text, ⇥ and runs are the same code as the browser and phone faces.

## Install

```sh
pnpm --filter @clfly/core build     # once; Pocket bundles core
pnpm --filter @clfly/pocket build   # public/app.js
packages/panel/install.sh           # builds clfly.app → ~/Applications, starts at login
```

`build.sh` alone builds `build/clfly.app` without installing (`open build/clfly.app` to try it).
Paths to `node`, `clfly` and the Pocket package are baked into `Info.plist` from the shell that
builds it, because a login item gets launchd's bare PATH. Rebuild after moving the checkout or
switching node versions.

## Updating after a merge

The installed panel runs from `~/git/clfly-main` (detached at `origin/main`). After merging a
clfly PR, run `clfly sync` (borkxs-mono's `@clfly/cli`; it also runs hourly as the `clfly-sync`
tick job): it fast-forwards that checkout, rebuilds what changed (core, pocket, or this app via
`install.sh`), stops the old engine and kickstarts the panel. A bare `launchctl kickstart -k`
is not enough: the killed panel never reaches "stop it on quit", so its engine keeps :4180 and
the new panel reuses it, still serving the old `server.mjs`.

## How it works

- **Hotkey**: Carbon `RegisterEventHotKey` for ⌥Space, so no Accessibility permission is needed.
  If another app holds ⌥Space, `~/.local/state/clfly/panel.log` says so.
- **Engine**: on launch the app checks `127.0.0.1:4180` (`POCKET_PORT`). If nothing answers, it
  starts `node server.mjs` in the Pocket package, logs to `panel.log`, and stops it on quit. An
  engine already running (`pnpm --filter @clfly/pocket start`) is used as is.
- **Bridge**: the page posts `"hide"` to `webkit.messageHandlers.clfly` on Esc with nothing left
  to clear. The app calls `window.clflyPanelShown()` on every open, which focuses the line and
  selects its text so typing replaces it.
- **No Dock icon** (`LSUIElement`); it opens on the screen with the mouse, on every Space.

Uninstall: `launchctl bootout gui/$(id -u)/dev.borkxs.clfly.panel`, then remove
`~/Library/LaunchAgents/dev.borkxs.clfly.panel.plist` and `~/Applications/clfly.app`.

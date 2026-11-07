#!/bin/sh
# Builds clfly.app, copies it to ~/Applications and starts it at login (a user LaunchAgent).
# Undo: launchctl bootout gui/$(id -u)/dev.borkxs.clfly.panel; rm ~/Library/LaunchAgents/dev.borkxs.clfly.panel.plist
set -eu
here=$(cd "$(dirname "$0")" && pwd)
"$here/build.sh" >/dev/null
dest="$HOME/Applications/clfly.app"
pkill -x clfly-panel 2>/dev/null || true
rm -rf "$dest" && cp -R "$here/build/clfly.app" "$dest"
label=dev.borkxs.clfly.panel
plist="$HOME/Library/LaunchAgents/$label.plist"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$dest/Contents/MacOS/clfly-panel</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "installed $dest; ⌥Space opens it"

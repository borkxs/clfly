#!/bin/sh
# Builds clfly.app (the ⌥Space panel) into packages/panel/build. Paths to node, clfly and the
# Pocket package are baked into Info.plist from this shell, since a login item gets launchd's bare PATH.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
app="$here/build/clfly.app"
node=$(command -v node)
clfly=$(command -v clfly)
pocket=$(cd "$here/../pocket" && pwd)
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
swiftc -O -o "$app/Contents/MacOS/clfly-panel" "$here/src/main.swift"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.borkxs.clfly.panel</string>
  <key>CFBundleName</key><string>clfly</string>
  <key>CFBundleExecutable</key><string>clfly-panel</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>CLFLY_NODE</key><string>$node</string>
  <key>CLFLY_BIN</key><string>$clfly</string>
  <key>CLFLY_POCKET_DIR</key><string>$pocket</string>
  <key>CLFLY_PATH</key><string>$PATH</string>
</dict></plist>
PLIST
codesign --force --sign - "$app" >/dev/null 2>&1 || true
echo "$app"

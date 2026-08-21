#!/bin/bash
# Rebuild Suite.app (icon + modes + ~/Applications copy).
# Creates a minimal Chrome --app wrapper for suite.html with the Toki icon.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/Suite.app"
ICON_SRC="$ROOT/Open Toki Menus.app/Contents/Resources/AppIcon.icns"
ICON_DST="$APP/Contents/Resources/AppIcon.icns"

if [[ ! -f "$ICON_SRC" ]]; then
  echo "missing Open Toki Menus icon: $ICON_SRC" >&2
  exit 1
fi

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Icon
cp -f "$ICON_SRC" "$ICON_DST"

# project path for launchers
printf '%s\n' "$ROOT" > "$APP/Contents/Resources/project-path.txt"

# Launcher script (MacOS/suite) — opens Chrome in app mode for the Suite hub
cat > "$APP/Contents/MacOS/suite" << 'LAUNCH'
#!/bin/bash
set -euo pipefail
APP_BUNDLE="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="$(cat "$APP_BUNDLE/Contents/Resources/project-path.txt" 2>/dev/null || pwd)"
URL="http://127.0.0.1:8765/suite.html"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [[ ! -x "$CHROME" ]]; then
  CHROME="$(/usr/bin/which google-chrome 2>/dev/null || echo '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')"
fi

if [[ -x "$CHROME" ]]; then
  exec "$CHROME" --app="$URL" \
    --user-data-dir="$HOME/Library/Application Support/SuiteChrome" \
    --no-first-run --no-default-browser-check --disable-sync --disable-extensions
else
  # Fallback
  open "$URL"
fi
LAUNCH
chmod +x "$APP/Contents/MacOS/suite"

# Stub for anything that references suite_app.py (harmless)
cat > "$APP/Contents/Resources/suite_app.py" << 'PYSTUB'
#!/usr/bin/env python3
"""Suite.app launcher stub. Real work is in the MacOS/suite shell script."""
import os, subprocess, sys
print("Suite.app stub — use the bundle executable instead.")
PYSTUB
chmod +x "$APP/Contents/Resources/suite_app.py"

# Minimal Info.plist so macOS recognizes it as a real app with icon
cat > "$APP/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>suite</string>
	<key>CFBundleIconFile</key>
	<string>AppIcon</string>
	<key>CFBundleIdentifier</key>
	<string>local.toki.suite</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Suite</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.13</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
PLIST

# Clean up and sign lightly
rm -rf "$APP/Contents/Resources/__pycache__"
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true
fi
xattr -cr "$APP" >/dev/null 2>&1 || true

# Replace symlink in ~/Applications (prevents duplicate launches / broken icons)
DEST="$HOME/Applications/Suite.app"
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
ln -s "$APP" "$DEST"

echo "Suite.app ready"
echo "  $APP"
echo "  $DEST -> $APP"
ls -l "$APP/Contents/Resources/AppIcon.icns" "$APP/Contents/MacOS/suite" "$DEST"

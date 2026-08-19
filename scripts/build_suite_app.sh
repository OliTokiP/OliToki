#!/bin/bash
# Rebuild Suite.app (icon + modes + ~/Applications copy).
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
cp -f "$ICON_SRC" "$ICON_DST"
printf '%s\n' "$ROOT" > "$APP/Contents/Resources/project-path.txt"
chmod +x "$APP/Contents/MacOS/suite"
chmod +x "$APP/Contents/Resources/suite_app.py"

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true
fi
xattr -cr "$APP" >/dev/null 2>&1 || true

DEST="$HOME/Applications/Suite.app"
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
cp -R "$APP" "$DEST"
xattr -cr "$DEST" >/dev/null 2>&1 || true
echo "Suite.app ready"
echo "  $APP"
echo "  $DEST"

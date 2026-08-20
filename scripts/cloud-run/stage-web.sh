#!/bin/bash
# Copy only the files the testing site needs into $1 (or a new temp dir).
# Prints the context path.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
STAGE="${1:-}"
if [[ -z "$STAGE" ]]; then
  STAGE="$(mktemp -d /tmp/toki-web-XXXXXX)"
fi
mkdir -p "$STAGE/scripts/cloud-run"
cp "$ROOT/Dockerfile.web" "$STAGE/Dockerfile"
cp "$ROOT/requirements.txt" "$STAGE/scripts/cloud-run/requirements.txt"
cp "$ROOT/../toki_server.py" "$STAGE/scripts/toki_server.py"
for name in js css assets food-pics data; do
  if [[ -d "$REPO/$name" ]]; then cp -R "$REPO/$name" "$STAGE/$name"; fi
done
for html in index.html index2.html index3.html index4.html manager.html \
  deploy.html preview-all.html new-bug.html push.html glossary.html \
  suite.html tickets.html brightness.html; do
  if [[ -f "$REPO/$html" ]]; then cp "$REPO/$html" "$STAGE/$html"; fi
done
printf '.*\n' > "$STAGE/.gcloudignore"
echo "$STAGE"

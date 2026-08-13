#!/bin/bash
# Read-only checks that live boards cannot fetch Drive xlsx styles.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
FAIL=0
pass() { printf "  PASS  %s\n" "$1"; }
fail() { printf "  FAIL  %s\n" "$1"; FAIL=1; }

echo "TokiMenu API-only proof"
echo "root: $ROOT"
echo

echo "1) Live boards do not load SheetJS"
if grep -n "xlsx\\.full" index.html index2.html index3.html index4.html preview-all.html 2>/dev/null | grep -q .; then
  fail "an index*.html still includes vendor/xlsx.full.min.js"
  grep -n "xlsx\\.full" index.html index2.html index3.html index4.html || true
else
  pass "index.html–index4.html have no xlsx.full.min.js"
fi

echo
echo "2) menu.js does not request a workbook"
if grep -nE "/api/sheets/xlsx|export\\?format=xlsx|Workbook xlsx:" js/menu.js | grep -v "Proof:" | grep -v "deprecated" | grep -v "API-only" | grep -q .; then
  fail "menu.js still contains a live xlsx URL or Workbook log"
  grep -nE "/api/sheets/xlsx|export\\?format=xlsx|Workbook xlsx:" js/menu.js || true
else
  pass "no live /api/sheets/xlsx or export?format=xlsx in menu.js"
fi

echo
echo "3) API-only flag is on"
if grep -q "window.TOKI_API_ONLY = true" js/menu.js; then
  pass "window.TOKI_API_ONLY = true"
else
  fail "TOKI_API_ONLY is not set true in menu.js"
fi

echo
echo "4) Zip/inflate parser is not in menu.js (it lives in this folder)"
if grep -q "async function inflateRaw" js/menu.js; then
  fail "inflateRaw still defined in menu.js — parser was not removed"
else
  pass "inflateRaw is gone from menu.js"
fi
if [[ -f deprecated/sheet-styles/xlsx-styles.excerpt.js ]]; then
  pass "quarantine file exists: deprecated/sheet-styles/xlsx-styles.excerpt.js"
else
  fail "quarantine excerpt missing"
fi

echo
echo "5) Server refuses xlsx export"
if grep -q '410' scripts/toki_server.py && grep -q 'xlsx export retired' scripts/toki_server.py; then
  pass "toki_server.py returns 410 for /api/sheets/xlsx"
else
  fail "toki_server.py does not 410 /api/sheets/xlsx"
fi
if grep -q "def xlsx_bytes" scripts/toki_server.py; then
  fail "SheetsBackend.xlsx_bytes is still implemented (Drive export still coded)"
else
  pass "Drive xlsx_bytes helper is gone from toki_server.py"
fi

echo
echo "6) Live server (optional — only if something is listening on 8765)"
CODE="$(curl -s -o /tmp/toki-xlsx-proof.json -w "%{http_code}" --connect-timeout 1 "http://127.0.0.1:8765/api/sheets/xlsx" 2>/dev/null || echo down)"
if [[ "$CODE" == "410" ]]; then
  pass "http://127.0.0.1:8765/api/sheets/xlsx → 410"
elif [[ "$CODE" == "down" || "$CODE" == "000" ]]; then
  echo "  SKIP  no server on :8765 (restart Open Toki Menus, then re-run)"
elif [[ "$CODE" == "200" ]]; then
  fail "server on :8765 still serves xlsx (200) — restart the old toki_server.py"
else
  fail "server on :8765 returned HTTP $CODE (want 410)"
fi

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "RESULT: all required checks passed."
  exit 0
else
  echo "RESULT: one or more checks failed."
  exit 1
fi

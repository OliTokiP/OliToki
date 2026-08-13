# Proof that live boards no longer fetch workbook styles

You do not need to read code. Use any **one** of the checks below. All four should agree.

## 1. Type this in the board’s console (easiest)

On a board page (Safari / Chrome → Develop → Show JavaScript Console):

```js
TOKI_API_ONLY
```

**Pass:** `true`

```js
document.documentElement.getAttribute("data-toki-api-only")
```

**Pass:** `"true"`

On load the console also prints a line that starts with:

`API-only: Drive xlsx export OFF`

If Debug Menu → Performance Console is on:

```js
TokiMenuDebug.list()
```

**Pass:** `xlsxStyles` is **NO** / not active.

## 2. Network tab (what the TV actually requested)

Hard-refresh a board. In the Network list, search: `xlsx`

**Pass:**

- No request named `xlsx` or `/api/sheets/xlsx`
- No `export?format=xlsx`
- No `xlsx.full.min.js`
- You **do** still see `/api/sheets/csv` (that is the fast path — keep it)

## 3. View source of the board page

Open `index.html` (or 2 / 3 / 4) → search for `xlsx.full`.

**Pass:** zero hits. The page loads `js/menu.js?v=20260813apionly` and does **not** load `vendor/xlsx.full.min.js`.

## 4. Ask the local server (after restarting it)

The running `toki_server.py` must be **restarted** once so it picks up the 410. Then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8765/api/sheets/xlsx"
```

**Pass:** `410`  
**Fail:** `200` means the old server process is still running — quit Open Toki Menus / the terminal server and launch again.

A 410 body looks like: `"error": "xlsx export retired"`.

## What you should see on the menus

Menus still show names, prices, typed colors, images, Encore, Family Portrait.

You should **not** expect:

- A cell’s **paint-bucket fill** to become a box or stripe color (type the hex instead)
- Mixed **bold / colored words inside one Google cell** (the whole cell is now plain text)

## Ran on this machine (2026-08-13)

```
TokiMenu API-only proof
  PASS  index.html–index4.html have no xlsx.full.min.js
  PASS  no live /api/sheets/xlsx or export?format=xlsx in menu.js
  PASS  window.TOKI_API_ONLY = true
  PASS  inflateRaw is gone from menu.js
  PASS  quarantine file exists: deprecated/sheet-styles/xlsx-styles.excerpt.js
  PASS  toki_server.py returns 410 for /api/sheets/xlsx
  PASS  Drive xlsx_bytes helper is gone from toki_server.py
  PASS  http://127.0.0.1:8765/api/sheets/xlsx → 410
RESULT: all required checks passed.
```

`curl` body:

```json
{"error": "xlsx export retired", "detail": "Live boards are API-only. Cell fills and rich text live in deprecated/sheet-styles/."}
```

Re-run anytime:

```bash
bash deprecated/sheet-styles/verify-api-only.sh
```

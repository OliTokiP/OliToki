# Quarantined: Drive xlsx fills, fonts, and rich text

**Retired from live boards:** 2026-08-13  
**Why:** The Drive workbook export (`/api/sheets/xlsx`) was the slow part of a local four-board launch. Cell **fill colors** and in-cell **rich text** (bold / italic / per-run color) were the only board features that needed that file. Typed hex and plain text still come from the Sheets API (`values.batchGet` → `/api/sheets/csv`).

This folder is the reconnect kit. **Nothing in here is loaded by `index.html`–`index4.html`.**

## What the boards still do

| Still live | Dead on the boards |
|------------|--------------------|
| Item names, prices, titles, Yes/No flags | Cell background fill as a color |
| Typed hex in Style / box Color cells | In-cell rich text (mixed bold/color in one cell) |
| `/api/sheets/csv` + `/api/sheets/tabs` | `/api/sheets/xlsx` (server returns **410**) |
| Public CSV fallback if the proxy is down | `vendor/xlsx.full.min.js` on the page |
| Theme numbers, speeds, Beta Features | SheetJS inflate of a full workbook |

## What is in this folder

| File | What it is |
|------|------------|
| `xlsx-styles.excerpt.js` | ZIP inflate + `extractSheetStylesFromXlsx` (fills / fonts / rich runs) |
| `loaders.excerpt.js` | `loadSheetStylesByName`, `loadBoardSheetStyles`, the old Google xlsx-warm, local style extract |
| `PROOF.md` | How a non-engineer checks that this is really off |
| `verify-api-only.sh` | Command-line checks (safe, read-only) |

## What we did **not** kill

These are **not** live-board features. They still exist as optional backups:

- **Toki Git Commit.app** — optional “include sheet snapshot” still downloads a workbook for git history
- **`scripts/pull-menu-xlsx.py`** — manual `Menu.xlsx` backup
- **`vendor/xlsx.full.min.js`** — still in the repo, not linked from the boards
- **`Menu.xlsx`** in the project root — file on disk; boards no longer parse fills from it

## How to reconnect later

1. Put the parser bodies from `xlsx-styles.excerpt.js` back into `js/menu.js` (replace the API-only stubs near `window.TOKI_API_ONLY`).
2. Restore `loadSheetStylesByName` / `loadBoardSheetStyles` / the Google xlsx-warm from `loaders.excerpt.js`.
3. Restore `SheetsBackend.xlsx_bytes` and a **200** `/api/sheets/xlsx` in `scripts/toki_server.py` (Drive export). Re-add the Drive readonly scope.
4. Add `<script src="vendor/xlsx.full.min.js"></script>` back on `index*.html` if local workbook parse is needed.
5. Set `window.TOKI_API_ONLY = false` and remove `data-toki-api-only`.
6. Cache-bust `menu.js?v=…`.

Until those steps happen, live TVs never download a workbook.

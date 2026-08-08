# TokiMenu Project Context

## Overview

TokiMenu is a static, browser-based restaurant menu display system for TV / Fire Stick boards. Vanilla HTML, CSS, and JavaScript — no build step. Four boards plus a multi-board wall preview.

| Page | Board |
|------|--------|
| `index.html` | Bowls |
| `index2.html` | Handhelds |
| `index3.html` | Munchies |
| `index4.html` | Drinks & Deals (announcement message board + drink box) |
| `preview-all.html` | Half-res wall of all four boards |

## Key directories

- `js/` — logic
  - `config.js` … `config4.js` — per-board Google Sheet IDs, gids, column maps
  - `data-source.js` — `TOKI_DATA_SOURCE` (local / remote)
  - `menu-data.js` — sheet fetch helpers
  - `menu.js` — main runtime (themes, boxes, fit, slideshow, announcements)
- `css/menu.css` — shared board styles
- `data/` — optional CSV fallbacks
- `assets/`, `food-pics/` — images
- `scripts/` — `toki_server.py`, `gsheet_client.py`, sync / git helpers
- `docs/` — architecture, product, data model, style guide
- `secrets/` — service account JSON (**gitignored**; never commit)
- `Open Toki Menus.app` — launcher (Local / Remote, focus, chrome, portrait stack)
- `Toki Git Commit.app` — commit helper applet

## Data flow

1. Board page loads `data-source.js` → `configN.js` → `menu-data.js` → `menu.js`
2. Live data: Google Sheets (CSV + xlsx for fills / fonts / rich text) via service account proxy or public export
3. Board 4 announcement slides: one message per non-empty **G** cell; speed **I**; **Shout** column **J**; body align from the **G cell’s own** Sheets formatting (not a separate Align column)
4. Themes / speeds / highlights from the Style tab
5. Soft refresh: fingerprint unchanged → skip re-render; offline keeps last good menu

## Important conventions

- Prefer small iterative edits; do not rewrite `menu.js` wholesale without approval
- Cache-bust query params on script/CSS links when shipping UI changes (`?v=…`)
- Wall preview (`preview-all` / `body.preview-wall`): lean path — performance matters (Fire Stick)
- Shadows off / reduced effects on multi-board wall when FPS is a concern
- Debug pages `_index*.html` are for local debugging
- Prefer existing patterns: `parseTextAlign`, `parseYesNo`, `fitBoxScale`, `setBoxTextAlign`

## Safety

- Never commit `secrets/` or service account keys
- Do not force-push or rewrite published history unless asked
- Destructive git / sheet bulk writes: confirm with the user first

## Docs to read first

- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/PRODUCT.md`
- `docs/STYLE_GUIDE.md`

## Launch

- `Start Toki Menu.command` — local preview
- `Open Toki Menus.app` — multi-window / wall launcher
- Optional local proxy: `scripts/toki_server.py` (see `scripts/gsheet_api.md`)

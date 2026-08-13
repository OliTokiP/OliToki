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
2. Live data: Google Sheets values only (`/api/sheets/csv`) via service account proxy or public CSV export. Drive xlsx / cell fills / rich text are quarantined in `deprecated/sheet-styles/`
3. Board 4 announcement slides: one message per non-empty **G** cell; speed **I**; **Shout** column **J**. In-cell rich text / fill colors are quarantined (plain text + typed hex only).
4. Themes / speeds / highlights from the Style tab
5. **Beta Features** (gid `1710200195`): boards 1–3 footer selection via `Include Footer Boxes` comma list — see [docs/BETA_FEATURES.md](docs/BETA_FEATURES.md)
6. Soft refresh: fingerprint unchanged → skip re-render; offline keeps last good menu

## Important conventions

- Prefer small iterative edits; do not rewrite `menu.js` wholesale without approval
- Cache-bust query params on script/CSS links when shipping UI changes (`?v=…`) — **include config*.js** when gids change
- Wall preview (`preview-all` / `body.preview-wall`): lean path — performance matters (Fire Stick)
- Shadows off / reduced effects on multi-board wall when FPS is a concern
- Debug pages `_index*.html` are for local debugging
- Plate architecture: `#hero-plate` (and portrait slots) are containers that own motion and shadow; stickers are children. Prefer updating plate helpers over direct img/sticker scale sync.
- Prefer existing patterns: `parseTextAlign`, `parseYesNo`, `fitBoxScale`, `setBoxTextAlign`
- **Beta / footer boxes:** inject via `applyBetaFooterBoxesOverride` only — prefetch sheets in `csvJobs`, **await** attach, outer-scope helpers only, full HTML/CSS/layout/render slice for new box types (see BETA_FEATURES.md). Beta errors must not fail the whole Google load.
- Footer **Priority**: lower number = higher priority (1 = leftmost / major). Max **3** boxes; rest are **exiled** (not painted).

## Safety

- Never commit `secrets/` or service account keys
- Do not force-push or rewrite published history unless asked
- Destructive git / sheet bulk writes: confirm with the user first

## Docs to read first

- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/PRODUCT.md`
- `docs/STYLE_GUIDE.md`
- `docs/UI_NOMENCLATURE.md` — Hero Panel, Plates, Frame, etc. (truth source for naming)
- `docs/MOTION_REFACTOR.md` — deferred pre-launch Motion Style / phase-runner work (not a mid-QA rewrite)
- `docs/PERFORMANCE.md` — feature performance tiers + kill vs hang + console debug prompt
- `docs/DEBUG_CONSOLE.md` — reading the performance flag console output (gated by Debug Menu sheet)
- `docs/SHEET_MIGRATION.md` — revised sheet tabs, percent 0–1 fields, future presentation features
- `docs/BETA_FEATURES.md` — Beta Features tab, Include Footer Boxes, how to add a 4th+ box type cleanly

## Launch

- `Start Toki Menu.command` — local preview
- `Open Toki Menus.app` — multi-window / wall launcher
- Optional local proxy: `scripts/toki_server.py` (see `scripts/gsheet_api.md`)

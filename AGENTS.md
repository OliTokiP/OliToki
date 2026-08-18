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
- `scripts/` — `toki_server.py`, `gsheet_client.py`, sync / git helpers, `toki_deploy.py`
- `deploy.html` — phone Deployer (testing vs restaurant). See [docs/DEPLOYER.md](docs/DEPLOYER.md)
- `docs/` — architecture, product, data model, style guide
- `secrets/` — service account JSON (**gitignored**; never commit)
- `Open Toki Menus.app` — launcher (Local / Remote, focus, chrome, portrait stack)
- `Toki Git Commit.app` — commit helper applet

## Data flow

1. Board page loads `data-source.js` → `configN.js` → `menu-data.js` → `menu.js`
2. Live data: **OliToki Menu Settings** picks Alpha vs Restaurant workbook; boards then load that sheet via `/api/sheets/csv`. Drive xlsx / cell fills / rich text are quarantined in `deprecated/sheet-styles/`
3. Soft refresh (30s) runs unless Settings → **Require restart to update?** is on (load once until a human refreshes). Unchanged fingerprint → skip re-render; offline keeps last good menu.
4. Board 4 announcement slides: one message per non-empty **G** cell; speed **I**; **Shout** column **J**. In-cell rich text / fill colors are quarantined (plain text + typed hex only).
5. Themes / speeds / highlights from the Style tab
6. **Beta Features** (gid `1710200195`): boards 1–3 footer selection via `Include Footer Boxes` comma list — see [docs/BETA_FEATURES.md](docs/BETA_FEATURES.md)

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
- QA lives in the iCloud Obsidian vault **OliToki Menu**. Style **A — Ticket**. One bug per file, named `YYYY-MM-DD Short title`, under `QA/Menu Manager` or `QA/Menu Screens`. **closed** and **include in listener** are Properties at the top (`false` until the user toggles them). [[Open Bugs]] / [[Closed bugs]] read `closed`. The crawler reads `include in listener`. Feature requests use the same shape in `FEATURE REQUESTS/`. **Version is required** (`version` in frontmatter = `js/build-info.js` `TOKI_BUILD.hash` or `git rev-parse --short HEAD`). If a ticket is missing a version when you create or touch it, add it. New tickets ship with include off — do not enroll them. **stage** is one Properties field: `In queue` / `In progress` / `Ready for review`. `- [ ] Mark as queued?` on the current Feedback (and on new-ticket forms) sets stage to In queue. Include alone lists the card for Listener and crawl skips it. Include + In queue puts it on that folder’s Queue (`QA/<surface>/Queue.md`, `FEATURE REQUESTS/<surface>/Queue.md`) — Queued / In progress / Ready for review / Closed. Listener moves In queue → In progress when it starts, then Ready for review when the pass is waiting on Feedback. Each Queue gets its own Terminal / Grok and self-terminates when Queued is empty. One Pass, one Feedback. After you write Pass N, add Feedback N only. Do not create Feedback N+1. Listener: vault `Listener/Listener.md` (**On**, models, Auto) and `Listener/Toki Listener.app`. Do not enroll tickets you create. See [[Listener]]. Never edit Apple Notes originals. Vault `Docs/` is a copy of repo `docs/` — Dropbox stays the git repo. See vault [[QA_Protocol]].
- **Menu Manager Style preview = the live board.** Measure mock geometry in native page units (PDF 400×300). Stay within ~5% of those numbers. Ken Burns / Slideshow **must** call `TOKI_MOTION.heroPunchIn` / `heroPunchOut`. Encore **must** call `TOKI_MOTION.encorePunchIn` / `encorePunchOut` on `#family-portrait-stage` (same functions as the live board). Do not write a preview-only camera or plate runner. Zoom *sizes* scale to the preview form factor; times do not. Active list color is Highlight; New items use Highlight Special.
- Motion styles: implement [docs/MOTION_GLOSSARY.md](docs/MOTION_GLOSSARY.md). Do not approximate Encore/Ken Burns/Slideshow.

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
- Live ship: `deploy.html` / GitHub Actions — **main** is work, **testing** is beta, **restaurant** is TVs. A git push to main does not update TVs.

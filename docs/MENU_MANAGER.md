# OliToki Menu Manager

**Last updated:** 2026-08-17  
**Status:** mobile layout + sheet read + Theme / Background write + Board Settings write (A3/B3/C3/G3)

Boss-facing mobile web app for authoring look, feel, and (later) menu content. This is the start of **Tier B** in [OWNER_HANDOFF.md](./OWNER_HANDOFF.md). Boards stay on the sheet CMS until board screens ship.

Open: [`manager.html`](../manager.html) via **Open Toki Menus** → **Open Menu Manager**, `toki_server.py`, or any static server. Env skip-UI: `TOKI_OPEN_MANAGER=1`.

Related: [PRODUCT.md](./PRODUCT.md) · [STYLE_GUIDE.md](./STYLE_GUIDE.md) · [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) · mockup `mockups/TokiSettings.pdf`

---

## 1. What this prototype is

A navigable mobile layout that **reads** the live sheet on boot:

- Splash → System Settings / Menu Settings
- Style and Theme editor with a live presentation preview
- Board 1–3 + Announcements **Coming Soon** placeholders
- Full-view Settings-style dropdowns
- Confirm-on-back (Yes / No / Keep Editing)

It should feel like a polished iPhone Settings app. Desktop is a centered phone frame on a studio background; phones use the full viewport and `env(safe-area-inset-*)` so Dynamic Island / camera cutouts do not inflate the header.

---

## 2. Theme contract (read this)

| Layer | When it updates |
|-------|-----------------|
| **This app’s chrome** | Immediately, from a **draft** cache (CSS variables) |
| **TV boards** | After Save writes Theme, Background, and speed cells — boards pick them up on their next sheet load |

Draft loads from **OliToki Menu Settings** + the chosen catalog’s **Style and Theme** tab (`js/manager-sheet.js` → `/api/settings` and `/api/sheets/csv`, public CSV fallback if the proxy is down). `js/manager-data.js` is the offline stand-in only. **Yes** on confirm leaves immediately (then writes in the background). Writes go same-origin first (`POST /api/manager/style`). It sends the Theme dropdown and the **Background** conglomerate on the **selected catalog**. The UI sends field names; the server adapter maps Theme Selector (**A3**), BG Color (**B3**), BG Pattern (**C3**), BG Wallpaper (**D3**). Pattern wins on the live board, so a color or wallpaper choice writes `none` into the unused of C/D. **BG Scroll Speed** (**H3**) and **Presentation Speed** (**I3**) write when those pills change. Encore children — Spotlight Type (**K3**), Spotlight Color (**L3**), Background Color (**M3**) — are **global** even when edited on a board. Board Yes also persists dirty Style fields. **Yes** also overwrites `data/manager-fallback.json` when `toki_server` is up. Pages cannot write — the key stays on the Mac. **No** reverts to the last loaded sheet values.

Toki Default tokens match [STYLE_GUIDE.md](./STYLE_GUIDE.md): Main `#000000`, Secondary `#FFFFFF`, Highlight `#26BBCB`, Highlight Special `#FFF900`. Other palettes are catalog seeds (several from `themes-to-paste.csv`).

Outlines use a darkened Highlight. Child rows (pattern / wallpaper / encore extras) use a lightened Highlight.

---

## 3. Screens

| Route | Screen |
|-------|--------|
| `#/` | Splash — OliToki Menu Manager |
| `#/system` | System Settings (Data Source, Require Restart, System Font, Sheet link) |
| `#/menu` | Menu Settings index |
| `#/menu/style` | Style and Theme |
| `#/menu/board/1` … `/3` | Board editor (title, family portrait, presentation, descriptions, drag-reorder items) |
| `#/menu/board/4` | Announcements (title + permalink; schema differs) |

Shared top slot (System + Menu Settings): Data Source, Current Theme, the four theme hexes (colored), Require restart, Version. No sheet-source line. No fake “Menus on” until board include is real.

QA query extras on Style: `?pick=theme`, `?pick=background`, `?pick=presentation`, `?bg=pattern`, `?bg=wallpaper`, `?pres=encore`, `?theme=Halloween`, `?confirm=1`.

---

## 4. Style and Theme fields

Context-driven children (same idea as the mockup):

| Parent | Reveals |
|--------|---------|
| Background = a theme color | (none — color also clears pattern/wallpaper) |
| Background = Pattern | Pattern Type, Pattern Color 1 / 2, BG Scroll Speed |
| Background = Wallpaper | Wallpaper Type, BG Scroll Speed |
| Presentation Style = Encore | Spotlight Style, Spotlight Color, Encore Background |

Preview (sticky under the header) is a **scaled crop of the live board**, not a second motion system. Slideshow / Ken Burns call `TOKI_MOTION.heroPunchIn` / `heroPunchOut` in `js/motion.js` — the same functions as the live board. Treatments: `css/motion.css`. Top slot height is the same `--top-slot-h` as System Settings.

Presentation Speed `0` = stop, `≥1` = go. Presentation Style is per-board and is **not** loaded from the sheet — Style screen defaults to Ken Burns. Create New Theme is gated (toast only).

**Board editor (1–3):** hamburger handles drag-reorder Menu Items in the local draft only (no inventory sheet write). Confirm-on-back Yes writes **Menu Title**, **Family Portrait** (0/1), **Presentation Mode** (`slideshow` / `ken burns` / `encore`), and **Include Descriptions?** (0/1) on that board tab (`POST /api/manager/board`). Permalink Yes saves those cells then opens the URL. Shared footer bar (`Add Item From Toast` / `New Theme`): plus stays left, label is centered on the bar. Toast add stays Coming Soon.

**Number pills (BG Scroll Speed / Presentation Speed):** read a validator in the Settings **header label** (same public CSV as themes). House style is the cute form already on Restaurant Copy:

| Header | Pills |
|--------|--------|
| `BG Scroll Speed (0<=5)` | 0…5 |
| `Presentation Speed (0,1,2,3)` | those integers |
| `Theme Selector (='Style and Theme'!$A$6:$A$17)` | values in that range |

`[0-5]`, `[0..5]`, `(>=3)` also parse. Matching ignores the suffix (`Highlight Color (Special)` stays a name). No spec → offline defaults.

---

## 5. Files

| Path | Role |
|------|------|
| `manager.html` | Shell |
| `css/manager.css` | Layout + theme tokens |
| `js/manager-data.js` | Offline catalogs, defaults, asset paths |
| `js/manager-sheet.js` | Settings + Style and Theme + board tab read; Theme + Background write via `/api/manager/style`; board Settings via `/api/manager/board` |
| `js/motion.js` + `css/motion.css` | Shared hero motion (live board + Style preview) |
| `js/manager.js` | Router, draft/commit, preview; Yes writes Theme + Background or board Settings |
| `scripts/toki_server.py` | `/api/sheets/validations`, `POST /api/manager/fallback`, `POST /api/manager/style`, `POST /api/manager/board` |
| `data/manager-fallback.json` | Last Save snapshot (offline / Pages when the sheet is down) |

Add a field: option list in `manager-data.js` → picker spec + `styleRows()` branch in `manager.js` → CSS only if the chrome changes. Sheet load maps **field names** into the draft. The UI does not send column indexes — Theme + Background use the server adapter (`Theme Selector` / A3, `BG Color` / B3, `BG Pattern` / C3, `BG Wallpaper` / D3). Number options should come from sheet dataValidation when present, not hard-coded spans.

---

## 6. Not in this prototype

- Writes for OliToki Menu Settings or Data Source
- Board inventory row reorder (drag is local-feel only; no row write)
- Image upload, Toast import, blur / blend / opacity (called out in the mockup as later)

System Font applies to **this app** (`html[data-system-font]`). Board type still follows `css/system-font.css` on the TV pages.

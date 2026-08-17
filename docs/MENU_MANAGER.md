# OliToki Menu Manager

**Last updated:** 2026-08-16 02:55  
**Status:** mobile layout + one-way sheet read (no Google Sheet writes)

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
| **TV boards** | Only after Save — **not wired** in the prototype |

Draft loads from **OliToki Menu Settings** + the chosen catalog’s **Style and Theme** tab (`js/manager-sheet.js` → `/api/settings` and `/api/sheets/csv`, public CSV fallback if the proxy is down). `js/manager-data.js` is the offline stand-in only. Edits never touch Google. **Yes** on confirm keeps the draft for the rest of the session; **No** reverts to the last loaded sheet values.

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
| `#/menu/board/1` … `/3` | Coming Soon (board authoring) |
| `#/menu/board/announcements` | Coming Soon |

Shared top slot (System + Menu Settings): Data Source, Current Theme, the four theme hexes (colored), Require restart, Version. No sheet-source line. No fake “Menus on” until board include is real.

QA query extras on Style: `?pick=theme`, `?pick=background`, `?pick=presentation`, `?bg=pattern`, `?bg=wallpaper`, `?pres=encore`, `?theme=Halloween`, `?confirm=1`.

---

## 4. Style and Theme fields

Context-driven children (same idea as the mockup):

| Parent | Reveals |
|--------|---------|
| Background = a theme color | (none — color also clears pattern/wallpaper) |
| Background = Pattern | Background Color, Pattern Type, Pattern Color 1 / 2, BG Scroll Speed |
| Background = Wallpaper | Background Color, Wallpaper Type, BG Scroll Speed |
| Presentation Style = Encore | Spotlight Style, Spotlight Color, Encore Background |

Preview (sticky under the header) is a **scaled crop of the live board**, not a second motion system. Slideshow / Ken Burns call `TOKI_MOTION.heroPunchIn` / `heroPunchOut` in `js/motion.js` — the same functions as the live board. Treatments: `css/motion.css`. Top slot height is the same `--top-slot-h` as System Settings.

Presentation Speed `0` = stop, `≥1` = go. Presentation Style is per-board and is **not** loaded from the sheet — Style screen defaults to Ken Burns. Create New Theme is gated (toast only).

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
| `js/manager-sheet.js` | One-way Settings + Style and Theme read (+ validations via API) |
| `js/motion.js` + `css/motion.css` | Shared hero motion (live board + Style preview) |
| `js/manager.js` | Router, draft/commit, preview |
| `scripts/toki_server.py` | `/api/sheets/validations` (Settings-row rules by header) |

Add a field: option list in `manager-data.js` → picker spec + `styleRows()` branch in `manager.js` → CSS only if the chrome changes. Sheet load maps **field names** into the draft. Do not teach this UI raw column indexes; write adapter is a later slice. Number options should come from sheet dataValidation when present, not hard-coded spans.

---

## 6. Not in this prototype

- Writes to OliToki Menu Settings or the catalog workbook
- Board / box / announcement item editors
- Image upload, Toast import, blur / blend / opacity (called out in the mockup as later)

System Font applies to **this app** (`html[data-system-font]`). Board type still follows `css/system-font.css` on the TV pages.

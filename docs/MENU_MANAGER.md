# OliToki Menu Manager

**Last updated:** 2026-08-14 16:40  
**Status:** mobile layout prototype (no Google Sheet writes)

Boss-facing mobile web app for authoring look, feel, and (later) menu content. This is the start of **Tier B** in [OWNER_HANDOFF.md](./OWNER_HANDOFF.md). Boards stay on the sheet CMS until board screens ship.

Open: [`manager.html`](../manager.html) via **Open Toki Menus** → **Open Menu Manager**, `toki_server.py`, or any static server. Env skip-UI: `TOKI_OPEN_MANAGER=1`.

Related: [PRODUCT.md](./PRODUCT.md) · [STYLE_GUIDE.md](./STYLE_GUIDE.md) · [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) · mockup `mockups/TokiSettings.pdf`

---

## 1. What this prototype is

A **non-working-but-navigable** mobile layout for testing:

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

Draft loads from a local stand-in of the selected Data Source’s **Style and Theme** tab (`js/manager-data.js`). Edits never touch Google in this version. **Yes** on confirm keeps the draft for the rest of the session; **No** reverts.

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

Preview (sticky under the header) is a **scaled crop of the live board**, not a second motion system. Slideshow / Ken Burns / Encore must match [MOTION_GLOSSARY.md](MOTION_GLOSSARY.md). Shared digits: `js/motion-presets.js`. Top slot height is the same `--top-slot-h` as System Settings.

Presentation Speed `0` = stop, `≥1` = go until sheets are wired. Create New Theme is gated (toast only).

---

## 5. Files

| Path | Role |
|------|------|
| `manager.html` | Shell |
| `css/manager.css` | Layout + theme tokens |
| `js/manager-data.js` | Catalogs, defaults, asset paths |
| `js/motion-presets.js` | Shared motion digits (also for live boards) |
| `js/manager.js` | Router, draft/commit, preview |

Add a field: option list in `manager-data.js` → picker spec + `styleRows()` branch in `manager.js` → CSS only if the chrome changes. Do not teach this UI raw column indexes; map **field names** when a write adapter lands.

---

## 6. Not in this prototype

- Writes to OliToki Menu Settings or the catalog workbook
- Loading live Style rows over `/api/sheets/csv` (hook is the next slice)
- Board / box / announcement item editors
- Image upload, Toast import, blur / blend / opacity (called out in the mockup as later)

System Font applies to **this app** (`html[data-system-font]`). Board type still follows `css/system-font.css` on the TV pages.

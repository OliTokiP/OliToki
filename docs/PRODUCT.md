# TokiMenu — Product

## What it is

TokiMenu is a **local digital menu board system** for restaurants. Boards are full-screen **1920×1080** HTML pages driven by a spreadsheet (today: Google Sheets via a private API proxy, or a local `Menu.xlsx`). Staff edit the sheet; displays refresh on a timer.

**Primary customer today:** OliToki (four boards: Bowls, Handhelds, Munchies, Drinks & Deals).

**Product direction:** the same renderer and layout engine should serve **multiple restaurants**, with per-tenant config (sheet ID, assets, themes) and optional POS data sources later (e.g. Toast) without rewriting layout code.

---

## Goals

| Priority | Goal |
|----------|------|
| P0 | Reliable, beautiful boards that match design mockups at fixed 1920×1080 |
| P0 | Non-technical staff can update titles, items, prices, and theme via the sheet |
| P0 | Private spreadsheet (service account + local proxy; no “anyone with the link”) |
| P1 | **Generic boxes** (Box 1 / 2 / 3) any combination on any board, with fixed width rules |
| P1 | Clean architecture so a second restaurant is config + assets + sheet, not a fork |
| P2 | Data-source adapters (Sheets now; Toast / other POS later) |
| P2 | Formal style guide as the contract for AI and human edits |

Non-goals (for now):

- Cloud multi-tenant SaaS hosting
- Mobile responsive redesign (boards are fixed stage, scaled to the display)

**Authoring path:** the sheet *is* the CMS for the first handoff. A boss-facing web authoring UI (sheet hidden) is a later goal — see [OWNER_HANDOFF.md](./OWNER_HANDOFF.md).

---

## Boards (OliToki)

| Board | HTML | Layout | Sheet tab (approx) | Role |
|-------|------|--------|--------------------|------|
| 1 | `index.html` | `bowls` | Board 1 | Item list + descriptions + optional footer boxes + hero |
| 2 | `index2.html` | `handhelds` | Board 2 | Same shell, denser list variants |
| 3 | `index3.html` | `munchies` | Board 3 | Dense multi-price list |
| 4 | `index4.html` | `drinks` | Board 4 / Announcements chrome + Drinks content | Mirrored frame; announcement + drink options; hero on left |

Shared content sheets today:

- **4 - Proteins** (footer Box A)
- **5 - Sauces** (footer Box B)
- **7 - Drinks** (Board 4 options box)
- **Style** (theme palette + BG FX + presentation speed)

**Target naming (hybrid rewrite):** Protein / Sauces / Drinks content tabs become **Box 1 / Box 2 / Box 3** with one column super-set. See [DATA_MODEL.md](./DATA_MODEL.md).

---

## User workflows

1. **Edit menu** — Google Sheet (or local xlsx for offline/stress).
2. **Run displays** — start `toki_server.py` (or Open Toki Menus app), open the four board URLs full-screen.
3. **Theme change** — Style tab theme selector + colors / BG image / blur / blend / opacity / scroll / slideshow.
4. **Backup** — Drive version history + local `Menu.xlsx` pull + git for code. Sheet content is **not** in git.

---

## Success criteria

- Visual parity with mockups in `mockups/` and verification screenshots in `screenshots/`.
- Toggling Include flags for boxes never corrupts the main item list.
- Private sheet works via `/api/sheets/*` without exposing the service account to the browser.
- After multi-tenant work: a second restaurant can ship with a new `restaurant.json` + assets + sheet, same JS/CSS.

---

## Related docs

- [OWNER_HANDOFF.md](./OWNER_HANDOFF.md) — boss handoff, Tier A sheet vs Tier B authoring UI
- [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md) — **truth source** for on-screen names (Hero Panel, Plates, …)
- [PERFORMANCE.md](./PERFORMANCE.md) — feature cost tiers (Encore, blur, wall) + debug kill-switch prompt + console flags
- [DEBUG_CONSOLE.md](./DEBUG_CONSOLE.md) — how to read TokiMenuDebug output and control via the Debug Menu sheet
- [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) — revised sheet tabs, percent 0–1 fields, future features
- [STYLE_GUIDE.md](./STYLE_GUIDE.md) — geometry, boxes, graphics snippets
- [DATA_MODEL.md](./DATA_MODEL.md) — sheet columns, flags, migration
- [ARCHITECTURE.md](./ARCHITECTURE.md) — modules, adapters, multi-tenant
- [../scripts/gsheet_api.md](../scripts/gsheet_api.md) — service account setup
- [git-howto.txt](./git-howto.txt) — git baseline workflow

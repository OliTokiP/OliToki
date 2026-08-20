# What’s New

**Last updated:** 2026-08-20 12:45  

Major product and presentation changes, newest first.  
How to maintain this file: [DOCS_MAINTENANCE.md](./DOCS_MAINTENANCE.md).

---

## 2026-08-20 12:45 — Deployer publishes restaurant/testing (no merge)

**Boards / surface:** Deployer (operator — not the TV boards)  
**Sheet:** none  
**Summary:** A restaurant/testing ship now **publishes** the source commit onto that branch and pins env/stamps. It does not merge. Merging two pin-rewritten trees is what aborted three `confirm-restaurant: yes` ships on `manager.html` `?v=` conflicts. `git push --force-with-lease` applies only to `restaurant` and `testing`. Never `main`. Unique work must not live on those branches — the next ship replaces the tip.

### Docs updated
- [DEPLOYER.md](./DEPLOYER.md)

---

## 2026-08-20 12:12 — Local portal instead of Wi-Fi IPs

**Boards / surface:** Suite / Listener / tickets (operator hub — not the TV boards)  
**Sheet:** none  
**Summary:** Ticket **Check local** links and Launcher’s Local column now use this Mac’s Bonjour name (`http://Peters-Mac.local:8765/…`) and a parked portal at `/portal` → Suite. DHCP Wi-Fi IPs (`10.0.0.106`) no longer get written into tickets, so Listener stops rewriting every note when the laptop gets a new address. The numeric IP stays on Launcher as a fallback only. Tailscale and Live URLs were already stable.

### Docs updated
- [HOW_TO_SHIP.md](./HOW_TO_SHIP.md)

---

## 2026-08-20 11:28 — Deployer hard-refreshes itself

**Boards / surface:** `deploy.html` (operator hub — not the TV boards)  
**Sheet:** none  
**Summary:** Opening Deployer adds a `_toki=` cache-buster so Suite App / Chrome cannot keep yesterday’s `deploy.html`. Status fetches use `cache: no-store`. Local `toki_server` sends `Cache-Control: no-store` on static files. If the Mac’s build hash moves while the tab is open, Deployer reloads. Launcher Hard refresh is not required for this page.

### Docs updated
- [DEPLOYER.md](./DEPLOYER.md)

---

## 2026-08-20 11:18 — Deployer says TVs current only vs main

**Boards / surface:** `deploy.html`, `suite.html` (operator hub — not the TV boards)  
**Sheet:** none  
**Summary:** Deployer no longer calls TVs current when GitHub Pages merely matches the last restaurant ship. Green only when the Pages stamp equals **main** (today’s work). A Testing-only ship, or any later commit on main, shows red: live hash, last restaurant ship, and main, plus “file a Restaurant ship.” Suite Health uses the same verdict. Matching live to restaurant-ship is called out as not a green light if main cannot be read.

### Docs updated
- [DEPLOYER.md](./DEPLOYER.md)
- [HOW_TO_SHIP.md](./HOW_TO_SHIP.md)

---

## 2026-08-20 01:35 — Menu Manager notification veil sits behind chrome

**Boards / surface:** `manager.html` (phone UI — not the TV boards)  
**Sheet:** none  
**Summary:** The notification veil is full-page and paints only over splash, the mini-display, and the Style preview — header, option lists, splash buttons, and footer stay on top, so the shroud no longer visibly grows or shrinks. The invisible stack box still eases to the current plate (hero vs top slot) and tracks that plate in layout pixels so a scaled desktop studio matches the phone.

### Docs updated
- [MENU_MANAGER.md](./MENU_MANAGER.md)

---

## 2026-08-20 00:40 — Suite Health grid

**Boards / surface:** `suite.html` (operator hub — not the TV boards)  
**Sheet:** none  
**Summary:** Suite front page now has a **Health** block: the Pages vs git Live line, then a two-column grid (Network, Load, Swap, Grok, Open sockets, Leftover CLOSE_WAIT, Sheets, Servers). Numbers are green / yellow / red. Mac meters come from local `GET /api/sys` (never Google). On GitHub Pages the Mac tiles show “Mac only”; restaurant API still pings Cloud Run.

### Docs updated
- [DEPLOYER.md](./DEPLOYER.md)

---

## 2026-08-19 23:28 — Wallpaper average-color Background Plate

**Boards / surface:** all four live boards + wall preview  
**Sheet:** Style BG Wallpaper, BG Opacity, BG Blend Mode  
**Summary:** Wallpaper at 100% opacity and Normal blend paints the Background Plate with the wallpaper’s average color so the dual-layer scroll/crossfade loop does not flash Style BG Color. Other opacity or blend values keep the sheet BG Color. Contract is [STYLE_GUIDE.md](./STYLE_GUIDE.md) §11 (`maybeApplyImageAverageAsPlate` in `js/menu.js`; first landed 2026-08-11).

### Docs updated
- [STYLE_GUIDE.md](./STYLE_GUIDE.md)
- [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md)

---

## 2026-08-18 21:30 — Suite phone hub + one-file surfaces

**Boards / surface:** `suite.html` (operator hub — not the TV boards)  
**Sheet:** none  
**Summary:** Phone page in the Launcher / Deployer style that links Deployer, Tickets, Menu Manager, and the boards. New **Suite** ticketing surface. Adding a surface is one object in `js/surfaces.js` — Listener creates `QA/<name>` and `FEATURE REQUESTS/<name>` plus Queue pages.

### Docs updated
- [DEPLOYER.md](./DEPLOYER.md)
- [HOW_TO_SHIP.md](./HOW_TO_SHIP.md)

---

## 2026-08-16 00:55 — Menu Manager reads the live sheet (one way)

**Boards / surface:** `manager.html`  
**Sheet:** [OliToki Menu Settings](https://docs.google.com/spreadsheets/d/1OwNKHzjP46xKJBW8sTm4IOWhIzf0lENdZ8rv_GY37fY/edit) + the chosen Alpha / Restaurant Style and Theme tab  
**Summary:** Manager boot now pulls System Settings and Style and Theme from Google (same `/api/settings` + `/api/sheets/csv` path as the TVs, public CSV fallback on Remote). Theme list, colors, background, speeds, and Encore knobs match the sheet. Confirm-on-back is still local. **No writes.**

### Docs updated
- [MENU_MANAGER.md](./MENU_MANAGER.md)

---

## 2026-08-14 16:40 — Menu Manager mobile layout prototype

**Boards / surface:** `manager.html` (phone UI — not the TV boards)  
**Sheet:** none (local draft only; no writes)  
**Summary:** First cut of the boss-facing Menu Manager from `mockups/TokiSettings.pdf`. Splash, System Settings, Menu Settings, Style and Theme (live app chrome + presentation preview), and Coming Soon board screens. Theme draft restyles the app immediately; Confirm on back keeps or discards the session. Sheet push and board item editing are not wired.

### Docs updated
- [MENU_MANAGER.md](./MENU_MANAGER.md)
- [PRODUCT.md](./PRODUCT.md)
- [README.md](./README.md)

---

## 2026-08-13 23:30 — Fire Stick HD is 1080p; pin AbleSign URLs

**Boards / surface:** AbleSign on **Fire Stick HD** (1080p max, 1080p TVs)  
**Summary:** Debug Display `3840×2160 dpr2` is 1920 CSS × 2, not a 4K screen. AbleSign has no resolution setting and appears to default a 2× buffer. Append `?w=1920&dpr=1` so we load 1080p assets. See [SUPPORTED_DEVICES.md](./SUPPORTED_DEVICES.md).

---

## 2026-08-13 21:30 — Remote stays on public Viewer sheets

**Boards / surface:** GitHub Pages (Remote)  
**Sheet:** Settings + Alpha / Restaurant copies — **Anyone with the link → Viewer** for now  
**Summary:** Remote cannot read a private sheet by itself (no place to hide the robot key). A hosted `toki_server` for that is a **future** feature: [FUTURE_HOSTED_API.md](./FUTURE_HOSTED_API.md). Local still uses the service account and can stay private. Until the hosted API exists, share Settings and the chosen live workbook as Viewer.

---

## 2026-08-13 20:00 — Live Settings (Alpha vs Restaurant, Require Restart)

**Boards / surface:** all four live boards  
**Sheet:** [OliToki Menu Settings](https://docs.google.com/spreadsheets/d/1OwNKHzjP46xKJBW8sTm4IOWhIzf0lENdZ8rv_GY37fY/edit)  
**Summary:** `toki_server` reads Settings → **Data Source** (catalog URL) and serves that workbook on `/api/sheets/csv`. **Require restart to update?** = TRUE turns off the 30s soft refresh (load once until a human refreshes the browser).

---

## 2026-08-13 18:00 — API-only live boards (no Drive xlsx)

**Boards / surface:** all four live boards + wall preview  
**Sheet:** typed hex / text still work. Cell **fill colors** and in-cell **rich text** (bold/color runs) do not.  
**Summary:** Live menus load Google values only (`/api/sheets/csv`). The Drive workbook export used for fills and rich text is gone — server returns **410** on `/api/sheets/xlsx`. Parsers live in `deprecated/sheet-styles/` so we can reconnect later. Proof: [deprecated/sheet-styles/PROOF.md](../deprecated/sheet-styles/PROOF.md).

### Docs updated
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DATA_MODEL.md](./DATA_MODEL.md)
- [DEBUG_CONSOLE.md](./DEBUG_CONSOLE.md)

---

## 2026-08-13 12:00 — Hard Veil Shadow restored (d03b4de)

**Boards / surface:** boards 1–3 Encore Hard spotlight  
**Sheet:** Beta Features → Veil Shadow Settings (unchanged columns)  
**Summary:** Restored the pre-geometry Hard veil from `d03b4de`: `filter: drop-shadow` on the real veil. The extra translated gradient copy is gone, so a fading / semi-transparent veil no longer shows a second full shadow circle.

### Docs updated
- [BETA_FEATURES.md](./BETA_FEATURES.md)

---

## 2026-08-11 16:20 — Animation Block Wind-up / Wind-down

**Boards:** 1–3 presentation  

- **Opening Wind-up** waits for fonts + stage paint (not off-screen premature motion).  
- **Animation Block** ids: encore sequence (FP+Encore or Encore-only) = one block; Slideshow FP overview = its own; Slideshow items = one block.  
- **Encore without FP lineup:** Zoom Reveal Wind-up into collage, then first bow Punch-in.  
- **Serialized Wind-down** between collage/Encore blocks (and hero-encore → other block) so consecutive FP/Encore segments don’t hard-cut mid-veil.  
- Same-block bow→bow and FP→Slideshow-item still overlap seamlessly.  
- Timer skips ticks while Wind-down handoff is busy.

See [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md) §4.

---

## 2026-08-11 15:10 — Presentation polish (images, New color, display order, Encore handoff)

**Boards:** 1–3 multi-segment presentation  

1. **Missing images:** no broken-image glyphs (slot/hero removed on error). Zero images → skip FP + Encore (text highlights only). Partial cast → FP/Encore layout only the items with images (e.g. 4 of 10 → 2×2), Encore bows only those.
2. **New color in boxes:** if `Include in Presentation?`, inventory uses Secondary (no static Special); Special/Highlight only on the active presentation turn. Boxes not in presentation keep static Special on New.
3. **Display order:** presentation cue + FP L→R follow painted DOM order (wrap balance), not raw sheet order.
4. **Encore veil:** keeps Highlight Special through zoom-out on New bows; Box Encore veil no longer depends on Alpha Presentation Mode.
5. **Segment handoff:** leaving Encore for another segment does full undim/zoom-out then FP reverse-zoom fade before the next segment starts.

---

## 2026-08-11 14:05 — Box Menu image folders (Drinks on Board 2)

**Boards / surface:** Boards 1–3 Box Menu presentation  
**Sheet:** none (path resolution only)

Bare Image filenames on footer box tabs (e.g. `CocaCola.png` on Drinks) now resolve under **per-box** folders, not the Alpha board folder:

| Box | Folder |
|-----|--------|
| Proteins | `food-pics/proteins` |
| Sauces | `food-pics/sauces` |
| Drinks | `food-pics/drinks` |
| Veggies | `food-pics/veggies` |

Fixes Family Portrait / hero broken icons when presenting Drinks on Handhelds (Board 2 was looking in `food-pics/handhelds`).

**Future desire:** standardize folder names to match box **Titles** exactly (and document that convention in sheet notes).

---

## 2026-08-11 13:15 — Box Menu presentation (Include in Presentation + Family Portrait)

**Boards / surface:** Boards 1–3 only (Board 4 Announcements excluded for now)  
**Sheet:** Proteins / Sauces / Veggies / Drinks Settings columns **G–I**

| Col | Header | Role |
|-----|--------|------|
| G | Include in Presentation? | Opt-in: box runs its own presentation segment |
| H | Family Portrait | Per-box collage overview (when cast has images) |
| I | Presentation Mode | `Slideshow` or `Encore` for that box only |

### Behavior

1. **Alpha Menu** (main board inventory) always runs first — implicit **Priority 0** (not in the sheet).
2. After every Alpha item has been highlighted once (including Alpha FP / Encore lineup + bows when configured), presentation **hands off** to Box Menus.
3. Eligible boxes: on this board’s strip (`include` after Priority top-3 / exile) **and** `Include in Presentation?` **and** at least one inventory row.
4. Box order = **Priority** ascending (same field as strip placement; lower number first).
5. Each box is a **closed segment**: only that box’s items. No mixing with Alpha or other boxes.
6. Per box: optional Family Portrait, then Slideshow or full Encore parity (spotlight / Ken Burns / lineup rules match Alpha, cast = box images only).
7. **Blank Image** → text-only beat (full-line highlight on the footer item; no hero photo). **New** still shows the New sticker when possible.
8. While a box segment is active: **Alpha list highlight is cleared**; the active box line (name + subtitle + price) uses Highlight / Special Highlight.
9. After the last presenting box finishes, the queue **loops to Alpha**.
10. **Style Settings** remain global (Presentation Speed, spotlight type/color, Ken Burns). Boxes only own FP + mode.

### Runtime notes

- Parsed via `BOX_REVISED_SETTINGS` G–I; inventory Image resolved for hero/FP.
- `buildBoardSlides` / `appendPresSegment` build a multi-segment `slides[]`.
- Slides rebuild after `applyBetaFooterBoxesOverride` so exile/include is final.
- Empty inventory or Include off → segment skipped silently.

### Docs updated

- [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) §6.1 rewritten (was “future sketch”)
- [DOCS_MAINTENANCE.md](./DOCS_MAINTENANCE.md) added
- This file

---

## 2026-08-11 — New sticker position + slideshow fade

**Boards:** All boards with `#new-sticker`  
**Sheet:** none

- Position matched to `mockups/Munchies Mockup.png` (stage seat via plate-relative `left/top`, no extra CSS rotate — tilt is baked into `Sticker-Body`).
- Sticker is a **child of `#hero-plate`**, sibling of `.hero-anim`: inherits plate **opacity fade**, does **not** take Ken Burns zoom.

---

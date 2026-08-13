# What’s New

**Last updated:** 2026-08-13 21:30  

Major product and presentation changes, newest first.  
How to maintain this file: [DOCS_MAINTENANCE.md](./DOCS_MAINTENANCE.md).

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

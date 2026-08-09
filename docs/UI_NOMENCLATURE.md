# TokiMenu — UI nomenclature (truth source)

**Canonical names for the on-screen parts of a menu board.**  
Use these words in:

- Google Sheet headers, notes, and dropdown labels (as we migrate)
- Product docs, handoff guides, and bug reports
- Code comments and new CSS/JS identifiers when practical (legacy DOM ids may lag)

**Last updated:** 2026-08-09  
**Status:** v1 — author-approved direction; sheet headers will be edited to match over time.

Related: [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) · [STYLE_GUIDE.md](./STYLE_GUIDE.md) · [PRODUCT.md](./PRODUCT.md)

---

## 1. How to use this document

| Term | Meaning |
|------|---------|
| **Preferred name** | What we say in conversation and sheet copy |
| **Also called** | Legacy code / CSS / informal names still in the repo |
| **DOM / code** | Current anchors (may not rename immediately) |

When sheet language and code disagree, **this doc wins for human language**; code renames are optional follow-ups.

---

## 2. Global chrome (all boards)

Fixed **1920×1080** canvas.

| Preferred name | What it is | Also called / DOM |
|----------------|------------|-------------------|
| **Stage** | The full 1920×1080 board root | `#stage` |
| **Background** | Rear-most scene: solid color plate + optional wallpaper image (blur, blend, opacity, scroll) | Galaxy, `#galaxy`, BG Color / BG Wallpaper |
| **Background Plate** | Solid color layer under the wallpaper (theme or Style BG Color) | BG color plate |
| **Wallpaper** | Bitmap on the Background (e.g. `film.jpg`, `galaxy-bg.jpg`, or `none`) | BG Image, BG Wallpaper |
| **Frame** | Opaque vector shape: white **Header Band** + black **Menu Panel**, with diagonal cutout toward the photo side | `#frame`, frame header / frame panel |
| **Header Band** | White (secondary) top strip of the Frame that holds the Logo and Menu Title | `.frame-header` |
| **Menu Panel** | Dark (main) body of the Frame that holds the Menu List (and on Board 4, the right-side content) | `.frame-panel`, black panel |
| **Logo** | Toki mark in the Header Band | `#logo` |
| **Menu Title** | Board title text (e.g. “Bowls & Salads”) | `#menu-title` |
| **Disclaimer** | Allergy / food-safety copy (usually top of the photo side) | `#disclaimer` |
| **Version Stamp** | Optional git/build line near the Disclaimer (author/debug; off for boss handoff) | Show Version / Show Github Version |

---

## 3. Boards 1–3 — list + photo side

Layout: Frame on the **left**, photo side on the **right** (Board 4 mirrors — see §5).

### 3.1 List side (on the Frame)

| Preferred name | What it is | Also called / DOM |
|----------------|------------|-------------------|
| **Menu List** | Scrollable/fit list of menu items | `#menu-list` |
| **Menu Item** | One row/entry: name, prices, optional subtitle & description | item row |
| **Item Name** | Primary label | `.item-name` |
| **Item Prices** | One to three price fields | Price 1–3 |
| **Item Subtitle** | Secondary label (often parenthetical) | Subtitle column |
| **Item Description** | Longer copy under/beside the name when Descriptions are on | Description column |
| **List Highlight** | Active Menu Item treatment during Slideshow / Encore | highlight row |
| **Footer Boxes** | Row of optional info boxes under the Menu List | `#footer-boxes` |
| **Footer Box** | One shared content box (today: Proteins, Sauces, optional Drinks) | info-box, Box 1/2/3 long-term |
| **Box Title / Box Subtitle** | Header labels inside a Footer Box | `.info-box-title`, `.info-box-subtitle` |
| **Box Body** | Item chips/lines inside a Footer Box | `.info-box-body` |
| **Box Shell** | SVG border/background chrome of a Footer Box | `.info-box-shell` |

### 3.2 Photo side (outside the Menu Panel cutout)

| Preferred name | What it is | Also called / DOM |
|----------------|------------|-------------------|
| **Hero Panel** | Region that shows the large food photo for the active item (or box item in a future cycle) | `#hero-wrap`, “the blank part that shows food” |
| **Plate** | The food image asset currently shown in the Hero Panel (or a tile in Family Portrait / Encore) | `#hero`, hero image, food pic |
| **New Sticker** | “New!” badge overlaid when the active item is marked New | `#new-sticker` |
| **Family Portrait** | Multi-Plate collage overview on the photo side (when enabled) | `#family-portrait-stage`, FP |
| **Portrait Slot** | One lattice position holding a Plate (and optional New Sticker) in Family Portrait / Encore | slot |
| **Encore** | Presentation mode: Ken Burns zoom on the collage + spotlight on the active Plate | presentation mode Encore |
| **Spotlight Veil** | Dim/black overlay with a hole (hard or soft) over non-active Plates during Encore | `.family-portrait-veil`, house lights |
| **Scaffold Background** | Optional pinned Background treatment during Encore zoom | encore scaffold BG |

**Rule of thumb:**

- **Hero Panel** = the *place*.
- **Plate** = the *picture* in that place (or in a Portrait Slot).

---

## 4. Presentation vocabulary

| Preferred name | What it is |
|----------------|------------|
| **Presentation Mode** | Board setting: **Slideshow** or **Encore** |
| **Slideshow** | Cycle Menu Items (and later opted-in Footer Box items); one Plate in the Hero Panel |
| **Encore** | Family Portrait collage + Ken Burns + Spotlight Veil; list highlight may defer to zoom |
| **Presentation Speed** | Seconds per step (Style Settings); `0` = pause |
| **Family Portrait (toggle)** | Whether the collage overview path is used with the current Presentation Mode |
| **Motion Style** | Named motion recipe (glossary-driven). Today partially hard-coded (e.g. Shout on announcements; Ken Burns in Encore). Future: dropdown, especially on Announcements |

---

## 5. Board 4 — Drinks & Deals (mirrored)

Frame on the **right**; photo side on the **left**.

| Preferred name | What it is | Also called / DOM |
|----------------|------------|-------------------|
| **Stripes** | Optional pinstripe layer on the Menu Panel | `#stripes` |
| **Announcement Panel** | Large message box (title, subtitle, body, motion) | `#announcement-box`, Announcement |
| **Announcement Body** | Main copy area inside the Announcement Panel | `#announcement-body` |
| **Drink Options Box** | Footer-style box of drink items / overview | `#drink-options-box` |
| **Hero Panel** | Same idea as boards 1–3; sits on the left over the Background | `#hero-wrap` |
| **Plate** | Drink or feature image in the Hero Panel | `#hero` |

---

## 6. Style system (not on-stage geometry)

| Preferred name | What it is |
|----------------|------------|
| **Theme** | Named palette: Main, Secondary, Highlight, Highlight Special |
| **Theme Selector** | Which Theme is active (Style Settings) |
| **Main Color** | Primary dark / panel role (also Frame Menu Panel fill via theme) |
| **Secondary Color** | Light / header role |
| **Highlight Color** | Active list / accent |
| **Highlight Color (Special)** | New / special accent (e.g. sticker / special highlight) |
| **Color Picker label** | Sheet value like `Main Color` or `Override (use cell fill)` resolving to a theme color or cell fill |
| **Styles Glossary** | Locked lists that feed dropdowns (wallpapers, blend modes, color labels, motion styles) |

---

## 7. Sheet ↔ screen mapping (target language)

As headers migrate, prefer:

| Sheet concept | UI name |
|---------------|---------|
| Image (item or box row) | **Plate** filename (shown in **Hero Panel** or Portrait Slot) |
| Include (item) | Show on **Menu List** |
| Include (box item) | Show in **Footer Box**; later may also gate presentation cycle |
| Family Portrait | **Family Portrait** toggle |
| Presentation Mode | **Presentation Mode** |
| BG Wallpaper | **Wallpaper** on **Background** |
| Include Protein/Sauces/Drinks Box | Show **Footer Box** N |
| Announcement columns | **Announcement Panel** fields |
| Motion style (future) | **Motion Style** on Announcement Panel |

---

## 8. ASCII map (Boards 1–3)

```text
┌──────────────────────────────── Stage (1920×1080) ────────────────────────────────┐
│  Background (Background Plate + Wallpaper)                                        │
│  ┌──────── Frame ──────────────┐   ┌──────── photo side ─────────────────────┐   │
│  │ Header Band  Logo  Title    │   │ Disclaimer              [Version Stamp] │   │
│  ├─────────────────────────────┤   │                                         │   │
│  │ Menu Panel                  │   │         Hero Panel                      │   │
│  │   Menu List                 │   │            Plate                        │   │
│  │   (List Highlight)          │   │         New Sticker                     │   │
│  │                             │   │   — or Family Portrait / Encore —       │   │
│  │ Footer Boxes                │   │   Portrait Slots + Spotlight Veil       │   │
│  └─────────────────────────────┘   └─────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Board 4: swap Frame and photo side; Menu List hidden; Announcement Panel + Drink Options Box in the Frame; Stripes optional.

---

## 9. Open renames (sheet / code later)

Track deliberately; do not block handoff:

- [ ] Style header “BG Wallpaper” already matches **Wallpaper** language
- [ ] Protein/Sauces tabs → generic **Footer Box** naming when multi-restaurant lands
- [ ] DOM `#galaxy` → comment or alias as **Background** (optional)
- [ ] DOM `#hero` → document as **Plate** in Hero Panel (optional id rename later)
- [ ] Align boss-facing sheet notes with this vocabulary

---

## 10. Changelog

| Date | Change |
|------|--------|
| 2026-08-09 | v1 — Hero Panel, Plate, Frame, Menu List, Footer Boxes, Encore/Spotlight, Board 4 Announcement Panel |

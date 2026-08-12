# TokiMenu — UI nomenclature (truth source)

**Canonical names for the on-screen parts of a menu board.**  
Use these words in:

- Google Sheet headers, notes, and dropdown labels (as we migrate)
- Product docs, handoff guides, and bug reports
- Code comments and new CSS/JS identifiers when practical (legacy DOM ids may lag)

**Last updated:** 2026-08-11 (Motion phases: Wind-up / Punch-in / Hold / Punch-out / Wind-down)  

**Pre-launch:** Runtime motion is still path-grown in `menu.js`; a structured Motion Style runner is deferred — see [MOTION_REFACTOR.md](MOTION_REFACTOR.md).  
**Status:** v1 — author-approved direction; sheet headers will be edited to match over time.

Related: [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) · [STYLE_GUIDE.md](./STYLE_GUIDE.md) · [PRODUCT.md](./PRODUCT.md) · [WHATS_NEW.md](./WHATS_NEW.md)

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
| **Version Stamp** | Optional git/build info appended to the Toki Debug HUD header (when Show Version + debug visuals active) | Show Version |

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

| Preferred name | What it is                                                                                                                                                  | Also called / DOM |
|----------------|------------|-------------------|
| **Hero Panel** | Region that shows the large food photo for the active item (or box item in a future cycle)                                                                  | `#hero-wrap` |
| **Plate** | Container object that owns motion (opacity, Ken Burns scale, drop-shadow) for one food presentation. Children (image + decorations) inherit its transforms. | `#hero-plate` (contains `#hero` img and/or multi lattice + `#new-sticker`) |
| **Plate Image** | The actual food bitmap inside a Plate                                                                                                                       | `#hero` (single) or `.family-portrait-item` imgs in multi lattice |
| **Multi-image lattice** | When Image has 2+ names: FP grid inside the Plate (same `buildPortraitLayout`); motion still Plate fade/KB                                                  | `.hero-multi-plates` + `.family-portrait-slot` — see [FAMILY_PORTRAIT_LATTICE.md](./FAMILY_PORTRAIT_LATTICE.md) |
| **New Sticker** | “New!” badge decoration that lives inside a Plate (inherits plate motion)                                                                                   | `#new-sticker` (child of `#hero-plate`) |
| **Family Portrait** | Multi-Plate collage overview on the photo side (when enabled)                                                                                               | `#family-portrait-stage`, FP |
| **Portrait Slot** | One lattice position that acts as a Plate container holding an image + optional New Sticker in Family Portrait / Encore. Drop-shadow lives on the slot.     | `.family-portrait-slot` (contains `.family-portrait-item` img + sticker) |
| **Encore** | 3Presentation mode: Ken Burns zoom on the collage + spotlight on the active Plate                                                                           | presentation mode Encore |
| **Spotlight Veil** | Dim/black overlay with a hole (hard or soft) over non-active Plates during Encore                                                                           | `.family-portrait-veil`, house lights |
| **Scaffold Background** | Optional pinned Background treatment during Encore zoom                                                                                                     | encore scaffold BG |

**Rule of thumb:**

- **Hero Panel** = the *region*.
- **Plate** = the animated container object (owns scale, fade, shadow). The food image and stickers are children inside it. Same idea for Portrait Slots.

---

## 4. Presentation vocabulary

| Preferred name | What it is |
|----------------|------------|
| **Presentation Mode** | Board setting: **Slideshow** or **Encore** |
| **Slideshow** | Cycle Menu Items (and Box Menu items when opted in); one Plate in the Hero Panel |
| **Encore** | Collage + Ken Burns + Spotlight Veil on the active Portrait Slot; list/box highlight may defer to zoom |
| **Presentation Speed** | Seconds per **Presentation Step** (Style Settings); `0` = pause. Also the default **Hold** duration when no separate hang control exists |
| **Family Portrait (toggle)** | Whether the collage overview Motion Style is available; may **compose** as Encore’s Wind-up when both are on (see §4.3) |
| **Motion Style** | Named recipe of **phases** + **treatments** (see §4.1). Today partially hard-coded (Ken Burns, Family Portrait Zoom Reveal, Encore Bow; Shout on announcements). Future: glossary dropdown |

---

### 4.1 Motion phases (building blocks)

Every Motion Style is assembled from these phases, in this order when present:

```text
Wind-up → Punch-in → Hold → Punch-out → Wind-down
```

**Not every style uses every phase.** Omit missing phases; do not invent empty no-ops that still burn time (except an intentional **Hold**).

| Preferred name | Phase role | Also called |
|----------------|------------|-------------|
| **Wind-up** | First appearance of this **Animation Block** after the previous block’s **Wind-down** (or cold start) | Anticipation, intro, entrance, settle-in |
| **Punch-in** | Emphasis: List/Box highlight + visual settle (zoom-in, veil hole opens, etc.) | Focus-in, hit-in |
| **Hold** | Stand still while settled | Looper, dwell, linger, park, idle, sustain |
| **Punch-out** | De-emphasis: lose highlight + reverse visual so the next Punch-in can begin | Focus-out, hit-out |
| **Wind-down** | Last appearance of this **Animation Block** before the next **Presentation Segment** (or loop) starts | Outro, settle-out, recovery, exit |

#### Role vs treatment (critical)

| Concept | Meaning |
|---------|---------|
| **Phase role** | *When* something happens in the recipe (Wind-up vs Punch-in) |
| **Motion treatment** | *What* it looks like (shared CSS/JS motion) |

**Wind-up and Punch-in are not mutually exclusive.** A style may declare “Wind-up uses Punch-in treatment.” Same for **Wind-down** ↔ **Punch-out**.

That is the fix language for Ken Burns today: the Wind-up *role* exists at handoff, but the *treatment* should reuse Punch-in rather than invent a third motion (and currently that reuse is underbuilt).

---

### 4.2 Containers

| Preferred name | What it is |
|----------------|------------|
| **Motion Style** | Named recipe of phases + treatments (e.g. Ken Burns, Family Portrait Zoom Reveal, Encore Bow) |
| **Animation Block** | One complete run of a Motion Style — one FP overview, one Encore bow, one Slideshow item beat |
| **Presentation Segment** | Alpha Menu or one Box Menu’s full cue (multi-segment presentation). Contains many Animation Blocks |
| **Handoff** | Boundary between Animation Blocks or Presentation Segments: previous **Wind-down** → next **Wind-up** |
| **Presentation Step** | One tick of Presentation Speed (timer advance). May align 1:1 with an Animation Block or with a **Hold** |

Avoid calling an Animation Block a “beat” alone — that word collides with **Presentation Step**.

---

### 4.3 Recipe examples

#### Ken Burns (Slideshow item / Encore bow emphasis)

```text
Wind-up → Punch-in → Hold → Punch-out → Wind-down
```

| Phase | Used? | Treatment |
|-------|-------|-----------|
| **Wind-up** | Yes (first item after handoff) | **Reuse Punch-in** (intended; underbuilt today) |
| **Punch-in** | Yes (each step) | Highlight + zoom-in (hero Ken Burns or Encore hole + zoom) |
| **Hold** | Yes | Presentation Speed at settled zoom |
| **Punch-out** | Yes (between steps) | Lose highlight + zoom-out / fade |
| **Wind-down** | Yes (last step before next segment) | **Reuse Punch-out** |

#### Family Portrait (overview collage)

```text
Wind-up → Hold → Wind-down
```

| Phase | Used? | Treatment |
|-------|-------|-----------|
| **Wind-up** | Yes | Zoom Reveal (center intro / peak → 1×) |
| **Punch-in** | No (typical) | — |
| **Hold** | Yes | Full cast stands still (Presentation Speed; no separate Hold column today) |
| **Punch-out** | No (typical) | — |
| **Wind-down** | Yes | Reverse Zoom Reveal → next Animation Block |

#### Encore (bow cycle) — context-dependent Wind-up

Encore’s **Punch-in / Hold / Punch-out** are the bow (Spotlight Veil + zoom to Portrait Slot + highlight).  
**Wind-up depends on Family Portrait:**

| Family Portrait | Encore Wind-up (product intent) |
|-----------------|----------------------------------|
| **ON** + Encore | Encore **inherits** Family Portrait’s Wind-up seamlessly — FP Animation Block *composes* as Encore’s entry (lineup / Zoom Reveal). Context-aware blocking is desirable here. |
| **OFF** + Encore | Encore must use its **own** bespoke Wind-up (not yet built). Must **not** force Family Portrait on. |

| Phase | FP on | FP off (intent) |
|-------|-------|-----------------|
| **Wind-up** | Inherit FP Wind-up | Bespoke Encore Wind-up (TBD) |
| **Punch-in** | Veil + zoom to slot + highlight | Same |
| **Hold** | Presentation Speed on bow | Same |
| **Punch-out** | Undim + ease toward next bow | Same |
| **Wind-down** | Full Punch-out; may chain FP Wind-down if FP was entry; then next Presentation Segment | Punch-out → next Presentation Segment |

**Gap (honest):** With FP off, a dedicated Encore Wind-up treatment is missing. The fix is an Encore-only Wind-up treatment, not removing the good compose-when-both-on behavior.

---

### 4.4 Product rules (motion)

1. **Wind-up may reuse Punch-in treatment**; **Wind-down may reuse Punch-out treatment**.  
2. **Hold** is duration-only (Presentation Speed today). No separate accessible Hold column required yet; if one existed it would be seconds-to-hang.  
3. **Encore Wind-up is context-dependent** on Family Portrait (compose when both on; own Wind-up when FP off) — see §4.3.  
4. **Handoff** between Presentation Segments always ends the outgoing segment with Wind-down and starts the incoming with Wind-up (even if those roles share Punch-out / Punch-in treatments).  
5. Box Menu presentation uses the same phase vocabulary as Alpha; only the cast and highlight target change.

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

| Sheet concept                     | UI name                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| Image (item or box row)           | **Plate Image** filename (shown inside a **Plate** in Hero Panel or Portrait Slot) |
| Include (item)                    | Show on **Menu List**                                                              |
| Include (box item)                | Show in **Footer Box**; later may also gate presentation cycle                     |
| Family Portrait                   | **Family Portrait** toggle (may compose as Encore **Wind-up** when both on)        |
| Presentation Mode                 | **Presentation Mode**                                                              |
| Presentation Speed                | **Presentation Step** / default **Hold** duration                                  |
| BG Wallpaper                      | **Wallpaper** on **Background**                                                    |
| Include Protein/Sauces/Drinks Box | Show **Footer Box** N                                                              |
| Include in Presentation? (box)    | Box **Presentation Segment** opt-in                                                |
| Announcement columns              | **Announcement Panel** fields                                                      |
| Motion style (future)             | **Motion Style** (phases: Wind-up → Punch-in → Hold → Punch-out → Wind-down)       |

---

## 8. ASCII map (Boards 1–3)

```text
┌──────────────────────────────── Stage (1920×1080) ────────────────────────────────┐
│  Background (Background Plate + Wallpaper)                                        │
│  ┌──────── Frame ──────────────┐   ┌──────── photo side ─────────────────────┐   │
│  │ Header Band  Logo  Title    │   │ Disclaimer (allergy always shown)     │   │
│  │                             │   │ (Version Stamp lives in debug HUD)    │   │
│  ├─────────────────────────────┤   │                                         │   │
│  │ Menu Panel                  │   │         Hero Panel                      │   │
│  │   Menu List                 │   │            Plate (container)            │   │
│  │   (List Highlight)          │   │              image + New Sticker (child)│   │
│  │                             │   │   — or Family Portrait / Encore —       │   │
│  │ Footer Boxes                │   │   Portrait Slots (plate containers)     │   │
│  │                             │   │     + Spotlight Veil                    │   │
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
- [ ] DOM `#hero-plate` is the **Plate** container; `#hero` is the image child
- [ ] Align boss-facing sheet notes with this vocabulary
- [ ] Version Stamp language in sheets (no longer replaces disclaimer)

---

## 10. Changelog

| Date | Change |
|------|--------|
| 2026-08-11 | **Motion phases** §4.1–4.4: Wind-up, Punch-in, **Hold**, Punch-out, Wind-down; role vs treatment; Animation Block / Handoff / Presentation Segment; Ken Burns, Family Portrait, Encore recipes; Encore Wind-up context-dependent on Family Portrait |
| 2026-08-09 | v1 — Hero Panel, Plate, Frame, Menu List, Footer Boxes, Encore/Spotlight, Board 4 Announcement Panel |
| 2026-08 | Plate as container object (#hero-plate owns motion + shadow; sticker is child decoration). Portrait slots are plate units. Version Stamp moved to Toki Debug header (disclaimer always shows allergy). Full View debug HUD mode added. |

# Family Portrait lattice (grid) — how it works

**Last updated:** 2026-08-10  
**Code:** `buildPortraitLayout`, `fillPortraitPlates`, `renderFamilyPortrait` in `js/menu.js`  
**CSS:** `#family-portrait-stage` + `.family-portrait-slot` / `.family-portrait-item` in `css/menu.css`

This is the **single source of truth** for how multiple food photos are arranged on the photo side.  
**Multi-image menu items** (comma-separated `Image` cell) **must call the same layout function** and use the same slot DOM recipe. They ride the **hero plate** for motion (fade + Ken Burns), not the Family Portrait stage intro/settle path.

---

## 1. Coordinate system

Photo-side trapezoid from the board `#frame` SVG (Boards 1–3):

| Corner | Stage px |
|--------|----------|
| Top-left of cutout | `(1071.9, 0)` |
| Top-right | `(1920, 0)` |
| Bottom-right | `(1920, 1080)` |
| Bottom-left of cutout | `(1156.5, 1080)` |

Constants in JS:

| Name | Value | Role |
|------|------:|------|
| `PORTRAIT_CUTOUT_X0` | `1071.9` | Left edge of photo wedge at y=0 |
| `PORTRAIT_CUTOUT_SLOPE` | `0.078335` | `dx/dy` of the diagonal cutout |
| `PORTRAIT_STAGE_LEFT` | `1071.9` | Stage left in board space |
| `PORTRAIT_STAGE_W` | `~848.1` | `1920 − 1071.9` |
| `PORTRAIT_STAGE_H` | `1080` | Full stage height |
| `PORTRAIT_IMG_W` / `H` | `1500` / `1000` | Native plate bitmap size before scale |

Local cutout edge inside the stage at height `y`:

```text
portraitCutoutLocalX(y) = PORTRAIT_CUTOUT_SLOPE * clamp(y, 0, 1080)
```

Each **row** of the lattice only uses the width to the **right** of that edge (the visible wedge).

---

## 2. `buildPortraitLayout(n, stageW, stageH)`

**Always call with the default stage size for “same as Family Portrait”:**

```js
buildPortraitLayout(n)  // → stageW = PORTRAIT_STAGE_W, stageH = PORTRAIT_STAGE_H, cutout on
```

### 2.1 Choose cols × rows

- Score candidate grids for padded counts `n … n+3` (so e.g. 11 can become 3×4).
- Prefer few empties, aspect near the mid-wedge aspect, near-square balance.
- Penalize tall 1×n and wide n×1 strips when `n > 3`.
- Mild bias toward **more rows than cols** (taller layouts suit the wedge).
- **n = 2 → typically 1 col × 2 rows (vertical stack).**

### 2.2 Place slot centers

For each row `r`:

1. `y = padY + (r + 0.5) * cellH` (row center).
2. `xLeftEdge = portraitCutoutLocalX(y)` (diagonal bias).
3. Row width = `stageW − xLeftEdge`, with horizontal padding.
4. **Incomplete last row is centered** within the remaining columns.
5. Each slot: `{ x, y, row, col, zIndex }` — **center** of the plate (not top-left).

### 2.3 Uniform plate scale

- Cell size → scale so native `1500×1000` plates fill with slight **overlap** (density table by `n`).
- Extra dampen for large `n`; slight haircut for `n ≤ 2` / `n ≤ 3`.
- Clamp scale to `[0.2, 0.7]`.

Returns:

```js
{ slots, cols, rows, scale, stageW, stageH }
```

---

## 3. DOM recipe (shared)

| Element | Class | Role |
|---------|-------|------|
| Slot | `.family-portrait-slot` | `position:absolute; width:0; height:0;` at `(slot.x, slot.y)` |
| Image | `.family-portrait-item` | `1500×1000`, `transform: translate(-50%,-50%) scale(layout.scale)` |
| Optional | `.family-portrait-sticker` | New! badge on `isNew` plates |

**Do not invent a second grid.** Use `fillPortraitPlates(platesEl, portraitItems)` which:

1. Calls `buildPortraitLayout(n)` with FP defaults.
2. Appends the same slot/img structure as the overview collage.

---

## 4. Two consumers (same grid, different motion host)

| Consumer | Host | Motion |
|----------|------|--------|
| **Family Portrait overview / Encore** | `#family-portrait-stage` | Stage opacity, Encore zoom, spotlight veil |
| **Multi-image menu item** | `#hero-plate` → `.hero-multi-plates` | **Same as single hero:** plate opacity + Ken Burns `--hero-zoom` |

Multi-image container is offset so lattice coordinates match the FP stage in board space:

```text
hero-wrap left/top = (870, 133)
hero-multi-plates left/top = (PORTRAIT_STAGE_LEFT − 870, 0 − 133)
                           = (201.9, −133)
width/height = PORTRAIT_STAGE_W × PORTRAIT_STAGE_H
```

So a 2-image item stacks **exactly** like a 2-plate Family Portrait, but **fades and zooms with the hero plate** like every other slideshow item.

---

## 5. Sheet contract (Image column)

- One name: `SpamMusubi` or `SpamMusubi.png` (extension optional; runtime prefers `.webp`).
- Multiple: `PorkDumplings, KimchiDumplings` (comma or semicolon).
- Runtime: `parseImageCell` → `resolveImagePath` each token → `item.image` (primary) + `item.images` (array when ≥ 2).

---

## 6. Anti-patterns (do not reintroduce)

| Wrong | Why |
|-------|-----|
| Custom grid for multi-image | Breaks vertical n=2 / incomplete-row centering |
| Multi-image via `showFamilyPortrait` / center intro | Different animation than single heroes — not seamless |
| Horizontal pack for n=2 “to fit hero rect” | Not Family Portrait grid behavior |
| Leaving multi DOM on the plate after leaving the item | Corrupts later single-image heroes |

---

## 7. Overview highlight chrome (parked)

Family Portrait used to recolor the **Alpha header** (fill → Highlight, title/logo → Secondary) or a **Box shell** during the overview beat.

**Off by default.** Restore with `FP_OVERVIEW_HIGHLIGHT = true` in `js/menu.js` (next to `FP_ALPHA_OVERVIEW_HL`).

| Piece | Where |
|-------|--------|
| Master switch | `FP_OVERVIEW_HIGHLIGHT` |
| Alpha look | `FP_ALPHA_OVERVIEW_HL` (`"header"` or `"title"`) |
| Arm / fade | `armFpOverviewHighlight`, `fadeFpAlphaHeaderHighlight`, `fadeFpBoxShellHighlights` |
| CSS | `body.fp-alpha-header-hl`, `.info-box.fp-shell-hl`, `.drinks-box.fp-shell-hl` |

---

## 7. Related docs

- [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md) — Plate, Portrait Slot, Hero Panel
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Plate model
- [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) — revised Inventory / Image column

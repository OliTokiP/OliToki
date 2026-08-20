# Motion glossary — portable building blocks

**Status:** Source of truth for *what each Motion Style does on the live boards*.  
Menu Manager preview must implement **this document**, not a look-alike.

**Code:** `js/motion.js` (digits + hero + Encore punch-in/out) · `css/motion.css` (treatments) · `js/menu.js` (board clock / FP / chrome)  
**Names:** [UI_NOMENCLATURE.md §4](UI_NOMENCLATURE.md)  
**Clock intent:** [MOTION_REFACTOR.md](MOTION_REFACTOR.md)  
**Runtime mode:** [MOTION_QUARANTINE.md](MOTION_QUARANTINE.md) — live is `engine`

If this file and `menu.js` disagree, **fix the file or the engine — do not invent a third set of numbers.**

---

## 0. How to use this

You can say “make Encore” only if you implement **every row** in the Encore grid below.

| Do | Do not |
|----|--------|
| Call `TOKI_MOTION.heroPunchIn` / `heroPunchOut` (js/motion.js) | Write a second plate runner for Menu Manager |
| Scale **pixel sizes** (hole px, pinch px, shadow px) to the form factor | Invent a second veil gradient |
| Drive highlight **color** on Punch-Out’s clock | Fade list text opacity |
| Keep hole pinched on Punch-Out (`ENCORE_HOLE_PINCH_OUT = false`) | Unpinch on the way out |
| Reset pinch to 0 only while the veil is **undimmed**, then shrink with Punch-In | Pinch while the veil is already down (visible jump) |

**Form-factor scale (sizes only):**

```text
s = previewHoleR / 160          // live default --encore-hole-r
pinchPx = 40 * s                // ENCORE_HOLE_PINCH_PX
shadow = (18, 22, 2, 0.5) * (previewW / 1920)
```

Zoom *factors* stay relative: Ken Burns `0.93 → 1`, Encore camera `1 → 1.24`.

---

## 1. Shared clock (all styles)

Phases, in order:

```text
Wind-up → Punch-in → Hold → Punch-out → Wind-down
```

| Token | Default (s) | Role |
|-------|-------------|------|
| Wind-up | `0` | First block of a segment only; if `0`, Punch-In is the entrance |
| Punch-in | `3.4` | Camera / zoom / veil-in / hero in |
| Hold | `1` | Hang at settled pose. Same for Slideshow, Ken Burns, and Encore |
| Punch-out | `0.45` | Camera back, veil-out, hero out, highlight color reverse |
| Wind-down | `0` | Last block of a segment only; if `0`, Punch-Out is the exit |
| Opacity fade | `min(0.45, phase)` | Plate / stage opacity. **Never** use the full 3.4s for opacity |
| Highlight color | **Punch-Out duration** (`0.45s`) | `--motion-highlight`. In *and* out. Not Punch-In. |

**Eases** (`css/menu.css`):

| Name | Bezier | Use |
|------|--------|-----|
| `--ease-fade` | `cubic-bezier(0.4, 0, 0.2, 1)` | Opacity, highlight color, Punch-Out camera |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Punch-In camera / zoom settle |

**Presentation Speed (Style I3, tiles 0–5):** not seconds. Tempo key on the **shared** Punch/Hold/Out clock (`TOKI_MOTION.presentationTempo` × Slideshow digits). `0` = parked. `3` = medium = 1×. Each step is a half-stop (`×√2`): 1 crawl 2×, 2 slow √2×, 4 fast 1/√2×, 5 very fast ½×. Slideshow, Ken Burns, and Encore use the same phase seconds so one slide is the same length at a given speed. Encore treatments (lattice, veil, pinch) still ride that clock.

Engine sequence today (`motionEngineRunBlock`):

```text
clock       = Slideshow (or Ken Burns) Punch/Hold/Out     // 3.4 / 1 / 0.45
entranceSec = windUp > 0 && first ? windUp : punchIn      // 3.4
holdSec     = hold                                        // 1
exitSec     = windDown > 0 && last ? windDown : punchOut  // 0.45
run entrance → run hold → run exit → next block
```

---

## 2. Highlight (list / numbers / title)

Live list items are **color only**. No opacity on the text.

| State | Color | How |
|-------|-------|-----|
| Idle | `--secondary-color` (white on the black Menu Panel) | `.menu-item` |
| Active, not New | `--highlight` (theme Highlight) | `.active` + `--item-highlight` |
| Active, New | `--highlight-special` (theme Special, usually `#FFF900`) | same, `--item-highlight` set to Special |
| Title (FP overview) | `--main-color` idle → Highlight when active | **never** Special |

**Clock:** `--motion-highlight` = Punch-Out seconds (`engineArmHighlightIn(style.punchOut)`).

**Punch-In:** set `--item-highlight`, add `.active`. Color eases idle → highlight over `0.45s`.  
**Punch-Out:** drop `.active`. Color eases highlight → idle over `0.45s`. Then clear `--item-highlight`.

Preview numbers **are** the Menu List. Same rules. Same clock. Same ease.

### Common errors

- Using Special on every active number.
- Snapping color with no `transition`.
- Timing the fade to Punch-In (`3.4s`) — that was a live bug; do not repeat.
- Fading number **opacity**.

---

## 3. Slideshow

| Piece | Behavior | Math / token |
|-------|----------|--------------|
| Plate opacity in | 0 → 1 | `min(0.45, punchIn)` s, `--ease-fade` |
| Plate opacity out | 1 → 0 | `min(0.45, punchOut)` s, `--ease-fade` |
| Zoom | **None** | `--hero-zoom` stays `1` |
| Highlight | §2 | Punch-Out clock |
| Image | `#hero` inside `.hero-anim` | `object-fit: fill` on live 3:2 |

Hero Ken Burns class is **not** applied.

---

## 4. Ken Burns

Same as Slideshow **plus** scale on `.hero-anim` only (sticker is a plate sibling — fades, does not zoom).

| Piece | Behavior | Math / token |
|-------|----------|--------------|
| Park before in | Opacity 0, zoom `zoomMin` | `0.93` |
| Punch-In zoom | `0.93 → 1` | `punchIn` `3.4s` `--ease-out` (`.is-kb-in`) |
| Punch-In opacity | 0 → 1 | `0.45s` `--ease-fade` (parallel, not 3.4s) |
| Hold | Stay at `1` | `hold` `1s` |
| Punch-Out zoom | `1 → 0.93` | `punchOut` `0.45s` `--ease-fade` |
| Punch-Out opacity | 1 → 0 | `0.45s` `--ease-fade` |

Drop-shadow lives on `.hero-anim`: `drop-shadow(0 14px 32px rgba(0,0,0,0.4))` (live px; scale if the plate is tiny).

### Common errors

- Scaling `3.4 / 1 / 0.45` by `0.7` “because the preview is small.”
- Putting the sticker inside `.hero-anim` (it will zoom).
- Using one duration for both opacity and zoom.

---

## 5. Encore (rebuild from this grid)

Encore is **not** Ken Burns with a hole on a single hero. It is a **scaffolded photo plane**.

### 5.0 Photo grid (required — do not skip)

Encore **reuses Family Portrait’s lattice**. One function: `buildPortraitLayout` (`js/portrait-lattice.js` / `js/menu.js`). Spec: [FAMILY_PORTRAIT_LATTICE.md](FAMILY_PORTRAIT_LATTICE.md).

| Step | What happens |
|------|----------------|
| 1. Draw a plane | Photo wedge `848.1 × 1080` (stage-local). Diagonal cutout on the left (`slope 0.078335`). |
| 2. Divide the plane | Score cols×rows for `n … n+3`. Prefer near-square, few empties, taller than wide. |
| 3. Place images | Each plate sits at a **slot center** — the intersection of its cell (not a tile fill). Native bitmap `1500×1000`, `translate(-50%,-50%) scale(layout.scale)`. |
| 4. Camera | The **whole scaffold** (`.family-portrait-rig`) scales (`--encore-zoom` `1 → 1.24`). Origin = the **active slot’s lattice point**. That is the “zoom in on one item.” |
| 5. Veil | Hole is painted at that same lattice point. |
| 6. Background | Encore **overrides** Style wallpaper/pattern with Encore Background (solid). Live: `encore-scaffold-bg` / solid plate. |

**Manager preview:** build this same 848×1080 world, then **scale the world** into the mini photo wedge. Do not invent a second one-photo Encore.

---

Encore is **not** Ken Burns with a hole. It is a **stage + rig + veil** over that lattice.

### 5.1 Nodes (live names)

| Node | Role |
|------|------|
| `#family-portrait-stage` | Stage. Opacity of the *grid*. `--encore-veil-color` lives here |
| `.family-portrait-rig` | Camera. `transform: scale(var(--encore-zoom))` origin = hole |
| `.family-portrait-veil` | House lights **in front** of plates. Hole is a radial-gradient |
| Plates / hero | Children of the rig so they ride the camera |

Preview must have the same three layers (stage / rig / veil), even if the “cast” is one hero.

**Default:** veil is a **sibling of the rig** (stage child). Hole x/y still use `--encore-hole-x/y` (the camera origin), so the lattice point stays under the aperture without stacking `scale(--encore-zoom)` on the veil layer. Hole **radius** is painted as `(holeR − pinch) × zoom` (`--encore-hole-paint-r`). The veil layer itself does not transform. **`?encore=old`:** veil is a **child of the rig**, so the hole inherits camera scale (aperture grows with Punch-In after pinch settles).

### 5.2 Spotlight chrome (`applyEncoreSpotlightChrome`)

| Spotlight Color | Veil fill |
|-----------------|-----------|
| **Black** | `#000000` always. **New does not override.** |
| **Highlight** | New → `--highlight-special`. Else → `--highlight` |

| Spotlight Type | Treatment |
|----------------|-----------|
| **Hard** | Crisp circle, `mix-blend-mode: normal`, dim opacity `1` |
| **Hard (with shadow)** | Hard + `filter: var(--veil-shadow-filter)` = `drop-shadow(18px 22px 2px rgba(0,0,0,0.5))` on the **veil** (blur 2 — 6px lip was too costly on Fire Stick) |
| **Soft** | Wide falloff gradient, multiply (unless Highlight color → normal), dim opacity `0.88` / `0.9` |

Veil box: `inset: calc(-1 * var(--veil-extend, 20px))`. Hole paint is offset by the same extend so stage-space hole x/y do not move. Default `20px`. **Detached default:** `--veil-extend` grows to hole overhang + Hard Shadow pad (`max(18,22)+2`) so a near-edge circle still has opaque surface; clip-path moves to the rig so the veil can hang past the wedge; `#family-portrait-stage` drops to `z-index: 1` so that hang tucks **behind** `#frame`. A CSS stroke/border cannot do this (rectangle around the box; the hole is a radial-gradient).

Hard hole (live CSS — do not rewrite):

```css
radial-gradient(
  circle max(40px, calc(var(--encore-hole-r, 160px) - var(--encore-hole-pinch, 0px)))
    at var(--veil-hole-x) var(--veil-hole-y),
  rgba(0,0,0,0) 0%,
  rgba(0,0,0,0) 99%,
  var(--encore-veil-color, #000) 100%
);
```

### 5.3 Camera + pinch

| Token | Live | Notes |
|-------|------|--------|
| `--encore-zoom` | `1` rest, `1.24` punch (`--encore-zoom-to`) | Relative — keep |
| `--encore-hole-pinch` | `0` → `40px` on Punch-In | Same `--ease-out` as zoom, duration `punchIn × 0.5` (`1.7s`). Hole settles; zoom finishes in the tight aperture. `ENCORE.pinchInMult = 1` locks pinch to the full camera clock (Pass 1). Scale px: `40 * (holeR / 160)` |
| `--encore-hole-r` | `max(70, plateW × 0.42 × crowdBoost)` | `plateW = 1500 × layout.scale`. `crowdBoost` is 1 at n≤5 (Handhelds), 1.25 at n≥15 (Munchies), lerp between. 160 is only a CSS fallback. Preview uses this same formula. New stickers live on a **second lattice** (`.family-portrait-sticker-rig`) above the veil. The rig is camera-only (`scale(--encore-zoom)`); **badge** opacity uses the same `is-dimmed` + `--motion-veil` rule as `.family-portrait-veil` (active slot only). Sticker scale is `photoScale × 0.9 × crowdBoost × rowBoost` — rowBoost 1.5 at ≤2 rows (Handhelds +50%), 1.75 at ≥4 rows (Munchies +75%). Right-edge badges that would clip the stage sit on the top-left of the hole. |
| `ENCORE_HOLE_PINCH_OUT` | `false` | Punch-Out **keeps** pinch |
| Veil fade-in | `punchIn * 0.5` = **1.7s** | `--motion-veil` |
| Veil fade-out | full Punch-Out **0.45s** | multiplier is **in only** |
| Stage opacity (Wind-up only) | `min(0.45, entrance)` | Mid-run Punch-In does **not** fade the grid |

### 5.4 First block (Wind-up, FP off)

1. Snap zoom `1`, pinch `0`, veil undimmed, stage opacity `0`.  
2. Set hole origin. Apply spotlight chrome.  
3. Transition: stage opacity `0.45s` ease-fade; rig zoom `1 → 1.24` in `entranceSec` (`3.4s`) ease-out; pinch `0 → pinchPx` in `entranceSec × 0.5` (`1.7s`) ease-out (same bezier, half the clock); veil dim in `1.7s`.  
4. Arm highlight on Punch-Out clock.  
5. Wait `3.4s`.

### 5.5 Mid-run Punch-In

Grid already visible (opacity 1). Previous Punch-Out left zoom ≈ 1, veil undimmed, hole still pinched.

1. **Snap pinch to 0 while veil is undimmed** (invisible reset).  
2. Retarget hole origin at ~1×.  
3. Punch: zoom `1 → 1.24` in `3.4s` ease-out; pinch `0 → pinchPx` in `1.7s` ease-out (half clock); veil dim in `1.7s`. **No** grid opacity fade.  
4. Arm highlight. Wait `3.4s`.

### 5.6 Punch-Out (not last)

1. Highlight color reverse (`0.45s`).  
2. Veil undim in `0.45s`.  
3. Zoom `1.24 → 1` in `0.45s` ease-fade.  
4. **Pinch stays.** Grid opacity stays `1`.

### 5.7 Wind-down (last of segment)

Punch-Out **plus** stage opacity `1 → 0` in `0.45s`. Then hide.

### 5.8 Common errors (Encore)

| Error | Why it looks “off” |
|-------|-------------------|
| Custom 2-stop gradient instead of live `0% / 99% / 100%` Hard | Soft edge, wrong size |
| Veil behind the food | Hole does not crop the plate |
| Pinch locked to the full Punch-In zoom clock (`3.4s`) | Hole still shrinking while the food should be settling into a tight aperture |
| Unpinching on Punch-Out | Hole breathes on the way out |
| Resetting pinch while veil is dimmed | Visible snap |
| Special veil color when Spotlight = Black | Yellow house lights on a Black bow |
| Scaling `3.4s` down for the mini preview | “Pinch times are off” |
| One rectangle rail + one rectangle logo | Not the live Frame / not the PDF trapezoid |

---

## 6. Family Portrait (overview)

Not in the Manager trio, but part of Encore’s world:

- Wind-up: grid opacity in at **1×**, **no veil**.  
- Hold: Presentation Speed.  
- Exit into Encore (same segment): **keep grid**; first bow is Punch-In (compose).  
- Exit into Slideshow / Ken Burns: grid opacity out, then hero blocks.

---

## 7. Porting checklist (Manager preview)

When adding or fixing a preview style:

1. Open **this file**, find the style.  
2. Call `window.TOKI_MOTION.heroPunchIn` / `heroPunchOut` (`js/motion.js`). Do not reimplement.  
3. Reuse live CSS treatments (same custom properties, same gradient).  
4. Scale **px** only.  
5. Screenshot and compare: highlight color, veil fill, hole radius, pinch duration, opacity vs zoom clocks.

**1920×1080 grid:** live `#stage`. Mini preview is a **scaled crop** of that world (PDF 400×300 composition fitted into `--top-slot-h`), not a second design system.

**Preview stage (400×300, `--u = slot-h / 300`):** divide the panel into **4 columns × 3 rows**. The green tile is column 3, row 2 (1-based). Plate center and Encore hole origin are that cell’s center: `(2.5/4, 1.5/3)` → `(250, 150)` × `--u`. Plate is a 3:2 box **3 cells × 2 cells**. Encore shroud clip is the photo trapezoid (frame complement): `(103.332, 0)`, `(100%, 0)`, `(100%, 100%)`, `(120.793, 100%)` × `--u` on the x’s. Do not invent a second rectangle for the veil.

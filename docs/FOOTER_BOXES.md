# Footer boxes — exact geometry (Boards 1–3)

Stage: **1920 × 1080**. All values are stage CSS pixels.  
Source of truth for footer strip layout. Shell chrome and packing live in `css/menu.css` / `js/menu.js`.

**Scope today:** left-panel boards (Bowls / Handhelds / Munchies).  
**Out of scope for now:** Board 4 (Drinks & Deals) — no protein/sauces/soda strip there yet.

---

## 1. Shared constants (every footer box)

| Property | Value | Notes |
|----------|-------|--------|
| Strip origin | **left 38**, **top 863** | Mockup-measured |
| Strip size | **1082 × 197** | Right edge = 1120 (`38 + 1082`) |
| Box height | **197px** | Always, 1 / 2 / 3 boxes |
| Header band height | **64px** | White title bar (SVG + CSS flex) |
| Body height | **133px** | `197 − 64`; black/colored fill |
| Shell side/bottom inset | **4px** | Outer shell vs body rect |
| Body SVG rect | `x=4, y=64, width=W−8, height=129` | 129 + 4 bottom = 133 content band |
| Gap between adjacent boxes | **15px** | Exact; never scale with content |
| List height when any footer on | **620px** | Shortens menu list above strip |

### Shell structure (width `W`, height always 197)

```svg
<svg class="info-box-shell" viewBox="0 0 W 197" preserveAspectRatio="none">
  <rect class="shell-outer" width="W" height="197" />
  <rect class="shell-body" x="4" y="64" width="W-8" height="129" />
</svg>
```

| Region | Height | Typical content |
|--------|--------|-----------------|
| Header | **64px** | Title (~48px) + optional subtitle (~36px) |
| Body | **133px** | Items (columns or balanced wrap); type scales via `--box-scale` |

---

## 2. One box enabled

The single visible box **fills the entire strip**.

| | Value |
|--|--------|
| Width | **1082px** |
| Height | **197px** |
| Position | `left: 38px; top: 863px` |
| Gaps | none |

Applies whether that box is Protein, Sauces, or Soda (when only one include flag is on).

---

## 3. Two boxes enabled — left-heavy (by design)

**Not** exact mathematical thirds. The left box is larger; the right is smaller than a pure ⅓ of the strip. These numbers are from the handhelds mockup and are intentional.

| Box (order left → right) | Width | Height | `left` | Right edge |
|--------------------------|-------|--------|--------|------------|
| First (priority / “major”) | **768px** | 197 | **38** | 806 |
| Gap | **15px** | — | 806 → 821 | — |
| Second (minor) | **299px** | 197 | **821** | 1120 |

Check: `768 + 15 + 299 = 1082`.

| Ratio (for intuition only) | |
|----------------------------|--|
| Major / strip | 768 / 1082 ≈ **71.0%** |
| Minor / strip | 299 / 1082 ≈ **27.6%** |
| Gap / strip | 15 / 1082 ≈ **1.4%** |

**Do not** replace 768 / 299 with `calc(2/3)` / `calc(1/3)` of 1082 — that would change the product look.

### Live mapping (today)

| Include | Layout |
|---------|--------|
| Protein + Sauces | Protein **768** @ 38, Sauces **299** @ 821 |
| Protein only / Sauces only | That box → **1082** @ 38 (see §2) |

### Two-box pairing rule (when three box types exist)

When exactly **two** of {Protein, Sauces, Soda} are on, order is left → right by fixed priority:

1. Protein (if on)  
2. Sauces (if on)  
3. Soda (if on)  

The **leftmost** of the two gets **768**; the **rightmost** gets **299**.

Examples:

| Enabled | Left (768) | Right (299) |
|---------|------------|-------------|
| Protein + Sauces | Protein | Sauces |
| Protein + Soda | Protein | Soda |
| Sauces + Soda | Sauces | Soda |

---

## 4. Three boxes enabled — even thirds

When **all three** are on, do **not** preserve the two-box left-heavy split. Equal widths look cleaner.

| | Value |
|--|--------|
| Gaps | **15px** between box 1–2 and 2–3 (two gaps) |
| Width equation | `3W + 2×15 = 1082` → `3W = 1052` → **W = 1052 / 3** |

### Exact equal width

| Each box | **350⅔ px** wide × **197** tall |

(Browsers may subpixel-round; prefer flex equal columns — see below.)

### Integer pixel split (optional)

`1052` is not divisible by 3. Remainder **2px** can sit on the left boxes:

| Box | Width | `left` |
|-----|-------|--------|
| 1 (Protein) | **351** | 38 |
| gap | 15 | — |
| 2 (Sauces) | **351** | 404 |
| gap | 15 | — |
| 3 (Soda) | **350** | 770 |

Check: `351 + 15 + 351 + 15 + 350 = 1082`.

### Preferred implementation

Avoid hardcoding `350.666px`. Use a flex strip:

```css
/* conceptual */
.footer-boxes.footer-three {
  /* positioned strip: 38, 863, 1082×197 */
  display: flex;
  flex-direction: row;
  gap: 15px;
  width: 1082px;
  height: 197px;
}
.footer-boxes.footer-three .info-box {
  flex: 1 1 0;
  min-width: 0;
  height: 197px;
  /* left/top absolute overrides off when in flex mode */
}
```

Each child is equal width in the layout model; any 1px remainder is fine.

---

## 5. Summary table

| Mode | Count | Widths (left → right) | Gaps | Height | Header |
|------|-------|------------------------|------|--------|--------|
| One | 1 | **1082** | — | 197 | 64 |
| Two | 2 | **768** · **299** | 15 | 197 | 64 |
| Three | 3 | **equal thirds** of 1052 (≈350⅔ each) | 15 · 15 | 197 | 64 |

Strip always: **38, 863, 1082×197**.

---

## 6. Product names (near-term)

| Role | Sheet / UI name (current → near-term) | Footer slot |
|------|----------------------------------------|-------------|
| Box 1 | Protein | Major when two; slot 1 of three |
| Box 2 | Sauces | Minor when two; slot 2 of three |
| Box 3 | **Soda** (e.g. “Include soda box?” on Handhelds) | Slot 3 of three; minor if only paired with one other |

Content for Soda may reuse the Drinks content sheet or a dedicated tab later — **geometry only** is fixed here.

### Near-term build focus

1. Document geometry ← **this file**  
2. Board **Handhelds (index2)** only: sheet column **Include soda box?** + render third footer box when on  
3. **Not yet:** Board 4 layout; protein/sauces on Board 4; full generic Box 1/2/3 rename across all boards  

---

## 7. CSS class map (suggested)

| Situation | Body / strip class (illustrative) |
|-----------|-----------------------------------|
| None | `footer-none` |
| One box | `footer-one` (+ which id visible) |
| Protein + Sauces only | `footer-both` (legacy) or `footer-two` |
| Any two including soda | `footer-two` + order classes |
| All three | `footer-three` |

Legacy classes `footer-protein-only`, `footer-sauces-only`, `footer-both` remain until soda lands and can be generalized.

---

## 8. Related docs

- [STYLE_GUIDE.md](./STYLE_GUIDE.md) — full stage, frame, sticker, theme  
- [DATA_MODEL.md](./DATA_MODEL.md) — sheet columns / include flags  
- Live CSS: `#protein-box`, `#sauces-box`, `#footer-boxes` in `css/menu.css`

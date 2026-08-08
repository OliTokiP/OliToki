# TokiMenu — Style Guide

**Stage:** 1920 × 1080 px (fixed). All measurements below are stage pixels unless noted.  
**Fonts:** Roboto 400/700/900; Roboto Condensed 300/700 (disclaimers, some box body type).  
**Primary references:** `mockups/`, live `css/menu.css`, inline SVG in `index*.html`, verification shots in `screenshots/footer-verify.png` etc.

This guide is the **layout contract**. Code may reorganize; these numbers and rules should not drift without an intentional design change.

---

## 1. Layer stack (z-order)

| Z | Layer | Notes |
|---|--------|--------|
| 1 | `#galaxy` | BG color plate + optional scrolling image(s) |
| 2 | `#frame` | Vector header + panel polygons |
| 2 | `#stripes` | Board 4 only; clipped to black panel |
| 3 | `#logo` | Vector mascot |
| 4 | Title, disclaimer, menu list, footer/drinks boxes | Content |
| 5 | `#hero-wrap` / `#hero` | Food photo |
| 6 | `#new-sticker` | Shadow + body + “New!” label |

---

## 2. Theme tokens (CSS variables)

Set from the **Style** sheet (see DATA_MODEL). Defaults:

| Token | Default | Role |
|-------|---------|------|
| `--main-color` | `#000000` | Panel fill, logo stroke, box header text, primary ink on secondary |
| `--secondary-color` | `#ffffff` | Header fill, menu item text, box outer shell |
| `--highlight` | `#26bbcb` | Active menu item / drink highlight |
| `--highlight-special` | `#fff900` | “New” sticker hue plate |
| `--stripe-1` / `--stripe-2` | main / secondary | Board 4 pinstripes |
| `--announcement-bg` | main | Announcement body fill |
| `--header-h` | `234px` | White header band height |
| `--panel-right` | `1114px` | Boards 1–3 content panel width (left shell) |
| `--stage-w` / `--stage-h` | 1920 / 1080 | Stage size |
| `--menu-scale` | dynamic | List type fit (JS) |
| `--box-scale` | dynamic | Footer / box body type fit (JS) |

Box-specific fills (JS → CSS):

- `--protein-box-bg`, `--protein-box-text` (legacy Box 1)
- `--sauces-box-bg`, `--sauces-box-text` (legacy Box 2)
- `--drink-box-bg` (legacy Box 3 body)

**Target:** generic `--box-N-bg` / `--box-N-text` for N ∈ {1,2,3}.

---

## 3. Frame geometry (vector)

### Boards 1–3 (panel on the left)

Diagonal cut calibrated from `assets/frame.png` @ 1920×1080:

```
edge of opaque frame:  x = 1071.925 + 0.078335 * y
header / panel split:  y = 234
```

SVG polygons (`index.html`):

```svg
<!-- Header (Secondary fill) -->
<polygon class="frame-header" points="0,0 1071.9,0 1090.3,234 0,234" />
<!-- Panel (Main fill) -->
<polygon class="frame-panel" points="0,234 1090.3,234 1156.5,1080 0,1080" />
```

### Board 4 (mirrored — panel on the right)

`x' = 1920 − x`:

```svg
<polygon class="frame-header" points="1920,0 848.1,0 829.7,234 1920,234" />
<polygon class="frame-panel" points="1920,234 829.7,234 763.5,1080 1920,1080" />
```

CSS: `--drinks-panel-left: 830px` (approx left edge of right panel content).

Stripes clip-path matches the black panel:

```css
clip-path: polygon(
  1920px 234px,
  829.7px 234px,
  763.5px 1080px,
  1920px 1080px
);
```

---

## 4. Chrome placements (Boards 1–3)

| Element | Position / size | Notes |
|---------|-----------------|--------|
| Logo | `left: 758px; top: 16px; 156×202` | Stroke/eyes = Main |
| Menu title | `left: 140px; top: 18px; width: 600px; height: header−28` | Font ~104px, weight 700, Main on Secondary header |
| Disclaimer | `top: 18px; right: 28px; max-width: 720px` | Roboto Condensed 300, 16px; color by contrast on BG |
| Menu list | `top: 234; left: 0; width: 1114; height: fills panel` | Padding ~28 / 16 / 20; shortens when footer on |
| Hero wrap | `left: 870; top: 133; 1305×870` | Photos authored 1500×1000 (3:2) |
| New sticker | `right: -52; bottom: -74; 560×560; rotate -12°` | See §7 |

List height when **any** footer box shown: **620px** (with reduced bottom padding).  
List height when **no** footer boxes: full panel `1080 − 234`.

### Menu list typography

| Layout | Name size base | Desc / sub |
|--------|----------------|------------|
| bowls / handhelds | `40px * --menu-scale` | desc `22px * scale` |
| munchies | `38px * --menu-scale` | prices/subs `0.712em` of name |

Auto **2-column** bake-off (JS): try when ≥7 items / always ≥10 / or 1-col scale &lt; 0.78; keep 2-col only if scale ≥ 1.06× better. Column-major grid; gutter ~36–40px × scale.

---

## 5. Footer info boxes (Boards 1–3) — **live** geometry

Measured from Handhelds mockup @ 1920:

| Box (legacy) | Origin (L,T) | Size W×H | Role today |
|--------------|--------------|----------|------------|
| Protein | 38, 863 | **768 × 197** | Left footer (~2/3 of strip) |
| Sauces | 821, 863 | **299 × 197** | Right footer (~1/3 of strip) |
| Combined strip | 38 → 1120 | **1082 × 197** | Full width when only one box enabled |

**Gap between boxes:** 821 − (38 + 768) = **15px**.

### Shell construction (all info boxes)

ViewBox scales with box width; structure is constant:

```svg
<svg class="info-box-shell" viewBox="0 0 W 197" preserveAspectRatio="none">
  <!-- Outer = Secondary (white header + 4px border look) -->
  <rect class="shell-outer" width="W" height="197" />
  <!-- Body = box color / Main; inset 4px sides, header band 64px -->
  <rect class="shell-body" x="4" y="64" width="W-8" height="129" />
</svg>
```

| Region | Height | Content |
|--------|--------|---------|
| Header band | **64px** | Title (~48px) + subtitle (~36px, ~75% of title) |
| Body | remaining (~133px content with padding) | Items: columns grid **or** balanced wrap |

Header padding: `8px 18px 0` (sauces slightly tighter `14px` horizontal).  
Body padding (wrap): ~`12px 18px 14px`; columns mode slightly tighter.

### Live include → CSS body classes

| Protein | Sauces | Class on `<body>` | Layout |
|---------|--------|-------------------|--------|
| on | on | `footer-both` | 768 + 299 at mockup positions |
| on | off | `footer-protein-only` | Protein expands to **1082×197** at L38 |
| off | on | `footer-sauces-only` | Sauces expands to **1082×197** at L38 |
| off | off | `footer-none` | Footer hidden; list full height |

---

## 6. Footer boxes 1 / 2 / 3 — width rules

**Canonical pixel sizes:** [FOOTER_BOXES.md](./FOOTER_BOXES.md) (heights, header 64px, 1/2/3-box widths).

```
Strip:  left 38, top 863, 1082×197
Gap:    15px between adjacent boxes
Header: 64px | Body: 133px | Total height: 197px
```

| Enabled | Widths (left → right) | Notes |
|---------|------------------------|--------|
| **One** | **1082** | Full strip |
| **Two** | **768** · **299** | Left-heavy **by design** (mockup); not pure ⅓ |
| **Three** | **Even thirds** of 1052 (≈350⅔ each) | Do **not** keep 768/299; equal looks cleaner |

Two-box order: Protein → Sauces → Soda (leftmost of the pair gets 768).  
Near-term: Handhelds **Include soda box?** only; Board 4 unchanged.

### Board 4 multi-box (target — later)

Today Board 4 has a fixed stack:

| Box | Origin | Size |
|-----|--------|------|
| Announcement | 912, 290 | **976 × 452** |
| Drink options | 912, 780 | **976 × 250** |

Announcement stays special (not one of Box 1–3).  
**Target:** the drink-options region becomes a **horizontal strip of enabled Box 1–3** under the announcement, using the same 1 / 2⁄3–1⁄3 / thirds rules across width **976**, top **780**, height **250** (or equal-height vertical stack only if the taper fights horizontal chrome — document any exception in code).

Shell for drinks-sized boxes uses the same 64px header band pattern:

```svg
<svg viewBox="0 0 976 250" preserveAspectRatio="none">
  <rect class="shell-outer" width="976" height="250" />
  <rect class="shell-body" x="4" y="64" width="968" height="182" />
</svg>
```

Announcement shell:

```svg
<svg viewBox="0 0 976 452" preserveAspectRatio="none">
  <rect class="shell-outer" width="976" height="452" />
  <rect class="shell-body-announcement" x="4" y="64" width="968" height="384" />
</svg>
```

---

## 7. Box body layout modes

Controlled by sheet columns **Create Columns?** and **Text Align**.

### Create Columns? = Yes → `.layout-columns`

- CSS grid, 1–4 columns; JS bake-off picks column count + `--box-scale` so type fills the body without overflow.
- Protein legacy default: **Yes**, text align **right**, base type ~34px × scale.
- Items may show **name + price** (Box 1 / proteins).

### Create Columns? = No → `.layout-wrap`

- Flex wrap with **balanced rows** (character/pixel budgeting so rows look even — reference `screenshots/footer-verify.png` / sauces packing).
- Sauces / drinks legacy default: **No**, align **center**, Condensed weight for sauces.
- Separators between items (· or thin rules); force-breaks for manual line control when present in data.

### Text Align

`Left` | `Center` | `Right` → classes `.align-left` | `.align-center` | `.align-right` on the body.

### Defaults (legacy → target)

| Content | createColumns default | textAlign default |
|---------|----------------------|-------------------|
| Box 1 (was Protein) | true | right |
| Box 2 (was Sauces) | false | center |
| Box 3 (was Drinks) | false | center |

---

## 8. Logo (vector snippet)

ViewBox `0 0 146.7 193.9`. Stroke/eyes use Main:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 146.7 193.9"
     width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
  <path class="logo-outline"
    d="M124.5,61.3s3.2-6.5,14.6-20.7c0,0,11.8-11-2.5-22.2,0,0-8.8-9.6-20.5-2.6,0,0-33.6,18.4-34.2,56.4,0,0-14.1-8.7-32.8,2.1,0,0-4.4-14.6,12.8-42.4,0,0,11.4-13.7-2.5-24.4,0,0-12.3-12.7-28.3,4.7,0,0-18.2,17.4-22.3,43.3,0,0-4.3,31.7,6.1,47.4,0,0-19.8,17.9-8.3,51.5,11.5,33.6,59.7,36.5,59.7,36.5,0,0,45.5,2.6,67.2-32.6,21.1-34.1-15.7-69.2-15.7-69.2-2.1-13.8,7.5-29.1,7.5-29.1"/>
  <circle class="logo-eye" cx="100.8" cy="136.6" r="7"/>
  <circle class="logo-eye" cx="44.3" cy="136.6" r="7"/>
</svg>
```

```css
.logo-outline {
  fill: none;
  stroke: var(--main-color);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 6px;
}
.logo-eye { fill: var(--main-color); }
```

Board 4 logo: `right: 36px; top: 12px; 148×192` (mirror placement).

---

## 9. New sticker

Assets: `assets/Sticker-Shadow.png`, `assets/Sticker-Body.png` (1024² with padding).

| Property | Value |
|----------|--------|
| Display size | 560×560 |
| Board rotation | −12° |
| Label | “New!” Roboto Black 900, white |
| Label font-size | `0.25714em` of wrapper (~144px at 560) |
| Label position | 48.05% × 54.1% of sticker, extra rotate −7.25°, `translateX(12px)` |
| Hue tint | `mix-blend-mode: hue` with `--highlight-special`, masked to body PNG |

Fade in lockstep with hero (`opacity` 0.45s).

---

## 10. Board 4 extras

### Title

`left: 912px; width: 780px; height: 234; font-size: 96px; nowrap`.

### Stripes

- Band width **93px**, period **186px** (black+white).
- Angle: PS 38.5° from vertical → CSS `rotate(-51.5deg)` on horizontal bands.
- Speed: ~75% of galaxy scroll factor; animation duration driven by BG scroll config.
- `Include Stripes` = 0 → hide completely (`.stripes-off`).

### Hero (drinks)

Left side over galaxy (mirrored composition vs boards 1–3). Slideshow may include overview image + individual drink images.

---

## 11. Background FX

Always paint **BG Color** on `#galaxy`. Optional image layer:

| Control | Range / notes |
|---------|----------------|
| BG Image | path under `assets/bgs/` or null = solid only |
| BG Blur | 0–1 → 0–40px CSS blur |
| BG Blend Mode | normal, overlay, lighten, color-burn, soft-light, luminosity |
| BG Opacity | 0–1 (image only) |
| BG Scroll Speed | multiplies base ~28 px/s dual-layer scroll; **0 = freeze** (no pan, stripes paused) |

Galaxy uses dual images for crossfade loops (`FADE_DURATION_MS = 1200`).

---

## 12. Visual QA checklist

Before merging layout changes, verify:

1. **Boards 1–3, no boxes** — list fills panel; frame diagonal clean.  
2. **Protein + sauces both on** — 768/299, 15px gap, list height 620.  
3. **Protein only / sauces only** — full 1082 strip; other box hidden.  
4. **Sauces wrap packing** — even rows vs `screenshots/footer-verify.png`.  
5. **Protein columns** — prices right-aligned; no overflow.  
6. **2-col menu list** — long names don’t kiss the gutter.  
7. **Board 4** — announcement + drink box, stripes, mirrored frame, hero left.  
8. **Theme swap** — Main/Secondary invert frame + logo correctly; sticker hue updates.  
9. **New sticker** — only when active item is New; fades with hero.  
10. **Generic target (post-rewrite)** — every 1/2/3-box combination on a board matches §6 table.

---

## 13. What not to do

- Hard-code food names or OliToki-only copy in layout CSS/JS.
- Change frame polygon math without re-fitting against `frame.png` / mockups.
- Use values-only sheet migrations that drop data-validation dropdowns.
- Invent footer width schemes beyond §6.
- Put service-account secrets or live sheet dumps into git.

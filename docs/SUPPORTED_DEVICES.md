# TokiMenu — Supported devices

**Last updated:** 2026-08-13 23:30

## Fire Stick HD — 1080p maximum

The restaurant player is an **Amazon Fire Stick HD**. It cannot output 4K. The TVs are **1920×1080**.

If Debug → **Display** reads `3840×2160 dpr2`, that is **not** a 4K panel. It is:

```text
1920×1080 CSS  ×  devicePixelRatio 2  =  3840×2160 “budget”
```

TokiMenu then loads **4K-class bitmaps** (e.g. `galaxy-bg.webp` at 3600×2400). The Stick downscales to 1080p and runs out of GPU memory. Theme-color flashes follow.

**AbleSign** (the signage wrapper) has no resolution control in the UI we can see. It almost certainly gives Silk a **2× backing store** (or a 4K default) on every Fire TV. Mac and iPhone report a real window, so they look correct.

### AbleSign URLs (required on the HD Stick)

Pin the pixel budget so we never believe 4K:

```text
https://absrdst.github.io/TokiMenu/index.html?w=1920&dpr=1
https://absrdst.github.io/TokiMenu/index2.html?w=1920&dpr=1
https://absrdst.github.io/TokiMenu/index3.html?w=1920&dpr=1
https://absrdst.github.io/TokiMenu/index4.html?w=1920&dpr=1
```

Also try (same idea): `?display=1920x1080` or `?width=1920`.

After a hard refresh, Display should read **`1920×1080 dpr1`**. Wallpaper should pick `galaxy-bg-sm`, not the 3600px master.

Optional on the Stick itself: Fire TV **Settings → Display & Sounds → Display → Video resolution → 1080p** (not Auto). The HD model should already be 1080p.

---

## What we design for

| Surface | Design | Notes |
|---------|--------|--------|
| **Stage** | Always **1920×1080** CSS | Letterboxed into whatever window we get |
| **Target TV** | **1080p** | Fire Stick HD + restaurant panels |
| **Mac / phone preview** | Real viewport | Debug Display should match the window |

## Device notes

| Device | Max output | Typical Display (honest) | Typical Display (AbleSign) |
|--------------------|-------------|----------------------------|----------------------------|
| **Fire Stick HD** | **1080p only** | `1920×1080 dpr1` | **`3840×2160 dpr2`** — lie; use `?w=1920&dpr=1` |
| Fire Stick 4K / 4K Max | 2160p | `1920×1080 dpr1` on a 1080p TV if HDMI is 1080p | May still report 4K / dpr2 |
| MacBook preview | Retina | CSS box × 2 is real pixels | n/a |
| iPhone preview | Varies | Real CSS × dpr | n/a |

Do **not** treat Fire Stick HD as a 4K client. Do **not** assume AbleSign knows the panel.

## How TokiMenu reads “Display”

1. `#stage` `getBoundingClientRect()` (fallback: `window.innerWidth/Height`)  
2. Times `window.devicePixelRatio`, cap 2  
3. **URL override wins** if present (`w` / `width`, `h` / `height`, `dpr`, `display=1920x1080`)

That budget chooses `galaxy-bg` vs `galaxy-bg-sm` and how far we canvas-downsample.

Related: [PERFORMANCE.md](./PERFORMANCE.md) · [FUTURE_HOSTED_API.md](./FUTURE_HOSTED_API.md) (Remote + private sheets, later)

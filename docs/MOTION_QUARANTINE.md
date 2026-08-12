# Presentation motion quarantine

**Status:** Live runtime is **`engine`** (`PRESENTATION_MOTION_MODE = "engine"`).  

| Presentation Mode (Settings) | Motion Style (Beta → Motion) |
|------------------------------|------------------------------|
| Slideshow | `Slideshow` — opacity on hero, no scale zoom |
| Ken Burns | `Ken Burns` — opacity + scale zoom on hero |
| Encore | `Encore` — grid + veil; Wind-up = grid+veil+camera; Punch = veil+camera only |

**Family Portrait** (toggle on board/box): one-slide full-spread overview before item/Encore bows.  
- Entrance: grid opacity in at 1×, no veil.  
- Exit into Encore (same segment): keep grid (compose); first bow uses Punch-In.  
- Exit into Slideshow/Ken Burns items: grid opacity out, then hero blocks.

## What “static” means (live)

- **One paint path:** `applyStaticPresentationSlide` (not gated legacy motion)
- Hero image **snaps**; highlight is applied **only after** the image is ready (same turn) so they lockstep
- Collage (FP / Encore cast) **snaps** at 1×; no veil / Zoom Reveal / bows
- Highlights: `.active` at opacity 0 → `.hl-on` fades to opacity 1 (0.35s); color is highlight when active
- Step duration: Style → **Presentation Speed** only

## Legacy gates (bypassed when static)

| Area | Functions (still present) |
|------|---------------------------|
| Hero Ken Burns | `updateHero`, `setHeroZoom`, `heroKenBurnsOn` |
| FP Wind-up / hide | `beginPortraitCenterIntro`, `showFamilyPortrait`, `hideFamilyPortrait`, `handoffHeroToPortrait` |
| Encore bows | `setPortraitSpotlight`, `easePortraitZoomOut`, `applyEncoreSpotlightChrome` |
| Step handoffs | `leaveCurrentSlideThen`, `beginCollageBlockHandoff`, `windDownCollageStage` |
| Highlight fade (old) | `clearAllPresentationHighlights({ fade })` with `--dur-slow` |

## Recovery

- Git history on `js/menu.js` before static mode  
- Phase model: [UI_NOMENCLATURE.md §4](UI_NOMENCLATURE.md), [MOTION_REFACTOR.md](MOTION_REFACTOR.md)  
- Sheet-driven rebuild: Beta Features → **Motion** table (Wind-up / Punch-in / Hold / Punch-out / Wind-down + Grok's Notes)

## Next engine

1. Parse Beta Motion rows  
2. Block runner: phases complete in order; Wind-up/Wind-down 0 = use Punch-in/out on first/last  
3. Ken Burns first, then Encore on the same runner  
4. Flip `PRESENTATION_MOTION_MODE` to `"engine"` when ready  

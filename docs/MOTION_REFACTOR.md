# Motion system — pre-launch refactor note

**Status:** Live runtime is **static quarantine** (`PRESENTATION_MOTION_MODE = "static"`).  
Legacy motion is bypassed; see [MOTION_QUARANTINE.md](MOTION_QUARANTINE.md).  
**Next:** Beta Motion table → real block engine (Ken Burns first).  
**Truth source for names/phases:** [UI_NOMENCLATURE.md §4](UI_NOMENCLATURE.md)

---

## Why this exists

Presentation motion was grown path-by-path in `js/menu.js` (Encore bows, FP Zoom Reveal, hero Ken Burns, multi-segment handoffs). Guidelines in §4 describe **Motion Styles** as reusable recipes of phases + treatments with durations you can tune in one place. Runtime today is closer to **bespoke branches** that mostly *look* like those phases.

That works for shipping looks; it does not scale for equal timing, Wind-down polish, or sheet-driven Motion Styles later.

---

## Product model (already agreed)

```text
Wind-up → Punch-in → Hold → Punch-out → Wind-down
```

| Piece | Meaning |
|-------|---------|
| **Motion Style** | Named recipe (Encore Bow, Family Portrait Zoom Reveal, Ken Burns, …) |
| **Phase role** | When (Wind-up vs Punch-in) |
| **Treatment** | What (CSS/JS motion; Wind-up may *reuse* Punch-in treatment) |
| **Hold** | Duration-only; **Presentation Speed** at settled state |
| **Animation Block** | One full run of a style (one bow, one FP overview, one slideshow item) |
| **Handoff** | Previous **Wind-down** → next **Wind-up** (segment or block boundary) |

See §4.3–4.4 for Encore (FP compose vs own Wind-up), FP overview, and Ken Burns.

---

## Current runtime debt (honest)

| Area | What it does today | What guidelines want |
|------|--------------------|----------------------|
| **Presentation clock** | Global `setInterval(Presentation Speed)` advances slides | **Hold** starts when settled; phase durations are *outside* uneven Hold steal |
| **Encore bows** | `ENCORE_FIRST_BOW_MS` (120) vs `ENCORE_BLACKOUT_MS` (1100) before highlight | Same **Punch-out → Punch-in** recipe every bow; **equal Hold** after Punch-in lands |
| **FP Wind-up** | `beginPortraitCenterIntro` + `--dur-fp-windup` | Motion Style table: wind-up treatment + ms |
| **Encore Wind-down** | Two-phase hide (`encoreWindDown`); still QA-open | Wind-down **reuses Punch-out** (undim + zoom to 1×), then fade / segment handoff — one recipe, not ad-hoc |
| **Segment handoffs** | `beginCollageBlockHandoff`, `windDownCollageStage`, flags | Handoff = Wind-down complete (or intentional overlap only on fade) → Wind-up |
| **Durations** | Mix of CSS vars, magic ms, and path-local timeouts | One **clock table per Motion Style** (CSS vars OK if named and documented) |

### Timing rule (product — do not regress)

**Every Animation Block is active for exactly Style → Presentation Speed** — Encore bow, Slideshow item, Family Portrait overview, drinks. No exceptions.

```text
[ Hold = Presentation Speed ] → [ Wind-down between steps if needed ] → [ next Hold = Presentation Speed ]
```

- Punch-in/out live *inside* the Hold window (never add Hold on top of punch).  
- **Wind-down is BETWEEN steps**, not on the next slide’s clock (overlapping Wind-down made FP look longer than Slideshow).  
- `leaveCurrentSlideThen` → then paint next → `notePresentationStepStart`.  
- Encore bows: same punch blackout every item.  
- Veil only on Encore **bows** (`type === "encore"`), never during FP lineup Wind-up.  

Clock: `presentationStepMs`, `notePresentationStepStart`, `leaveCurrentSlideThen` in `menu.js`.

---

## Target shape (for the later refactor)

Not a mandate to rewrite everything at once — a checklist so the refactor is intentional:

1. **`MOTION_STYLES` (or equivalent)**  
   Per style: which phases exist; treatment id; duration source (`--dur-*` or Presentation Speed for Hold only).

2. **Phase runner**  
   Enter block → run Wind-up (if any) → Punch-in → **arm Hold** → on Hold end: Punch-out → next block or Wind-down if leaving segment.

3. **Presentation Speed = Hold only**  
   Never “interval from slide open” for Encore bows (and ideally not for styles where Punch-* is long).

4. **Handoff API**  
   `windDown(block) → then windUp(next)` with shared clocks; kill generation tokens so stale `finishHide` cannot cancel the next Wind-up (keep the gen pattern; make it part of the runner).

5. **Leave treatments in CSS**  
   Keep Ken Burns / veil / Zoom Reveal as treatments; JS only schedules phase roles and Hold.

6. **Do not** invent empty phases that burn time; **do** keep intentional Hold.

---

## Out of scope until refactor

- Full rewrite of `setActiveBoardSlides` / portrait pipeline mid-feature-QA  
- Sheet glossary dropdown for Motion Styles (called out as future in §4)  
- Changing Presentation Speed sheet semantics without product sign-off  

---

## Pointers in code (today)

| Concern | Approx. home in `js/menu.js` |
|---------|------------------------------|
| Slide list / block ids | `appendPresentationSegment`, `animationBlockId` |
| Encore bow punch | `setPortraitSpotlight`, `ENCORE_*_MS` |
| FP show / hide / Wind-up | `showFamilyPortrait`, `beginPortraitCenterIntro`, `hideFamilyPortrait` |
| Segment collage handoff | `beginCollageBlockHandoff`, `windDownCollageStage` |
| Global advance timer | `startSlideshow` / `setInterval` |

---

## When picking this up

1. Re-read [UI_NOMENCLATURE.md §4](UI_NOMENCLATURE.md) end-to-end.  
2. Fix **equal Encore Hold** first (proves Hold-driven advance).  
3. Fold Encore Wind-down into Punch-out reuse + one fade clock.  
4. Only then extract a shared runner; avoid a big-bang rewrite of hero + drinks + wall paths in one PR.

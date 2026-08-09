# TokiMenu — Feature performance impact

**Purpose:** Rank major runtime features by GPU / CPU / memory / network cost so we can:

1. Know what hurts Fire Stick / multi-board wall / weak browsers first  
2. Design **console kill-switches** that truly disable work (not just hide UI)  
3. Decide when **tearing a feature down and rebuilding** costs more than **leaving it idle**

**Last updated:** 2026-08-09 (plates as containers, debug Full View, version in HUD header)  
**Primary runtime:** `js/menu.js`, `css/menu.css`  
**Target display:** 1920×1080; stress cases = Amazon Fire Stick, `preview-all.html` wall (4 boards)

Related: [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [SHEET_MIGRATION.md](./SHEET_MIGRATION.md)

---

## 1. Impact scale

| Rating | Meaning | Typical symptoms |
|--------|---------|------------------|
| **Very High** | Sustained multi-layer compositing, many large rasters, or continuous animation at full stage size | Hitched Ken Burns, low FPS, thermal throttle, wall unusable |
| **High** | Expensive filter / blend / dual-buffer work, or large decode + layout spikes | Stutter on theme change, pan jank, soft-refresh spikes |
| **Medium** | Periodic work or moderate continuous cost; fine solo, stacks poorly ×4 | Noticeable on wall or when stacked with Encore |
| **Low** | Cheap continuous or occasional work | Rarely the bottleneck alone |
| **Very Low** | Idle flags, small DOM text, pure data toggles | Negligible if implemented as no-ops when off |

**Axes (when rating):**

| Axis | Examples |
|------|----------|
| **GPU composite** | CSS `filter`, `mix-blend-mode`, large transformed layers, veil gradients |
| **CPU** | RAF loops, fit bake-offs, text measurement, JSON/CSV parse |
| **Memory / decode** | Many full-res Plates, dual galaxy layers, xlsx inflate |
| **Network** | Sheet refresh, xlsx download, food-pics / wallpapers |
| **Main-thread spikes** | Soft re-render, Family Portrait rebuild, menu fit |

Ratings below assume **one full-quality solo board** unless noted. **×4 wall multiplies** almost everything that is not already on the lean wall path.

---

## 2. Kill vs hang (important)

| Strategy | When cheaper | When worse |
|----------|--------------|------------|
| **Hang idle** — keep DOM/nodes/timers but skip paint work (`hidden`, `opacity:0`, early-return in RAF) | Feature toggles often (Slideshow ↔ Encore, hero slide change); teardown is heavy (destroy 8–12 Plate nodes + rebuild) | Feature left “half on” still runs RAF, blur, or dual layers |
| **Hard kill** — remove listeners/timers, detach heavy DOM, drop image refs, cancel RAF | Long-lived off (boss never uses Encore; wall lean path; debug isolation) | Rapid toggle thrash (rebuild Family Portrait every few seconds) |
| **Never partially kill** | — | Hiding Encore but leaving galaxy dual-pan + blur + soft refresh at full rate still burns budget |

**Rule of thumb for TokiMenu:**

1. **Presentation modes** (Slideshow / Encore / Family Portrait): prefer **structured hang** — one stage, hide/show with opacity, reuse Plate nodes when the item set fingerprint is unchanged; hard-kill only when leaving the mode for a long time or on wall lean path.  
2. **BG effects** (blur, dual-layer scroll, blend): **hard kill** when off — set `filter: none`, single layer, cancel pan RAF. Hanging a dual-layer pan “invisible” still costs.  
3. **Network refresh / xlsx**: **hard kill** timers and skip fetches; hanging a 30s poll still costs network + main-thread parse.  
4. **List highlight / New Sticker / Version Stamp**: hang or kill both cheap; prefer hang (class toggles).  
5. **Debug isolation:** hard-kill is better so logs prove “this code path did not run,” not “it ran but was invisible.”

**Toggle thrash cost (relative):**

| Feature | Cost to fully kill + rebuild | Prefer |
|---------|------------------------------|--------|
| Family Portrait / Encore collage | **Very High** (many imgs, lattice, veil, scaffold) | Hang idle; rebuild only on menu fingerprint change |
| Background dual-layer + blur | **High** (re-decode wallpaper, re-bind layers) | Hard kill when off; don’t thrash on every slide |
| Hero single Plate swap | **Medium** (decode + fade) | Hang Hero Panel; swap src carefully |
| Menu List fit bake-off | **Medium–High** spike once | Cache until content/theme changes |
| Slideshow timer | **Very Low** | Clear interval when paused |
| Soft sheet refresh | **Medium** spike | Disable timer entirely when debugging FPS |
| Version Stamp / Disclaimer text | **Very Low** | Either |

---

## 3. Feature impact table

### 3.1 Presentation & photo side

| Feature | Impact | Primary cost | Notes / kill guidance |
|---------|--------|--------------|------------------------|
| **Encore** (collage + Ken Burns + spotlight) | **Very High** | Many Plate layers, CSS transforms, veil, zoom RAF/transitions, list coupling | Largest solo-board risk after wall×4. Hard kill: hide stage, cancel zoom, unpin scaffold, restore single hero path. Hang: keep stage `hidden` but **do not** leave zoom transitions mid-flight. |
| **Family Portrait** (collage overview, no full Encore) | **Very High** | N food rasters + layout lattice + fade | Same class of cost as Encore minus some zoom. Each Portrait Slot acts as a Plate container (one drop-shadow per slot). Rebuild only on cast/fingerprint change. |
| **Encore Spotlight Veil** (hard/soft) | **High** | Full-stage gradient / mask composite every frame of zoom | Soft ≥ Hard. Kill with Encore; don’t leave veil class on empty stage. |
| **Ken Burns** (hero and/or collage zoom) | **High** | Large layer transform + optional filter/stack | Solo hero KB cheaper than collage KB. Kill: remove transform transitions; reset scale 1. |
| **Scaffold Background pin** (Encore BG copy) | **High** | Extra full-stage BG bitmap + free-galaxy hide choreography | Avoid dual BG (free galaxy + scaffold) both live; pin should **replace**, not stack. |
| **Hero Plate** (container + image child) (Slideshow) | **Medium** | One large decode + crossfade. Plate owns scale/shadow. | Baseline. One shadow per logical Plate (not per bitmap). Children (sticker, future multi-images) inherit motion. |
| **New Sticker** | **Low** | Small WebPs + CSS | Fine. Kill = `hidden`. |
| **List Highlight** (active Menu Item) | **Low** | Style/class on one row | Cheap. Encore may defer highlight — logic only. |
| **Presentation Speed timer** | **Very Low** | `setInterval` / timeout | Kill clears timer. `0` = pause. |

### 3.2 Background

| Feature | Impact | Primary cost | Notes / kill guidance |
|---------|--------|--------------|------------------------|
| **BG Blur** (`filter: blur` up to ~40px) | **High** | GPU filter on large wallpaper | **Hard kill** at 0: `filter: none`, remove `has-blur`. Percent `100%` = max cost. Wall path forces blur off. |
| **Dual-layer galaxy pan** (seamless scroll) | **High** | Continuous RAF + 2 full-stage images | Wall uses **single-layer** pan. Kill: cancel RAF (`startGalaxyScroll` counterpart), one layer only. Frozen during Encore (`bgScrollFrozen`) — good hang pattern. |
| **BG Blend Mode** (non-`normal`) | **Medium–High** | Extra compositing with Background Plate | `normal` is cheapest. Wall forces normal. |
| **BG Opacity** | **Low–Medium** | Layer opacity | Cheap alone; stacks with blur/blend. |
| **BG Wallpaper decode** (large masters) | **Medium** (spike) | Network + decode + memory | Prefer stage-sized / WebP. Wall uses `wallFriendlyBgPath`. Hang after load is fine. |
| **Background Plate only** (solid, no wallpaper) | **Very Low** | Solid fill | Cheapest BG. |
| **BG Scroll Speed = 0** | **Very Low** when truly stopped | — | Ensure RAF **stops**, not “pan by 0 every frame.” |

### 3.3 Layout / text / boxes

| Feature | Impact | Primary cost | Notes / kill guidance |
|---------|--------|--------------|------------------------|
| **Menu List fit bake-off** (`fitMenuText`, multi-pass scale) | **Medium** (spike) | Measure + reflow | Run on content/theme change only; skip if fingerprint unchanged. |
| **Footer Boxes** (Proteins / Sauces / Drinks) | **Low–Medium** | DOM + optional multi-column fit | Create Columns? can add layout passes. |
| **Include Descriptions / Columns?** | **Low** | More text / columns → slightly harder fit | Content density, not continuous GPU. |
| **Announcement Panel** (Board 4 body + rich text) | **Medium** | Text, optional rich styles, slide timer | Motion styles (future) may raise cost — rate per style. |
| **Shout / future Motion Styles** | **Low–High** | Depends on effect | Treat each named style separately when implementing; default to Low until measured. |
| **Stripes** (Board 4 scroll) | **Medium** | Extra scrolling layer | Kill = hide + stop stripe animation. |
| **Disclaimer / Version Stamp** | **Very Low** | Text paint | Disclaimer always shows allergy text. Version Stamp (when enabled) is appended only to the floating Toki Debug header. |

### 3.4 Data pipeline

| Feature | Impact | Primary cost | Notes / kill guidance |
|---------|--------|--------------|------------------------|
| **Soft refresh** (poll sheet ~30s) | **Medium** (periodic) | Network + parse; re-render if fingerprint changes | Wall: refresh disabled/lean. Kill timer for FPS debug. Fingerprint skip = good hang. |
| **xlsx styles** (fills, fonts, announcement rich text) | **High** (spike) | Download + inflate + parse | Wall disables most xlsx. Kill: CSV-only path. |
| **CSV sheet fetch** (items only) | **Low–Medium** | Network + parse | Baseline. |
| **Protein / Sauces / Drinks shared sheets** | **Low** | Extra small fetches | Parallel; cache with board payload. |
| **WebP prefer + PNG fallback** | **Low** (usually wins) | One failed request if WebP missing | Net savings when WebP exists. |
| **`?imgScale=` debug downsample** | **Low–Medium** CPU spike, then **helps** GPU | Canvas resize after load | Debug only; not a product feature. |

### 3.5 Multi-board & environment

| Feature | Impact | Primary cost | Notes / kill guidance |
|---------|--------|--------------|------------------------|
| **Preview wall** (`preview-all` / `?preview=all`) | **Very High** if full quality ×4; **mitigated** by lean path | 4× everything | Lean path: no blur/blend/xlsx (mostly), single-layer pan, no soft refresh thrash. Still 4 stages. |
| **Four solo Fire Stick windows** | **Very High** aggregate | 4 processes/WebViews | Prefer one stick per board or wall lean; don’t assume desktop FPS. |
| **Stage CSS scale to viewport** | **Low** | One transform on `#stage` | Fine. |
| **Shadow / heavy effects on wall** | **High** when enabled | Extra paint | Intentionally reduced on wall when FPS concerns. |

### 3.6 Planned (not shipped) — provisional ratings

| Feature | Expected impact | Notes |
|---------|-----------------|-------|
| **Footer Box items in presentation cycle** (Hero Plate per box item) | **Medium** | Extra Plate swaps; avoid rebuilding Footer Box DOM each tick |
| **Priority box roll-after-menu** | **Low** logic; **Medium** if images | Cost = images + highlight, not priority math |
| **Announcement Motion Style dropdown** | **Low–High** | Rate each style; Shout-like text FX usually Low; full-stage FX High |
| **Debug menu tab** (sheet) | **Very Low** | Authoring only |

---

## 4. What already exists (do not reinvent blindly)

| Hook | Role |
|------|------|
| `tokiLog` / `tokiInfo` / `tokiWarn` / `tokiError` | Tagged console helpers in `menu.js` |
| `isPreviewWall()` / `body.preview-wall` | Lean multi-board path |
| `?imgScale=` | Runtime Plate/BG downsample for cost experiments |
| `bgScrollFrozen()` | Stops free pan during Encore / visible FP |
| Soft-refresh **fingerprint** | Skip re-render when sheet unchanged |
| Wall: blur/blend/xlsx mostly off | Precedent for real kill-switches |

**Gap:** there is no unified **feature flag registry** with on/off state printable in one `TokiMenu.debug` dump. That is what the console-flag work should add.

---

## 5. Suggested kill-switch tiers (for implementers)

| Tier | Examples | Default when debugging FPS |
|------|----------|----------------------------|
| **A — continuous GPU** | Encore, FP collage, BG blur, dual pan, veil, blend | Off first |
| **B — periodic / spike** | Soft refresh, xlsx, fit bake-off, hero crossfade | Off or slowed |
| **C — content chrome** | Footer boxes, stripes, sticker, descriptions | Optional |
| **D — always-on baseline** | Stage, Frame, Menu List text, solid BG, one Plate | Keep on |

Isolation order for “what is killing Fire Stick?”:

1. Disable A entirely → if smooth, re-enable one at a time  
2. If still bad with only D: image sizes / WebView limits / 4× wall  
3. Log **active set** every time a flag flips (see prompt §7)

---

## 6. Measurement notes (cheap checks)

| Check | How |
|-------|-----|
| RAF load | Performance panel / `requestAnimationFrame` count while idle vs Encore |
| Layer count | Count visible `#hero`, FP plates, galaxy layers in Elements |
| Soft refresh | Watch network every `refreshSeconds`; confirm fingerprint skip logs |
| Blur on/off | Toggle Style Blur 0% vs 100%; watch GPU |
| Wall vs solo | Same board in `index.html` vs `preview-all.html` |

Evidence so far (product history): **layer count + continuous composite** dominate Fire Stick more than WebP file size alone; image format is secondary to “how many scaled full-stage layers are live.”

---

## 7. Prompt for a cheaper Grok model (console feature flags)

Copy everything in the block below into a cheaper model session that has this repo open.

```text
You are working in the TokiMenu repo (static HTML/CSS/JS menu boards). Read:
- docs/PERFORMANCE.md (feature impact table + kill vs hang rules)
- docs/UI_NOMENCLATURE.md (names: Hero Panel, Plate, Frame, etc.)
- js/menu.js (especially tokiLog/tokiInfo, isPreviewWall, imgScale, startGalaxyScroll,
  startSlideshow/stopSlideshow, Family Portrait / Encore paths, startAutoRefresh,
  soft-refresh fingerprint)

GOAL
Add a robust, low-overhead **debug feature-flag console API** so we can see which
features are ACTIVE vs INACTIVE and force them off/on for isolation testing on
Fire Stick and desktop. Do NOT redesign the product. Prefer small iterative edits
to menu.js (+ tiny css only if required). Cache-bust script query params on HTML
pages if you touch menu.js.

REQUIREMENTS

1) Global registry
   - Expose something like window.TokiMenuDebug or window.TOKI_DEBUG with:
     - flags: object of { id, label, impact, active, source, killCost }
     - list(): print a clear table/lines of ALL flags and active true/false
     - get(id) / set(id, on|off) / enable(id) / disable(id) / reset()
     - snapshot(): return JSON-serializable state for copy-paste
   - On every set(), log with existing tokiInfo style:
     [TokiMenu …] DEBUG flag <id> ACTIVE|INACTIVE (reason)

2) Flag IDs to implement (wire real behavior, not just labels).
   Minimum set (add more if obvious hooks exist):
   - encore              (Presentation Mode encore path)
   - familyPortrait      (collage stage)
   - kenBurns            (zoom transitions where gated)
   - spotlightVeil       (encore veil hard/soft)
   - scaffoldBg          (encore scaffold BG pin)
   - heroPlate           (hero image show/swap; careful: baseline feature)
   - newSticker
   - listHighlight
   - slideshowTimer      (presentation advance)
   - bgBlur
   - bgDualPan           (dual-layer galaxy scroll RAF)
   - bgBlend
   - bgWallpaper         (image layer; solid plate may remain)
   - softRefresh         (auto sheet poll)
   - xlsxStyles          (remote/local xlsx style path when skippable)
   - footerBoxes
   - stripes             (board 4)
   - announcementMotion  (if shout/motion gated; else stub)
   - versionStamp

   Each flag must report:
   - active: whether the feature is ACTUALLY doing work now (not merely “config wants it”)
   - source: "config" | "url" | "console" | "wall-lean" | "forced-off"
   - When console forces OFF, code paths must early-return / cancel timers / remove
     expensive classes — see PERFORMANCE.md kill vs hang:
       * Continuous GPU (blur, dual pan, encore): HARD kill work
       * Collage/Encore DOM: prefer hide + cancel animation; avoid full rebuild on
         every toggle; rebuild only when turning on from cold or menu cast changes
       * softRefresh: clear interval when off
       * Do not thrash destroy/recreate Family Portrait on rapid toggles

3) URL bootstrap (optional but valuable)
   - Support query params, e.g.:
     ?tokiDebug=1
     ?tokiFlags=bgBlur:0,encore:0,softRefresh:0
   - ?tokiDebug=1 → list() once after first successful menu apply
   - Document in a short comment at top of the debug section

4) Honesty / instrumentation
   - When a feature is config-ON but forced OFF, active=false and log once.
   - When a feature is config-OFF, active=false; enabling via console may no-op with
     a warning if dependencies missing (e.g. encore without family portrait cast).
   - Add a cheap heartbeat optional: TokiMenuDebug.watch(ms) that every N ms logs
     only flags whose active state changed (diff), not a spam full dump.
   - Never log per animation frame.

5) Safety
   - No secrets, no service account, no network calls for the debug API itself.
   - Do not force-push; do not commit secrets.
   - Keep preview-wall lean path respected: wall may force some flags inactive with
     source "wall-lean"; console can still force further offs for isolation.
   - Prefer not to break production when flags are untouched (all default = follow
     config as today).

6) Deliverables
   - Code changes in js/menu.js (and HTML cache-bust if needed)
   - Brief note in docs/PERFORMANCE.md section “Console flags” OR a few lines in
     the existing debug comment block listing:
       TokiMenuDebug.list()
       TokiMenuDebug.set('bgBlur', false)
       URL examples
   - Do NOT rewrite menu.js wholesale.
   - Do NOT implement new product features (box presentation cycle, etc.).

7) Acceptance checks
   - Solo board: TokiMenuDebug.list() shows encore/familyPortrait/bgBlur/softRefresh
     matching real behavior
   - TokiMenuDebug.set('bgBlur', false) removes blur work (no has-blur / filter none)
   - TokiMenuDebug.set('softRefresh', false) stops polling
   - TokiMenuDebug.set('encore', false) exits expensive encore path without console errors
   - Untouched flags → identical behavior to pre-change baseline
   - No per-frame console spam

Implement now. If a flag cannot be fully wired without a large refactor, implement
accurate active detection + a safe force-OFF no-op path, and mark it partial in list().
```

---

## 8. Console flags (implementation)

The prompt in the previous section was executed (adapted for the actual Debug Menu sheet).

### How it works now

- Debug configuration lives in the **Debug Menu** tab (master `Debug Mode` + feature toggles under `Debug Features`).
- **Automatic** detailed flag emission to console only occurs when **both**:
  - `Debug Mode` = TRUE
  - `Performance Console` = TRUE
- Manual inspection via `TokiMenuDebug.list()` / `TokiMenuDebug.set(...)` is always available from DevTools.
- A registry of the high-cost features from the original prompt (encore, bgBlur, softRefresh, etc.) reports honest `active` state + `source`.
- Best-effort hard-kill paths exist for several expensive items when you force them off via the API (see docs).
- URL bootstrap: `?tokiDebug=1`

Full usage and output explanation: **[docs/DEBUG_CONSOLE.md](./DEBUG_CONSOLE.md)**

Update the Debug Menu sheet with more columns under "Debug Features" as you want individual feature instrumentation / overrides.

---

## 9. Changelog

| Date | Change |
|------|--------|
| 2026-08-09 | Initial feature impact matrix, kill-vs-hang guidance, cheaper-model console-flag prompt |
| 2026-08-09 | Executed §7 prompt: added TokiMenuDebug API + sheet-driven gating via Debug Menu (Debug Mode + Performance Console). Added docs/DEBUG_CONSOLE.md. |

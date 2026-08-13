# Beta Features — injection guide

**Last updated:** 2026-08-13 12:00 (Hard veil shadow restored to d03b4de drop-shadow)  

**Tab:** `Beta Features` · **GID:** `1710200195` · constant `BETA_FEATURES_GID` in `js/menu.js`  

This tab is the **experiment / override surface** for features that should not require editing every board Settings row. Boards stay simple; Beta turns capabilities on, ranks them, and (when ready) those controls can migrate onto per-board tabs without rewriting runtime logic.

Related: [FOOTER_BOXES.md](./FOOTER_BOXES.md) (geometry), [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) (revised sheets), [DEBUG_CONSOLE.md](./DEBUG_CONSOLE.md) (Debug Menu is a *different* tab).

---

## 1. Tab layout (live)

Section pattern matches other revised tabs (label → headers → data), but Beta is free-form enough to host several unrelated knobs.

| Approx rows | Content |
|-------------|---------|
| 0 | `Beta Features:` (title) |
| 1–3 | Style / HeroText experiments (flags; not all wired) |
| 10 | `Boards` (section label) |
| 11 | `Include Footer Boxes` (header) |
| 12 | **Data cell** — comma-separated multi-select (Sheets data validation) |

### `Veil Shadow Settings` (Hard Encore cutout)

Section title `Veil Shadow Settings`. Header row then **one data row directly under it**.

| Column | What it does |
|--------|----------------|
| **Enabled?** | `TRUE` = experiment on. `FALSE` / blank = current behavior (one collage shadow on `.family-portrait-plates`; no veil shadow). |
| **Shift Right / Shift Down** | px offset of the veil `drop-shadow` (cartoon lip into the Hard hole). |
| **Spread** | Extra thickness. CSS `filter: drop-shadow` has no spread — runtime fakes it with extra hard copies. |
| **Blur** | px blur of the main drop-shadow. |
| **Opacity** | `0–1` (values `>1` are treated as percent, e.g. `50` → `0.5`). |

**Hard veil shadow** is a CSS `filter: drop-shadow` on the real Hard veil (follows the hole alpha). Same element as the fade, so a semi-transparent veil never shows a second full shadow circle. Spread is faked with extra hard copies. Soft never gets a veil shadow.

**Veil extend** is hardcoded at `20px` (no sheet hook). `--encore-hole-x/y` stay in stage space; only the veil box / gradient `at` are offset.

**Hole pinch** is hardcoded (Hard only): shrink `40px` on Punch-in with the zoom ease; Punch-out stays pinched. Reset to full radius at the next Punch-in while the veil is undimmed. Soft is unchanged. No sheet hook.

Defaults written under the headers (also in `VEIL_SHADOW_DEFAULTS`): `18 / 22 / 3 / 2 / 0.5`. Blank cells keep those. Solo heroes (`#hero-plate .hero-anim`) are never touched. Soft spotlight never gets a veil shadow. Wall preview strips the filter.

### `Include Footer Boxes` (primary control today)

- The list now lives on **each board's own Settings row** (column "Include Footer Boxes", e.g. `Proteins, Sauces, Veggies`).
- Falls back to the central Beta Features tab cell if the board row has no list.
- **One cell**, comma-separated titles. Case-sensitive match to the box tab Titles.
- Multi-select data validation works; quotes in CSV are handled.
- The list fully replaces the old per-board Include Protein/Sauces/Drinks/Veggies? flags.
- **Empty list (blank cell) → no footer boxes** (does not keep the previous selection or default Proteins/Sauces on).

### Selection → display (footer boxes)

1. Parse the comma list (`parseBetaFeatures`)
2. Load content for every **named** box that is not already loaded
3. Rank by **Priority** from each box’s Settings row (col **F**): **lower number = higher priority** (1 leftmost / major)
4. Keep **top 3** only
5. **Exile** the rest: `include = false`, **do not render**, and prefer not re-fetching once known exiled

Defaults when Priority blank: Proteins `1` · Sauces `2` · Drinks `3` · Veggies `4`.

---

## 2. Runtime entry points (`js/menu.js`)

| Piece | Role |
|-------|------|
| `parseBetaFeatures(rows)` | Reads Boards → Include Footer Boxes cell |
| `selectFooterBoxesFromBeta(list, registry)` | Case-sensitive match + Priority sort + top 3 |
| `applyBetaFooterBoxesOverride(parsed)` | **Sole place** that applies Beta footer selection after `applyParsedMenu` |
| `attachVeggiesBox` / `attachFooterDrinksBox` / `attachSharedProteinSauces` | Content loaders (must be **awaited** when Beta enables a box) |
| `renderFooterBoxBody` | Shared paint for all footer boxes |
| `applyFooterBoxesLayout` | major/minor / thirds; DOM order by Priority |

**When it runs:** cold + soft Google load, **after** `applyParsedMenu(parsed)`, wrapped so Beta failures **never** abort the whole board load.

**Prefetch:** main sheet load already parallel-fetches `csvJobs.beta` and `csvJobs.veggies` (boards 1–3) so the override does not add a second round-trip (and avoids Sheets 429 rate limits).

---

## 3. Architecture rules for “inject via Beta” (do this every time)

These are the rules that make Beta cheap. Breaking them is why Veggies/Drinks hurt.

### 3.1 One override function, not scattered flags

- Parse board → attach what you can → `applyParsedMenu` → **`applyBetaFooterBoxesOverride`**
- Beta may **force-load** content that board flags skipped (Drinks / Veggies)
- Then set **global** box state (`proteinBox`, `saucesBox`, `footerDrinksBox`, `veggiesBox`) and call **`renderFooterBoxes()`** once

Never: set `.include = true` fire-and-forget without await + re-render.

### 3.2 Outer-scope helpers only

`applyParsedMenu` nests helpers like `boxSurfaceFrom`. **Beta code cannot call those.**  
Use module-level helpers (`resolveFooterBoxBg`, `paintFooterBoxChrome`, `parsePriority`, …) or promote shared helpers out of nested scopes.

### 3.3 Prefetch every tab Beta might need

Add to the parallel `csvJobs` map in `loadMenuFromGoogleSheet`:

- The Beta Features gid
- Any new content sheet gid (e.g. `veggiesSheetGid`)

Stash on `parsed` (`_betaRows`, `_veggiesRows`) so the override does not refetch.

### 3.4 Full vertical slice for each box type

A new footer box is **not** “parser only.” Checklist:

| Layer | Required |
|-------|----------|
| Sheet | Revised Settings + Inventory; Title matches Beta multi-select string **exactly** |
| Config | `*SheetGid` on **all boards that can show it** (`config.js` / `2` / `3`) |
| Parse | Prefer shared `BOX_REVISED_*` + one parser (or generic) |
| Attach | Async loader; accept prefetched rows; **await** when Beta enables |
| State | Global box object with `include`, `priority`, `items`, … |
| HTML | `#…-box` shell on **index / index2 / index3** (copy footer-drinks / veggies) |
| CSS | `#…-box` in layout, typography, wrap chips, shell fill vars |
| Layout | Slot in `applyFooterBoxesLayout` (typeOrder + default Priority) |
| Render | `renderFooterBoxBody` + title/subtitle elements |
| Fit | `fitFooterBoxes` branch if wrap/columns scale matters |
| Registry | Title string in `applyBetaFooterBoxesOverride` registry |
| Cache-bust | HTML `?v=` on **menu.js, menu.css, and config*.js** |

Miss any one layer → silent failure (include true but empty, or no DOM → box never appears).

### 3.5 Exile means skip

Exiled boxes must not paint. Prefer not fetching them once the final top-3 is known (today: load candidates named in the list, then exile losers after Priority rank so Priority can come from the sheet). Future: two-pass with Priority-only peek if we need zero waste.

### 3.6 Fail soft

Beta override errors → `console.warn`, board stays on last good applyParsedMenu state. **Never** throw out of Beta code into the Google load catch in a way that forces xlsx/embedded fallback unless the main sheet itself failed.

### 3.7 Titles are the API

Registry titles are the long-term key (future DB will reference the same strings). Do not fuzzy-match. Do not rename sheet Title without updating Beta validation options and the registry.

---

## 4. Adding a new footer box (copy-paste checklist)

Example name: **Sides** (title `Sides`, gid `…`).

1. **Sheet:** Settings `Title=Sides` · Priority · Create Columns? · Text Align · Inventory columns as Proteins  
2. **Beta data validation:** add `Sides` to the multi-select list  
3. **config.js / 2 / 3:** `sidesSheetGid: "…"`  
4. **menu.js:**  
   - `FOOTER_PRIORITY_DEFAULTS` / registry entry `{ title: "Sides", priority: N }`  
   - `parse…` or generic revised box parse  
   - `attachSidesBox`  
   - `csvJobs.sides` + `parsed._sidesRows`  
   - slots in `applyFooterBoxesLayout`  
   - titles + `renderFooterBoxBody` in `renderFooterBoxes`  
   - `fitFooterBoxes` if needed  
5. **HTML:** `#sides-box` on boards 1–3  
6. **CSS:** mirror `#veggies-box` selectors / `--sides-box-bg`  
7. **Docs:** this file + FOOTER_BOXES + SHEET_MIGRATION (timestamp with **date and time**)  
8. **Verify:** local `toki_server.py` + hard refresh; console should log `Beta Features Footer Boxes active` with `Sides@N`; never fall through to xlsx because of a Beta error  

If the only product change is “which of the existing boxes show,” **only edit the Beta cell** — no code.

---

## 5. Planned migrations

| Near-term | Notes |
|-----------|--------|
| Move multi-select onto each board’s Settings row | Same parser shape; Beta remains global default/override until cutover |
| Sodas vs Drinks naming | Announcement board may prefer “Sodas”; keep Title-driven match |
| Presentation cycle + exile | Exiled boxes stay available for “include in presentation” later without showing on the strip |
| HeroText / other Beta rows | Still mostly unparsed; follow the same outer-scope + soft-fail pattern when wiring |

---

## 6. Lessons learned (2026-08-10) — why this felt hard

| Footgun | Symptom | Fix (now policy) |
|---------|---------|------------------|
| Nested `boxSurfaceFrom` used from Beta override | `boxSurfaceFrom is not defined` → entire Google load failed → xlsx fallback, empty titles | Only outer-scope helpers |
| Fire-and-forget `attachX().catch()` | Include true, items never applied, empty box or missing box | Always `await` attach, then assign globals, then `renderFooterBoxes()` |
| No `#veggies-box` in HTML | Layout skipped missing id; box never appeared | Full vertical slice checklist |
| Extra fetch after load | Sheets **429** rate limit under testing | Prefetch Beta + content gids in `csvJobs` |
| Config not cache-busted | Old `config.js` lacked `veggiesSheetGid` | Bust **config + menu.js + css** together |
| Priority direction | Higher number wrongly treated as major | Documented: **lower number = higher priority** |

Keep Beta injection boring: **prefetch → parse → await attach → rank → paint → soft-fail.**

---

## 7. Quick console signals

When healthy (boards 1–3, Google source):

```text
Beta Features Include Footer Boxes raw: ["Proteins", "Sauces", "Veggies"]
Veggies sheet loaded: 640368705 items 3 title Veggies priority 3
Beta Features Footer Boxes active (top 3 by Priority): ["Proteins@1", "Sauces@2", "Veggies@3"]
Footer boxes: footer-three order …
TokiMenu data source: GOOGLE SHEET
```

Bad smells:

- `Beta footer override failed` / `boxSurfaceFrom is not defined` → outer-scope bug  
- `loaded from xlsx` right after Google errors → override threw into load catch  
- `footer-two` when three titles selected → missing DOM, failed attach, or exile  
- Empty third box shell → include true, items never copied to global box  

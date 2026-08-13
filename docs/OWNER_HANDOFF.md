# TokiMenu — Owner handoff & authoring strategy

Living context for product direction (not a coding checklist).  
Last updated: 2026-08-13 21:30.

Also see: [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md) (screen part names) · [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) (revised tabs + percent fields).

---

## 1. Why this exists

TokiMenu started as a **Photoshop + DaVinci Resolve** digital menu: it looked right, but **updates were slow** and depended on one person being available. The web boards exist so the restaurant can run the **same visual language** with **live data** and less production friction.

**Near-term purpose:** give the restaurant owner (the boss) control over menu boards at work — without needing design software or the original author on call.

**Status today:** functionally a solid **C / low-expectations ship** — boards look like the design, spreadsheet-driven updates work, Local + Remote paths exist. Obsessive polish (Encore, WebP, Fire Stick) is aiming at **A+**, not blocking a first handoff.

**Disclosure:** the boss has not been told about the system yet. Handoff is intentional and staged.

---

## 2. Two tiers of “done”

### Tier A — Ship now (spreadsheet CMS)

| Piece | Role |
|-------|------|
| GitHub Pages (or Local + Fire Sticks) | Display |
| Google Sheet (shared carefully) | Authoring |
| Style tab | Theme / speeds / presentation |
| Board tabs + shared Protein / Sauces / Drinks | Content |

**Boss workflow:** edit sheet → boards soft-refresh → done.  
**You still own:** assets, deploy, Fire Stick setup, “don’t break these columns” guidance.

**Remote vs private sheets (2026-08-13):** GitHub Pages can only load workbooks shared as **Anyone with the link → Viewer**. Local can stay private (service account). A hosted API so Remote can stay private is parked — [FUTURE_HOSTED_API.md](./FUTURE_HOSTED_API.md).

### Tier B — Owner-facing authoring UI (goal)

| Piece | Role |
|-------|------|
| Simple web app | Only UI the boss sees |
| Google Sheet (or later DB) | **Hidden** storage; protected from casual direct edits |
| Same board renderer | Unchanged or lightly adapted |

**Boss workflow:** log into a calm interface → change items / prices / “New” / theme → publish.  
**You still own:** design of that UI, permissions, image upload pipeline, validation.

Tier B is the fun interface project; Tier A is the practical handoff that can happen first.

---

## 3. Goals (priority order)

| Priority | Goal |
|----------|------|
| **P0** | Boards stay reliable and on-brand at 1920×1080 on TV / Fire Stick |
| **P0** | Owner can change **menu content** without calling you |
| **P0** | Mistakes are hard (validation, defaults, limited knobs) |
| **P1** | Sheet remains a clean **backend** for a future authoring UI |
| **P1** | Advanced presentation (Encore, Family Portrait, BG FX) available but not required for daily use |
| **P2** | Full custom authoring UI; sheet invisible to the boss |
| **P2** | Multi-restaurant / second site without forking the renderer |

**Non-goals for first handoff:** SaaS multi-tenant cloud, POS sync, mobile redesign of boards.

---

## 4. Is the sheet okay as-is?

### Short answer

| Audience | Verdict |
|----------|---------|
| **You + power user** | **Yes.** It works; it’s the real CMS. |
| **Boss, day one (Tier A)** | **Mostly yes for content**, if you give a short “only touch these columns” guide and hide or freeze advanced tabs. |
| **Backend for Tier B UI** | **Usable but not ideal.** Several spreadsheet quirks should be **standardized before** you invent a nice UI that maps 1:1 to cells. |

The sheet does **not** need a full redesign to hand him a spreadsheet. It **does** need cleanup if you want the authoring UI to stay simple and the data model to stay stable.

---

## 5. What works well (keep)

| Strength | Why keep it |
|----------|-------------|
| **Boards 1–3 shared item schema** | One mental model: title, item, prices, subtitle, description, New, image, include |
| **Shared Protein / Sauces / Drinks tabs** | DRY content; boards only toggle visibility |
| **Style tab for theme + motion** | Separates “look” from “menu lines” |
| **Include flags** | Soft delete without deleting rows |
| **Image as filename** | Simple; works with `food-pics/` layout |
| **Private sheet + service account path** | Correct security model for production |

These map cleanly to a future UI: Item form, Box form, Theme picker.

---

## 6. What should change or be standardized (before / as you build UI)

### A. Separate “item rows” from “board settings”

**Today:** Board-level flags (Include Protein Box?, Family Portrait, Presentation Mode, etc.) live on the **same grid as item rows**, often “first non-empty cell wins.”

**Problem for a boss:** Easy to put a `0` in the wrong row and wonder why the box vanished. Hard to explain in one sentence.

**Better (sheet or UI):**

- One **Board settings** block (single row or separate small tab), **or**
- UI only: board settings screen; sheet row still filled by automation

### B. Normalize yes/no and enums

**Today:** mix of `0`/`1`, `Yes`/`No`, free text for modes (`Hard`, `Soft `, trailing spaces, etc.).

**Standardize:**

| Kind | Convention |
|------|------------|
| Booleans | `Yes` / `No` or checkbox columns only |
| Presentation Mode | `Slideshow` \| `Encore` (dropdown data validation) |
| Spotlight Type / Color | locked dropdowns (already partially there) |
| Include | checkbox or Yes/No — never raw `0` without validation |

Data validation in Sheets is free insurance for Tier A.

### C. Style tab: split “theme palette” vs “board FX”

**Today:** one Style grid = theme rows (A–F) **plus** board-wide G–Q on the first data row.

**Problem:** Owner changes “theme” and accidentally pokes BG blend / Show Version / Encore spotlight.

**Better:**

| Layer | Examples | Who edits |
|-------|----------|-----------|
| **Daily** | Theme name pick, maybe Main/Secondary if you allow | Boss |
| **Setup** | BG image, blur, blend, scroll, spotlight, Show Version | You (or advanced section) |

Even without a new tab, a frozen row + “do not edit columns G–Q” note helps.

### D. Image authoring

**Today:** type a filename that must exist under `food-pics/…`.

**Boss risk:** typos, wrong folder, forgotten export.

**Tier A:** dropdown of known files, or a printed “image library” list.  
**Tier B:** upload → save WebP → write filename into sheet automatically.

Sheet column can stay “Image”; the **UI** owns discovery.

### E. Board 4 vs Boards 1–3

**Today:** Announcements chrome + drinks content sheet — different shape than item boards.

**For handoff:** treat Board 4 as **“Messages + drinks”** in docs and UI, not “just another item list.” Don’t force one sheet layout if the product roles differ.

### F. Color system

**Today:** Color Picker labels (Main / Secondary / Highlight / …) + optional cell fills + hex.

**Works**, but dual paths confuse non-designers.

**Standardize for boss:** only **named roles** (Main, Secondary, Highlight, Special). Hex/fill stays power-user / your tools.

### G. Presentation features vs menu features

| Daily menu | Presentation / TV show |
|------------|-------------------------|
| Items, prices, New, include | Family Portrait, Encore, spotlight, BG scroll, presentation speed |

For Tier A, put presentation knobs in an **“Advanced / TV mode”** section of the guide (or separate sheet tab). Daily price changes shouldn’t sit next to Encore spotlight color.

### H. Naming cleanliness (optional but good before UI)

Docs already aim at **Box 1 / 2 / 3** instead of Protein / Sauces / Drinks as hard-coded product types. Doing that in the sheet (or only in the UI vocabulary) makes a second restaurant and a generic form builder easier.

### I. Schema version

When you freeze a handoff sheet, add a cell or doc note: **`schemaVersion = 1`**. Future UI and boards can refuse silent drift.

---

## 7. Recommended sheet stance by phase

### Phase 1 — Tell the boss / spreadsheet only

- **Keep the current sheet structure.**
- Share **Editor** only if you must; prefer a filtered experience:
  - Protect Style G–Q and advanced board columns, **or**
  - Give a short one-pager: “Edit columns B–J on Board 1–3; use Include; put images from this list.”
- You keep Style, Encore, BG FX, deploy, assets.
- Freeze a **known-good** sheet copy (Drive version history + optional xlsx pull).

**Sheet is okay as-is** for this phase.

### Phase 2 — Prep for authoring UI (no big visual rewrite)

- Add **data validation** everywhere enums/bools live.
- Move or document **board-level settings** as a single settings row/tab.
- Decide **canonical image pipeline** (WebP names, folders) so the UI can upload once.
- Align names with a small **domain model** (Item, BoardSettings, Theme, Box) — even if still stored in Sheets.
- Stop adding one-off columns without updating `DATA_MODEL.md`.

**Sheet becomes a database with manners**, not a dump of every engine knob.

### Phase 3 — Authoring UI

- Boss never opens Sheets for normal work.
- UI writes through a **trusted API** (same spirit as `toki_server` + service account).
- Sheet can stay under the hood **if** the model is clean; migrate to DB only if Sheets becomes painful (concurrency, permissions, files).

---

## 8. What *not* to do

- Don’t rebuild the sheet from scratch right before the first handoff — risk &gt; reward.
- Don’t expose every Encore/BG control on day one.
- Don’t put the service account key or “anyone with the link” on a boss-facing workflow.
- Don’t design the authoring UI against **cell indices** (`K2`); design against **field names** and let an adapter map to columns.

---

## 9. Practical recommendation

| Question | Answer |
|----------|--------|
| Ship him the sheet soon? | **Yes**, with a narrow “safe columns” guide and protections. |
| Is the sheet “done”? | **For Tier A content, yes enough.** For Tier B, **standardize settings vs items, enums, and images first.** |
| Biggest structural smell? | **Board settings mixed into item rows** + **Style board-wide knobs next to theme colors.** |
| Biggest handoff risk? | Accidental Include / box / presentation toggles, not missing features. |

---

## 10. Related docs

- [PRODUCT.md](./PRODUCT.md) — product overview (still describes sheet as CMS; this file is the owner-handoff overlay)
- [DATA_MODEL.md](./DATA_MODEL.md) — live columns
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Local/Remote, proxy, multi-tenant direction
- [STYLE_GUIDE.md](./STYLE_GUIDE.md) — visual contract for boards

---

## 11. Open decisions (for later)

1. Tier A: boss gets **full Editor** or **protected ranges** only?  
2. Who owns new plate images — boss upload later, or always you?  
3. Authoring UI first vertical slice: **edit prices + New + include** only, or full item CRUD?  
4. Keep Google Sheet forever under the UI, or plan a migration off Sheets within N months?

# TokiMenu — Sheet migration notes

Living notes for the **revised sheet tabs** and runtime cutovers.  
Not a full rewrite of [DATA_MODEL.md](./DATA_MODEL.md) until every board is on Revised.

**Last updated:** 2026-08-09 (Board 1 migrated to revised)  
**Spreadsheet:** `1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10`

| Revised tab | GID | Live counterpart | Runtime status |
|-------------|-----|------------------|----------------|
| Style and Theme | `183083022` | Style and Theme (old) `1076652078` | **All boards live** (configs → this gid) |
| Board 1 Revised | `1058015863` | Board 1 `0` | **Board 1 live** (`config.js` → this gid; parser supports restructured Settings/Inventory) |
| Proteins Revised | `1420775786` | Proteins `1191392779` | Not cut over yet |

Related:

- [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md) — on-screen part names
- [OWNER_HANDOFF.md](./OWNER_HANDOFF.md) — boss Tier A / Tier B strategy
- [DATA_MODEL.md](./DATA_MODEL.md) — live (legacy) column map
- Code: `STYLE_REVISED_*` + `parseStyleThemeFromRows` in `js/menu.js`

---

## 0. How to migrate Style columns (token saver — READ THIS)

**Do not invent structure.** Fetch the tab and map headers → indices.

```bash
python3 scripts/gsheet_client.py get --json "'Style and Theme'!A1:L5"
```

### Section pattern (all revised tabs)

Every block is **three layers**, not “header then data”:

| Index (0-based) | Role | Example |
|-----------------|------|---------|
| `i` | Section **label** only (often just col A) | `Settings` |
| `i+1` | Column **headers** | `Theme Selector`, `BG Color`, … |
| `i+2` | **Data** (Settings = one row; Inventory/Themes = many rows) | `Summer`, `Secondary Color`, … |

Code helper pattern: `findRevisedSectionDataStart(rows, "settings")` → returns `i+2`.

**Wrong:** treat the row after the label as values (that is the header row).  
**Wrong:** reuse **legacy** `STYLE_COLUMNS` (G–Q flat layout) on the Revised tab.  
**Right:** use **`STYLE_REVISED_SETTINGS`** / **`STYLE_REVISED_THEME`** maps that match **current** headers.

### When someone inserts a column in Settings

1. Re-fetch row of headers.  
2. Shift every index **after** the insert in `STYLE_REVISED_SETTINGS`.  
3. Leave unknown new fields **parsed but not applied** until implemented.  
4. Smoke-test: theme colors, wallpaper path, blur/opacity %, spotlight type/color.

Example (2026-08): **BG Pattern** inserted at col C → Wallpaper and everything after it moved +1.

### Style and Theme (revised) — Settings columns (verified live)

One values row under Settings (excel row 3 / 0-based index 2):

| Col | Header | Index | Runtime field | Notes |
|-----|--------|------:|---------------|--------|
| A | Theme Selector | 0 | picks Themes Database row | Name match, case-insensitive |
| B | BG Color | 1 | `bgColor` | Color Picker label / hex / fill |
| C | BG Pattern | 2 | `bgPattern` | "stripes" | none → stripes using row-6 pattern colors + shared stripe anim |
| D | BG Wallpaper | 3 | `bgImage` | filename / `none` → no galaxy |
| E | BG Blur | 4 | `bgBlur` | Percent → 0–1 (`parseUnit01`) |
| F | BG Blend Mode | 5 | `bgBlendMode` | e.g. `normal` |
| G | BG Opacity | 6 | `bgOpacity` | Percent → 0–1 |
| H | BG Scroll Speed | 7 | `bgScrollSpeed` | multiplier |
| I | Presentation Speed | 8 | `slideshowSpeed` | seconds; `0` = pause |
| J | Show Github Version | 9 | `showVersion` | checkbox / 0–1 |
| K | Encore Spotlight Type | 10 | `encoreSpotlightType` | Hard \| Soft |
| L | Encore Spotlight Color | 11 | `encoreSpotlightColor` | Black \| Highlight |

### Style and Theme (revised) — Themes Database columns (verified live)

| Col | Header | Index | Runtime field |
|-----|--------|------:|---------------|
| A | Theme Name | 0 | `themeName` |
| B | Main Color | 1 | `mainColor` (text hex **or** cell fill) |
| C | Secondary Color | 2 | `secondaryColor` |
| D | Highlight Color | 3 | `highlight` |
| E | Highlight Color (Special) | 4 | `highlightSpecial` |
| F+ | Styles Glossary lists | — | **Ignore** for theme application (Wallpaper Options, Blend Modes, Color Picker, Motion Styles, Patterns, …) |

Toki Default may have **empty hex** — fills are the source of truth (`resolveColor` + xlsx fills).

### Style and Theme (revised) — what broke when we first cut over (lessons)

| Symptom | Cause |
|---------|--------|
| All colors black | Used legacy theme cols B–F; Revised theme name is **A**, colors **B–E** |
| Wallpaper missing | Read old H2 / wrong Settings col after Pattern insert |
| Spotlight always hard / black | Read old cols P/Q instead of Settings K/L (or shifted J/K) |
| Blur/opacity wrong | `"100%"` via `Number()` → NaN → defaults (fixed in `parseUnit01`) |

### Percents (implemented)

`parseUnit01` accepts:

- `0`–`1` decimals  
- strings ending in `%` → divide by 100  
- bare values &gt; 1 treated as percent (e.g. `100` → 1)

Prefer unformatted `numberValue` when available; CSV/formatted path still works with the rules above.

---

## 1. Structural direction (accepted)

Revised tabs split each sheet into labeled blocks:

| Block | Role |
|-------|------|
| **Settings** | Label → headers → **single** control row (board-wide or box-wide) |
| **Inventory** | Label → headers → one row per menu / box item |
| **Themes Database** | Theme name + color palette (Style only) |
| **Styles Glossary** | Dropdown source lists only — not applied per theme row |

This replaces “first filled cell in a long column wins” mixed into item rows. Keep this pattern when revising Boards 2–3, Sauces, Drinks, Board 4.

---

## 2. Percents replacing 0–1 for effect limits

### Decision

For continuous **0–1 effect limits** (today: **BG Blur**, **BG Opacity**), the Style Settings cells use Google Sheets **Percent** number format.

Intent:

| Display (Sheets UI) | Stored number (API `numberValue`) | Meaning for the board |
|---------------------|-----------------------------------|------------------------|
| `0%` | `0` | Effect off / none |
| `50%` | `0.5` | Half strength |
| `100%` | `1` | Full strength |

Same idea for any future 0–1 “amount” knobs (veil strength, dim, etc.). **Not** for discrete flags (Include, New, Show Version) — those stay checkbox / 0–1 boolean.

### Code

`parseUnit01` in `js/menu.js` handles formatted `"100%"` / `"20%"` and unformatted `0`–`1`. See §0.

### Author guidance (Style Settings)

- Format Blur / Opacity cells as **Percent**.
- Enter `0` for off, `1` for full (Sheets shows `0%` / `100%`).
- Prefer real percent-formatted numbers over typing the characters `100%` as free text.

---

## 3. What the values API does *not* show

When reviewing sheets with `spreadsheets.values.get` (formatted strings only), several intentional authoring patterns are invisible or misleading:

| Sheet UI | What formatted values show | What runtime needs |
|----------|----------------------------|--------------------|
| **Checkbox** columns | Often `"0"` / `"1"` (or TRUE/FALSE) | Boolean via `parseYesNo` / `parseInclude` — already supported |
| **Percent** cells | `"100%"` | Unformatted `0`–`1` (see §2) |
| **Cell fill** as color | Empty string if no hex typed | Background fill from grid / xlsx styles (already used for theme + box colors) |
| **Data validation** lists | Just the chosen string | Glossary columns supply the list; code does not need the validation rule |

**Toki Default example:** Main/Secondary text may be blank; Highlight / Special can be fill-only (`#26BBCB`, `#FFB703` on fills). That is intentional — the Sheets color picker is more layperson-friendly than typing hex. Runtime already resolves **text hex first, then cell fill**.

**Implication for reviews and tools:** prefer `includeGridData` (or the existing xlsx style pipeline) when judging “is this theme row empty?”

---

## 4. Glossary design notes (Style and Theme revised)

### Color Picker column and `none` first

The Color Picker glossary lists **`none` as the top option** on purpose:

- Data validation can include the **full column** for fields that allow “no image / no stripe / off” (e.g. wallpaper, some stripe cases).
- Other dropdowns can **exclude the first option** (`none`) while still using the rest of the growing list (main / secondary / highlight / special / override).

Do not alphabetize this list without updating every validation range that depends on “skip row 1 of the list.”

### Wallpaper Options / Blend Modes / Motion Styles

These are **Styles Glossary** source lists, not “apply this wallpaper when theme = Ocean Punch.” Board-wide BG wallpaper and blend live only in **Settings**.

### Motion Styles (future)

Glossary already includes seeds such as `shout`, `ken burns`.

**Planned:** Announcement (Board 4) motion becomes a **dropdown of motion styles**, not a single Shout toggle. New styles are added by:

1. Appending a label to the Motion Styles glossary (and data validation).
2. Implementing the named style in the renderer.

See §6.

### Case on glossary labels

Mixed Title Case vs lowercase is **not** standardized yet. Runtime resolves color labels case-insensitively today. A single convention will be chosen later; until then do not rely on exact case in new code.

---

## 5. Revised tab decisions (exception log)

Recorded from author review 2026-08-09:

| # | Topic | Decision |
|---|--------|----------|
| 1 | Blur / Opacity | Percent format; migrate parsers (§2) |
| 2 | Protein **New / Image / Include** | **Keep** for later presentation rollout (§6) |
| 3 | Motion Styles column | **Future** Announcement dropdown (§6) |
| 4 | 0/1 vs Yes/No | Sheets UI is **checkbox**; underlying 0/1 is fine |
| 5 | Show Github Version | **Off** for now; feature (and similar) may move to a **Debug** sheet/tab later |
| 6 | Boneless Wings Include off | **Demo** for the boss (item dropped; shows how Include works) |
| 7 | Toki Default empty hex | **Fill colors** are the source of truth when hex text is blank |
| 8 | `none` top of Color Picker | **Validation range trick** (§4) |
| 9 | Label case | Standardize later |
| 10 | Pilot only Style + Board 1 + Proteins Revised | Style+Theme now on all boards; others later |

---

## 6. Future implementation (not built yet)

### 6.1 Footer box items in the presentation cycle

**Columns reserved on Proteins Revised Inventory:** New, Image, Include (and later a priority / “include in presentation” flag as needed).

**Intended behavior (sketch):**

1. Slideshow / Encore runs through **menu list** items as today.
2. After the **last menu item**, presentation **rolls into footer boxes** that opt in (highest **priority** first).
3. While in a box: **highlight each box item** in turn; show that row’s **Image** in the **Hero Panel** (see [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md)).
4. **Presentation style** (Slideshow vs Encore, speed, spotlight, etc.) is **inherited from Style Settings**, not redefined per box.

Open product details to lock before coding:

- Priority field location (column vs Settings order of boxes)
- Whether Sauces / Drinks boxes use the same columns
- What happens when Image is blank (skip item vs hold previous Plate)
- Interaction with Family Portrait / Encore collage

### 6.2 Announcement motion styles

Replace boolean-only **Shout** with a **Motion Style** dropdown driven by the Style glossary list. Architecture should treat styles as named strategies so new motions are additive.

### 6.3 Debug surface

Version stamp and other author-only knobs may leave the boss-facing Style Settings and move to a **Debug** tab or advanced section.

### 6.4 Sheet language ↔ UI nomenclature

After [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md) is accepted, **rename sheet headers / notes** to match (Hero Panel, Plates, Menu List, Footer Boxes, etc.) so the sheet and the design speak the same language.

---

## 7. Parser / cutover checklist

### Style and Theme (revised, gid `183083022`)

- [x] Detect Settings / Themes Database sections (label → headers → data)
- [x] Map Settings columns via `STYLE_REVISED_SETTINGS` (not legacy G–Q)
- [x] Map Themes Database A–E via `STYLE_REVISED_THEME`
- [x] Percent-aware `parseUnit01` for Blur / Opacity
- [x] Theme Selector → Themes Database name match; fills when hex blank
- [x] Board 1 `config.js` points `styleThemeGid` at Revised
- [x] Wire **BG Pattern** (col C): parsed in Settings; Pattern Color 1/2 dropdown labels (cols K/L) read from chosen theme row, falling back to Toki Default / row 6 when blank (inheritance for defaults); resolved via `resolveNamedThemeColor` against current theme palette (supports highlight etc.); re-uses stripe anim on `#bg-pattern`
- [x] Hooked revised "Style and Theme" (gid 183083022) to all boards (config2/3/4 + name updates for tab rename)
- [x] Board 1 data migrated to gid 1058015863 (restructured Settings top + Inventory headers below; parser + attach updated; config updated)

### Board / Proteins Revised (pilot done; full rollout later)

- [x] Board Settings single row + Inventory items; `Columns?` Auto|1|2|3 (Board 1 migrated; parser updated for restructured layout)
- [ ] Protein Settings + Inventory; ignore or implement New/Image/Include per §6
- [x] Style+Theme revised hooked to boards 2–4 (via config*.js + name handling)
- [x] Point board gid for Board 1 at Revised (1058015863); others pending
- [ ] Mirror pattern to remaining boards and Sauces
- [ ] Update [DATA_MODEL.md](./DATA_MODEL.md) + configs; bump `schemaVersion` when freezing

---

## 8. API tips for future sheet reviews

```text
# Formatted strings only (hides fills, percent raw, checkbox truth sometimes):
python3 scripts/gsheet_client.py get --json "'Style and Theme'!A1:I20"

# Prefer grid / unformatted when auditing types:
# spreadsheets.get includeGridData + effectiveValue.numberValue / boolValue
# + effectiveFormat.backgroundColor + numberFormat
```

Until `gsheet_client.py` grows helpers for fills and unformatted numbers, treat empty color cells as **unknown** unless fills were fetched.

# TokiMenu — Sheet migration notes

Living notes for the **revised sheet tabs** and the runtime changes they will require.  
Not a full rewrite of [DATA_MODEL.md](./DATA_MODEL.md) until revised tabs go live.

**Last updated:** 2026-08-09  
**Spreadsheet:** `1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10`

| Revised tab | GID | Live counterpart |
|-------------|-----|------------------|
| Style and Theme Revised | `183083022` | Style and Theme `1076652078` |
| Board 1 Revised | `1058015863` | Board 1 `0` |
| Proteins Revised | `1420775786` | Proteins `1191392779` |

**Status:** Draft schema. Live boards still point at the non-Revised gids. Do not cut over until parsers understand the sectioned layout (and the notes below).

Related:

- [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md) — **truth source** for on-screen part names (Hero Panel, Plates, …)
- [OWNER_HANDOFF.md](./OWNER_HANDOFF.md) — boss Tier A / Tier B strategy
- [DATA_MODEL.md](./DATA_MODEL.md) — live column map

---

## 1. Structural direction (accepted)

Revised tabs split each sheet into labeled blocks:

| Block | Role |
|-------|------|
| **Settings** | Single control row (board-wide or box-wide) |
| **Inventory** | One row per menu / box item |
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

### Why this matters for code

Sheets **formatted** value API often returns the string `"100%"` / `"0%"`, not the number `1` / `0`.

Current `parseUnit01` in `menu.js` does roughly `Number(raw)`. That yields:

| Formatted cell | `Number(...)` | Result today |
|----------------|---------------|--------------|
| `"100%"` | `NaN` | Falls back to default (blur → 0, opacity → 1) |
| `"50%"` | `NaN` | Same problem |
| `"1"` (number format) | `1` | Works |
| unformatted `numberValue: 1` | — | Works if we read it |

**Migration rule for loaders:**

1. Prefer **unformatted** number (`numberValue` / `valueRenderOption=UNFORMATTED_VALUE` / xlsx raw) when the column is a 0–1 effect.
2. If only a string is available, accept:
   - plain `0`–`1` decimals
   - percent strings: strip `%`, divide by 100 when absolute value &gt; 1 **or** when the string ends with `%`
3. Always clamp to `[0, 1]`.

### Author guidance (Style Settings)

- Format Blur / Opacity cells as **Percent**.
- Enter `0` for off, `1` for full (Sheets shows `0%` / `100%`).
- Do not type the characters `100%` as free text if you can avoid it — use a real percent-formatted number so collaborators see a consistent UI.

### Observed (2026-08-09 Style Revised Settings)

Via grid API: Blur and Opacity both `formattedValue=100%`, `numberValue=1`, `numberFormat=PERCENT`.  
Until the parser migrates, **formatted CSV path will misread these**; unformatted / fill-aware xlsx path can still recover `1`.

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

## 4. Glossary design notes (Style Revised)

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
| 10 | Pilot only Style + Board 1 + Proteins Revised | Boards 2–3 / Sauces / Board 4 later |

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

## 7. Parser / cutover checklist (when ready)

- [ ] Detect sectioned tabs (Settings / Inventory / Themes Database) vs legacy flat headers
- [ ] Map Style Settings: Theme Selector, BG Color, BG Wallpaper, Blur, Blend, Opacity, Scroll, Presentation Speed, Show Version, Encore Spotlight Type/Color
- [ ] Parse Blur / Opacity with **percent-aware** 0–1 logic (§2)
- [ ] Theme palette: hex text **or** cell fill; Theme Selector matches Themes Database names
- [ ] Board Settings single row + Inventory items; `Columns?` Auto|1|2|3
- [ ] Protein Settings + Inventory; ignore or implement New/Image/Include per §6
- [ ] Point `styleThemeGid` / board gid / `proteinSheetGid` at Revised gids only after smoke test
- [ ] Mirror pattern to remaining boards and Sauces
- [ ] Update [DATA_MODEL.md](./DATA_MODEL.md) + configs; bump `schemaVersion` when freezing

---

## 8. API tips for future sheet reviews

```text
# Formatted strings only (hides fills, percent raw, checkbox truth sometimes):
python3 scripts/gsheet_client.py get --json "'Style and Theme Revised'!A1:I20"

# Prefer grid / unformatted when auditing types:
# spreadsheets.get includeGridData + effectiveValue.numberValue / boolValue
# + effectiveFormat.backgroundColor + numberFormat
```

Until `gsheet_client.py` grows helpers for fills and unformatted numbers, treat empty color cells as **unknown** unless fills were fetched.

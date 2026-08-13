# TokiMenu — Reading the Debug Console Flags

This document explains how the performance feature flag output works and how to read it.

**Last updated:** 2026-08-09 (Full View mode, Version Stamp location)

**Primary reference:** [PERFORMANCE.md](./PERFORMANCE.md)  
**Control source:** Google Sheet **Debug Menu** tab (gid `1793812854`)

---

## 1. Master gate (required)

Console flag output is **never sent automatically** unless **both** of these are `TRUE` in the **Debug Menu** tab:

1. **Debug Mode** = `TRUE` (top master switch)
2. **Performance Console** = `TRUE` (under Debug Features)

Only when **both** are true does the menu emit the `TokiMenuDebug` table on load and on important state changes.

If either is `FALSE`, the code stays completely silent on the flag channel (no spam).

You can still inspect state manually at any time (see below).

---

## 2. How to enable

In the Google Sheet:

1. Go to the **Debug Menu** tab.
2. Set the cell under **Debug Mode** to `TRUE`.
3. Under **Debug Features**, set **Performance Console** to `TRUE`.
4. (Optional) Set other future columns (e.g. Version History) as needed.
5. Save. Boards soft-refresh (or hard reload for immediate effect).

Example current shape (as of 2026-08-09):

```
Debug Mode
TRUE

Debug Features
Performance Console   Version History   Full View   ...
TRUE                  FALSE             FALSE       ...
```

- **Full View** = TRUE (with Debug Mode) expands the floating HUD to natural content height with no body scroll — useful on Fire Stick / devices without mouse. The HUD sizes to fit the entire list instead of scrolling.

---

## 3. The console output

When the gate is open you will see something like:

```
[TokiMenu bowls index.html] DEBUG menu ...
TokiMenuDebug — feature flags (active = actually doing work)
id                  active  impact         source
-----------------------------------------------------------
encore                no   Very High      config
familyPortrait        YES  Very High      config
kenBurns              no   High           config
spotlightVeil         no   High           config
...
bgBlur                no   High           config
bgDualPan             YES  High           config
softRefresh           YES  Medium         config
...
```

### Columns explained

| Column | Meaning |
|--------|---------|
| `id` | Stable machine name for the feature (use this with `.set()`) |
| `active` | `YES` = the feature is **currently doing work** (DOM, RAF, timers, filters, etc. are live). `no ` = it is not contributing cost right now. |
| `impact` | From PERFORMANCE.md (Very High / High / Medium / Low / Very Low). Use to prioritize what to kill when hunting Fire Stick hitching. |
| `source` | Why it is in this state:<br>• `config` — follows the Style / Board / normal runtime config<br>• `console` — you overrode it via `TokiMenuDebug.set()`<br>• `wall-lean` — `preview-all` or `?preview=all` forced a cheaper path<br>• `forced-off` (rare, internal) |

A line ending in `(forced)` means a console override is currently in effect.

---

## 4. Using the console API (always available)

Even when the sheet gate is closed, you can open DevTools and run:

```js
TokiMenuDebug.list()           // pretty table + returns the object
TokiMenuDebug.snapshot()       // raw object, good for copy/paste
TokiMenuDebug.get('bgBlur')    // details for one flag

TokiMenuDebug.set('bgBlur', false)   // hard kill blur work
TokiMenuDebug.disable('encore')      // attempt to suppress encore path
TokiMenuDebug.enable('softRefresh')

TokiMenuDebug.reset()          // clear all console overrides
```

### Useful performance kill examples (see PERFORMANCE.md for kill vs hang)

```js
// Typical FPS debug session on a solo board
TokiMenuDebug.set('bgBlur', false);
TokiMenuDebug.set('bgDualPan', false);
TokiMenuDebug.set('encore', false);
TokiMenuDebug.set('softRefresh', false);

// Re-enable one at a time to find the culprit
TokiMenuDebug.set('bgBlur', true);
```

After a `set()`, if Performance Console is enabled the table will reprint automatically so you can see the new `active` + `source=console`.

---

## 5. URL helpers (quick temporary control)

- `?tokiDebug=1` (or `?debug=1`)  
  Forces one `list()` dump shortly after load, regardless of sheet. Useful for one-off inspection without touching the sheet.

- `?tokiFlags=bgBlur:0,softRefresh:0,encore:0` (future extension — not fully wired yet)

These only affect the current browser tab/session.

---

## 6. What "active" really means (examples)

| Flag | `active = YES` when... |
|------|------------------------|
| `bgDualPan` | Galaxy scroll RAF is running and wallpaper image exists |
| `bgBlur` | `#galaxy.has-blur` + filter is applied |
| `encore` | Presentation mode is encore + family-portrait stage is visible with content |
| `spotlightVeil` | Encore veil hard or soft class is present on the stage |
| `softRefresh` | The `setInterval` for sheet polling is armed |
| `heroPlate` | The Plate container (`#hero-plate`) is visible and contains an active image |
| `xlsxStyles` | Always **NO** — Drive xlsx / fills / rich text are quarantined (2026-08-13) |

This is deliberately "is the expensive thing actually happening right now", not "the config asked for it".

---

## 7. Automatic vs manual emission

- **Automatic** (the menu "sends console flags"): only when Debug Mode + Performance Console are both TRUE. Happens on cold load and when certain flags are changed via the API.
- **Manual**: `TokiMenuDebug.list()` always prints the current truth.

No per-frame spam ever.

---

## 8. Relation to Debug Menu columns

Today the Debug Menu mainly controls the **gate** (`Debug Mode` + `Performance Console`).

As you add more columns under "Debug Features" (e.g. `Encore`, `BGBlur`, `FamilyPortrait`...), the values become available in:

- `TokiMenuDebug.snapshot()` (future versions may consult sheet values for forced on/off)
- `debugConfig.features` (internal)

For now, **Performance Console** is the one that turns on the reporting stream.

---

## 9. Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| No output at all | Debug Mode or Performance Console is FALSE in the sheet |
| Output appears once then stops | Normal — it only reprints on load or when you call `set()` / changes are detected |
| `active` says YES but I hid the element in DOM | The detector looks at config + classes + timers. Use `.set('xxx', false)` to force a hard kill |
| Wall looks different | `source = wall-lean` is expected and intentional |
| `?tokiDebug=1` gives a list but normal load is silent | Expected — the URL forces one dump |

---

## 10. Live non-console views (hybrid)

In addition to (or instead of) the console, we now provide two live views that update as features turn on and off:

### A. CSS Custom Properties (Computed panel)

- When the gate is open (or you have forced overrides), CSS custom properties are set on `<html>`.
- In DevTools → **Elements** tab, select the `<html>` element.
- Go to the **Computed** (or Styles) panel.
- You will see many `--debug-*` properties, e.g.:
  ```
  --debug-encore: active
  --debug-encore-detail: active · config
  --debug-bg-blur: inactive
  --debug-bg-dual-pan: active · config
  ...
  ```
- These update **in place in real time** with no console output. This is the closest analog to the "live Computed activity" you mentioned.

### B. Floating HUD

- A small collapsible overlay appears (top-right by default).
- Shows a live table of feature / state / source.
- Click the header to collapse/expand.
- Click × to hide for the session.
- Updates automatically on state changes (no console spam).
- **Full View** (Debug Features column): when enabled the HUD uses natural height and shows every row without internal scrolling.
- When **Show Version** is active the build stamp (hash + date) is appended to the "Toki Debug" header title (e.g. "Toki Debug · a1b2c3d · 2026-..."). It no longer replaces the disclaimer.

Both are driven from the same `updateDebugVisuals()` logic.

### C. Still have the console API

`TokiMenuDebug.list()`, `.set()`, `.watch()`, etc. continue to work exactly as before.

## 11. Quick start checklist

1. Open Debug Menu tab → set Debug Mode = TRUE + Performance Console = TRUE.
2. Hard reload one board (or wait for soft refresh).
3. **For live view without spam**: Select `<html>` in Elements → look at Computed for `--debug-*` vars. Or look at the floating HUD.
4. Open DevTools console if you also want the snapshot table.
5. Run `TokiMenuDebug.set('bgBlur', false)` — watch both the HUD and the Computed vars update instantly.
6. When done, set the two cells back to FALSE so production boards stay quiet.

See also: [PERFORMANCE.md](./PERFORMANCE.md) for the full cost table and isolation strategy.

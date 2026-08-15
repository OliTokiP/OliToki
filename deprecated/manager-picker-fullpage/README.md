# Archived Menu Manager picker (full-page)

Saved 2026-08-15 during TokiSettings QA1.

This was the first prototype dropdown: a full-bleed Settings-style overlay
(highlight frame, black title bar, scrolling option list, fake “L” checkmark).
QA1 replaced it with a centered rounded card + shroud (see `css/manager.css`
`.picker` and `renderPicker()` in `js/manager.js`).

To compare or revert the look:

- `picker.css` — overlay / panel / option / checkmark rules from before QA1
- `renderPicker.js` — the markup builder from before QA1

Paste the CSS back over the `/* —— Picker overlay —— */` block and restore
the JS function. Confirm-on-back (`Yes` / `No` / `Keep Editing`) was never
in this overlay; it lives on `.dialog-card`.

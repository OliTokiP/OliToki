# QA Protocol

**Purpose:** Consistent, repeatable, and portable QA between the live menus and the Menu Manager preview.

**Truth sources:**
- [MOTION_GLOSSARY.md](MOTION_GLOSSARY.md) — what each Motion Style must do
- [UI_NOMENCLATURE.md](UI_NOMENCLATURE.md) — names and structure
- Live code: `js/menu.js`, `css/menu.css`

---

## 1. Where QA lives

- QA now lives in the iCloud Obsidian vault **OliToki Menu → QA**.
- Apple Notes originals are left alone (rewrites corrupt screenshots).
- Ticket shape is being chosen in `QA/Ticket styles/`. Until a style is picked, don’t invent a fifth format.

---

## 2. Note format (multi-pass)

Ticket shape is on trial in the vault (`QA/Ticket styles/`). Until one wins, don’t invent a fifth.

```
QA Round N-g
intro line (original note was not edited)

1. Short name of the item
   Bug
   the original report
   Pass 1
   what changed
   Feedback 1
   user’s notes (leave empty for them)
   Pass 2
   …
```

**Rules:**
- One numbered section per item.
- Subheads in order: `Bug`, `Pass 1`, `Feedback 1`, `Pass 2`, `Feedback 2`, …
- Add the next `Pass` only after the user has written that round’s `Feedback`.
- Use Notes fully: titles, bold, lists, line breaks. Paste screenshots as images, not table cells.
- Every `Pass N` must cite the Motion Glossary section when the item is motion.
- Obsidian is the home. Four candidate ticket styles live in the vault under `QA/Ticket styles/`.

---

## 3. Current process

1. **Extract** the QA note (text + images) into `/tmp/qa-round-N/` without modifying the original.
2. **Read** the note and any referenced PDFs or images.
3. **Create** the `-g` note using the multi-pass table above.
4. **Implement** using the Motion Glossary as the spec:
   - Never invent preview-only timings.
   - Scale **pixel sizes** (hole radius, pinch, shadow) to the form factor.
   - Measure mock geometry in its native page units (currently 400×300).
   - Number highlights, food placement, and Encore must match the glossary exactly.
5. **Verify** with screenshots at the native device width.
6. **Update** the `-g` note with the results of the pass.
7. **Repeat** until the user marks the item as resolved.

**Presentation Speed** is left as `0 = stop / ≥1 = go` until the live sheets are wired.

---

## 4. Future: Mobile QA loop

Goal: Allow the user to run QA and give feedback entirely from a phone or Fire Stick without returning to the computer.

**Planned approach**
- The Menu Manager preview runs in the phone’s browser (same URL used for LAN preview).
- A lightweight “QA mode” (toggle or query param) shows the current item + a simple feedback form that writes directly into the corresponding row of the `-g` note (via a small backend or Google Form → Notes bridge).
- The agent monitors the note (or a shared sheet) and responds with the next `Pass N` column.
- All visual QA (screenshots, overlay checks) can be done on-device; the glossary is the single source of truth so the agent can implement without desktop verification.

**Open questions to resolve later**
- How feedback is captured on-device (form, voice note, quick text).
- How the agent is notified of new `Feedback N` entries.
- Whether the mobile preview needs a “mirror” view that shows both the live board and the manager preview side-by-side.

This section will be expanded once the mobile QA tooling is built.

---

## 5. Related documents

- [MOTION_GLOSSARY.md](MOTION_GLOSSARY.md) — required reading before any Encore / Ken Burns / Slideshow work
- [UI_NOMENCLATURE.md](UI_NOMENCLATURE.md) — canonical names
- [MOTION_REFACTOR.md](MOTION_REFACTOR.md) — clock and handoff intent
- [MENU_MANAGER.md](MENU_MANAGER.md) — preview rules and file layout

---

**Last updated:** 2026-08-15 (heading-based -g notes; no tables; Obsidian as a possible later home)
# Documentation maintenance

**Last updated:** 2026-08-11 13:15  

How to keep TokiMenu docs honest, timestamped, and useful.

---

## 1. When to update docs

| Change type | Update |
|-------------|--------|
| New product feature (behavior bosses care about) | [WHATS_NEW.md](./WHATS_NEW.md) **+** the domain doc (DATA_MODEL, BETA_FEATURES, SHEET_MIGRATION, etc.) |
| Sheet column add/rename/shift | SHEET_MIGRATION + DATA_MODEL (or note “live headers” in SHEET_MIGRATION) |
| Architecture / load path | ARCHITECTURE.md |
| Footer geometry / CSS contracts | FOOTER_BOXES.md / STYLE_GUIDE.md |
| Performance toggles | PERFORMANCE.md + DEBUG_CONSOLE.md if console surface changes |
| Naming of on-screen parts | UI_NOMENCLATURE.md |

Skip docs for pure refactors with **no** user-visible or sheet-facing change — unless they fix a documented lie.

---

## 2. Timestamps (required)

- Put **Last updated:** `YYYY-MM-DD HH:MM` (local) near the top of every living doc you touch.
- In [WHATS_NEW.md](./WHATS_NEW.md), each entry gets a full stamp and a short title.
- Prefer the same clock as the machine doing the work (no need for timezone math).

---

## 3. How to add a What’s New entry

1. Open `docs/WHATS_NEW.md`.
2. **Prepend** a new section (newest first).
3. Template:

```markdown
## YYYY-MM-DD HH:MM — Short title

**Boards / surface:** e.g. boards 1–3 footer boxes  
**Sheet:** columns or tabs touched (or “none”)  
**Summary:** 2–5 sentences on behavior.

### Details
- Bullet the behavior, not the file list.
- Call out defaults and opt-in flags.

### Docs updated
- Link sibling docs you also edited.
```

4. If the feature supersedes an older sketch in SHEET_MIGRATION / DATA_MODEL, **edit that sketch** so it doesn’t contradict What’s New.

---

## 4. Style

- Write for a future engineer **and** for the owner scanning “what shipped.”
- Prefer product language from [UI_NOMENCLATURE.md](./UI_NOMENCLATURE.md) (Alpha Menu vs Box Menu, Family Portrait, Encore, etc.).
- Do not paste large code blocks; link to symbols or paths instead.
- Never commit secrets or sheet keys in docs.

---

## 5. README index

When you add a **new** top-level doc, add one row to [README.md](./README.md) in the table.

---

## 6. Agents / sessions

If you implement a major feature in a session, end with:

1. Code working  
2. WHATS_NEW entry  
3. Domain doc patches  
4. This file’s timestamp bumped if process guidance changed  

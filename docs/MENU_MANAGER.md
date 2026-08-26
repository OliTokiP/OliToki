# OliToki Menu Manager

**Last updated:** 2026-08-26 (Edit Image tutorial popup + larger sliders) 
**Status:** mobile layout + sheet read + Theme / Background write + Board Settings write (A3/B3/C3/G3)

Boss-facing mobile web app for authoring look, feel, and (later) menu content. This is the start of **Tier B** in [OWNER_HANDOFF.md](./OWNER_HANDOFF.md). Boards stay on the sheet CMS until board screens ship.

Open: [`manager.html`](../manager.html) via **Open Toki Menus** → **Open Menu Manager**, `toki_server.py`, or any static server. Env skip-UI: `TOKI_OPEN_MANAGER=1`.

Related: [PRODUCT.md](./PRODUCT.md) · [STYLE_GUIDE.md](./STYLE_GUIDE.md) · [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) · mockup `mockups/TokiSettings.pdf`

---

## 1. What this prototype is

A navigable mobile layout that **reads** the live sheet on boot:

- Splash → System Settings / Menu Settings
- Style and Theme editor with a live presentation preview
- Board 1–3 + Announcements **Coming Soon** placeholders
- Full-view Settings-style dropdowns
- Confirm-on-back (Yes / No / Keep Editing), unless **Confirm save?** is No — then each option writes as soon as it changes

It should feel like a polished iPhone Settings app. Desktop is a centered phone frame on a studio background; phones use the full viewport and `env(safe-area-inset-*)` so Dynamic Island / camera cutouts do not inflate the header.

---

## 2. Theme contract (read this)

| Layer | When it updates |
|-------|-----------------|
| **This app’s chrome** | Immediately, from a **draft** cache (CSS variables) |
| **TV boards** | After a write of Theme, Background, speeds, Encore extras, or board Settings — immediately when **Confirm save?** is No; otherwise after Confirm-on-back **Yes**. Boards pick the cells up on their next sheet load |

Draft loads from **OliToki Menu Settings** + the chosen catalog’s **Style and Theme** tab (`js/manager-sheet.js` → `/api/settings` and `/api/sheets/csv`, public CSV fallback if the proxy is down). System chrome — Require restart, System Font, Refresh Timer, Limit Heavy Filters, Confirm save?, Debug Mode — comes from **that catalog’s Settings row** (Restaurant **A2–G2**, Beta **A3–G3**, next source the next row). Switching Data Source reapplies that row immediately on System Settings (no Confirm dialog). `js/manager-data.js` is the offline stand-in only. **Yes** on confirm leaves immediately (then writes in the background). Writes go same-origin first (`POST /api/manager/style`). It sends the Theme dropdown and the **Background** conglomerate on the **selected catalog**. The UI sends field names; the server adapter maps Theme Selector (**A3**), BG Color (**B3**), BG Pattern (**C3**), BG Wallpaper (**D3**). Pattern wins on the live board, so a color or wallpaper choice writes `none` into the unused of C/D. **BG Scroll Speed** (**H3**) and **Presentation Speed** (**I3**) write when those pills change. Encore children — Spotlight Type (**K3**), Spotlight Color (**L3**), Background Color (**M3**) — are **global** even when edited on a board. Board Yes also persists dirty Style fields. **Yes** also overwrites `data/manager-fallback.json` when `toki_server` is up. Pages cannot write — the key stays on the Mac. **No** reverts to the last loaded sheet values.

**Confirm save?** is per catalog (that row’s Confirm save? cell). It applies to Style and Theme (theme, background, speeds) and Board editors (title, family portrait, presentation mode, Encore extras, descriptions, menu-item order). **Yes** (default) = Confirm-on-back before any sheet write. **No** = skip the dialog; each change writes immediately (`POST /api/manager/style`, `/api/manager/board`, `/api/manager/settings` as needed) so the catalog and TVs update on the next board refresh — except menu-item reorder, which waits 3 seconds of idle so a drag session is one write, and **except Edit Item / Create Item**, which always Confirm-on-back. That order write is a background save: it must not open Confirm Changes or close Edit Item / Create Item if the editor is open when the idle fires. Item Yes with Confirm save? **Yes** keeps the row in the app until Board Back Yes writes Inventory; Board Back No reverts those item edits. The Confirm save? toggle itself always writes the moment it is changed, whether it was on or off. Data Source never prompts Confirm — it only switches which catalog row you are editing.

**Debug Mode** (System Settings, between Confirm save? and Links) is a **per-catalog Settings column** — header **Debug Mode**, Restaurant **G2**, Beta **G3**. Yes shows the Toki Debug HUD on the TV boards that read that row; No hides it. Dining-room TVs keep the Restaurant cell (`GET /api/settings` top-level). Switching Data Source loads that row’s Debug Mode the same way as Require restart. Debug Features (Performance Console, Full View, …) stay on the **Debugger** tab. Menu Manager itself does not get a debug console. Tooltip preview: `?tip=debug`.

Toki Default tokens match [STYLE_GUIDE.md](./STYLE_GUIDE.md): Main `#000000`, Secondary `#FFFFFF`, Highlight `#26BBCB`, Highlight Special `#FFF900`. Other palettes are catalog seeds (several from `themes-to-paste.csv`).

Outlines use a darkened Highlight. Child rows (pattern / wallpaper / encore extras) use a lightened Highlight.

---

## 3. Screens

| Route | Screen |
|-------|--------|
| `#/` | Splash — OliToki Menu Manager. |
| `#/system` | System Settings (Data Source, Require Restart, System Font, Confirm save, Debug Mode, Sheet link). Data Source is the catalog you are **editing** — it selects that catalog’s Settings row and does not write column A as a TV pointer. |
| `#/menu` | Menu Settings index |
| `#/menu/style` | Style and Theme |
| `#/menu/board/1` … `/3` | Board editor (title, family portrait, presentation, descriptions, drag-reorder items) |
| `#/menu/board/1/item/new` … `/item/0` | **Beta:** Create Item / Edit Item (Inventory fields + photo) |
| `#/menu/board/1/item/0/image` | **Beta:** Edit Image (`.menuimg` 1500×1000 guide + sliders) |
| `#/menu/board/4` | Announcements (title + permalink; schema differs) |

Shared top slot (System + Menu Settings): Data Source, Current Theme, the four theme hexes (colored), Require restart, Version. No sheet-source line. No fake “Menus on” until board include is real.

QA query extras on Style: `?pick=theme`, `?pick=background`, `?bg=pattern`, `?bg=wallpaper`, `?pres=encore`, `?encore=old`, `?theme=Halloween`, `?confirm=1`, `?confirmsave=yes` / `?confirmsave=no` (forces Confirm save? for this session without writing the sheet). **`?beta`** selects **Beta (Development) Copy** and gates unshipped Manager UI (Announcements editor, Item editor). Tooltip preview: `?tip=stack`, `?tip=family`, `?tip=encore`, `?tip=save`, `?tip=restart`, `?tip=restart-no`, `?tip=filter`, `?tip=debug`, `?tip=hard`, `?tip=hard-shadow`, `?tip=encore-save`, `?tip=order`, `?tip=board-save`. Splash overlay: `#/?tip=save` (home-hero shroud). Settings overlay: `#/system?tip=save` then Back to watch the stack box ease into splash.

---

## 3a. Data Source (catalog workbooks)

Manager drives **two** workbooks:

| Workbook | What it is |
|----------|------------|
| **OliToki Menu Settings** (`1OwNKHzjP…`) | Always. Per-catalog chrome rows (incl. Debug Mode) + Gsheet name / URL list. Debugger tab is Debug Features only |
| **Selected catalog** | Restaurant Copy or Beta (Development) Copy — theme, boards, items |

Settings tab chrome is **one row per catalog**, next to the Data Source name:

| Row | Catalog | Cells |
|-----|---------|--------|
| **A2–G2** | Restaurant Copy | Require restart, System Font, Limit Heavy Filters, Refresh Timer, Confirm save?, Debug Mode |
| **A3–G3** | Beta (Development) Copy | Same columns for Beta |
| **A4…** | Next source | Same columns as we add catalogs |

The Data Source picker is the **Settings catalog** (Gsheet name / Gsheet URL rows), not a hardcoded Alpha/Restaurant pair. Local Manager always lists **Beta (Development) Copy** (`1Bh5pbaBUT5kzANZg_r_ELGxEkphOty4uNyg92ZDBMs8`) even if the live catalog fetch is late. Picking a catalog loads that row’s chrome on the same System Settings screen (font, require-restart, timer, confirm-save, debug mode) and the catalog’s Style + boards. It does **not** prompt Confirm Changes.

**Data Source is which workbook — and which Settings row — you are editing.** Column A is the row’s name, not a TV pointer; writes go to that row via `POST /api/manager/settings` with `sourceId`. TVs keep reading the Restaurant row unless the board URL has `?beta`. Copy-permalink and board links append `?beta` while you are on Beta. `manager.html?beta` is the same switch plus unshipped Manager UI (Announcements editor). Alpha is retired as a first-class Manager target; if the sheet still lists it, it is just another catalog row. Debug Mode is that row’s **G** cell, not a global Debugger checkbox.

---

## 4. Style and Theme fields

Context-driven children (same idea as the mockup):

| Parent | Reveals |
|--------|---------|
| Background = a theme color | (none — color also clears pattern/wallpaper) |
| Background = Pattern | Pattern Type, Pattern Color 1 / 2, BG Scroll Speed |
| Background = Wallpaper | Wallpaper Type, BG Scroll Speed |

After those Background children, Style and Theme shows **Presentation Speed**, then the New Theme bar. Presentation Style and Encore Spotlight Style / Color / Background are **not** on this screen.

Pattern Color 1 / 2 are per-theme (Themes Database K/L on the selected row). The Style preview updates from the draft immediately; Confirm Yes writes those cells so TV boards (`#bg-pattern`, Board 4 `#stripes`) pick them up on the next sheet load.

Preview (sticky under the header) is a **scaled crop of the live board**, not a second motion system. Slideshow / Ken Burns call `TOKI_MOTION.heroPunchIn` / `heroPunchOut` in `js/motion.js` — the same functions as the live board. Encore calls `TOKI_MOTION.encorePunchIn` / `encorePunchOut` on `#family-portrait-stage`. The 848.1×1080 lattice is cover-scaled into the photo box using `--device-w` (not `100cqi` — Fire Stick Silk has no container query units). Treatments: `css/motion.css`. Top slot height is the same `--top-slot-h` as System Settings.

Presentation Speed `0` = stop, `≥1` = go. Presentation Style is per-board and is **not** loaded from the sheet — Style screen defaults to Ken Burns. Create New Theme is gated (toast only).

**Board editor (1–3):** hamburger handles drag-reorder Menu Items. Confirm-on-back Yes writes **Menu Title**, **Family Portrait** (0/1), **Presentation Mode** (`slideshow` / `ken burns` / `encore`), **Include Descriptions?** (0/1), and — if the list moved, items were edited/added, or an item was deleted — the **Inventory** block (`POST /api/manager/board`, prune missing rows). When Presentation Style is **Encore**, child rows appear for Spotlight Style, Spotlight Color, and Encore Background; those write the global Style **K3 / L3 / M3** cells (`POST /api/manager/style`) the same way as other dirty Style fields. When **Confirm save?** is No, those fields write on change; item reorder waits **3 seconds of idle** before the Inventory write (so a drag session is one API call). Opening **Edit Item** / **Create Item** during that idle flushes the order write in the background — it must not open Confirm Changes or close the item editor. Permalink Yes saves those cells then opens the URL. Shared footer bar (`Add Item` / `New Theme`): plus stays left, label is centered on the bar. Dragging a row morphs **Add Item** into **Delete Item** (trash); the hamburger must pass 50% of the footer height to arm. **Beta** (`?beta` or Beta catalog): tapping a Menu Item name opens **Edit Item**; **Add Item** opens **Create Item**. Items with Include off get a light red pill and `(!)` after the name. Non-beta keeps `Add Item From Toast` (Coming Soon) and names are not tappable.

**Edit Item / Create Item (beta):** manager chrome (uniform rows, pickers). Item editor **always** Confirm-on-back (Yes / No / Keep Editing), even when **Confirm save?** is No. A pending menu-item reorder from the board list saves in the background and does not prompt to save or close this screen. Mini Display: centered Plate Image over the live theme, footer line `Item Name (Item Subtitle) - Item Prices` (subtitle + prices smaller, same color, prices joined with ` | `), Item Description under that when Include Descriptions is on. **Mark as new?** tints that line Highlight Special and plants the New sticker at the bottom-right of the photo. Description taps open a larger textbox (fixed height, no resize handle; closed row truncates). Subtitle label matches other rows; only the Optional placeholder is dim. Option rows share one min-height; long values ellipsize. Pricing Model is Fixed-Portion / Linear Tiered / Volume Bundling (max 3 tiers; Add Tier is its own row). Tier chips open a dialog with the sizing vs piece-count hint. New items default **Mark as new?** Yes and **Include in board?** No. Image empty = **Upload New Image**, which opens the transparent-background **tutorial popup** (looping `assets/tutorials/iphone_longpress_tutorial.mp4`, swipeable copy, **Upload Image** on the last slide). The device picker runs from that button, not the row. On phones the picker asks for Photo Library / Files (`multiple` hides Take Photo on iOS Safari; HTML cannot forbid a Camera tile on every Android sheet). JPEG camera shots are rejected. After pick, Manager measures opaque pixels; a transparent source opens **Edit Image** with Size / X / Y pre-fit so the invisible grey box is 115% of the red square guide. An opaque source warns first (`Your item may not appear correctly because you haven't removed the background yet.`). An existing Image opens Edit Image (hash `#/menu/board/N/item/K/image`). Edit Image Yes flattens a 1500×1000 Plate Image into the item draft — it does not write the sheet. Item save (`POST /api/manager/item`) writes local `food-pics/{folder}/{Stem}.menuimg/` (`config.txt` + source webp + `display.webp`) and uploads the flattened display (Drive when configured). Image cell is the Drive URL when Drive works, else `{Stem}.menuimg`. Boards resolve `.menuimg` to `display.webp` (same 3:2 as today's food-pics). Fill from Toast stays Coming Soon. Back with missing Description / Image warns first (Subtitle is optional and is not in that list); Include No warns that the row is saved but TVs will not show it until Include is Yes. When **Confirm save?** is Yes, item Yes keeps the row in Menu Manager only; the Google Sheet waits until Board Back **Yes**. Board Back **No** reverts those item edits even if they were saved on Edit Item. When **Confirm save?** is No, item Yes writes the Inventory row immediately after the prompt. Boards 1–3 pick the Inventory row up on the next sheet load.

**Edit Image (beta):** 3:2 mini-display is the native 1500×1000 canvas (`--top-slot-h`). Red square guide is 780px native, centered. Sliders: Image Size 70–130 (100 = auto-fit, mid-slider), X ±240px, Y ±160px; thumbs are 36px with a 48px hit row. Image File shows the source name; tap (or **How?**) opens the same tutorial popup as Upload New Image — last slide **Upload Image** replaces the source. Instructions row is 2× `--row-min-h`. Back dirty → **Save changes?** (Yes / No / Keep Editing). Config:

```
Filename_1: Crunchburilla.webp
Scale_1: 100
X_1: 0
Y_1: 0
```

**Delete item (beta board list):** dragging a Menu Item morphs **Add Item** into a red **Delete Item** trash. The hamburger must pass the vertical midpoint of that footer to arm (lid tilts). Release while armed → “Delete this item?” When **Confirm save?** is No, the note adds “This cannot be undone.” When Confirm save? is Yes, the warning is omitted (Board Back No still reverts). Yes removes it from the list (sheet write follows Confirm save? the same way as other board inventory changes). No puts the row back.

**Number pills (BG Scroll Speed / Presentation Speed):** read a validator in the Settings **header label** (same public CSV as themes). House style is the cute form already on Restaurant Copy:

| Header | Pills |
|--------|--------|
| `BG Scroll Speed (0<=5)` | 0…5 |
| `Presentation Speed (0,1,2,3)` | those integers |
| `Theme Selector (='Style and Theme'!$A$6:$A$17)` | values in that range |

`[0-5]`, `[0..5]`, `(>=3)` also parse. Matching ignores the suffix (`Highlight Color (Special)` stays a name). No spec → offline defaults.

---

## 5. Files

| Path | Role |
|------|------|
| `manager.html` | Shell |
| `css/manager.css` | Layout + theme tokens |
| `js/manager-data.js` | Offline catalogs, defaults, asset paths |
| `js/manager-sheet.js` | Settings + Style and Theme + board tab read; Theme + Background write via `/api/manager/style`; board Settings via `/api/manager/board` |
| `js/motion.js` + `css/motion.css` | Shared hero motion (live board + Style preview) |
| `js/menuimg.js` | `.menuimg` package (config + 1500×1000 layout / composite); shared by Manager + boards |
| `js/manager.js` | Router, draft/commit, preview; Yes writes Theme + Background or board Settings; Edit Image |
| `scripts/toki_server.py` | `/api/sheets/validations`, `POST /api/manager/fallback`, `POST /api/manager/style`, `POST /api/manager/board`, `POST /api/manager/item` (append or update Inventory + photo + `.menuimg` package), `GET /api/manager/menuimg`, `POST /api/manager/settings` (Settings G = Debug Mode) |
| `data/manager-fallback.json` | Last Save snapshot (offline / Pages when the sheet is down) |

Add a field: option list in `manager-data.js` → picker spec + `styleRows()` branch in `manager.js` → CSS only if the chrome changes. Sheet load maps **field names** into the draft. The UI does not send column indexes — Theme + Background use the server adapter (`Theme Selector` / A3, `BG Color` / B3, `BG Pattern` / C3, `BG Wallpaper` / D3). Number options should come from sheet dataValidation when present, not hard-coded spans.

## Tooltip

The `#tooltip-root` stack (manager.html + manager.js + manager.css) is a reusable overlay for post-choice explanations. Confirm Changes and dropdown pickers stay as they are.

- **Layering:** the veil is full-device (`#tooltip-root` z-index 2) and paints in front of splash (`.home-hero`), the misc-data mini-display (`.status`), and the mini-presentation (`.preview`) only. Header, option lists, splash buttons (`.home-body`), and footer sit at z-index 5, so they stay bright and tappable. The shroud does **not** resize with the screen — chrome hides it.
- **Scaffold:** `.tooltip-scroll` tracks the current plate in layout pixels (divides out `.device` CSS scale so desktop studio and native phone match). Settings = top slot (`.status` / `.preview`); splash = `.home-hero`. It eases `top` / `height` with the same WAAPI bezier as the cards (~0.52s) so the stack re-centers. Veil opacity is WAAPI-only (no CSS snap); it fades with the last card’s wind-down.
- Screen changes do **not** clear the stack.
- Cards stack like Notification Center: oldest on top, newest below. The stack stays centered as cards enter or leave. Drop-shadow sits on the slot (filter) with height clip on an inner wrapper so the shadow is not cropped. Overflow stack is on `.tooltip-scroll` so a tall stack pans on phone and desktop.
- New cards fade and slide in (~0.4s) via the Web Animations API (not CSS transitions), so OS “Reduce Motion” does not skip them. Each auto-fades and slides out after ~6s (oldest first). Slot height animates so neighbors physically slide as the centered stack grows or shrinks (Notification Center). Tap a card to dismiss that card; tap empty stack / shroud / Escape to dismiss the stack.
- **Info:** centered bold title (hard return) + left-aligned body. Multiple lines become a `•` list (soft return between items).
- **Save:** inverted theme tokens (`--main` fill, `--secondary` type) via `kind: "save"`. Sheet **save** notices use this style in the stack. Load / copy / Coming soon stay as footer toasts.
- Theme tokens inherit the selected theme.

Triggered from picker `choose()`:

| Choice | Title | Body |
|--------|-------|------|
| Confirm save? Yes / No | Save confirmation enabled. / surpassed. | Existing bullet guidance |
| Require restart to update? Yes | Soft refresh disabled. | TVs must be restarted for changes to take effect. **Hang override:** if a live sheet never lands (API timeout / fail), boards retry every 10s even when this is Yes — automated TVs must not sit on “Menu unavailable.” Once live data has painted, Require restart is honored again. |
| Require restart to update? No | Soft refresh enabled. | Menus will check for updates on a fixed timer — you don't have to do a thing. |
| Limit Heavy Filters to 30FPS Yes | Filter Cap Enabled for Heavy Effects. | (title only) |
| Debug Mode Yes | Debug Mode Enabled | Debugger Console now showing on Menu Screens. |
| Family Portrait Yes | Family Portrait Enabled | Shows spread of all items in first slide of presentation. |
| Presentation Style → Encore | Encore Enabled | Spread + zoom, own background, heavy filter |
| Encore Spotlight Style → Hard (with shadow) | WARNING: | Performance issues with Fire Stick. Use with caution. |

Bespoke **save** cards (stack order matches the board menu: Board Saved on top, Encore, then Menu Order):

| When | Card |
|------|------|
| Board Confirm-on-back Yes (or an auto-save that wrote board fields) | Board Saved to Restaurant Settings |
| Encore Spotlight / Color / Background wrote | Global Encore Style Settings updated |
| Menu-item order wrote | Menu Items Order Saved. |
| Item editor Confirm-on-back Yes (or auto-save) | Item Saved to Menu |

Confirm save? No shows the Encore / Order cards immediately (Order after the 3s idle, including a background flush from Edit Item). Confirm save? Yes waits for Confirm-on-back, then stacks them under Board Saved.

When adding new post-choice explanations, prefer this stack over new toast variants or inline notes.

---

## 6. Not in this prototype

- Writes for OliToki Menu Settings Data Source (A2) — intentionally never; TVs must not follow the Manager picker
- Toast import, blur / blend / opacity (called out in the mockup as later)
- **Standalone** [`uploader.html`](../uploader.html) remains for Suite / operator use. **Beta Menu Manager** now hosts the same write (`POST /api/manager/item`) as Edit Item / Create Item on boards 1–3. Footer boxes (Proteins / Sauces / Drinks / Veggies) still use the Suite uploader.

System Font (System Settings) applies to the Manager UI and the menu boards (`html[data-system-font]` + `css/system-font.css` + JS apply on the TV pages). The boards poll it live (watcher) regardless of Require restart. See also the board read path in `js/menu.js`.

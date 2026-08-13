# TokiMenu — Architecture

**Last updated:** 2026-08-13 21:30 (Remote = public Viewer sheets; hosted private API is future — FUTURE_HOSTED_API.md)

## 1. Current system (baseline `a50b4d8`)

```text
┌─────────────────┐     HTTP      ┌──────────────────┐     API      ┌──────────────┐
│  Browser boards │ ────────────► │  toki_server.py  │ ───────────► │ Google Sheet │
│  index*.html    │  static+proxy │  :8765           │  SA key      │  (private)   │
│  menu.js (~5k)  │ ◄──────────── │  /api/sheets/*   │ ◄─────────── │              │
└─────────────────┘               └──────────────────┘              └──────────────┘
        │                                    │
        │ TOKI_DATA_SOURCE=local             │ secrets/google-service-account.json
        ▼                                    │ (never sent to browser)
   Menu.xlsx + menu-data.js fallback
```

### Runtime pieces

| Piece | Role |
|-------|------|
| `index.html` … `index4.html` | Stage DOM shells (frame SVG, heroes, footer/drinks markup) |
| `js/config*.js` | Per-board sheet gids, layout name, image folder, column maps |
| `js/data-source.js` | `google` vs `local` switch |
| `js/menu.js` | **Monolith:** fetch, parse, theme, list fit, footer boxes, Plate objects (hero + portrait), hero motion, stickers, stripes |
| `js/menu-data.js` | Embedded offline fallback rows |
| `css/menu.css` | Fixed-stage layout + board modifiers |
| `scripts/toki_server.py` | Static file server + Sheets CSV proxy + caches |
| `scripts/gsheet_client.py` | CLI read/write for migrations / tooling |
| `Open Toki Menus.app` | Launches server + tiles board windows |
| `vendor/xlsx.full.min.js` | Not loaded on live boards (API-only). Kept for optional local reconnect |

**Current Plate model (implemented):**
- Slideshow hero: `#hero-wrap > #hero-plate` (container) contains the food `<img id="hero">` + `#new-sticker` (decoration).
- The plate owns `opacity`, Ken Burns `--hero-zoom` + `.is-kb-in` transitions, and the drop-shadow.
- All children inherit the plate's transforms and fade.
- **Multi-image item** (comma-separated Image cell): same plate motion; content is `.hero-multi-plates` filled by `fillPortraitPlates` → `buildPortraitLayout` (identical grid to Family Portrait). Documented in [FAMILY_PORTRAIT_LATTICE.md](./FAMILY_PORTRAIT_LATTICE.md).
- Family Portrait overview / Encore: `#family-portrait-stage` + same `fillPortraitPlates` for the cast collage (stage owns Encore zoom / veil).

### Private Google Sheet + live boards (what the API is for)

The Sheets **API + service account** exists so a **trusted program** can read a **private** spreadsheet without “Anyone with the link.” That is the intended product path.

```text
[Private Google Sheet]
        ↑  Sheets API (authenticated with service account key)
[Trusted backend]   ← only place that holds secrets/google-service-account.json
   Local:  toki_server.py on this Mac
   Market: same idea, hosted (Fly / Cloud Run / VPS / …)
        ↑  plain HTTP JSON/CSV (no Google key)
[Browser boards]    ← GitHub Pages or localhost HTML/JS only
```

| Question | Answer |
|----------|--------|
| Does **Local** use the API or public export? | **API**, when `toki_server.py` is up (`/api/sheets/*`). Public `/export` is only a fallback if the proxy is missing. |
| Can the sheet stay private? | **Yes**, with Local (or a hosted backend). Share the sheet with the service account email as Viewer (or Editor if the app writes). |
| Can **GitHub Pages alone** use that private API path? | **No.** Pages is static files only — no Python process, nowhere safe for the key. |
| Is “market Remote = private sheet + live boards via API” possible? | **Yes, later.** Same proxy, hosted 24/7. Not built — [FUTURE_HOSTED_API.md](./FUTURE_HOSTED_API.md). Pages stays the frontend. |
| Dropbox / iCloud as the API server? | **No.** They sync files; they do not run code or serve `/api/sheets/*`. This repo *lives* in Dropbox; that is storage, not a backend. |
| Mac + tunnel (Cloudflare / ngrok / Tailscale)? | Possible for demos: tunnel exposes local `toki_server` to the internet. Mac must stay awake; not a product host. |
| Put the service account JSON in the website/repo? | **Don’t.** Public repo scrapers steal keys; that is not “private sheet.” |

**Launcher Environment (Open Toki Menus):**

| Choice | Meaning |
|--------|---------|
| **Local** | `http://127.0.0.1:8765` + start `toki_server` → private sheet API path |
| **Remote** | GitHub Pages. **Today:** public CSV — Settings + the chosen Alpha/Restaurant workbook must be **Anyone with the link → Viewer**. **Future:** hosted `toki_server` so those sheets can stay private ([FUTURE_HOSTED_API.md](./FUTURE_HOSTED_API.md)). A git push does not change Data Source — the Settings sheet does. |

Service account email is a **robot identity** for *your software*, not a substitute for making the whole internet a Viewer of the sheet.

### Pain points (why hybrid rewrite)

1. **One 5k+ line IIFE** — hard to test layout pure functions; high regression risk.  
2. **Protein / sauces / drinks special cases** — blocks generic Box 1–3.  
3. **Four nearly duplicate configs** — poor multi-restaurant story.  
4. **OliToki sheet ID and food paths** woven through defaults.  
5. **No formal contract** — AI sessions re-learn layout from screenshots and break adjacent features.

Working algorithms that **must be ported**, not reinvented: menu scale bake-off, 2-col decision, footer box scale, balanced wrap packing, include-flag parsing, dual-layer galaxy scroll, drinks stripes, sticker/hero coupling.

**Performance cost of major features** (Encore, blur, wall, soft refresh, etc.): see [PERFORMANCE.md](./PERFORMANCE.md).

---

## 2. Target architecture (hybrid)

Keep production green on `main`. Build modular code on a branch; cut over when visual parity holds.

```text
                    ┌────────────────────────────┐
                    │     restaurant.json         │
                    │  id, sheetId, boards, assets│
                    └─────────────┬──────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
  ┌─────────────┐         ┌─────────────┐          ┌─────────────┐
  │ sheetsAdapter│         │ toastAdapter│          │  xlsx/local │
  │ (MenuSource) │         │ (later)     │          │  adapter    │
  └──────┬──────┘         └──────┬──────┘          └──────┬──────┘
         │                       │                        │
         └───────────────────────┼────────────────────────┘
                                 ▼
                    ┌────────────────────────────┐
                    │   Normalized RestaurantMenu │
                    │   (see DATA_MODEL.md)       │
                    └─────────────┬──────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
  ┌─────────────┐         ┌─────────────┐          ┌─────────────┐
  │ theme apply  │         │ layout/*    │          │ boards/*    │
  │ CSS vars     │         │ pack, cols, │          │ shell + DOM │
  │              │         │ footer widths│         │ mount       │
  └─────────────┘         └─────────────┘          └─────────────┘
```

### Proposed module map

```text
js/
  app.js                 # boot: read board id + restaurant id, load modules
  core/
    parseFlags.js        # Include / YesNo / TextAlign (unit-testable)
    prices.js
    normalize.js         # raw rows → domain model (legacy + v2 schemas)
  layout/
    menuScale.js         # fitMenuText, 2-col bake-off
    boxPack.js           # columns bake-off + balanced wrap (port from menu.js)
    footerWidths.js      # 1 / 2⁄3–1⁄3 / thirds pure functions
  boxes/
    renderBox.js         # generic info-box shell + body
    boxShell.svg helpers
  boards/
    itemList.js
    hero.js
    sticker.js
    galaxy.js
    stripes.js
    boardShell.js        # boards 1–3 vs drinks
  theme/
    applyTheme.js
  adapters/
    menuSource.js        # interface
    sheetsAdapter.js
    localXlsxAdapter.js
    toastAdapter.js      # stub until credentials
  config/
    # deprecate config2/3/4 — one restaurant manifest
```

HTML becomes thin:

```html
<body data-restaurant="olitoki" data-board="1" class="board-bowls">
  ... stage chrome ...
  <script type="module" src="js/app.js"></script>
</body>
```

Or keep non-module script tags initially if local `file://` constraints require it; prefer ES modules served via `toki_server.py`.

---

## 3. MenuSource interface (multi-source)

```js
/**
 * @typedef {object} MenuSource
 * @property {() => Promise<ThemeConfig>} getTheme
 * @property {(boardId: string) => Promise<Board>} getBoard
 * @property {() => Promise<Box[]>} getBoxes
 * @property {() => Promise<string[]>} listBoardIds
 */
```

| Adapter | Input | Notes |
|---------|--------|-------|
| `sheetsAdapter` | sheetId + gids / tab titles | Production path via server proxy |
| `localXlsxAdapter` | `Menu.xlsx` | Offline parity |
| `toastAdapter` | Toast REST (partner) | Map menus/modifiers → Board items + Boxes; **presentation stays TokiMenu** |

### Toast (later)

- Access is **partner / enterprise**, not a public “menu CDN.”
- Do **not** block architecture on Toast credentials.
- When live: poll or webhook → normalize into `RestaurantMenu`; honor availability if API provides it.
- Box content may map from modifier groups (proteins, sauces) depending on restaurant setup.
- Never put Toast secrets in the browser; extend `toki_server.py` with `/api/toast/*` proxy same as Sheets.

---

## 4. Multi-restaurant readiness

```text
restaurants/
  olitoki/
    restaurant.json
    # optional overrides; assets may stay in food-pics/ or move under tenant
  demo/
    restaurant.json
```

Example `restaurant.json`:

```json
{
  "id": "olitoki",
  "displayName": "OliToki",
  "sheetId": "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  "dataSource": "google",
  "schemaVersion": 1,
  "boards": [
    {
      "id": "1",
      "path": "index.html",
      "layout": "bowls",
      "sheetGid": "0",
      "imageFolder": "food-pics/bowls"
    },
    {
      "id": "2",
      "path": "index2.html",
      "layout": "handhelds",
      "sheetGid": "1959901693",
      "imageFolder": "food-pics/handhelds"
    },
    {
      "id": "3",
      "path": "index3.html",
      "layout": "munchies",
      "sheetGid": "1427118423",
      "imageFolder": "food-pics/munchies"
    },
    {
      "id": "4",
      "path": "index4.html",
      "layout": "drinks",
      "sheetGid": "1962117802",
      "imageFolder": "food-pics/drinks",
      "boxesSheetGids": { "1": "1191392779", "2": "1780619208", "3": "628145419" }
    }
  ],
  "styleGid": "1076652078",
  "boxGids": {
    "1": "1191392779",
    "2": "1780619208",
    "3": "628145419"
  }
}
```

Server:

- `TOKI_SHEET_ID` remains default for single-tenant.
- Multi-tenant: `GET /api/{restaurantId}/sheets/csv?gid=…` resolves sheetId from server-side restaurant registry (not from untrusted client-supplied sheet IDs alone).
- Secrets: one SA can be shared across sheets (share each sheet with SA email) or per-tenant keys later.

**Rule:** layout/theme code must not contain restaurant display names or item strings.

---

## 5. Server responsibilities

`toki_server.py` today:

| Endpoint | Purpose |
|----------|---------|
| static `/*` | HTML/CSS/JS/assets |
| `/api/health` | API + SA readiness |
| `/api/sheets/csv` | Tab values by gid/title |
| `/api/sheets/xlsx` | **410 Gone** — Drive workbook export retired 2026-08-13 |
| `/api/sheets/tabs` | gid ↔ title map |
| `/api/settings` | Live Data Source + Require Restart (from OliToki Menu Settings) |

Caches: meta TTL ~120s, CSV ~90s. API calls serialized (client not thread-safe). Fills/rich-text parsers: `deprecated/sheet-styles/`.

Future:

- **Hosted API for Remote + private sheets** — [FUTURE_HOSTED_API.md](./FUTURE_HOSTED_API.md)  
- Restaurant registry resolution  
- Toast proxy  
- Optional `schemaVersion` check endpoint  

---

## 6. Rendering pipeline (target)

1. Boot → resolve `restaurantId` + `boardId`.  
2. Adapter loads theme + board + boxes.  
3. Apply theme → CSS variables on `:root` / `#stage`.  
4. Render item list → run `menuScale` / 2-col.  
5. Compute footer width classes from `includeBoxIds` ([STYLE_GUIDE](./STYLE_GUIDE.md) §6).  
6. Render each box with shared `renderBox`.  
7. Start hero slideshow + sticker + galaxy (+ stripes if drinks).  
8. Soft-refresh on `refreshSeconds` without full reload when possible.

---

## 7. Hybrid rewrite phases

| Phase | Deliverable | Production risk |
|-------|-------------|-----------------|
| **0** | Docs: PRODUCT, STYLE_GUIDE, DATA_MODEL, ARCHITECTURE | None |
| **1** | Extract pure helpers from `menu.js` into modules; still called from monolith | Low |
| **2** | Generic box renderer + width rules; dual-read legacy sheet columns | Medium — branch + parity QA |
| **3** | Sheet migrate to Box 1–3 + board flags; drop protein special cases | Medium — sheet backup first |
| **4** | `restaurant.json` + kill config2/3/4 duplication | Low–medium |
| **5** | Toast adapter stub + server seam | None until enabled |

**Never:** delete all of `js/` on day one and hope docs are enough.

**Cutover:** side-by-side branch until the visual QA checklist in STYLE_GUIDE passes on all four boards.

---

## 8. Testing strategy

| Level | What |
|-------|------|
| Unit | `parseInclude`, footer width math, wrap balance scoring, price format |
| Visual | Manual QA checklist; screenshot diffs vs `screenshots/` and `mockups/` |
| Integration | `toki_server` health + csv for each gid with SA key present |
| Stress | `TOKI_DATA_SOURCE=local` + dense xlsx backups in `backups/` |

No need for a heavy framework initially — small pure functions + a `scripts/smoke_boards.sh` that curls health and opens boards is enough.

---

## 9. Security & ops

- Service account JSON: `secrets/` only; gitignored.  
- Browser talks only to local server for private sheets.  
- Do not accept arbitrary sheet IDs from query strings without a server-side allow-list in multi-tenant mode.  
- Code in git; sheet content via Drive history + `pull-menu-xlsx.py` + `backups/`.  
- See [git-howto.txt](./git-howto.txt) for commit/rollback.

---

## 10. Decision log

| Date | Decision |
|------|----------|
| 2026-08 | Git baseline of working boards after Box-experiment restore |
| 2026-08 | Hybrid rewrite preferred over full nuke or endless patch-only |
| 2026-08 | Sheets first; Toast as future MenuSource adapter |
| 2026-08 | Generic boxes use fixed 1 / 2⁄3–1⁄3 / thirds width rules |
| 2026-08 | Plate as first-class container object (#hero-plate, .family-portrait-slot) for inherited motion + single shadow per logical plate |
| 2026-08 | Debug "Full View" + Version Stamp relocated to Toki Debug header (disclaimer no longer replaced) |

Update this table when product architecture choices change.

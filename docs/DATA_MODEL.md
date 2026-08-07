# TokiMenu — Data Model

Spreadsheet is the CMS. The browser never holds the service account key; `toki_server.py` proxies Sheets when `TOKI_DATA_SOURCE=google`.

**OliToki spreadsheet ID (default):**  
`1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10`

---

## 1. Tabs (live today)

| Tab (approx title) | GID | Role |
|--------------------|-----|------|
| Board 1 | `0` | Items + include protein/sauces flags |
| Board 2 | `1959901693` | Same schema |
| Board 3 | `1427118423` | Same schema (dense list when Description empty) |
| Board 4 / Announcements chrome | `1962117802` | Title, stripes, announcement fields |
| 4 - Proteins | `1191392779` | Shared footer box content |
| 5 - Sauces | `1780619208` | Shared footer box content |
| 7 - Drinks | `628145419` | Drink options box + overview |
| Style | `1076652078` | Themes + BG + speeds |
| 6 - Announcements | (legacy / related) | May exist; Board 4 owns chrome columns |

Configs: `js/config.js` … `config4.js` bind each HTML board to gids.

---

## 2. Board tabs 1–3 — live columns

Unified schema (all three boards):

| Col | Header | Index | Notes |
|-----|--------|-------|-------|
| A | Menu Title | 0 | First non-empty wins for board title |
| B | Item | 1 | Row = menu item |
| C | Price 1 | 2 | |
| D | Price 2 | 3 | Empty → omit |
| E | Price 3 | 4 | Empty → omit |
| F | Subtitle | 5 | Parenthetical / secondary label |
| G | Description | 6 | Empty → dense munchies-style line |
| H | New | 7 | Truthy → New sticker when item active |
| I | Image | 8 | Filename under board `imageFolder` |
| J | Include | 9 | Item visibility |
| K | Include Protein Box? | 10 | Board-level toggle (first filled cell) |
| L | Include Sauces Box? | 11 | Board-level toggle (first filled cell) |

**Include parsing rules (important):**

- Treat blank as “use default” for board-level box flags (default **on** if no value found).
- Item `Include`: falsey / `0` / `No` / `false` → exclude.
- Avoid `!!"0"` style bugs — `"0"` must mean off.

Theme / speeds are **not** on Board tabs when Style tab is present (`bgScrollSpeed` etc. are `null` in board column maps).

---

## 3. Protein sheet — live

GID `1191392779`

| Col | Header | Index | Notes |
|-----|--------|-------|-------|
| A | Title | 0 | Box title (row 2 / first data row) |
| B | Subtitle | 1 | e.g. “Options” |
| C | Color | 2 | Color Picker label or fill |
| D | Item | 3 | Protein name per row |
| E | Price | 4 | Upcharge; formatted by JS |
| F | Create Columns? | 5 | Default **Yes** |
| G | Text Align | 6 | Default **Right** |

---

## 4. Sauces sheet — live

GID `1780619208`

| Col | Header | Index | Notes |
|-----|--------|-------|-------|
| A | Title | 0 | |
| B | Subtitle | 1 | |
| C | Color | 2 | |
| D | Item | 3 | Sauce name |
| E | Create Columns? | 4 | Default **No** |
| F | Text Align | 5 | Default **Center** |

No price column today.

---

## 5. Drinks content sheet — live

GID `628145419` (`drinksSheetColumns` in `config4.js`)

| Col | Header | Index |
|-----|--------|-------|
| A | Drink Box Title | 0 |
| B | Drink Box Subtitle | 1 |
| C | Drink Box Color | 2 |
| D | Overview | 3 | Truthy → include overview slide |
| E | Overview Image | 4 |
| F | Individual (Show Items) | 5 | Truthy → per-item slides / list |
| G | Item | 6 |
| H | Item Subtitle | 7 |
| I | New | 8 |
| J | Image | 9 |
| K | Include | 10 |
| L | Create Columns? | 11 | Default **No** |
| M | Text Align | 12 | Default **Center** |

---

## 6. Board 4 chrome tab — live

GID `1962117802` — announcement + stripes (drink items come from drinks sheet when API OK):

| Col | Header | Index |
|-----|--------|-------|
| A | Title | 0 | Board title |
| B | Include Stripes | 1 | 0 = hide stripes |
| C | Stripe Color 1 | 2 | Color picker label → theme |
| D | Stripe Color 2 | 3 | |
| E | Announcement Title | 4 | |
| F | Announcement Subtitle | 5 | |
| G | Announcement Copy | 6 | Multi-line / rich via xlsx styles when available |
| H | Announcement Color | 7 | Body fill |
| I–S | Legacy drink columns | 8+ | Fallback only if drinks sheet fails |

---

## 7. Style tab — live

GID `1076652078`

**Per-theme rows** (active = first row with Theme Selector set / first non-empty selector pattern in code):

| Col | Header | Index |
|-----|--------|-------|
| A | Theme Selector | 0 | Dropdown of theme names |
| B | Theme Name | 1 | |
| C | Main | 2 | |
| D | Secondary | 3 | |
| E | Highlight | 4 | |
| F | Highlight Special | 5 | |

**Board-wide** (first filled value wins — not per theme in current code):

| Col | Header | Index |
|-----|--------|-------|
| G | BG Color | 6 |
| H | BG Image | 7 |
| I | BG Blur | 8 | 0–1 |
| J | BG Blend Mode | 9 | See allow-list in menu.js |
| K | BG Opacity | 10 | 0–1 |
| L | BG Scroll Speed | 11 | |
| M | Slideshow Speed | 12 | Seconds-ish |
| N | Color Picker labels | — | Reference list for other sheets |

Blend modes allow-list: `normal`, `overlay`, `lighten`, `color-burn`, `soft-light`, `luminosity`.

---

## 8. Normalized domain model (target)

Adapters (Sheets, Toast, …) must produce something like:

```ts
type RestaurantMenu = {
  restaurantId: string;
  schemaVersion: number; // bump on breaking sheet migrations
  theme: ThemeConfig;
  boards: Board[];
  boxes: Box[]; // Box 1..3 shared definitions
};

type Board = {
  id: string;           // "1" | "2" | "3" | "4"
  layout: "bowls" | "handhelds" | "munchies" | "drinks";
  title: string;
  items: MenuItem[];
  includeBoxIds: number[]; // 1, 2, 3
  // board 4 only:
  announcement?: Announcement;
  includeStripes?: boolean;
  stripeColors?: [string, string];
};

type MenuItem = {
  name: string;
  prices: string[];     // 0–3 display strings
  subtitle?: string;
  description?: string;
  isNew?: boolean;
  image?: string;
  include: boolean;
};

type Box = {
  id: number;           // 1 | 2 | 3
  title: string;
  subtitle?: string;
  color?: string;       // resolved hex
  createColumns: boolean;
  textAlign: "left" | "center" | "right";
  overview?: boolean;
  overviewImage?: string;
  showItems?: boolean;
  items: BoxItem[];
};

type BoxItem = {
  name: string;
  subtitle?: string;
  price?: string;
  isNew?: boolean;
  image?: string;
  include: boolean;
};

type ThemeConfig = {
  main: string;
  secondary: string;
  highlight: string;
  highlightSpecial: string;
  bgColor: string;
  bgImage: string | null;
  bgBlur: number;
  bgBlendMode: string;
  bgOpacity: number;
  bgScrollSpeed: number;
  slideshowSpeed: number;
};
```

Layout code consumes **only** this model — never raw column indexes.

---

## 9. Target: unified Box tabs

Rename / migrate content sheets:

| GID (keep) | Old title | New title |
|------------|-----------|-----------|
| 1191392779 | 4 - Proteins | **Box 1** |
| 1780619208 | 5 - Sauces | **Box 2** |
| 628145419 | 7 - Drinks | **Box 3** |

### Unified Box columns

| Col | Header | Notes |
|-----|--------|-------|
| A | Box Title | |
| B | Box Subtitle | |
| C | Box Color | Color Picker / fill |
| D | Item | |
| E | Item Subtitle | |
| F | Item Price | optional |
| G | New | |
| H | Image | |
| I | Include | item-level |
| J | Create Columns? | |
| K | Text Align | Left / Center / Right |
| L | Overview | board-4 / hero source |
| M | Overview Image | |
| N | Show Items | individuals on / off |

### Board include flags (target)

| Old | New |
|-----|-----|
| Include Protein Box? | **Include Box 1?** |
| Include Sauces Box? | **Include Box 2?** |
| (new) | **Include Box 3?** |

Board columns after migrate:

`Menu Title | Item | Price 1–3 | Subtitle | Description | New | Image | Include | Include Box 1? | Include Box 2? | Include Box 3?`

### Defaults for OliToki after migrate

- Boards 1–3: Box1 + Box2 flags from current protein/sauces; Box3 **off**.
- Board 4: Box3 **on**; Box1/2 **off** (unless product wants multi-box under announcement).

---

## 10. Migration rules (non-negotiable)

1. **Snapshot** data validations (`includeGridData` / Sheets API) before rewrite.  
2. **Do not** values-only paste that drops dropdowns.  
3. Clear old range → write full-width migrated rows → **re-apply** validations on new columns.  
4. Export `Menu.xlsx` backup + Drive version note before migrate.  
5. Set `schemaVersion` (meta cell or tab) after successful migrate.  
6. Keep code able to read **legacy** protein/sauces/drinks layouts until cutover is verified on all four boards.

### Dropdowns to re-apply (Box tabs)

| Column | Source |
|--------|--------|
| Box Color | Style Color Picker list |
| Create Columns? | Yes / No |
| Text Align | Left / Center / Right |
| Include / Overview / Show Items / New | Yes/No or 1/0 (match existing convention) |

---

## 11. Data sources

| Source | How | When |
|--------|-----|------|
| `google` | `/api/sheets/csv`, `/api/sheets/xlsx`, `/api/sheets/tabs` via `toki_server.py` | Production displays |
| `local` | `Menu.xlsx` + SheetJS in browser | Offline / stress / no network |
| Fallbacks | public export URLs (legacy), then `menu-data.js` embedded | Only if proxy/xlsx fail |

Toggle: `js/data-source.js` → `TOKI_DATA_SOURCE`.

---

## 12. Truthiness cheatsheet

| Cell | Include item? | Create Columns? |
|------|---------------|-----------------|
| empty | item: usually skip or default; box flag: “no value” → default | use code default for that box |
| `1` / `Yes` / `TRUE` / `true` | yes | yes |
| `0` / `No` / `FALSE` / `false` | no | no |

Never use JavaScript `!!string` alone for flags.

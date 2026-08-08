/**
 * TokiMenu — spreadsheet-driven animated menu board (1920×1080)
 *
 * Supports layouts: bowls | handhelds | munchies | drinks via TOKI_CONFIG.
 *
 * Data sources (see js/data-source.js — TOKI_DATA_SOURCE):
 *  "local"  → Menu.xlsx (all tabs + fills/fonts) — preferred for offline/stress
 *  "google" → live Google Sheet CSV + remote xlsx styles
 *  fallbacks: xlsx → embedded (when google fails or is unset)
 */
(function () {
  "use strict";

  // ---------- diagnostics (Safari Web Inspector / desktop consoles) ----------
  const _cfg0 =
    typeof window !== "undefined" && window.TOKI_CONFIG
      ? window.TOKI_CONFIG
      : {};
  const LOG_TAG =
    "[TokiMenu " +
    (_cfg0.layout || "board") +
    (typeof location !== "undefined" && location.pathname
      ? " " + location.pathname.split("/").pop()
      : "") +
    "]";

  function tokiLog() {
    var a = [LOG_TAG].concat([].slice.call(arguments));
    console.log.apply(console, a);
  }
  function tokiInfo() {
    var a = [LOG_TAG].concat([].slice.call(arguments));
    console.info.apply(console, a);
  }
  function tokiWarn() {
    var a = [LOG_TAG].concat([].slice.call(arguments));
    console.warn.apply(console, a);
  }
  function tokiError() {
    var a = [LOG_TAG].concat([].slice.call(arguments));
    console.error.apply(console, a);
  }

  window.addEventListener("error", function (e) {
    tokiError(
      "uncaught",
      e.message,
      e.filename ? e.filename + ":" + e.lineno + ":" + e.colno : "",
      e.error || ""
    );
  });
  window.addEventListener("unhandledrejection", function (e) {
    tokiError("unhandledrejection", e.reason);
  });

  tokiInfo(
    "boot",
    "dataSource=",
    typeof window.TOKI_DATA_SOURCE !== "undefined"
      ? window.TOKI_DATA_SOURCE
      : "(unset)",
    "href=",
    typeof location !== "undefined" ? location.href : ""
  );

  /**
   * True when embedded in preview-all.html (or ?preview=all).
   * Four full boards kill Fire Stick / phone WebViews — use a leaner path
   * that keeps the design, not 4× dual-galaxy + xlsx + blur + refresh.
   * Solo boards (no preview=all) stay full quality.
   */
  function isPreviewWall() {
    try {
      const q = new URLSearchParams(
        typeof location !== "undefined" ? location.search : ""
      );
      return q.get("preview") === "all";
    } catch (e) {
      return false;
    }
  }

  /** Prefer stage-sized galaxy in the wall (not 3600× masters ×4). */
  function wallFriendlyBgPath(path) {
    if (!path || !isPreviewWall()) return path;
    const s = String(path);
    if (s.indexOf("galaxy-bg") === -1) return path;
    if (s.indexOf("galaxy-bg-sm") !== -1 || s.indexOf("galaxy-bg-xs") !== -1) {
      return s;
    }
    return "assets/bgs/galaxy-bg-sm.jpg";
  }

  const STAGE_W = 1920;
  const STAGE_H = 1080;
  const CUTOUT_LEFT = 1114;
  /** Mirrored panel left edge at y≈mid for drinks galaxy loop */
  const CUTOUT_RIGHT_BOARD = 830;
  const FADE_DURATION_MS = 1200;
  const BASE_SCROLL_PX_PER_SEC = 28;
  const STRIPE_SPEED_FACTOR = 0.75;
  const MAX_MENU_SCALE = 1.55;
  const MIN_MENU_SCALE = 0.22;
  /**
   * Auto-columns (Bowls + Handhelds): try 2-col when the list is dense enough
   * that single-column type gets small. Keep 2-col only if scale improves enough.
   */
  const MENU_COLS_MIN_ITEMS = 7; // never split below this
  const MENU_COLS_ALWAYS_TRY = 10; // always bake-off 2-col at/above this count
  const MENU_COLS_SCALE_FLOOR = 0.78; // try 2-col if 1-col scale is under this
  const MENU_COLS_WIN_RATIO = 1.06; // need ≥6% larger type to switch

  /**
   * Unified Board tab columns (Board 1 / 2 / 3 share this schema).
   * Empty Price 2/3 → single price; empty Description → dense list (munchies);
   * empty Subtitle → no parenthetical; Include Protein/Sauces Box? toggles footers.
   * A Menu Title | B Item | C–E Price 1–3 | F Subtitle | G Description |
   * H New | I Image | J Include | K Include Protein Box? | L Include Sauces Box?
   * M Include Drinks Box? | N Include Descriptions? | O Columns? (Auto|1|2|3)
   */
  const BOARD_COLUMNS = {
    title: 0,
    item: 1,
    price: null, // use price1/2/3 only (avoids index collisions)
    price1: 2,
    price2: 3,
    price3: 4,
    subtitle: 5,
    description: 6,
    isNew: 7,
    image: 8,
    include: 9,
    includeProteinBox: 10,
    includeSaucesBox: 11,
    includeDrinksBox: 12,
    includeDescriptions: 13,
    menuColumns: 14,
    bgScrollSpeed: null,
    slideshowSpeed: null,
    highlight: null,
    highlightSpecial: null,
  };
  /** @deprecated alias — same as BOARD_COLUMNS */
  const BOWLS_COLUMNS = BOARD_COLUMNS;

  /** Style & Theme tab (gid 1076652078)
   * Theme palette ONLY (selected row — Theme Selector in col A):
   *   A Theme Selector | B Theme Name | C Main | D Secondary |
   *   E Highlight | F Highlight Special
   * Board-wide stage BG (always the first data row = sheet row 2, not per theme):
   *   G2 BG Color | H2 BG Image (dropdown) | I2 BG Blur | J2 BG Blend Mode |
   *   K2 BG Opacity | L2 BG Scroll Speed | M2 Slideshow Speed
   * N Color Picker labels (reference list for other sheets)
   * O Show Version (1 = commit stamp in disclaimer slot instead of allergy text)
   */
  const STYLE_COLUMNS = {
    themeSelector: 0,
    themeName: 1,
    mainColor: 2,
    secondaryColor: 3,
    highlight: 4,
    highlightSpecial: 5,
    bgColor: 6,
    bgImage: 7,
    bgBlur: 8,
    bgBlendMode: 9,
    bgOpacity: 10,
    bgScrollSpeed: 11,
    slideshowSpeed: 12,
    // N Color Picker (reference list) · O Show Version
    colorPicker: 13,
    showVersion: 14,
  };
  /** Excel row 2 = first data row (index 1 in sheet_to_json header:1 arrays) */
  const STYLE_BOARD_WIDE_ROW_INDEX = 1;
  /** Default allergy copy (HTML uses &lt;br /&gt; between lines). */
  const DEFAULT_DISCLAIMER_HTML =
    "Before placing your order, please inform us if you have a food allergy.<br />" +
    "Consuming raw or undercooked food may lead to foodborne illness.";

  const DEFAULT_BG_IMAGE = "assets/bgs/galaxy-bg.jpg";
  const BG_IMAGE_FOLDER = "assets/bgs";
  /** Blur 1.0 → this many CSS px (0 = filter disabled entirely). */
  const BG_BLUR_MAX_PX = 40;
  /**
   * BG Blend Mode dropdown — keep in sync with bg-blend-modes.csv / Style sheet.
   * (Short list: only modes useful on a menu board.)
   */
  const BG_BLEND_MODES = [
    "normal",
    "overlay",
    "lighten",
    "color-burn",
    "soft-light",
    "luminosity",
  ];

  const cfg = Object.assign(
    {
      googleSheetId: "",
      googleSheetGid: "0",
      styleThemeGid: "1076652078",
      proteinSheetGid: null, // shared Protein sheet (all boards)
      saucesSheetGid: null, // shared Sauces sheet (all boards)
      drinksSheetGid: null, // board 4: drink box content (items / overview)
      drinksSheetColumns: null, // column map for drinksSheetGid
      inheritConfigGid: null, // legacy; unused when styleThemeGid set
      layout: "bowls",
      showHero: true,
      showSticker: true,
      showDisclaimer: true,
      showVersion: false,
      imageFolder: "food-pics",
      overviewImageDefault: null,
      refreshSeconds: 30,
      fallbacks: ["xlsx", "embedded"],
      /** "google" | "local" — overridable via window.TOKI_DATA_SOURCE */
      dataSource: null,
      /** Path to local workbook when dataSource is local */
      localXlsx: null,
      columns: BOARD_COLUMNS,
    },
    window.TOKI_CONFIG || {}
  );

  /** Effective data source: data-source.js → config → google default */
  function resolvedDataSource() {
    const raw = (
      cfg.dataSource ||
      window.TOKI_DATA_SOURCE ||
      "google"
    )
      .toString()
      .trim()
      .toLowerCase();
    if (raw === "local" || raw === "xlsx" || raw === "file") return "local";
    return "google";
  }

  function localXlsxPath() {
    return (
      cfg.localXlsx ||
      window.TOKI_LOCAL_XLSX ||
      "Menu.xlsx"
    ).toString();
  }

  const col = Object.assign({}, BOWLS_COLUMNS, cfg.columns || {});
  const isHandhelds = cfg.layout === "handhelds";
  const isMunchies = cfg.layout === "munchies";
  const isDrinks = cfg.layout === "drinks";
  const isBowls = cfg.layout === "bowls" || (!isHandhelds && !isMunchies && !isDrinks);
  /** Boards that can auto-split into 2 columns (bowls, handhelds, munchies) */
  const usesAutoMenuColumns = isHandhelds || isBowls || isMunchies;

  const els = {
    stage: document.getElementById("stage"),
    title: document.getElementById("menu-title"),
    list: document.getElementById("menu-list"),
    hero: document.getElementById("hero"),
    heroWrap: document.getElementById("hero-wrap"),
    sticker: document.getElementById("new-sticker"),
    galaxyA: document.getElementById("galaxy-a"),
    galaxyB: document.getElementById("galaxy-b"),
    proteinTitle: document.getElementById("protein-title"),
    proteinSubtitle: document.getElementById("protein-subtitle"),
    proteinBody: document.getElementById("protein-body"),
    saucesTitle: document.getElementById("sauces-title"),
    saucesSubtitle: document.getElementById("sauces-subtitle"),
    saucesBody: document.getElementById("sauces-body"),
    footerDrinksTitle: document.getElementById("footer-drinks-title"),
    footerDrinksSubtitle: document.getElementById("footer-drinks-subtitle"),
    footerDrinksBody: document.getElementById("footer-drinks-body"),
    footerBoxes: document.getElementById("footer-boxes"),
    disclaimer: document.getElementById("disclaimer"),
    announcementTitle: document.getElementById("announcement-title"),
    announcementSubtitle: document.getElementById("announcement-subtitle"),
    announcementBody: document.getElementById("announcement-body"),
    announcementBodyRect: document.getElementById("announcement-body-rect"),
    drinkBoxTitle: document.getElementById("drink-box-title"),
    drinkBoxSubtitle: document.getElementById("drink-box-subtitle"),
    drinkBoxBody: document.getElementById("drink-box-body"),
    drinksBoxes: document.getElementById("drinks-boxes"),
    stripes: document.getElementById("stripes"),
    stripesTrack: document.getElementById("stripes-track"),
  };

  let config = {
    title: "",
    mainColor: "#000000",
    secondaryColor: "#ffffff",
    // Stage BG: color plate always on; image optional on top with FX
    bgColor: "#000000",
    // null until Style sheet says otherwise — do not preload galaxy-bg
    bgImage: null,
    bgBlur: 0, // 0–1 (0 = filter:none, 1 = BG_BLUR_MAX_PX)
    bgBlendMode: "normal",
    bgOpacity: 1, // 0–1 image opacity only
    bgMode: "solid", // legacy alias: "image" if bgImage set, else "solid"
    bgSolid: null, // legacy alias of bgColor
    bgScrollSpeed: 1,
    slideshowSpeed: 3,
    highlight: "#26bbcb",
    highlightSpecial: "#fff900",
    stripeColor1: "#000000",
    stripeColor2: "#ffffff",
    includeStripes: true,
    announcementBg: null, // null → Main after theme apply
    proteinBoxBg: null,
    saucesBoxBg: null,
    drinkBoxBg: null,
    drinksOverview: true,
    drinksIndividual: true,
    overviewImage: null,
  };
  let items = [];
  let proteinBox = {
    title: "",
    subtitle: "",
    items: [],
    bg: null,
    include: true,
    createColumns: true, // default: grid bake-off (legacy protein)
    textAlign: "right", // legacy protein columns were right-aligned
  };
  let saucesBox = {
    title: "",
    subtitle: "",
    items: [],
    bg: null,
    include: true,
    createColumns: false, // default: balanced wrap (legacy sauces)
    textAlign: "center",
  };
  /** Boards 1–3 footer drinks/soda box (shared Drinks sheet; off by default) */
  let footerDrinksBox = {
    title: "",
    subtitle: "",
    items: [],
    bg: null,
    include: false,
    createColumns: false,
    textAlign: "center",
  };
  /** Board list options from Include Descriptions? / Columns? (first filled cell) */
  let boardListOptions = {
    showDescriptions: true,
    /** "auto" | 1 | 2 | 3 */
    columns: "auto",
  };
  let announcementBox = {
    title: "",
    subtitle: "",
    /** @type {Array<{title,subtitle,text,speedSec,textAlign,shout,shakeIntensity,color,bold,italic,runs}>} */
    messages: [],
    lines: [], // legacy alias during render of active message body lines
    bg: null,
  };
  let announcementIndex = 0;
  let announcementTimer = null;
  let drinkBox = {
    title: "",
    subtitle: "",
    bg: null,
    createColumns: false, // default: balanced wrap (legacy sodas)
    textAlign: "center",
  };
  /** Slideshow slides for drinks: overview + individuals */
  let slides = [];
  let activeIndex = 0;
  let slideshowTimer = null;
  let refreshTimer = null;
  let dataSource = "";
  /** Cell fills from xlsx export: { "B2": "#000000", ... } */
  let sheetFills = {};
  /** Cell fonts from xlsx: { "F2": { bold, italic, color } } */
  let sheetFonts = {};
  /** Rich-text runs from xlsx: { "F3": [ { text, bold, italic, color }, ... ] } */
  let sheetRich = {};

  // ---------- helpers ----------

  function normalizeHex(value) {
    if (value == null || value === "") return null;
    let s = String(value).trim();
    if (s.startsWith("#")) s = s.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
      s = s
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return "#" + s.toLowerCase();
  }

  /**
   * Font colors left over from sheet hyperlinks should not override the board's
   * contrast announcement text. Intentional colors (e.g. orange Halloween,
   * red emphasis) still pass through.
   *
   * - Link blues → always treated as remnants
   * - Pure #000000 → remnant only for rich-text *runs* (unlinked URL paint);
   *   whole-cell black is also treated as "no color" so default sheet black
   *   doesn't force black type on a dark announcement box
   */
  function isHyperlinkRemnantFontColor(hex) {
    const h = normalizeHex(hex);
    if (!h) return false;
    // Default black (cell default or unlinked URL run)
    if (h === "#000000") return true;
    // Common Excel / Google Sheets / browser hyperlink blues
    return (
      h === "#0563c1" ||
      h === "#1155cc" ||
      h === "#0000ee" ||
      h === "#0000ff" ||
      h === "#0066cc" ||
      h === "#1a0dab" ||
      h === "#0645ad"
    );
  }

  /** Cell/run font color for announcement copy, stripping link leftovers. */
  function announcementFontColor(raw) {
    const h = normalizeHex(raw);
    if (!h || isHyperlinkRemnantFontColor(h)) return null;
    return h;
  }

  /**
   * Color resolution for sheet-driven styling.
   * Priority: typed hex → cell fill → fallback (theme Main/Secondary or default).
   */
  function resolveColor(typedValue, fillHex, fallback) {
    const typed = normalizeHex(typedValue);
    if (typed) return typed;
    const fill = normalizeHex(fillHex);
    if (fill) return fill;
    return normalizeHex(fallback) || fallback || null;
  }

  /**
   * Resolve Style "Color Picker" labels (and legacy hex/fill) to a concrete hex.
   * Options: Main Color | Secondary Color | Highlight Color |
   * Highlight Color (Special) | Override (Use Fill) | bare #hex
   * Returns null if blank / unknown (caller applies default).
   */
  function resolveNamedThemeColor(raw, cellFill, theme) {
    const t = theme || {};
    const main = normalizeHex(t.mainColor) || "#000000";
    const secondary = normalizeHex(t.secondaryColor) || "#ffffff";
    const highlight = normalizeHex(t.highlight) || "#26bbcb";
    const highlightSpecial = normalizeHex(t.highlightSpecial) || "#fff900";

    const s = String(raw == null ? "" : raw).trim();
    if (!s) return null;

    // First token only (multi-select safety)
    const token = s
      .split(/[,;|]/)[0]
      .trim()
      .replace(/^["']|["']$/g, "");
    const low = token.toLowerCase();

    if (low === "main color" || low === "main") return main;
    if (low === "secondary color" || low === "secondary") return secondary;
    if (low === "highlight color" || low === "highlight") return highlight;
    if (
      low.indexOf("highlight color (special)") === 0 ||
      low.indexOf("highlight color (new)") === 0 ||
      low === "highlight new" ||
      low === "special"
    ) {
      return highlightSpecial;
    }
    if (low.indexOf("override") === 0 || low.indexOf("custom") === 0) {
      // Typed hex in the cell (if any) → cell fill → Main
      const typedInCell = (s.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/) ||
        [])[0];
      return (
        normalizeHex(typedInCell) ||
        normalizeHex(cellFill) ||
        main
      );
    }

    // Bare hex typed as the value
    const hex = normalizeHex(token) || normalizeHex(s);
    if (hex) return hex;

    return null;
  }

  /**
   * WCAG relative luminance (0 = black, 1 = white).
   * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
   */
  function relativeLuminance(hex) {
    const h = normalizeHex(hex);
    if (!h) return 0;
    const channels = [1, 3, 5].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  /** Contrast ratio between two colors (1 = identical, 21 = black on white). */
  function contrastRatio(hexA, hexB) {
    const L1 = relativeLuminance(hexA);
    const L2 = relativeLuminance(hexB);
    const lighter = Math.max(L1, L2);
    const darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /**
   * For a box OVERRIDE background, pick Main or Secondary text —
   * whichever has the higher WCAG contrast against that background.
   * Yellow bg → black (Main) wins; black bg → white (Secondary) wins.
   */
  function pickContrastingThemeColor(bgHex, mainHex, secondaryHex) {
    const bg = normalizeHex(bgHex) || "#000000";
    const main = normalizeHex(mainHex) || "#000000";
    const secondary = normalizeHex(secondaryHex) || "#ffffff";
    const cMain = contrastRatio(bg, main);
    const cSec = contrastRatio(bg, secondary);
    return cMain >= cSec ? main : secondary;
  }

  function colLetterToIndex(letters) {
    let n = 0;
    const s = String(letters || "").toUpperCase();
    for (let i = 0; i < s.length; i++) {
      n = n * 26 + (s.charCodeAt(i) - 64);
    }
    return n - 1;
  }

  function indexToColLetter(index) {
    let n = index + 1;
    let s = "";
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function cellRef(colIndex, row1Based) {
    return indexToColLetter(colIndex) + String(row1Based);
  }

  function resolveImagePath(imageName) {
    if (
      imageName === "" ||
      imageName == null ||
      String(imageName).toLowerCase() === "null"
    ) {
      return null;
    }
    const s = String(imageName).replace(/^\/+/, "").trim();
    if (!s) return null;
    if (s.indexOf("food-pics/") === 0) return s;
    const folder = (cfg.imageFolder || "food-pics").replace(/\/+$/, "");
    return folder + "/" + s;
  }

  function formatPrice(value) {
    if (value == null || value === "") return "";
    const n = Number(String(value).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n) && String(value).trim() !== "") {
      // Keep + prefix style for protein upcharges when already formatted
      const raw = String(value).trim();
      if (raw.startsWith("+")) return "+$" + Math.abs(n).toFixed(2);
      return "$" + n.toFixed(2);
    }
    const s = String(value).trim();
    if (s.startsWith("$") || s.startsWith("+$")) return s;
    return s ? "$" + s : "";
  }

  /** Leave multi-price tokens alone; format plain numbers as $x.xx */
  function formatPriceToken(value) {
    if (value == null || value === "") return "";
    const s = String(value).trim();
    // e.g. "s $6.95", "1/$2.00", "m $9.95"
    if (/[a-zA-Z]/.test(s) || s.indexOf("/") !== -1) return s;
    return formatPrice(s);
  }

  /** Reject blank / zero placeholders that aren't real prices */
  function isUsablePriceCell(value) {
    if (value == null) return false;
    const s = String(value).trim();
    if (s === "") return false;
    if (/^\$?0+(\.0+)?$/.test(s)) return false;
    if (s.toLowerCase() === "null") return false;
    return true;
  }

  function getItemPrices(item) {
    if (item.prices && item.prices.length) return item.prices;
    if (item.price) return [item.price];
    return [];
  }

  function formatItemPriceLine(item) {
    const prices = getItemPrices(item);
    // Bowls/handhelds: plain "Name - $x.xx"
    if (prices.length === 0) return item.name;
    return item.name + " - " + prices.join(" · ");
  }

  /** Build structured munchies line: Name (sub) - prices with size hierarchy */
  function buildMunchiesLine(item) {
    const line = document.createElement("div");
    line.className = "item-line";

    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = item.name;
    line.appendChild(name);

    if (item.subtitle) {
      const sub = document.createElement("span");
      sub.className = "item-paren-sub";
      sub.textContent = " (" + item.subtitle + ")";
      line.appendChild(sub);
    }

    const prices = getItemPrices(item);
    if (prices.length) {
      const dash = document.createElement("span");
      dash.className = "item-prices";
      dash.textContent = " - ";
      line.appendChild(dash);

      const priceEl = document.createElement("span");
      priceEl.className = "item-prices";
      priceEl.textContent = prices.join(" · ");
      line.appendChild(priceEl);
    }

    return line;
  }

  function cell(row, idx) {
    if (idx == null || idx < 0) return "";
    if (!row || row[idx] == null) return "";
    const v = row[idx];
    if (typeof v === "string") return v.trim();
    return v;
  }

  function parseInclude(raw) {
    if (raw === undefined || raw === null || raw === "") return true;
    if (typeof raw === "boolean") return raw;
    const n = Number(raw);
    if (Number.isFinite(n)) return n === 1;
    return String(raw).trim() === "1";
  }

  /**
   * Yes/No (or 1/0) toggle — used for "Create Columns?" on Protein/Sauces/Drinks.
   * Blank → defaultVal (protein default true, sauces/drinks default false).
   */
  function parseYesNo(raw, defaultVal) {
    if (raw === undefined || raw === null || raw === "") return !!defaultVal;
    if (typeof raw === "boolean") return raw;
    const s = String(raw).trim().toLowerCase();
    if (
      s === "1" ||
      s === "yes" ||
      s === "y" ||
      s === "true" ||
      s === "on"
    ) {
      return true;
    }
    if (
      s === "0" ||
      s === "no" ||
      s === "n" ||
      s === "false" ||
      s === "off"
    ) {
      return false;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) return n === 1;
    return !!defaultVal;
  }

  /** First non-empty cell in a column → Yes/No (or default). */
  function firstColumnYesNo(rows, colIdx, defaultVal) {
    if (colIdx == null || !rows) return !!defaultVal;
    for (let i = 1; i < rows.length; i++) {
      const raw = cell(rows[i], colIdx);
      if (raw === "" || raw == null) continue;
      return parseYesNo(raw, defaultVal);
    }
    return !!defaultVal;
  }

  /**
   * Text Align dropdown: Left | Center | Right (case-insensitive).
   * Blank → defaultVal ("left" | "center" | "right").
   */
  function parseTextAlign(raw, defaultVal) {
    const fallback =
      defaultVal === "left" || defaultVal === "right" || defaultVal === "center"
        ? defaultVal
        : "center";
    if (raw === undefined || raw === null || raw === "") return fallback;
    const s = String(raw).trim().toLowerCase();
    if (s === "left" || s === "l" || s === "start") return "left";
    if (s === "right" || s === "r" || s === "end") return "right";
    if (
      s === "center" ||
      s === "centre" ||
      s === "c" ||
      s === "middle" ||
      s === "mid"
    ) {
      return "center";
    }
    return fallback;
  }

  function firstColumnTextAlign(rows, colIdx, defaultVal) {
    if (colIdx == null || !rows) return parseTextAlign("", defaultVal);
    for (let i = 1; i < rows.length; i++) {
      const raw = cell(rows[i], colIdx);
      if (raw === "" || raw == null) continue;
      return parseTextAlign(raw, defaultVal);
    }
    return parseTextAlign("", defaultVal);
  }

  function applyConfigColors() {
    const main = config.mainColor || "#000000";
    const secondary = config.secondaryColor || "#ffffff";
    const root = document.documentElement;
    root.style.setProperty("--main-color", main);
    root.style.setProperty("--secondary-color", secondary);
    root.style.setProperty("--highlight", config.highlight);
    root.style.setProperty("--highlight-special", config.highlightSpecial);
    // Alias for any leftover CSS/rules that still reference the old name
    root.style.setProperty("--highlight-new", config.highlightSpecial);
    applyStickerTint();
    applyStageBackground();
    // Box overrides + contrast text (all boards that have boxes)
    applyBoxChrome();
    applyDisclaimerContent();
    applyDisclaimerColor();
  }

  /**
   * NEW sticker body tint: paint .new-sticker-tint with Style
   * "Highlight Color (Special)" so mix-blend-mode:color recolors
   * the gray Sticker-Body.png (hue blend does nothing on gray).
   */
  function applyStickerTint() {
    const special =
      normalizeHex(config.highlightSpecial) ||
      normalizeHex(config.highlight) ||
      "#fff900";
    // Keep CSS var in sync even if applyConfigColors order changes
    document.documentElement.style.setProperty(
      "--highlight-special",
      special
    );
    const tints = document.querySelectorAll(".new-sticker-tint");
    for (let i = 0; i < tints.length; i++) {
      tints[i].style.backgroundColor = special;
    }
  }

  /**
   * Allergy text: Main or Secondary by contrast against the *composite* stage BG
   * (BG Color plate + BG Image × opacity × blend mode), not the JPG alone.
   */
  let _disclaimerSampleGen = 0;
  const _bgImageCache = {};

  function setDisclaimerColor(color) {
    if (!els.disclaimer) return;
    const c = normalizeHex(color) || "#ffffff";
    document.documentElement.style.setProperty("--disclaimer-color", c);
    const lightText = relativeLuminance(c) > 0.45;
    els.disclaimer.style.textShadow = lightText
      ? "0 1px 3px rgba(0, 0, 0, 0.45)"
      : "0 1px 2px rgba(255, 255, 255, 0.35)";
  }

  /** Map CSS mix-blend-mode → canvas globalCompositeOperation. */
  function cssBlendToCanvas(blend) {
    const s = String(blend || "normal").toLowerCase();
    const map = {
      normal: "source-over",
      multiply: "multiply",
      screen: "screen",
      overlay: "overlay",
      darken: "darken",
      lighten: "lighten",
      "color-dodge": "color-dodge",
      "color-burn": "color-burn",
      "hard-light": "hard-light",
      "soft-light": "soft-light",
      difference: "difference",
      exclusion: "exclusion",
      hue: "hue",
      saturation: "saturation",
      color: "color",
      luminosity: "luminosity",
    };
    return map[s] || "source-over";
  }

  function loadBgImageCached(src) {
    if (!src) return Promise.reject(new Error("no src"));
    const cached = _bgImageCache[src];
    if (cached && cached.complete && cached.naturalWidth > 0) {
      return Promise.resolve(cached);
    }
    return new Promise(function (resolve, reject) {
      const img = cached || new Image();
      _bgImageCache[src] = img;
      const finish = function () {
        if (img.naturalWidth > 0) resolve(img);
        else reject(new Error("bg image empty: " + src));
      };
      if (img.complete && img.naturalWidth > 0) {
        finish();
        return;
      }
      img.onload = finish;
      img.onerror = function () {
        reject(new Error("bg image load failed: " + src));
      };
      // Same-origin asset paths (assets/bgs/…) stay readable via getImageData
      img.src = src;
    });
  }

  /** object-fit: cover into w×h (matches galaxy layer fill). */
  function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(dw / iw, dh / ih);
    const sw = dw / scale;
    const sh = dh / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function averageCanvasHex(ctx, w, h) {
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (err) {
      // Tainted canvas (cross-origin) — caller falls back
      return null;
    }
    let r = 0;
    let g = 0;
    let b = 0;
    const n = w * h;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    r = Math.round(r / n);
    g = Math.round(g / n);
    b = Math.round(b / n);
    return (
      "#" +
      [r, g, b]
        .map(function (x) {
          return x.toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  /**
   * Composite BG Color + image (opacity + blend) on an offscreen canvas and
   * return the average hex — approximates what sits under the disclaimer.
   */
  async function sampleCompositeStageBgHex(plateHex, imagePath, opacity01, blend) {
    const W = 80;
    const H = 48;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return plateHex;

    // 1) Color plate (always under the image, same as #galaxy)
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = plateHex || "#000000";
    ctx.fillRect(0, 0, W, H);

    if (!imagePath || opacity01 <= 0.01) {
      return averageCanvasHex(ctx, W, H) || plateHex;
    }

    const img = await loadBgImageCached(imagePath);
    // 2) Image layer: opacity + mix-blend-mode against the plate
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity01));
    ctx.globalCompositeOperation = cssBlendToCanvas(blend);
    drawImageCover(ctx, img, 0, 0, W, H);
    ctx.restore();

    return averageCanvasHex(ctx, W, H) || plateHex;
  }

  /**
   * Resolve git build stamp for Show Version (replaces allergy disclaimer).
   * Prefers /api/build (local server live git), then window.TOKI_BUILD.
   */
  function fetchBuildInfo() {
    if (window.__tokiBuildInfoPromise) return window.__tokiBuildInfoPromise;
    window.__tokiBuildInfoPromise = (async function () {
      try {
        const res = await fetch("/api/build?t=" + Date.now(), {
          cache: "no-store",
        });
        if (res && res.ok) {
          const j = await res.json();
          if (j && (j.hash || j.hashFull)) {
            return {
              hash: j.hash || (j.hashFull || "").slice(0, 7),
              hashFull: j.hashFull || "",
              date: j.date || "",
              subject: j.subject || "",
              source: j.source || "api",
            };
          }
        }
      } catch (e) {
        /* remote Pages or offline */
      }
      const b = window.TOKI_BUILD || null;
      if (b && (b.hash || b.hashFull)) {
        return {
          hash: b.hash || String(b.hashFull || "").slice(0, 7),
          hashFull: b.hashFull || "",
          date: b.date || "",
          subject: b.subject || "",
          source: b.source || "static",
        };
      }
      return {
        hash: "unknown",
        hashFull: "",
        date: "",
        subject: "",
        source: "missing",
      };
    })();
    return window.__tokiBuildInfoPromise;
  }

  /** Show Version=1 → disclaimer slot becomes commit hash + date/time. */
  function applyDisclaimerContent() {
    if (!els.disclaimer) return;
    if (cfg.showDisclaimer === false) {
      els.disclaimer.hidden = true;
      return;
    }
    els.disclaimer.hidden = false;
    const showVer = !!(config && config.showVersion);
    if (!showVer) {
      els.disclaimer.innerHTML = DEFAULT_DISCLAIMER_HTML;
      els.disclaimer.classList.remove("is-version");
      return;
    }
    els.disclaimer.classList.add("is-version");
    els.disclaimer.textContent = "…";
    fetchBuildInfo().then(function (info) {
      if (!els.disclaimer) return;
      if (!(config && config.showVersion)) {
        els.disclaimer.innerHTML = DEFAULT_DISCLAIMER_HTML;
        els.disclaimer.classList.remove("is-version");
        return;
      }
      const hash = info.hash || "unknown";
      const date = info.date || "";
      // Replace allergy copy entirely with build identity
      els.disclaimer.textContent = date
        ? hash + " · " + date
        : hash;
      els.disclaimer.title = [
        info.hashFull || hash,
        info.subject || "",
        "source: " + (info.source || ""),
      ]
        .filter(Boolean)
        .join("\n");
    });
  }

  function applyDisclaimerColor() {
    if (!els.disclaimer) return;
    const main = config.mainColor || "#000000";
    const secondary = config.secondaryColor || "#ffffff";
    const plate =
      normalizeHex(config.bgColor) ||
      normalizeHex(config.bgSolid) ||
      main;
    const imagePath = config.bgImage || null;
    const opacity01 = parseUnit01(config.bgOpacity, 1);
    const blend = parseBgBlendMode(config.bgBlendMode);

    // No image / fully transparent image → contrast against the color plate only
    if (!imagePath || opacity01 <= 0.02) {
      setDisclaimerColor(pickContrastingThemeColor(plate, main, secondary));
      return;
    }

    // Provisional: plate-only until the composite sample finishes (avoids flash)
    setDisclaimerColor(pickContrastingThemeColor(plate, main, secondary));

    const gen = ++_disclaimerSampleGen;
    const srcAtStart = imagePath;
    const plateAtStart = plate;
    const opAtStart = opacity01;
    const blendAtStart = blend;

    sampleCompositeStageBgHex(plate, imagePath, opacity01, blend)
      .then(function (compositeHex) {
        if (gen !== _disclaimerSampleGen) return; // superseded by newer theme
        if (config.bgImage !== srcAtStart) return;
        if (parseUnit01(config.bgOpacity, 1) !== opAtStart) return;
        if (parseBgBlendMode(config.bgBlendMode) !== blendAtStart) return;
        const plateNow =
          normalizeHex(config.bgColor) ||
          normalizeHex(config.bgSolid) ||
          main;
        if (plateNow !== plateAtStart) return;

        const bg = normalizeHex(compositeHex) || plate;
        const color = pickContrastingThemeColor(bg, main, secondary);
        setDisclaimerColor(color);
        console.info(
          "Disclaimer contrast on composite BG",
          bg,
          "→",
          color,
          "(plate",
          plate,
          "opacity",
          opacity01,
          "blend",
          blend + ")"
        );
      })
      .catch(function (err) {
        console.warn(
          "Disclaimer composite sample failed; using plate color:",
          err && err.message ? err.message : err
        );
        if (gen === _disclaimerSampleGen) {
          setDisclaimerColor(pickContrastingThemeColor(plate, main, secondary));
        }
      });
  }

  /** Clamp sheet 0–1 controls (blur, opacity). Blank → fallback. */
  function parseUnit01(raw, fallback) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return fallback;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  }

  function parseBgImagePath(raw) {
    const s = String(raw == null ? "" : raw)
      .trim()
      // strip zero-width / BOM junk from Sheets
      .replace(/[\u200b-\u200d\ufeff]/g, "");
    if (!s) return null;
    const token = s
      .split(/[,;|]/)[0]
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!token) return null;
    const low = token.toLowerCase();
    // Explicit solid / no bitmap (Style sheet uses "none")
    if (
      low === "none" ||
      low === "off" ||
      low === "0" ||
      low === "false" ||
      low === "no" ||
      low === "solid" ||
      low === "n/a" ||
      low === "-" ||
      low === "—"
    ) {
      return null;
    }
    if (!/\.(jpe?g|png|webp|gif)$/i.test(low) && low.indexOf("/") === -1) {
      return null;
    }
    const file = token.replace(/^\/+/, "");
    if (file.indexOf("assets/") === 0 || file.indexOf("/") !== -1) return file;
    return BG_IMAGE_FOLDER + "/" + file;
  }

  /**
   * Stage BG image is board-wide: always Style sheet H2 (first data row),
   * never the selected theme's H column (themes are A–F only).
   */
  function resolveStageBgImageFromRows(rows, sc) {
    const row = rows && rows[STYLE_BOARD_WIDE_ROW_INDEX];
    const raw = row ? cell(row, sc.bgImage) : "";
    return {
      raw: raw,
      path: parseBgImagePath(raw),
      from: "H2",
    };
  }

  function parseBgBlendMode(raw) {
    const s = String(raw == null ? "" : raw)
      .trim()
      .toLowerCase()
      .replace(/_/g, "-")
      .replace(/\s+/g, "-");
    if (!s) return "normal";
    if (BG_BLEND_MODES.indexOf(s) >= 0) return s;
    console.warn("Unknown BG Blend Mode:", raw, "— using normal");
    return "normal";
  }

  /**
   * Resolve board-wide BG Color (Color Picker labels / hex / fill).
   * Always returns a concrete hex (falls back to Main).
   */
  function parseBgColor(raw, cellFill, theme) {
    const t = theme || {};
    const main = normalizeHex(t.mainColor) || "#000000";
    const s = String(raw == null ? "" : raw).trim();
    if (!s) {
      return normalizeHex(cellFill) || main;
    }
    const named = resolveNamedThemeColor(s, cellFill, theme);
    if (named) return named;
    return normalizeHex(s) || normalizeHex(cellFill) || main;
  }

  /**
   * Legacy single-cell BG (image OR solid). Kept for old sheets / embedded data.
   */
  function parseBgChoice(raw, cellFill, theme) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) {
      // Blank → color-only (no galaxy fetch)
      return {
        bgMode: "solid",
        bgImage: null,
        bgSolid: null,
        bgColor: null,
      };
    }

    const tokens = s.split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
    const token = (tokens[0] || s).replace(/^["']|["']$/g, "");
    const low = token.toLowerCase();

    if (/\.(jpe?g|png|webp|gif)$/i.test(low)) {
      const path = parseBgImagePath(token);
      return {
        bgMode: "image",
        bgImage: path || null,
        bgSolid: null,
        bgColor: null,
      };
    }

    const solid = resolveNamedThemeColor(token, cellFill, theme);
    if (solid) {
      return {
        bgMode: "solid",
        bgImage: null,
        bgSolid: solid,
        bgColor: solid,
      };
    }

    // Unknown token — solid plate, do not force galaxy download
    return {
      bgMode: "solid",
      bgImage: null,
      bgSolid: null,
      bgColor: null,
    };
  }

  /** Peak image opacity for crossfade (0–1). */
  function bgImageOpacityPeak() {
    const o = Number(config.bgOpacity);
    if (!Number.isFinite(o)) return 1;
    return Math.max(0, Math.min(1, o));
  }

  function applyStageBackground() {
    const galaxy = document.getElementById("galaxy");
    if (!galaxy) return;

    const wall = isPreviewWall();
    const main = config.mainColor || "#000000";
    let plate =
      normalizeHex(config.bgColor) ||
      normalizeHex(config.bgSolid) ||
      main;
    let imagePath = config.bgImage || null;
    if (imagePath) imagePath = wallFriendlyBgPath(imagePath);

    // Multi-board wall: still per-board BG (4 copies), but leaner:
    // no CSS blur/blend, stage-sized galaxy asset, single-layer pan.
    const blur01 = wall ? 0 : parseUnit01(config.bgBlur, 0);
    const opacity01 = parseUnit01(config.bgOpacity, 1);
    const blend = wall ? "normal" : parseBgBlendMode(config.bgBlendMode);

    // Color plate always under the image
    galaxy.style.backgroundColor = plate;
    galaxy.classList.toggle("has-image", !!imagePath);
    galaxy.classList.toggle("is-solid", !imagePath);

    // Blur: 0 → filter disabled (not blur(0)); 1 → BG_BLUR_MAX_PX
    if (blur01 <= 0) {
      galaxy.style.setProperty("--bg-image-blur", "none");
      galaxy.classList.remove("has-blur");
    } else {
      const px = (blur01 * BG_BLUR_MAX_PX).toFixed(2);
      galaxy.style.setProperty("--bg-image-blur", "blur(" + px + "px)");
      galaxy.classList.add("has-blur");
    }
    galaxy.style.setProperty("--bg-image-opacity", String(opacity01));
    galaxy.style.setProperty("--bg-image-blend", blend);

    // Wall: one layer only. Solo: both for pan crossfade.
    const layerEls = wall ? [els.galaxyA] : [els.galaxyA, els.galaxyB];
    if (wall && els.galaxyB) {
      els.galaxyB.hidden = true;
      els.galaxyB.classList.remove("active", "fading-in", "fading-out");
      els.galaxyB.style.opacity = "0";
      if (els.galaxyB.getAttribute("src")) {
        els.galaxyB.removeAttribute("src");
      }
    }

    // Only assign img.src when we actually need a background image.
    layerEls.forEach((el) => {
      if (!el) return;
      if (!imagePath) {
        el.hidden = true;
        el.classList.remove("active", "fading-in", "fading-out");
        el.style.opacity = "0";
        el.style.filter = "";
        el.style.mixBlendMode = "";
        if (el.getAttribute("src")) {
          el.removeAttribute("src");
          tokiLog("bg image cleared (solid / unused)");
        }
        return;
      }
      el.hidden = false;
      if (el.getAttribute("src") !== imagePath) {
        tokiLog("bg image load", imagePath, wall ? "(preview-wall)" : "");
        el.src = imagePath;
      }
    });

    if (
      imagePath &&
      els.galaxyA &&
      !els.galaxyA.classList.contains("active") &&
      !(els.galaxyB && !wall && els.galaxyB.classList.contains("active"))
    ) {
      els.galaxyA.classList.add("active");
      els.galaxyA.style.opacity = String(opacity01);
    }

    // Re-sample disclaimer once the active galaxy image is decode-ready
    if (imagePath && els.galaxyA) {
      const onReady = function () {
        applyDisclaimerColor();
      };
      if (els.galaxyA.complete && els.galaxyA.naturalWidth) {
        // already cached — sample on next frame so paint stack is current
        requestAnimationFrame(onReady);
      } else {
        els.galaxyA.addEventListener("load", onReady, { once: true });
      }
    }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let i = 0;
    let inQuotes = false;
    const s = text.replace(/^\uFEFF/, "");

    while (i < s.length) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === ",") {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        row.push(field);
        field = "";
        if (row.some((c) => String(c).trim() !== "")) rows.push(row);
        row = [];
        if (ch === "\r" && s[i + 1] === "\n") i++;
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    row.push(field);
    if (row.some((c) => String(c).trim() !== "")) rows.push(row);
    return rows;
  }

  // ---------- xlsx fill extraction (for drinks colors) ----------

  async function inflateRaw(data) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("DecompressionStream not available");
    }
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([data]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  /**
   * Minimal ZIP reader via end-of-central-directory (handles data descriptors).
   * Only extracts paths we care about for fill parsing.
   */
  async function readZipEntries(arrayBuffer, wantedPrefixes) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const entries = {};
    const prefixes = wantedPrefixes || ["xl/"];

    // Find EOCD (search last 64KB)
    let eocd = -1;
    const searchFrom = Math.max(0, bytes.length - 65536);
    for (let i = bytes.length - 22; i >= searchFrom; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("ZIP EOCD not found");

    const cdOffset = view.getUint32(eocd + 16, true);
    const cdEntries = view.getUint16(eocd + 10, true);
    let offset = cdOffset;

    for (let n = 0; n < cdEntries && offset + 46 <= bytes.length; n++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      const method = view.getUint16(offset + 10, true);
      const compSize = view.getUint32(offset + 20, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLen);
      const name = new TextDecoder("utf-8").decode(nameBytes);
      offset += 46 + nameLen + extraLen + commentLen;

      const wanted = prefixes.some(
        (p) => name === p || name.indexOf(p) === 0
      );
      if (!wanted) continue;
      // Skip bulky media
      if (/\.(png|jpe?g|gif|emf|wmf)$/i.test(name)) continue;

      // Local file header
      if (view.getUint32(localOffset, true) !== 0x04034b50) continue;
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const comp = bytes.subarray(dataStart, dataStart + compSize);

      if (method === 0) {
        entries[name] = comp;
      } else if (method === 8) {
        try {
          entries[name] = await inflateRaw(comp);
        } catch (err) {
          console.warn("inflate failed for", name, err);
        }
      }
    }
    return entries;
  }

  function xmlLocal(name) {
    const i = name.indexOf("}");
    return i >= 0 ? name.slice(i + 1) : name;
  }

  function parseXlsxRgb(colorEl) {
    if (!colorEl) return null;
    const rgb = colorEl.getAttribute("rgb");
    if (rgb) {
      const s = rgb.length === 8 ? rgb.slice(2) : rgb;
      return normalizeHex(s);
    }
    // theme colors: treat theme 0/1 carefully; skip unresolved themes
    return null;
  }

  /**
   * Google workbook xlsx cache — one network download serves every
   * loadSheetStylesByName / fills request (Protein, Style, Announcements, …).
   * Soft reloads reuse the buffer until TTL so periodic refresh stays snappy.
   */
  const XLSX_CACHE_TTL_MS = 5 * 60 * 1000;
  let _workbookXlsxCache = {
    buffer: null,
    entries: null,
    fetchedAt: 0,
    sheetId: "",
    stylesByMatch: {}, // lowercased sheet name match → { fills, fonts, rich }
  };

  function invalidateWorkbookXlsxCache() {
    _workbookXlsxCache = {
      buffer: null,
      entries: null,
      fetchedAt: 0,
      sheetId: "",
      stylesByMatch: {},
    };
  }

  /**
   * @param {boolean} forceRefresh
   * @param {object} [opts]
   * @param {boolean} [opts.allowInWall] Board 4 rich text may load xlsx even in wall
   */
  async function fetchWorkbookXlsxBuffer(forceRefresh, opts) {
    opts = opts || {};
    // Wall: skip xlsx unless explicitly allowed (drinks announcement rich text)
    if (isPreviewWall() && !opts.allowInWall) {
      throw new Error("preview-wall: xlsx disabled");
    }
    const id = (cfg.googleSheetId || "").trim();
    if (!id) throw new Error("No googleSheetId in config");
    const now = Date.now();
    if (
      !forceRefresh &&
      _workbookXlsxCache.buffer &&
      _workbookXlsxCache.sheetId === id &&
      now - _workbookXlsxCache.fetchedAt < XLSX_CACHE_TTL_MS
    ) {
      return _workbookXlsxCache.buffer;
    }
    const useProxy = await detectSheetsApiProxy();
    const url = useProxy
      ? "/api/sheets/xlsx?t=" +
        now +
        (forceRefresh ? "&force=1" : "")
      : "https://docs.google.com/spreadsheets/d/" +
        encodeURIComponent(id) +
        "/export?format=xlsx&cachebust=" +
        now;
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const res = await fetch(url, { cache: "no-store", mode: "cors" });
    if (!res.ok) {
      throw new Error(
        "Xlsx export failed (" +
          res.status +
          ")" +
          (useProxy
            ? " via API proxy — enable Drive API + share sheet with service account"
            : "")
      );
    }
    const buf = await res.arrayBuffer();
    // Detect HTML error pages masquerading as xlsx
    const head = new Uint8Array(buf.slice(0, 4));
    const isZip = head[0] === 0x50 && head[1] === 0x4b; // PK
    if (!isZip) {
      throw new Error(
        "Xlsx response was not a workbook (sheet private or API misconfigured)"
      );
    }
    const ms =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      t0;
    _workbookXlsxCache = {
      buffer: buf,
      entries: null,
      fetchedAt: now,
      sheetId: id,
      stylesByMatch: {},
    };
    console.info(
      "Workbook xlsx:",
      (buf.byteLength / 1024).toFixed(1) + "KB in " + Math.round(ms) + "ms",
      useProxy ? "(API proxy)" : "(public export)"
    );
    return buf;
  }

  async function getWorkbookZipEntries(arrayBuffer) {
    if (
      _workbookXlsxCache.buffer === arrayBuffer &&
      _workbookXlsxCache.entries
    ) {
      return _workbookXlsxCache.entries;
    }
    const entries = await readZipEntries(arrayBuffer, [
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/sharedStrings.xml",
      "xl/_rels/",
      "xl/worksheets/",
    ]);
    if (_workbookXlsxCache.buffer === arrayBuffer) {
      _workbookXlsxCache.entries = entries;
    }
    return entries;
  }

  /**
   * Extract fills + font styles (+ rich text) from a workbook sheet.
   * Returns { fills, fonts, rich } keyed by cell ref (e.g. "F2").
   */
  async function extractSheetStylesFromXlsx(arrayBuffer, sheetNameMatch) {
    const empty = { fills: {}, fonts: {}, rich: {} };
    const entries = await getWorkbookZipEntries(arrayBuffer);
    const dec = new TextDecoder("utf-8");
    const parser = new DOMParser();

    const stylesXml = entries["xl/styles.xml"];
    if (!stylesXml) return empty;
    const stylesDoc = parser.parseFromString(dec.decode(stylesXml), "text/xml");
    const fillNodes = [];
    const fontStyles = []; // { bold, italic, color }

    for (const el of stylesDoc.getElementsByTagName("*")) {
      if (xmlLocal(el.tagName) === "fills") {
        for (const child of el.children || []) {
          if (xmlLocal(child.tagName) === "fill") fillNodes.push(child);
        }
      }
      if (xmlLocal(el.tagName) === "fonts") {
        for (const child of el.children || []) {
          if (xmlLocal(child.tagName) !== "font") continue;
          let bold = false;
          let italic = false;
          let col = null;
          for (const f of child.children || []) {
            const n = xmlLocal(f.tagName);
            if (n === "b") bold = true;
            if (n === "i") italic = true;
            if (n === "color") col = parseXlsxRgb(f);
          }
          fontStyles.push({ bold: bold, italic: italic, color: col });
        }
      }
    }

    const fillColors = fillNodes.map((fill) => {
      let pattern = null;
      for (const ch of fill.children || []) {
        if (xmlLocal(ch.tagName) === "patternFill") pattern = ch;
      }
      if (!pattern) return null;
      if (pattern.getAttribute("patternType") !== "solid") return null;
      for (const ch of pattern.children || []) {
        if (xmlLocal(ch.tagName) === "fgColor") return parseXlsxRgb(ch);
      }
      return null;
    });

    const cellXfs = [];
    const cellStyleXfs = [];
    for (const el of stylesDoc.getElementsByTagName("*")) {
      const tag = xmlLocal(el.tagName);
      if (tag === "cellXfs") {
        for (const xf of el.children || []) {
          if (xmlLocal(xf.tagName) === "xf") cellXfs.push(xf);
        }
      }
      if (tag === "cellStyleXfs") {
        for (const xf of el.children || []) {
          if (xmlLocal(xf.tagName) === "xf") cellStyleXfs.push(xf);
        }
      }
    }

    /** Horizontal align from xf / style chain → "left"|"center"|"right"|null */
    function xfTextAlign(xf, allowStyleLookup) {
      if (!xf) return null;
      for (const ch of xf.children || []) {
        if (xmlLocal(ch.tagName) !== "alignment") continue;
        const h = String(ch.getAttribute("horizontal") || "")
          .trim()
          .toLowerCase();
        if (h === "left" || h === "right" || h === "center") return h;
        if (h === "justify" || h === "distributed" || h === "fill") {
          return "center";
        }
        // "general" / empty → no explicit align
        return null;
      }
      if (allowStyleLookup === false) return null;
      const apply = xf.getAttribute("applyAlignment");
      if (apply === "0") return null;
      const styleId = xf.getAttribute("xfId");
      if (styleId != null && styleId !== "" && cellStyleXfs[Number(styleId)]) {
        return xfTextAlign(cellStyleXfs[Number(styleId)], false);
      }
      return null;
    }

    // Rich text shared strings (index → runs)
    const richBySs = {};
    const ssXml = entries["xl/sharedStrings.xml"];
    if (ssXml) {
      const ssDoc = parser.parseFromString(dec.decode(ssXml), "text/xml");
      let ssIndex = 0;
      for (const el of ssDoc.getElementsByTagName("*")) {
        if (xmlLocal(el.tagName) !== "si") continue;
        const runs = [];
        let hasRich = false;
        for (const child of el.children || []) {
          if (xmlLocal(child.tagName) === "r") {
            hasRich = true;
            let bold = false;
            let italic = false;
            let col = null;
            let text = "";
            for (const part of child.children || []) {
              const pn = xmlLocal(part.tagName);
              if (pn === "rPr") {
                for (const rp of part.children || []) {
                  const rn = xmlLocal(rp.tagName);
                  // Google/Excel: <b/> or <b val="1"/> = bold; <b val="0"/> = not bold
                  if (rn === "b") {
                    const bv = rp.getAttribute("val");
                    bold =
                      bv == null ||
                      bv === "" ||
                      bv === "1" ||
                      bv === "true" ||
                      bv === "on";
                  }
                  if (rn === "i") {
                    const iv = rp.getAttribute("val");
                    italic =
                      iv == null ||
                      iv === "" ||
                      iv === "1" ||
                      iv === "true" ||
                      iv === "on";
                  }
                  if (rn === "color") col = parseXlsxRgb(rp);
                }
              }
              if (pn === "t") text = part.textContent || "";
            }
            runs.push({
              text: text,
              bold: bold,
              italic: italic,
              color: col,
            });
          }
        }
        if (hasRich && runs.length) richBySs[ssIndex] = runs;
        ssIndex++;
      }
    }

    // Find worksheet path
    const wbXml = entries["xl/workbook.xml"];
    const relsXml = entries["xl/_rels/workbook.xml.rels"];
    if (!wbXml || !relsXml) return empty;
    const wbDoc = parser.parseFromString(dec.decode(wbXml), "text/xml");
    const relsDoc = parser.parseFromString(dec.decode(relsXml), "text/xml");
    const ridToTarget = {};
    for (const rel of relsDoc.getElementsByTagName("*")) {
      if (xmlLocal(rel.tagName) !== "Relationship") continue;
      let t = rel.getAttribute("Target") || "";
      if (t && t.indexOf("xl/") !== 0) t = "xl/" + t.replace(/^\//, "");
      ridToTarget[rel.getAttribute("Id")] = t;
    }

    let sheetPath = null;
    for (const sh of wbDoc.getElementsByTagName("*")) {
      if (xmlLocal(sh.tagName) !== "sheet") continue;
      const name = sh.getAttribute("name") || "";
      const rid =
        sh.getAttribute("r:id") ||
        sh.getAttributeNS(
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
          "id"
        );
      if (
        sheetNameMatch &&
        name.toLowerCase().indexOf(String(sheetNameMatch).toLowerCase()) !== -1
      ) {
        sheetPath = ridToTarget[rid];
        break;
      }
    }
    if (!sheetPath) {
      const sheets = [];
      for (const sh of wbDoc.getElementsByTagName("*")) {
        if (xmlLocal(sh.tagName) === "sheet") sheets.push(sh);
      }
      if (sheets.length >= 4) {
        const sh = sheets[3];
        const rid =
          sh.getAttribute("r:id") ||
          sh.getAttributeNS(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "id"
          );
        sheetPath = ridToTarget[rid];
      }
    }
    if (!sheetPath || !entries[sheetPath]) return empty;

    const sheetDoc = parser.parseFromString(
      dec.decode(entries[sheetPath]),
      "text/xml"
    );
    const fills = {};
    const fonts = {};
    const rich = {};
    for (const c of sheetDoc.getElementsByTagName("*")) {
      if (xmlLocal(c.tagName) !== "c") continue;
      const ref = c.getAttribute("r");
      if (!ref) continue;
      const s = c.getAttribute("s");
      const t = c.getAttribute("t");
      let vText = null;
      for (const ch of c.children || []) {
        if (xmlLocal(ch.tagName) === "v") vText = ch.textContent;
      }

      if (s != null) {
        const xf = cellXfs[Number(s)];
        if (xf) {
          const fillId = Number(xf.getAttribute("fillId") || 0);
          const fontId = Number(xf.getAttribute("fontId") || 0);
          const fillColor = fillColors[fillId];
          if (fillColor) fills[ref] = fillColor;
          const fs = fontStyles[fontId];
          const align = xfTextAlign(xf, true);
          if (fs || align) {
            fonts[ref] = {
              bold: !!(fs && fs.bold),
              italic: !!(fs && fs.italic),
              color: (fs && fs.color) || null,
              align: align || null,
            };
          }
        }
      }

      // Rich text: shared string index with multiple runs
      if (t === "s" && vText != null && richBySs[Number(vText)]) {
        rich[ref] = richBySs[Number(vText)];
      }
    }
    return { fills: fills, fonts: fonts, rich: rich };
  }

  /** Back-compat: fills only */
  async function extractSheetFillsFromXlsx(arrayBuffer, sheetNameMatch) {
    const meta = await extractSheetStylesFromXlsx(
      arrayBuffer,
      sheetNameMatch
    );
    return meta.fills || {};
  }

  // ---------- data ----------

  function parsedMenuFromRows(rows, columnMap) {
    const c = columnMap || col;
    const dataRows = rows
      .slice(1)
      .filter((r) => r && r.some((v) => v != null && String(v).trim() !== ""));

    if (dataRows.length === 0) {
      throw new Error("Spreadsheet has no data rows");
    }

    // Drinks board has a dedicated shape
    if (isDrinks && c.drinksOverview != null) {
      return parsedDrinksFromRows(rows, c);
    }

    const first = dataRows[0];
    const parsedItems = [];
    const proteins = [];
    const sauces = [];
    let proteinTitle = "";
    let proteinSubtitle = "";
    let saucesTitle = "";
    let saucesSubtitle = "";

    for (const row of dataRows) {
      const name = cell(row, c.item);
      if (name !== "" && name != null) {
        const imageName = cell(row, c.image);

        // Prices: multi-price boards (price1/2/3) must NOT also read bowls' `price`
        // column — that index collides with New/Image on munchies sheets.
        const priceTokens = [];
        const multiPrice =
          c.price1 != null || c.price2 != null || c.price3 != null;
        if (multiPrice) {
          [c.price1, c.price2, c.price3].forEach((idx) => {
            if (idx == null) return;
            const p = cell(row, idx);
            if (isUsablePriceCell(p)) priceTokens.push(String(p).trim());
          });
        } else if (c.price != null) {
          const p = cell(row, c.price);
          if (isUsablePriceCell(p)) priceTokens.push(String(p).trim());
        }

        // Subtitle (munchies) and description (bowls/handhelds) are separate —
        // never fall back across column types (avoids Image filename as subtitle).
        const subtitle =
          c.subtitle != null
            ? String(cell(row, c.subtitle) || "").trim()
            : "";
        const description =
          c.description != null
            ? String(cell(row, c.description) || "").trim()
            : "";

        parsedItems.push({
          name: String(name).trim(),
          price: priceTokens[0] || "",
          prices: priceTokens,
          description,
          subtitle,
          isNew: Number(cell(row, c.isNew)) === 1,
          image:
            imageName !== "" &&
            imageName != null &&
            String(imageName).toLowerCase() !== "null"
              ? String(imageName).replace(/^\/+/, "")
              : null,
          include: parseInclude(cell(row, c.include)),
        });
      }

      if (c.proteinItem != null) {
        const pt = cell(row, c.proteinTitle);
        const ps = cell(row, c.proteinSubtitle);
        const pi = cell(row, c.proteinItem);
        const pp = cell(row, c.proteinPrice);
        if (pt) proteinTitle = String(pt);
        if (ps) proteinSubtitle = String(ps);
        if (pi) {
          proteins.push({
            name: String(pi).trim(),
            price: formatPrice(pp),
          });
        }
      }

      if (c.saucesItem != null) {
        const st = cell(row, c.saucesTitle);
        const ss = cell(row, c.saucesSubtitle);
        const si = cell(row, c.saucesItem);
        if (st) saucesTitle = String(st);
        if (ss) saucesSubtitle = String(ss);
        if (si) {
          sauces.push({ name: String(si).trim() });
        }
      }
    }

    // Box color overrides: store Color Picker label + cell fill; resolve at apply
    let proteinChoice = null;
    let proteinFill = null;
    let saucesChoice = null;
    let saucesFill = null;
    if (c.proteinBoxColor != null) {
      proteinChoice = String(cell(first, c.proteinBoxColor) || "").trim() || null;
      proteinFill = sheetFills[cellRef(c.proteinBoxColor, 2)] || null;
    }
    if (c.saucesBoxColor != null) {
      saucesChoice = String(cell(first, c.saucesBoxColor) || "").trim() || null;
      saucesFill = sheetFills[cellRef(c.saucesBoxColor, 2)] || null;
    }

    // Include flags — first non-empty cell in the column
    function firstColumnInclude(colIdx, defaultVal) {
      if (colIdx == null) return defaultVal !== false;
      const def = defaultVal !== false;
      for (let i = 1; i < rows.length; i++) {
        const raw = cell(rows[i], colIdx);
        if (raw === "" || raw == null) continue;
        return parseInclude(raw);
      }
      return def;
    }
    const includeProteinBox = firstColumnInclude(c.includeProteinBox, true);
    const includeSaucesBox = firstColumnInclude(c.includeSaucesBox, true);
    // Drinks/soda footer: default OFF when column missing or blank
    const includeDrinksBox = firstColumnInclude(c.includeDrinksBox, false);
    // Descriptions: default ON when column missing (legacy boards)
    const includeDescriptions = firstColumnInclude(
      c.includeDescriptions,
      true
    );

    function firstColumnMenuColumns(colIdx) {
      if (colIdx == null) return "auto";
      for (let i = 1; i < rows.length; i++) {
        const raw = cell(rows[i], colIdx);
        if (raw === "" || raw == null) continue;
        const s = String(raw).trim().toLowerCase();
        if (!s || s === "auto") return "auto";
        if (s === "1" || s === "one") return 1;
        if (s === "2" || s === "two") return 2;
        if (s === "3" || s === "three") return 3;
        const n = Number(s);
        if (n === 1 || n === 2 || n === 3) return n;
        return "auto";
      }
      return "auto";
    }
    const menuColumns = firstColumnMenuColumns(c.menuColumns);

    const out = {
      title: String(cell(first, c.title) || ""),
      items: parsedItems,
      includeDescriptions: includeDescriptions,
      menuColumns: menuColumns,
      proteinBox: {
        title: proteinTitle,
        subtitle: proteinSubtitle,
        items: proteins,
        bgChoice: proteinChoice,
        bgFill: proteinFill,
        include: includeProteinBox,
      },
      saucesBox: {
        title: saucesTitle,
        subtitle: saucesSubtitle,
        items: sauces,
        bgChoice: saucesChoice,
        bgFill: saucesFill,
        include: includeSaucesBox,
      },
      footerDrinksBox: {
        title: "",
        subtitle: "",
        items: [],
        include: includeDrinksBox,
        createColumns: false,
        textAlign: "center",
      },
    };

    // Speeds / colors only when those columns exist on this sheet
    if (c.bgScrollSpeed != null) {
      out.bgScrollSpeed = Number(cell(first, c.bgScrollSpeed)) || 1;
    }
    if (c.slideshowSpeed != null) {
      out.slideshowSpeed = Number(cell(first, c.slideshowSpeed)) || 3;
    }
    if (c.highlight != null) {
      out.highlight = cell(first, c.highlight);
    }
    if (c.highlightSpecial != null) {
      out.highlightSpecial = cell(first, c.highlightSpecial);
    }

    return out;
  }

  function parseAnnouncementSpeed(raw, fallback) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return fallback;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
  }

  function parsedDrinksFromRows(rows, columnMap) {
    const c = columnMap || col;
    // Walk every data row by original CSV index so Excel row numbers stay aligned
    // with xlsx styles (G2, G3, …). Each non-empty Announcement Text (G) is one
    // message-board slide. Title+subtitle are married: blank E inherits both
    // previous title and subtitle; new E takes F as subtitle (blank F clears).
    // Blank I inherits previous speed. Rich bold/color live in G runs.
    const dataRows = rows.slice(1);
    if (
      !dataRows.some(
        (r) => r && r.some((v) => v != null && String(v).trim() !== "")
      )
    ) {
      throw new Error("Drinks sheet has no data rows");
    }

    const first =
      dataRows.find(
        (r) => r && r.some((v) => v != null && String(v).trim() !== "")
      ) || dataRows[0];
    const parsedItems = [];
    const messages = [];
    let lastTitle = "";
    let lastSubtitle = "";
    let lastSpeed = Number(config.slideshowSpeed) || 4;
    let lastShout = false;
    /** Baseline shake that matched the baked keyframes before intensity column */
    const DEFAULT_SHAKE_INTENSITY = 0.75;
    let lastShakeIntensity = DEFAULT_SHAKE_INTENSITY;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row) continue;
      // Excel row 1 = header; dataRows[0] → row 2
      const excelRow = i + 2;

      const copyText = cell(row, c.announcementCopy);
      if (copyText != null && String(copyText).trim() !== "") {
        const ref = cellRef(c.announcementCopy, excelRow);
        const font = sheetFonts[ref] || {};
        const runs = sheetRich[ref] || null;
        const rawTitle =
          c.announcementTitle != null
            ? String(cell(row, c.announcementTitle) || "").trim()
            : "";
        const rawSub =
          c.announcementSubtitle != null
            ? String(cell(row, c.announcementSubtitle) || "").trim()
            : "";
        // Title + subtitle are married:
        // - new title → subtitle = F (blank F clears subtitle)
        // - blank title → inherit previous title AND subtitle
        let title;
        let subtitle;
        if (rawTitle) {
          title = rawTitle;
          subtitle = rawSub;
          lastTitle = title;
          lastSubtitle = subtitle;
        } else {
          title = lastTitle;
          subtitle = lastSubtitle;
        }
        const speed = parseAnnouncementSpeed(
          c.announcementSpeed != null ? cell(row, c.announcementSpeed) : "",
          lastSpeed
        );
        // Body align from G cell formatting (xlsx); default center — not titles
        const textAlign = parseTextAlign(font.align, "center");
        // J Shout: blank inherits previous (default off)
        let shout = lastShout;
        if (c.announcementShout != null) {
          const rawShout = cell(row, c.announcementShout);
          if (rawShout != null && String(rawShout).trim() !== "") {
            shout = parseYesNo(rawShout, false);
          }
        }
        // K Shout Shake Intensity: blank inherits; default 0.75 (= current baked look)
        let shakeIntensity = lastShakeIntensity;
        if (c.announcementShakeIntensity != null) {
          const rawI = cell(row, c.announcementShakeIntensity);
          if (rawI != null && String(rawI).trim() !== "") {
            const n = Number(rawI);
            if (Number.isFinite(n) && n >= 0) {
              // Clamp silly highs; 0 = no shake, 1 = max (crazier than baseline)
              shakeIntensity = Math.min(2, n);
            }
          }
        }
        messages.push({
          title: title,
          subtitle: subtitle,
          text: String(copyText).trim(),
          speedSec: speed,
          textAlign: textAlign,
          shout: !!shout,
          shakeIntensity: shakeIntensity,
          // Cell-level font only used when no rich runs (see paintAnnouncementBody)
          color: announcementFontColor(font.color),
          bold: !!font.bold,
          italic: !!font.italic,
          runs: runs,
        });
        lastSpeed = speed;
        lastShout = !!shout;
        lastShakeIntensity = shakeIntensity;
      }

      const name = cell(row, c.item);
      if (name !== "" && name != null) {
        const imageName = cell(row, c.image);
        const subtitle =
          c.subtitle != null
            ? String(cell(row, c.subtitle) || "").trim()
            : "";
        parsedItems.push({
          name: String(name).trim(),
          price: "",
          prices: [],
          description: "",
          subtitle,
          isNew: c.isNew != null && Number(cell(row, c.isNew)) === 1,
          image:
            imageName !== "" &&
            imageName != null &&
            String(imageName).toLowerCase() !== "null"
              ? String(imageName).replace(/^\/+/, "")
              : null,
          include: parseInclude(cell(row, c.include)),
        });
      }
    }

    const s1Fill = sheetFills[cellRef(c.stripeColor1, 2)] || null;
    const s2Fill = sheetFills[cellRef(c.stripeColor2, 2)] || null;
    const annChoice =
      c.announcementColor != null
        ? String(cell(first, c.announcementColor) || "").trim() || null
        : null;
    const annFill =
      c.announcementColor != null
        ? sheetFills[cellRef(c.announcementColor, 2)] || null
        : null;
    const drinkChoice =
      c.drinkBoxColor != null
        ? String(cell(first, c.drinkBoxColor) || "").trim() || null
        : null;
    const drinkFill =
      c.drinkBoxColor != null
        ? sheetFills[cellRef(c.drinkBoxColor, 2)] || null
        : null;

    // Blank Overview Image = no overview hero (do not invent a default file)
    let overviewImg = String(cell(first, c.overviewImage) || "").trim();
    if (!overviewImg || overviewImg.toLowerCase() === "null") {
      overviewImg = null;
    }

    // Stripes: Color Picker labels OR typed hex OR fill (resolved at apply)
    const stripe1Choice = String(cell(first, c.stripeColor1) || "").trim() || null;
    const stripe2Choice = String(cell(first, c.stripeColor2) || "").trim() || null;
    const includeStripes =
      c.includeStripes != null
        ? parseInclude(cell(first, c.includeStripes))
        : true;

    const firstMsg = messages[0] || null;
    return {
      title: String(cell(first, c.title) || ""),
      items: parsedItems,
      includeStripes: includeStripes,
      stripeColor1Choice: stripe1Choice,
      stripeColor1Fill: s1Fill,
      stripeColor2Choice: stripe2Choice,
      stripeColor2Fill: s2Fill,
      announcementBox: {
        title: firstMsg ? firstMsg.title : "",
        subtitle: firstMsg ? firstMsg.subtitle : "",
        messages: messages,
        // legacy lines for any leftover callers: body lines of first message
        lines: firstMsg
          ? firstMsg.text.split(/\n/).map(function (t) {
              return {
                text: t,
                color: firstMsg.color,
                bold: firstMsg.bold,
                italic: firstMsg.italic,
                runs: null,
              };
            })
          : [],
        bgChoice: annChoice,
        bgFill: annFill,
      },
      drinkBox: {
        title: String(cell(first, c.drinkBoxTitle) || "").trim(),
        subtitle: String(cell(first, c.drinkBoxSubtitle) || "").trim(),
        bgChoice: drinkChoice,
        bgFill: drinkFill,
      },
      drinksOverview: parseInclude(cell(first, c.drinksOverview)),
      drinksIndividual: parseInclude(cell(first, c.drinksIndividual)),
      overviewImage: overviewImg,
    };
  }

  function applyParsedMenu(parsed) {
    const main =
      normalizeHex(parsed.mainColor) || config.mainColor || "#000000";
    const secondary =
      normalizeHex(parsed.secondaryColor) ||
      config.secondaryColor ||
      "#ffffff";
    const highlight =
      normalizeHex(parsed.highlight) || config.highlight || "#26bbcb";
    const highlightSpecial =
      normalizeHex(parsed.highlightSpecial) ||
      config.highlightSpecial ||
      "#fff900";

    const themeColors = {
      mainColor: main,
      secondaryColor: secondary,
      highlight: highlight,
      highlightSpecial: highlightSpecial,
    };

    /**
     * Box Color Picker → solid hex or image surface.
     * Supports Main/Secondary/Highlight/Special/Override fill + galaxy-bg.jpg etc.
     */
    function boxSurfaceFrom(box, legacyBg) {
      const choice =
        (box && (box.bgChoice != null ? box.bgChoice : box.bg)) || legacyBg;
      const fill = box && box.bgFill != null ? box.bgFill : null;
      const s = String(choice == null ? "" : choice).trim();
      const token = s
        .split(/[,;|]/)[0]
        .trim()
        .replace(/^["']|["']$/g, "");
      const low = token.toLowerCase();

      if (token && /\.(jpe?g|png|webp|gif)$/i.test(low)) {
        const file = token.replace(/^\/+/, "");
        const path =
          file.indexOf("assets/") === 0 || file.indexOf("food-pics/") === 0
            ? file
            : BG_IMAGE_FOLDER + "/" + file;
        // Galaxy-style photos are dark → Secondary (white) text reads best
        return {
          mode: "image",
          color: main,
          image: path,
          text: secondary,
        };
      }

      const color =
        resolveNamedThemeColor(choice, fill, themeColors) || main;
      return {
        mode: "solid",
        color: color,
        image: null,
        text: pickContrastingThemeColor(color, main, secondary),
      };
    }

    const stripe1 =
      resolveNamedThemeColor(
        parsed.stripeColor1Choice != null
          ? parsed.stripeColor1Choice
          : parsed.stripeColor1,
        parsed.stripeColor1Fill,
        themeColors
      ) || main;
    const stripe2 =
      resolveNamedThemeColor(
        parsed.stripeColor2Choice != null
          ? parsed.stripeColor2Choice
          : parsed.stripeColor2,
        parsed.stripeColor2Fill,
        themeColors
      ) || secondary;

    const annSurf = boxSurfaceFrom(
      parsed.announcementBox,
      parsed.announcementBg
    );
    const proteinSurf = boxSurfaceFrom(
      parsed.proteinBox,
      parsed.proteinBoxBg
    );
    const saucesSurf = boxSurfaceFrom(parsed.saucesBox, parsed.saucesBoxBg);
    const drinkSurf = boxSurfaceFrom(parsed.drinkBox, parsed.drinkBoxBg);
    const footerDrinksSurf = boxSurfaceFrom(
      parsed.footerDrinksBox,
      parsed.footerDrinksBoxBg
    );

    const bgColor =
      normalizeHex(parsed.bgColor) ||
      normalizeHex(parsed.bgSolid) ||
      main;
    // null image is intentional (color-only); only fall back when key absent
    let bgImage;
    if (Object.prototype.hasOwnProperty.call(parsed, "bgImage")) {
      bgImage = parsed.bgImage || null;
    } else if (parsed.bgMode === "solid") {
      bgImage = null;
    } else {
      // No theme image key → keep current (often null); never force galaxy
      bgImage = config.bgImage || null;
    }
    const bgBlur = parseUnit01(
      parsed.bgBlur != null ? parsed.bgBlur : config.bgBlur,
      0
    );
    const bgOpacity = parseUnit01(
      parsed.bgOpacity != null ? parsed.bgOpacity : config.bgOpacity,
      1
    );
    const bgBlendMode = parseBgBlendMode(
      parsed.bgBlendMode != null ? parsed.bgBlendMode : config.bgBlendMode
    );

    config = {
      title: parsed.title || config.title || "",
      mainColor: main,
      secondaryColor: secondary,
      bgColor: bgColor,
      bgImage: bgImage,
      bgBlur: bgBlur,
      bgBlendMode: bgBlendMode,
      bgOpacity: bgOpacity,
      bgMode: bgImage ? "image" : "solid",
      bgSolid: bgColor,
      bgScrollSpeed: Number(parsed.bgScrollSpeed) || config.bgScrollSpeed || 1,
      slideshowSpeed:
        Number(parsed.slideshowSpeed) || config.slideshowSpeed || 3,
      highlight: highlight,
      highlightSpecial: highlightSpecial,
      stripeColor1: stripe1,
      stripeColor2: stripe2,
      includeStripes:
        parsed.includeStripes !== undefined
          ? !!parsed.includeStripes
          : config.includeStripes !== false,
      announcementBg: annSurf.color,
      announcementBgImage: annSurf.image,
      announcementBodyText: annSurf.text,
      proteinBoxBg: proteinSurf.color,
      proteinBoxImage: proteinSurf.image,
      proteinBoxText: proteinSurf.text,
      saucesBoxBg: saucesSurf.color,
      saucesBoxImage: saucesSurf.image,
      saucesBoxText: saucesSurf.text,
      drinkBoxBg: drinkSurf.color,
      drinkBoxImage: drinkSurf.image,
      drinkBoxText: drinkSurf.text,
      footerDrinksBoxBg: footerDrinksSurf.color,
      footerDrinksBoxImage: footerDrinksSurf.image,
      footerDrinksBoxText: footerDrinksSurf.text,
      drinksOverview:
        parsed.drinksOverview !== undefined
          ? !!parsed.drinksOverview
          : config.drinksOverview !== false,
      drinksIndividual:
        parsed.drinksIndividual !== undefined
          ? !!parsed.drinksIndividual
          : config.drinksIndividual !== false,
      // Allow explicit null (blank Overview Image column) — don't keep a prior default
      overviewImage:
        parsed.overviewImage !== undefined
          ? parsed.overviewImage
          : config.overviewImage || null,
      showVersion:
        parsed.showVersion !== undefined
          ? !!parsed.showVersion
          : !!config.showVersion,
    };

    if (parsed.proteinBox) {
      proteinBox = {
        title: parsed.proteinBox.title || "",
        subtitle: parsed.proteinBox.subtitle || "",
        items: parsed.proteinBox.items || [],
        bg: proteinSurf.color,
        bgImage: proteinSurf.image,
        bgChoice: parsed.proteinBox.bgChoice,
        bgFill: parsed.proteinBox.bgFill,
        include: parsed.proteinBox.include !== false,
        createColumns: parsed.proteinBox.createColumns !== false,
        textAlign: parseTextAlign(parsed.proteinBox.textAlign, "right"),
      };
      console.info(
        "Protein Create Columns?",
        proteinBox.createColumns ? "Yes" : "No",
        "align",
        proteinBox.textAlign
      );
    }
    if (parsed.saucesBox) {
      saucesBox = {
        title: parsed.saucesBox.title || "",
        subtitle: parsed.saucesBox.subtitle || "",
        items: parsed.saucesBox.items || [],
        bg: saucesSurf.color,
        bgImage: saucesSurf.image,
        bgChoice: parsed.saucesBox.bgChoice,
        bgFill: parsed.saucesBox.bgFill,
        include: parsed.saucesBox.include !== false,
        createColumns: !!parsed.saucesBox.createColumns,
        textAlign: parseTextAlign(parsed.saucesBox.textAlign, "center"),
      };
      console.info(
        "Sauces Create Columns?",
        saucesBox.createColumns ? "Yes" : "No",
        "align",
        saucesBox.textAlign
      );
    }
    if (parsed.footerDrinksBox) {
      footerDrinksBox = {
        title: parsed.footerDrinksBox.title || "",
        subtitle: parsed.footerDrinksBox.subtitle || "",
        items: parsed.footerDrinksBox.items || [],
        bg: footerDrinksSurf.color,
        bgImage: footerDrinksSurf.image,
        bgChoice: parsed.footerDrinksBox.bgChoice,
        bgFill: parsed.footerDrinksBox.bgFill,
        include: !!parsed.footerDrinksBox.include,
        createColumns: !!parsed.footerDrinksBox.createColumns,
        textAlign: parseTextAlign(
          parsed.footerDrinksBox.textAlign,
          "center"
        ),
      };
      console.info(
        "Footer drinks include?",
        footerDrinksBox.include ? "Yes" : "No",
        "Create Columns?",
        footerDrinksBox.createColumns ? "Yes" : "No",
        "items",
        (footerDrinksBox.items || []).length
      );
    } else {
      footerDrinksBox.include = false;
    }
    applyHandheldsFooterLayout();
    if (parsed.announcementBox) {
      const msgs = Array.isArray(parsed.announcementBox.messages)
        ? parsed.announcementBox.messages
        : [];
      announcementBox = {
        title: parsed.announcementBox.title || "",
        subtitle: parsed.announcementBox.subtitle || "",
        messages: msgs,
        lines: Array.isArray(parsed.announcementBox.lines)
          ? parsed.announcementBox.lines
          : [],
        bg: annSurf.color,
        bgImage: annSurf.image,
        bgChoice: parsed.announcementBox.bgChoice,
        bgFill: parsed.announcementBox.bgFill,
      };
      if (announcementIndex >= msgs.length) announcementIndex = 0;
    }
    if (parsed.drinkBox) {
      drinkBox = {
        title: parsed.drinkBox.title || "",
        subtitle: parsed.drinkBox.subtitle || "",
        bg: drinkSurf.color,
        bgImage: drinkSurf.image,
        bgChoice: parsed.drinkBox.bgChoice,
        bgFill: parsed.drinkBox.bgFill,
        createColumns: !!parsed.drinkBox.createColumns,
        textAlign: parseTextAlign(parsed.drinkBox.textAlign, "center"),
      };
      console.info(
        "Drinks Create Columns?",
        drinkBox.createColumns ? "Yes" : "No",
        "align",
        drinkBox.textAlign
      );
    }

    boardListOptions = {
      showDescriptions:
        parsed.includeDescriptions !== undefined
          ? !!parsed.includeDescriptions
          : true,
      columns:
        parsed.menuColumns === 1 ||
        parsed.menuColumns === 2 ||
        parsed.menuColumns === 3
          ? parsed.menuColumns
          : "auto",
    };
    console.info(
      "Board list options: descriptions",
      boardListOptions.showDescriptions ? "on" : "off",
      "columns",
      boardListOptions.columns
    );

    const rawItems = (parsed.items || []).concat(cfg.extraItems || []);
    items = rawItems
      .map((it) => {
        const image = resolveImagePath(it.image);

        // Prefer multi-price list; fall back to single price
        let prices = Array.isArray(it.prices)
          ? it.prices.map((p) => String(p).trim()).filter(isUsablePriceCell)
          : [];
        if (prices.length === 0 && isUsablePriceCell(it.price)) {
          prices = [String(it.price).trim()];
        }
        // Format plain currency tokens; leave "s $6.95" / "1/$2.00" as-is
        prices = prices.map((p) => formatPriceToken(p));

        // Keep subtitle and description separate — never invent one from the other
        // when the source board doesn't use that field.
        const subtitle = String(it.subtitle || "").trim();
        let description = String(it.description || "").trim();
        if (!boardListOptions.showDescriptions) description = "";

        return {
          name: String(it.name || "").trim(),
          price: prices[0] || "",
          prices,
          description,
          subtitle,
          isNew: !!it.isNew || Number(it.isNew) === 1,
          image,
          include: cfg.forceIncludeAll
            ? true
            : parseInclude(it.include !== undefined ? it.include : 1),
        };
      })
      .filter((it) => it.name && it.include);

    if (isDrinks) buildDrinksSlides();
    applyConfigColors(); // includes applyBoxChrome()
  }

  function buildDrinksSlides() {
    slides = [];
    const overviewOn = config.drinksOverview !== false;
    const individualOn = config.drinksIndividual !== false;

    // Overview only when enabled AND Overview Image column has a filename
    if (overviewOn) {
      const img = resolveImagePath(config.overviewImage);
      if (img) {
        slides.push({
          type: "overview",
          image: img,
          itemIndex: -1,
          isNew: false,
        });
      }
    }

    if (individualOn) {
      items.forEach((it, i) => {
        slides.push({
          type: "item",
          image: it.image,
          itemIndex: i,
          isNew: !!it.isNew,
        });
      });
    }

    // No hardcoded hero fallback — blank overview simply means no overview slide
  }

  /**
   * Paint a box body rect with an image via SVG <pattern> (reliable vs CSS
   * background under opaque shell fills). Clears pattern when solid.
   */
  function applyBoxBodySurface(boxEl, solidColor, imageUrl) {
    if (!boxEl) return;
    const svg =
      boxEl.querySelector(".info-box-shell") ||
      boxEl.querySelector(".drinks-box-shell");
    if (!svg) return;
    const bodyRect =
      svg.querySelector(".shell-body-announcement") ||
      svg.querySelector(".shell-body");
    if (!bodyRect) return;

    const ns = "http://www.w3.org/2000/svg";
    const patternId = boxEl.id + "-img-pattern";

    if (!imageUrl) {
      // Back to CSS-variable solid fill
      bodyRect.removeAttribute("fill");
      bodyRect.style.removeProperty("fill");
      const pat = svg.querySelector("#" + CSS.escape(patternId));
      if (pat && pat.parentNode) pat.parentNode.removeChild(pat);
      boxEl.classList.remove("has-image-bg");
      return;
    }

    boxEl.classList.add("has-image-bg");

    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(ns, "defs");
      svg.insertBefore(defs, svg.firstChild);
    }

    let pattern = document.getElementById(patternId);
    // Pattern must live inside this SVG's defs (not a detached global id)
    if (pattern && !svg.contains(pattern)) {
      pattern = null;
    }
    let imgEl = pattern ? pattern.querySelector("image") : null;
    const vb = (svg.getAttribute("viewBox") || "0 0 300 200").split(/\s+/);
    const vw = parseFloat(vb[2]) || 300;
    const vh = parseFloat(vb[3]) || 200;

    if (!pattern) {
      pattern = document.createElementNS(ns, "pattern");
      pattern.setAttribute("id", patternId);
      pattern.setAttribute("patternUnits", "userSpaceOnUse");
      pattern.setAttribute("x", "0");
      pattern.setAttribute("y", "0");
      pattern.setAttribute("width", String(vw));
      pattern.setAttribute("height", String(vh));
      imgEl = document.createElementNS(ns, "image");
      imgEl.setAttribute("x", "0");
      imgEl.setAttribute("y", "0");
      imgEl.setAttribute("width", String(vw));
      imgEl.setAttribute("height", String(vh));
      imgEl.setAttribute("preserveAspectRatio", "xMidYMid slice");
      pattern.appendChild(imgEl);
      defs.appendChild(pattern);
    } else {
      pattern.setAttribute("width", String(vw));
      pattern.setAttribute("height", String(vh));
      if (imgEl) {
        imgEl.setAttribute("width", String(vw));
        imgEl.setAttribute("height", String(vh));
      }
    }

    if (imgEl) {
      // Prefer absolute URL so SVG image loads reliably
      let abs = imageUrl;
      try {
        abs = new URL(imageUrl, window.location.href).href;
      } catch (e) {
        /* keep relative */
      }
      imgEl.setAttribute("href", abs);
      imgEl.setAttributeNS(
        "http://www.w3.org/1999/xlink",
        "xlink:href",
        abs
      );
    }

    // Presentation attribute (not CSS url()) — fragment refs are reliable here.
    // Clear inline style so attribute is not overridden by fill: var(...).
    bodyRect.style.setProperty("fill", "url(#" + patternId + ")", "important");
  }

  /**
   * Apply box body overrides: solid theme colors or image (e.g. galaxy-bg.jpg).
   * Solid text = Main/Secondary by contrast. Image text = Secondary (dark photos).
   */
  function applyBoxChrome() {
    const main = config.mainColor || "#000000";
    const secondary = config.secondaryColor || "#ffffff";
    const root = document.documentElement;

    function setBox(elId, bgVar, textVar, color, image, text) {
      const bg = normalizeHex(color) || main;
      const textColor =
        text || pickContrastingThemeColor(bg, main, secondary);
      root.style.setProperty(bgVar, bg);
      root.style.setProperty(textVar, textColor);

      const el = elId ? document.getElementById(elId) : null;
      applyBoxBodySurface(el, bg, image || null);
      return { bg: bg, text: textColor, image: image || null };
    }

    setBox(
      "protein-box",
      "--protein-box-bg",
      "--protein-box-text",
      config.proteinBoxBg,
      config.proteinBoxImage,
      config.proteinBoxText
    );
    setBox(
      "sauces-box",
      "--sauces-box-bg",
      "--sauces-box-text",
      config.saucesBoxBg,
      config.saucesBoxImage,
      config.saucesBoxText
    );
    setBox(
      "footer-drinks-box",
      "--footer-drinks-box-bg",
      "--footer-drinks-box-text",
      config.footerDrinksBoxBg,
      config.footerDrinksBoxImage,
      config.footerDrinksBoxText
    );
    setBox(
      "drink-options-box",
      "--drink-box-bg",
      "--drink-box-text",
      config.drinkBoxBg,
      config.drinkBoxImage,
      config.drinkBoxText
    );
    setBox(
      "announcement-box",
      "--announcement-bg",
      "--announcement-body-text",
      config.announcementBg,
      config.announcementBgImage,
      config.announcementBodyText
    );

    if (isDrinks) {
      root.style.setProperty("--stripe-1", config.stripeColor1 || main);
      root.style.setProperty("--stripe-2", config.stripeColor2 || secondary);
      // Include Stripes: 1 = show + animate, 0 = hide completely
      const showStripes = config.includeStripes !== false;
      if (els.stripes) {
        els.stripes.hidden = !showStripes;
        els.stripes.style.display = showStripes ? "" : "none";
        document.body.classList.toggle("stripes-off", !showStripes);
      }
      if (showStripes) {
        updateStripeAnimation();
      } else if (els.stripesTrack) {
        els.stripesTrack.style.animationDuration = "0s";
        els.stripesTrack.style.animationPlayState = "paused";
      }
    }
  }

  function updateStripeAnimation() {
    if (!els.stripesTrack) return;
    if (config.includeStripes === false) {
      els.stripesTrack.style.animationPlayState = "paused";
      return;
    }
    // One full period = black 93px + white 93px (CSS --stripe-period)
    const periodPx = 186;
    const speed =
      BASE_SCROLL_PX_PER_SEC *
      (config.bgScrollSpeed || 1) *
      STRIPE_SPEED_FACTOR;
    const duration = Math.max(0.5, periodPx / Math.max(0.01, speed));
    els.stripesTrack.style.animationDuration = duration + "s";
    els.stripesTrack.style.animationPlayState = "running";
  }

  // ---------- loaders ----------

  /**
   * Prefer local Toki server Sheets API proxy (/api/sheets/*) so the spreadsheet
   * can stay private. Falls back to public Google /export URLs if the proxy is
   * not running (legacy "Anyone with the link" setup).
   */
  let _sheetsApiProxy = null; // null = unknown, true/false after probe

  async function detectSheetsApiProxy() {
    if (_sheetsApiProxy != null) return _sheetsApiProxy;
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) {
        _sheetsApiProxy = false;
        tokiInfo(
          "sheets proxy: no (/api/health " + res.status + ") → public export"
        );
        return false;
      }
      const j = await res.json();
      _sheetsApiProxy = !!(j && j.sheetsApi);
      if (_sheetsApiProxy) {
        tokiInfo("sheets proxy: yes", j.email || "");
      } else {
        tokiInfo("sheets proxy: health ok but sheetsApi false → public export");
      }
      return _sheetsApiProxy;
    } catch (e) {
      _sheetsApiProxy = false;
      tokiInfo("sheets proxy: unreachable → public export", String(e && e.message || e));
      return false;
    }
  }

  function publicSheetCsvUrl(gid) {
    const id = (cfg.googleSheetId || "").trim();
    if (!id) return null;
    // Use /export?format=csv (not gviz). Gviz auto-types columns as number when
    // most Price 1 cells look like currency, then drops string values like
    // "s $8.25" or "1/$2.00". Export returns raw cell text correctly.
    return (
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(id) +
      "/export?format=csv&gid=" +
      encodeURIComponent(String(gid)) +
      "&cachebust=" +
      Date.now()
    );
  }

  function sheetCsvUrl(gid) {
    // Sync helper for logging; actual fetch chooses proxy vs public async.
    return publicSheetCsvUrl(gid);
  }

  /**
   * Fingerprint of sheet CSV payloads — soft refresh skips re-render when equal.
   * Not cryptographic; only change detection.
   */
  function fingerprintSheetPayload(parts) {
    const s = JSON.stringify(parts);
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) ^ s.charCodeAt(i);
    }
    return (h >>> 0).toString(16) + ":" + s.length;
  }

  /** Last successful soft/cold load fingerprint (null until first good load). */
  let _lastDataFingerprint = null;

  async function fetchSheetRows(gid) {
    const useProxy = await detectSheetsApiProxy();
    let url;
    if (useProxy) {
      url =
        "/api/sheets/csv?gid=" +
        encodeURIComponent(String(gid)) +
        "&t=" +
        Date.now();
    } else {
      url = publicSheetCsvUrl(gid);
      if (!url) throw new Error("No googleSheetId in config");
    }
    let res;
    try {
      res = await fetch(url, { cache: "no-store", mode: "cors" });
    } catch (netErr) {
      // Offline / DNS / CORS network failure — do not treat as empty sheet
      throw new Error(
        "Sheet network error (keeping last menu): " +
          (netErr && netErr.message ? netErr.message : String(netErr))
      );
    }
    if (!res.ok) {
      throw new Error(
        "Sheet fetch failed (" +
          res.status +
          ")" +
          (useProxy
            ? " via API proxy — is toki_server.py running and the sheet shared with the service account?"
            : " — sheet may be private; use scripts/toki_server.py or set General access to Anyone with the link")
      );
    }
    const text = await res.text();
    if (/^\s*<!DOCTYPE|^\s*<html/i.test(text)) {
      throw new Error(
        "Sheet returned HTML (share as Anyone with the link, or run toki_server.py for private API access)"
      );
    }
    // Proxy errors return JSON { error: "..." }
    const trimmed = text.trim();
    if (useProxy && trimmed.charAt(0) === "{") {
      try {
        const j = JSON.parse(trimmed);
        if (j && j.error) throw new Error(String(j.error));
      } catch (e) {
        if (e && e.message && trimmed.indexOf('"error"') !== -1) throw e;
      }
    }
    return parseCsv(text);
  }

  /**
   * True if Style row is a theme palette (not Color Picker labels, not BG-only).
   * Themes = Theme Name and/or the four colors (typed or fill). BG is board-wide.
   * Theme Selector is a separate dropdown of names — not a per-row flag.
   */
  function isStyleThemeRow(row, excelRow, fills) {
    const sc = STYLE_COLUMNS;
    const name = String(cell(row, sc.themeName) || "").trim();
    if (name) return true;
    if (
      cell(row, sc.mainColor) ||
      cell(row, sc.secondaryColor) ||
      cell(row, sc.highlight) ||
      cell(row, sc.highlightSpecial)
    ) {
      return true;
    }
    const f = fills || {};
    if (
      f["C" + excelRow] ||
      f["D" + excelRow] ||
      f["E" + excelRow] ||
      f["F" + excelRow]
    ) {
      return true;
    }
    return false;
  }

  function normalizeThemeKey(raw) {
    return String(raw == null ? "" : raw)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  /**
   * Theme Selector column is a dropdown of theme names (not 0/1).
   * Use the first non-empty A cell that matches a Theme Name in column B.
   */
  function findSelectedThemeName(rows, sc, themes) {
    const nameSet = {};
    themes.forEach(function (t) {
      const n = normalizeThemeKey(cell(t.row, sc.themeName));
      if (n) nameSet[n] = true;
    });
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const sel = String(cell(row, sc.themeSelector) || "").trim();
      if (!sel) continue;
      const key = normalizeThemeKey(sel);
      // Skip legacy 0/1 flags if someone still has them
      if (key === "0" || key === "1" || key === "true" || key === "false") {
        continue;
      }
      if (nameSet[key]) return sel.trim();
      // Allow match even if slightly off spacing vs catalog
      for (let k = 0; k < themes.length; k++) {
        const tn = String(cell(themes[k].row, sc.themeName) || "").trim();
        if (normalizeThemeKey(tn) === key) return tn;
      }
    }
    return null;
  }

  /**
   * Parse Style & Theme rows (+ optional cell fills) into a theme object.
   * Shared by Google Sheet and local Menu.xlsx paths.
   */
  function parseStyleThemeFromRows(rows, fills) {
    fills = fills || {};
    if (!rows || rows.length < 2) {
      throw new Error("Style sheet has no data row");
    }

    const sc = STYLE_COLUMNS;
    const themes = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.some((v) => v != null && String(v).trim() !== "")) {
        continue;
      }
      const excelRow = i + 1;
      // Theme catalog = cols A–F only (isStyleThemeRow checks name/colors)
      if (!isStyleThemeRow(row, excelRow, fills)) continue;
      themes.push({ row: row, excelRow: excelRow });
    }
    if (!themes.length) throw new Error("Style sheet has no theme rows");

    const selectedName = findSelectedThemeName(rows, sc, themes);
    let chosen = null;
    if (selectedName) {
      const key = normalizeThemeKey(selectedName);
      chosen = themes.find(function (t) {
        return normalizeThemeKey(cell(t.row, sc.themeName)) === key;
      });
    }
    if (!chosen) {
      chosen = themes[0];
      console.info(
        selectedName
          ? 'Theme Selector "' +
              selectedName +
              '" not found; using first theme:'
          : "No Theme Selector value; using first theme:",
        cell(chosen.row, sc.themeName) || "row " + chosen.excelRow
      );
    }

    const first = chosen.row;
    const er = chosen.excelRow;
    const themeName = String(cell(first, sc.themeName) || "").trim() || null;

    // A–F from selected theme only
    const main = resolveColor(
      cell(first, sc.mainColor),
      fills["C" + er],
      "#000000"
    );
    const secondary = resolveColor(
      cell(first, sc.secondaryColor),
      fills["D" + er],
      "#ffffff"
    );
    const highlight =
      resolveColor(cell(first, sc.highlight), fills["E" + er], "#26bbcb") ||
      "#26bbcb";
    const highlightSpecial =
      resolveColor(
        cell(first, sc.highlightSpecial),
        fills["F" + er],
        "#fff900"
      ) || "#fff900";

    const palette = {
      mainColor: main,
      secondaryColor: secondary,
      highlight: highlight,
      highlightSpecial: highlightSpecial,
    };

    // G2–M2 board-wide (always first data row — independent of Theme Selector)
    const boardRow = rows[STYLE_BOARD_WIDE_ROW_INDEX] || first;
    const boardEr = STYLE_BOARD_WIDE_ROW_INDEX + 1; // excel row 2

    const bgColor = parseBgColor(
      cell(boardRow, sc.bgColor),
      fills["G" + boardEr],
      palette
    );
    const bgImgResolved = resolveStageBgImageFromRows(rows, sc);
    const bgImage = bgImgResolved.path;
    const bgBlur = parseUnit01(cell(boardRow, sc.bgBlur), 0);
    const bgBlendMode = parseBgBlendMode(cell(boardRow, sc.bgBlendMode));
    const bgOpacity = parseUnit01(cell(boardRow, sc.bgOpacity), 1);
    const bgScrollSpeed = Number(cell(boardRow, sc.bgScrollSpeed));
    const slideshowSpeed = Number(cell(boardRow, sc.slideshowSpeed));
    const showVersion =
      sc.showVersion != null
        ? parseYesNo(cell(boardRow, sc.showVersion), false)
        : false;

    const theme = {
      themeName: themeName,
      mainColor: main,
      secondaryColor: secondary,
      highlight: highlight,
      highlightSpecial: highlightSpecial,
      bgColor: bgColor,
      bgImage: bgImage,
      bgBlur: bgBlur,
      bgBlendMode: bgBlendMode,
      bgOpacity: bgOpacity,
      bgMode: bgImage ? "image" : "solid",
      bgSolid: bgColor,
      bgScrollSpeed: Number.isFinite(bgScrollSpeed) ? bgScrollSpeed : 1,
      slideshowSpeed: Number.isFinite(slideshowSpeed) ? slideshowSpeed : 3,
      showVersion: !!showVersion,
    };
    tokiInfo(
      "Style theme:",
      theme.themeName || "(unnamed)",
      "main",
      theme.mainColor,
      "secondary",
      theme.secondaryColor,
      "bgColor",
      theme.bgColor,
      "bgImage raw=",
      JSON.stringify(bgImgResolved.raw),
      "from",
      bgImgResolved.from,
      "→",
      theme.bgImage || "(none — not loading galaxy)",
      "blur",
      theme.bgBlur,
      "opacity",
      theme.bgOpacity,
      "blend",
      theme.bgBlendMode
    );
    return theme;
  }

  function applyThemeToParsed(parsed, theme) {
    if (!parsed || !theme) return parsed;
    parsed.mainColor = theme.mainColor;
    parsed.secondaryColor = theme.secondaryColor;
    parsed.highlight = theme.highlight;
    parsed.highlightSpecial = theme.highlightSpecial;
    parsed.bgColor = theme.bgColor;
    parsed.bgImage = theme.bgImage;
    parsed.bgBlur = theme.bgBlur;
    parsed.bgBlendMode = theme.bgBlendMode;
    parsed.bgOpacity = theme.bgOpacity;
    parsed.bgMode = theme.bgMode;
    parsed.bgSolid = theme.bgSolid;
    parsed.bgScrollSpeed = theme.bgScrollSpeed;
    parsed.slideshowSpeed = theme.slideshowSpeed;
    parsed.showVersion = !!theme.showVersion;
    return parsed;
  }

  /**
   * Style tab from live Google Sheet.
   * @param {object} [opts]
   * @param {Array|null} [opts.styleRows] pre-fetched CSV rows
   */
  async function loadStyleTheme(opts) {
    opts = opts || {};
    const gid = cfg.styleThemeGid;
    if (gid == null || gid === "") return null;

    let fills = {};
    try {
      fills = await loadSheetFillsByName("Style");
    } catch (err) {
      console.warn("Style sheet fills unavailable:", err);
    }

    const rows =
      opts.styleRows != null
        ? opts.styleRows
        : await fetchSheetRows(gid);
    if (!rows) return null;
    return parseStyleThemeFromRows(rows, fills);
  }

  /**
   * Styles for one sheet name from the cached workbook xlsx (single download).
   */
  async function loadSheetStylesByName(sheetNameMatch, opts) {
    opts = opts || {};
    // Wall: no xlsx unless allowInWall (drinks rich text)
    if (isPreviewWall() && !opts.allowInWall) {
      return { fills: {}, fonts: {}, rich: {} };
    }
    const id = (cfg.googleSheetId || "").trim();
    if (!id) return { fills: {}, fonts: {}, rich: {} };
    const cacheKey = String(sheetNameMatch || "").toLowerCase();
    if (
      _workbookXlsxCache.sheetId === id &&
      _workbookXlsxCache.stylesByMatch[cacheKey]
    ) {
      return _workbookXlsxCache.stylesByMatch[cacheKey];
    }
    const buf = await fetchWorkbookXlsxBuffer(false, opts);
    // Re-check after await (another caller may have filled the cache)
    if (
      _workbookXlsxCache.sheetId === id &&
      _workbookXlsxCache.stylesByMatch[cacheKey]
    ) {
      return _workbookXlsxCache.stylesByMatch[cacheKey];
    }
    const meta = await extractSheetStylesFromXlsx(buf, sheetNameMatch);
    if (_workbookXlsxCache.sheetId === id) {
      _workbookXlsxCache.stylesByMatch[cacheKey] = meta;
    }
    return meta;
  }

  async function loadSheetFillsByName(sheetNameMatch, opts) {
    const meta = await loadSheetStylesByName(sheetNameMatch, opts);
    return meta.fills || {};
  }

  /**
   * Board-tab fills/fonts/rich text (announcement copy colors, stripe fills, …).
   * Drinks layout: chrome lives on "Board 4" (renamed from Announcements /
   * Drinks Deals). NOT the dedicated "Drinks" items sheet — matching "Drinks"
   * would pull the wrong tab and drop intentional G-sheet font colors.
   * One xlsx buffer; try name candidates without re-downloading.
   * @param {object} [opts] { allowInWall } for Board 4 rich text in multi-board
   */
  async function loadBoardSheetStyles(opts) {
    opts = opts || {};
    // Drinks: allow xlsx even in wall so announcement rich text works
    if (isDrinks) opts = Object.assign({ allowInWall: true }, opts);
    if (isHandhelds) return loadSheetStylesByName("Handhelds", opts);
    if (!isDrinks) return { fills: {}, fonts: {}, rich: {} };

    const candidates = [
      "Board 4",
      "Announcements",
      "Drinks Deals",
      "Deals",
      "Announcement",
    ];
    let lastErr = null;
    // Ensure buffer is warm once, then extract each candidate from it
    try {
      await fetchWorkbookXlsxBuffer(false, opts);
    } catch (err) {
      throw err;
    }
    for (let i = 0; i < candidates.length; i++) {
      try {
        const meta = await loadSheetStylesByName(candidates[i], opts);
        const fonts = meta.fonts || {};
        const rich = meta.rich || {};
        const fills = meta.fills || {};
        if (
          Object.keys(fonts).length ||
          Object.keys(rich).length ||
          Object.keys(fills).length
        ) {
          tokiInfo("Board styles sheet:", candidates[i]);
          return meta;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    return { fills: {}, fonts: {}, rich: {} };
  }

  /**
   * Shared Protein sheet:
   * Title | Subtitle | Color | Item | Price | Create Columns? | Text Align
   */
  function parseProteinSheetRows(rows, fills) {
    fills = fills || {};
    const box = {
      title: "",
      subtitle: "",
      items: [],
      bgChoice: null,
      bgFill: null,
      createColumns: true,
      textAlign: "right",
    };
    if (!rows || rows.length < 2) return box;
    const first = rows[1];
    box.title = String(cell(first, 0) || "").trim();
    box.subtitle = String(cell(first, 1) || "").trim();
    box.bgChoice = String(cell(first, 2) || "").trim() || null;
    box.bgFill = fills["C2"] || fills["C" + 2] || null;
    // F = Create Columns? · G = Text Align
    box.createColumns = firstColumnYesNo(rows, 5, true);
    box.textAlign = firstColumnTextAlign(rows, 6, "right");
    for (let i = 1; i < rows.length; i++) {
      const name = cell(rows[i], 3);
      if (!name) continue;
      box.items.push({
        name: String(name).trim(),
        price: formatPrice(cell(rows[i], 4)),
      });
    }
    return box;
  }

  /**
   * Shared Sauces sheet:
   * Title | Subtitle | Color | Item | Create Columns? | Text Align
   */
  function parseSaucesSheetRows(rows, fills) {
    fills = fills || {};
    const box = {
      title: "",
      subtitle: "",
      items: [],
      bgChoice: null,
      bgFill: null,
      createColumns: false,
      textAlign: "center",
    };
    if (!rows || rows.length < 2) return box;
    const first = rows[1];
    box.title = String(cell(first, 0) || "").trim();
    box.subtitle = String(cell(first, 1) || "").trim();
    box.bgChoice = String(cell(first, 2) || "").trim() || null;
    box.bgFill = fills["C2"] || null;
    // E = Create Columns? · F = Text Align
    box.createColumns = firstColumnYesNo(rows, 4, false);
    box.textAlign = firstColumnTextAlign(rows, 5, "center");
    for (let i = 1; i < rows.length; i++) {
      const name = cell(rows[i], 3);
      if (!name) continue;
      box.items.push({ name: String(name).trim() });
    }
    return box;
  }

  /**
   * Load shared Protein + Sauces sheets; merge into parsed menu using board include flags.
   * @param {object} [prefetched] optional { proteinRows, saucesRows } from parallel CSV fetch
   */
  async function attachSharedProteinSauces(parsed, boardRows, prefetched) {
    if (!parsed) return parsed;
    prefetched = prefetched || {};
    const includeP =
      parsed.proteinBox && parsed.proteinBox.include !== false;
    const includeS =
      parsed.saucesBox && parsed.saucesBox.include !== false;

    // Re-read include flags from board rows if present
    let flagP = includeP;
    let flagS = includeS;
    if (boardRows && col.includeProteinBox != null) {
      flagP = true;
      let found = false;
      for (let i = 1; i < boardRows.length; i++) {
        const raw = cell(boardRows[i], col.includeProteinBox);
        if (raw === "" || raw == null) continue;
        flagP = parseInclude(raw);
        found = true;
        break;
      }
      if (!found) flagP = true;
    }
    if (boardRows && col.includeSaucesBox != null) {
      flagS = true;
      let found = false;
      for (let i = 1; i < boardRows.length; i++) {
        const raw = cell(boardRows[i], col.includeSaucesBox);
        if (raw === "" || raw == null) continue;
        flagS = parseInclude(raw);
        found = true;
        break;
      }
      if (!found) flagS = true;
    }

    const jobs = [];

    if (cfg.proteinSheetGid != null && cfg.proteinSheetGid !== "") {
      jobs.push(
        (async function () {
          try {
            const fills = await loadSheetFillsByName("Protein").catch(
              function () {
                return {};
              }
            );
            const rows =
              prefetched.proteinRows != null
                ? prefetched.proteinRows
                : await fetchSheetRows(cfg.proteinSheetGid);
            if (!rows) throw new Error("no protein rows");
            const box = parseProteinSheetRows(rows, fills);
            parsed.proteinBox = Object.assign({}, box, { include: flagP });
          } catch (err) {
            console.warn("Could not load Protein sheet:", err);
            if (!parsed.proteinBox) {
              parsed.proteinBox = { items: [], include: flagP };
            } else {
              parsed.proteinBox.include = flagP;
            }
          }
        })()
      );
    } else if (parsed.proteinBox) {
      parsed.proteinBox.include = flagP;
    }

    if (cfg.saucesSheetGid != null && cfg.saucesSheetGid !== "") {
      jobs.push(
        (async function () {
          try {
            const fills = await loadSheetFillsByName("Sauce").catch(
              function () {
                return {};
              }
            );
            const rows =
              prefetched.saucesRows != null
                ? prefetched.saucesRows
                : await fetchSheetRows(cfg.saucesSheetGid);
            if (!rows) throw new Error("no sauces rows");
            const box = parseSaucesSheetRows(rows, fills);
            parsed.saucesBox = Object.assign({}, box, { include: flagS });
          } catch (err) {
            console.warn("Could not load Sauces sheet:", err);
            if (!parsed.saucesBox) {
              parsed.saucesBox = { items: [], include: flagS };
            } else {
              parsed.saucesBox.include = flagS;
            }
          }
        })()
      );
    } else if (parsed.saucesBox) {
      parsed.saucesBox.include = flagS;
    }

    if (jobs.length) await Promise.all(jobs);
    return parsed;
  }

  /**
   * Boards 1–3: load shared Drinks sheet into footer drinks box when
   * Include Drinks Box? is on. Does not touch Board 4 hero/items path.
   */
  async function attachFooterDrinksBox(parsed, boardRows, prefetched) {
    if (!parsed || isDrinks) return parsed;
    prefetched = prefetched || {};

    let flagD = !!(parsed.footerDrinksBox && parsed.footerDrinksBox.include);
    if (boardRows && col.includeDrinksBox != null) {
      flagD = false;
      let found = false;
      for (let i = 1; i < boardRows.length; i++) {
        const raw = cell(boardRows[i], col.includeDrinksBox);
        if (raw === "" || raw == null) continue;
        flagD = parseInclude(raw);
        found = true;
        break;
      }
      if (!found) flagD = false;
    }

    if (!flagD) {
      parsed.footerDrinksBox = Object.assign(
        {},
        parsed.footerDrinksBox || {},
        { items: [], include: false }
      );
      return parsed;
    }

    if (cfg.drinksSheetGid == null || cfg.drinksSheetGid === "") {
      console.warn(
        "Include Drinks Box? is on but drinksSheetGid is not set in config"
      );
      parsed.footerDrinksBox = Object.assign(
        {},
        parsed.footerDrinksBox || {},
        { include: true, items: (parsed.footerDrinksBox && parsed.footerDrinksBox.items) || [] }
      );
      return parsed;
    }

    try {
      let fills = {};
      try {
        await fetchWorkbookXlsxBuffer(false);
        fills = await loadSheetFillsByName("Drink");
      } catch (e) {
        /* optional */
      }
      const rows =
        prefetched.drinksRows != null
          ? prefetched.drinksRows
          : await fetchSheetRows(cfg.drinksSheetGid);
      if (!rows) throw new Error("no drinks rows");
      const content = parseDrinksContentSheetRows(rows, fills);
      const box = content.drinkBox || {};
      const items = (content.items || [])
        .filter(function (it) {
          return it && it.include !== false;
        })
        .map(function (it) {
          return {
            name: it.name,
            subtitle: it.subtitle || "",
          };
        });
      parsed.footerDrinksBox = {
        title: box.title || "",
        subtitle: box.subtitle || "",
        items: items,
        bgChoice: box.bgChoice,
        bgFill: box.bgFill,
        createColumns: !!box.createColumns,
        textAlign: box.textAlign || "center",
        include: true,
      };
      console.info(
        "Footer drinks sheet:",
        cfg.drinksSheetGid,
        "items",
        items.length,
        "title",
        box.title
      );
    } catch (err) {
      console.warn("Could not load footer Drinks sheet:", err);
      if (!parsed.footerDrinksBox) {
        parsed.footerDrinksBox = { items: [], include: true };
      } else {
        parsed.footerDrinksBox.include = true;
      }
    }
    return parsed;
  }

  /**
   * Local xlsx: attach Protein/Sauces sheets by name when present.
   */
  function attachSharedProteinSaucesFromWorkbook(parsed, wb) {
    if (!parsed || !wb) return parsed;
    const names = wb.SheetNames || [];
    const proteinName = names.find(function (n) {
      return /protein/i.test(n);
    });
    const saucesName = names.find(function (n) {
      return /sauce/i.test(n);
    });
    if (proteinName && wb.Sheets[proteinName]) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[proteinName], {
        header: 1,
        defval: null,
        raw: true,
      });
      const box = parseProteinSheetRows(rows, {});
      const flag =
        parsed.proteinBox && parsed.proteinBox.include !== false;
      parsed.proteinBox = Object.assign({}, box, { include: flag });
    }
    if (saucesName && wb.Sheets[saucesName]) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[saucesName], {
        header: 1,
        defval: null,
        raw: true,
      });
      const box = parseSaucesSheetRows(rows, {});
      const flag =
        parsed.saucesBox && parsed.saucesBox.include !== false;
      parsed.saucesBox = Object.assign({}, box, { include: flag });
    }
    return parsed;
  }

  /**
   * Default columns for the dedicated drinks content sheet
   * (Drink Box Title … Include).
   */
  const DRINKS_CONTENT_COLUMNS = {
    drinkBoxTitle: 0,
    drinkBoxSubtitle: 1,
    drinkBoxColor: 2,
    drinksOverview: 3,
    overviewImage: 4,
    drinksIndividual: 5,
    item: 6,
    subtitle: 7,
    isNew: 8,
    image: 9,
    include: 10,
    createColumns: 11,
    textAlign: 12,
  };

  function drinksContentColumnMap() {
    return cfg.drinksSheetColumns || DRINKS_CONTENT_COLUMNS;
  }

  /**
   * Parse dedicated drinks content sheet → items + drink box chrome + overview.
   * fills: optional cell fills keyed by A1 ref (for Drink Box Color).
   */
  function parseDrinksContentSheetRows(rows, fills) {
    fills = fills || {};
    const c = drinksContentColumnMap();
    const empty = {
      items: [],
      drinkBox: {
        title: "",
        subtitle: "",
        bgChoice: null,
        bgFill: null,
        createColumns: false,
        textAlign: "center",
      },
      drinksOverview: true,
      drinksIndividual: true,
      overviewImage: null,
    };
    if (!rows || rows.length < 2) return empty;

    const dataRows = rows.slice(1);
    const first =
      dataRows.find(function (r) {
        return r && r.some(function (v) {
          return v != null && String(v).trim() !== "";
        });
      }) || dataRows[0];

    const items = [];
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row) continue;
      const name = cell(row, c.item);
      if (name === "" || name == null) continue;
      const imageName = cell(row, c.image);
      const subtitle =
        c.subtitle != null ? String(cell(row, c.subtitle) || "").trim() : "";
      items.push({
        name: String(name).trim(),
        price: "",
        prices: [],
        description: "",
        subtitle: subtitle,
        isNew: c.isNew != null && Number(cell(row, c.isNew)) === 1,
        image:
          imageName !== "" &&
          imageName != null &&
          String(imageName).toLowerCase() !== "null"
            ? String(imageName).replace(/^\/+/, "")
            : null,
        include:
          c.include != null
            ? parseInclude(cell(row, c.include))
            : true,
      });
    }

    const drinkChoice =
      c.drinkBoxColor != null
        ? String(cell(first, c.drinkBoxColor) || "").trim() || null
        : null;
    const drinkFill =
      c.drinkBoxColor != null
        ? fills[cellRef(c.drinkBoxColor, 2)] || null
        : null;

    let overviewImg =
      c.overviewImage != null
        ? String(cell(first, c.overviewImage) || "").trim()
        : "";
    if (!overviewImg || overviewImg.toLowerCase() === "null") {
      overviewImg = null;
    }

    const createColIdx = c.createColumns != null ? c.createColumns : 11;
    const alignColIdx = c.textAlign != null ? c.textAlign : 12;

    return {
      items: items,
      drinkBox: {
        title:
          c.drinkBoxTitle != null
            ? String(cell(first, c.drinkBoxTitle) || "").trim()
            : "",
        subtitle:
          c.drinkBoxSubtitle != null
            ? String(cell(first, c.drinkBoxSubtitle) || "").trim()
            : "",
        bgChoice: drinkChoice,
        bgFill: drinkFill,
        createColumns: firstColumnYesNo(rows, createColIdx, false),
        textAlign: firstColumnTextAlign(rows, alignColIdx, "center"),
      },
      drinksOverview:
        c.drinksOverview != null
          ? parseInclude(cell(first, c.drinksOverview))
          : true,
      drinksIndividual:
        c.drinksIndividual != null
          ? parseInclude(cell(first, c.drinksIndividual))
          : true,
      overviewImage: overviewImg,
    };
  }

  function mergeDrinksContentIntoParsed(parsed, content) {
    if (!parsed || !content) return parsed;
    parsed.items = Array.isArray(content.items) ? content.items : [];
    parsed.drinkBox = Object.assign(
      {},
      parsed.drinkBox || {},
      content.drinkBox || {}
    );
    if (content.drinksOverview !== undefined) {
      parsed.drinksOverview = content.drinksOverview;
    }
    if (content.drinksIndividual !== undefined) {
      parsed.drinksIndividual = content.drinksIndividual;
    }
    if (content.overviewImage !== undefined) {
      parsed.overviewImage = content.overviewImage;
    }
    return parsed;
  }

  /**
   * Load dedicated drinks content sheet (Google) and overwrite drink box + items.
   * @param {object} [prefetched] optional { drinksRows } from parallel CSV fetch
   */
  async function attachSharedDrinksSheet(parsed, prefetched) {
    if (!parsed || !isDrinks) return parsed;
    if (cfg.drinksSheetGid == null || cfg.drinksSheetGid === "") return parsed;
    prefetched = prefetched || {};

    try {
      // Prefer tab names that aren't "Drinks Deals" (board tab).
      // Fills come from the single cached workbook xlsx (no re-download).
      let fills = {};
      const nameCandidates = [
        "Drink Options",
        "Drinks Menu",
        "Drinks Content",
        "Drink Box",
      ];
      try {
        await fetchWorkbookXlsxBuffer(false);
      } catch (e) {
        /* fills optional */
      }
      for (let i = 0; i < nameCandidates.length; i++) {
        try {
          fills = await loadSheetFillsByName(nameCandidates[i]);
          if (fills && Object.keys(fills).length) break;
        } catch (e) {
          /* try next name on same buffer */
        }
      }
      const rows =
        prefetched.drinksRows != null
          ? prefetched.drinksRows
          : await fetchSheetRows(cfg.drinksSheetGid);
      if (!rows) throw new Error("no drinks content rows");
      const content = parseDrinksContentSheetRows(rows, fills);
      mergeDrinksContentIntoParsed(parsed, content);
      console.info(
        "Drinks content sheet:",
        cfg.drinksSheetGid,
        "items",
        (content.items || []).length,
        "title",
        content.drinkBox && content.drinkBox.title
      );
    } catch (err) {
      console.warn(
        "Could not load drinks content sheet (gid=" +
          cfg.drinksSheetGid +
          "); using board tab drink columns:",
        err
      );
    }
    return parsed;
  }

  /**
   * Local xlsx: attach drinks content sheet by name when present.
   */
  function attachSharedDrinksFromWorkbook(parsed, wb, fills) {
    if (!parsed || !wb || !isDrinks) return parsed;
    const names = wb.SheetNames || [];
    const contentName =
      names.find(function (n) {
        return /drink\s*option/i.test(n);
      }) ||
      names.find(function (n) {
        return /drink/i.test(n) && !/deal/i.test(n) && !/announce/i.test(n);
      });
    if (!contentName || !wb.Sheets[contentName]) return parsed;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[contentName], {
      header: 1,
      defval: null,
      raw: true,
    });
    const content = parseDrinksContentSheetRows(rows, fills || {});
    mergeDrinksContentIntoParsed(parsed, content);
    console.info(
      "Local drinks content sheet:",
      contentName,
      "items",
      (content.items || []).length
    );
    return parsed;
  }

  /**
   * Live Google Sheet load.
   * @param {object} [opts]
   * @param {boolean} [opts.soft] soft reload: reuse cached xlsx (fills/fonts)
   *   within TTL; always re-fetch CSVs.
   * @param {boolean} [opts.forceXlsxRefresh] bust xlsx cache
   */
  async function loadMenuFromGoogleSheet(opts) {
    opts = opts || {};
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    if (opts.forceXlsxRefresh) invalidateWorkbookXlsxCache();

    // Wall embeds: skip full xlsx/SheetJS inflate (×4 kills low-RAM WebViews)
    const needXlsx =
      !isPreviewWall() &&
      (isDrinks ||
        isHandhelds ||
        !!(cfg.proteinSheetGid || cfg.saucesSheetGid || cfg.styleThemeGid));

    // Overlap one workbook download with all CSV hops
    const xlsxWarm = needXlsx
      ? fetchWorkbookXlsxBuffer(!!opts.forceXlsxRefresh).catch(function (err) {
          console.warn("Workbook xlsx unavailable:", err);
          return null;
        })
      : Promise.resolve(null);

    const csvJobs = {
      main: fetchSheetRows(cfg.googleSheetGid || "0"),
    };
    if (cfg.proteinSheetGid != null && cfg.proteinSheetGid !== "") {
      csvJobs.protein = fetchSheetRows(cfg.proteinSheetGid);
    }
    if (cfg.saucesSheetGid != null && cfg.saucesSheetGid !== "") {
      csvJobs.sauces = fetchSheetRows(cfg.saucesSheetGid);
    }
    if (cfg.drinksSheetGid != null && cfg.drinksSheetGid !== "") {
      // Board 4 content and/or boards 1–3 footer drinks box
      csvJobs.drinks = fetchSheetRows(cfg.drinksSheetGid);
    }
    if (cfg.styleThemeGid != null && cfg.styleThemeGid !== "") {
      csvJobs.style = fetchSheetRows(cfg.styleThemeGid);
    }

    const csvKeys = Object.keys(csvJobs);
    const csvSettled = await Promise.all(
      csvKeys.map(function (k) {
        return csvJobs[k].then(
          function (rows) {
            return { key: k, rows: rows, err: null };
          },
          function (err) {
            return { key: k, rows: null, err: err };
          }
        );
      })
    );
    const csv = {};
    csvSettled.forEach(function (r) {
      if (r.err) {
        tokiWarn("CSV fetch failed (" + r.key + "):", r.err);
      }
      csv[r.key] = r.rows;
    });

    // Soft refresh: any missing tab ⇒ abort (keep last good UI; no partial apply)
    if (opts.soft) {
      const failed = csvSettled.filter(function (r) {
        return r.err;
      });
      if (failed.length) {
        throw (
          failed[0].err ||
          new Error("soft refresh: sheet fetch incomplete (offline?)")
        );
      }
    }

    if (!csv.main) {
      const mainFail = csvSettled.filter(function (r) {
        return r.key === "main" && r.err;
      })[0];
      throw (
        (mainFail && mainFail.err) ||
        new Error("Board sheet CSV failed to load")
      );
    }

    // Change detection for soft refresh (and baseline for next soft)
    const dataFingerprint = fingerprintSheetPayload({
      main: csv.main,
      protein: csv.protein || null,
      sauces: csv.sauces || null,
      drinks: csv.drinks || null,
      style: csv.style || null,
    });
    if (
      opts.soft &&
      _lastDataFingerprint != null &&
      dataFingerprint === _lastDataFingerprint
    ) {
      tokiInfo("refresh: sheet unchanged — skip re-render");
      const unchanged = { __tokiUnchanged: true, _fingerprint: dataFingerprint };
      return unchanged;
    }

    await xlsxWarm;

    // Cell fills + fonts + rich text for announcements.
    // Wall: skip handhelds xlsx; drinks still load Board 4 styles (rich text).
    const loadBoardStyles =
      isDrinks || (!isPreviewWall() && isHandhelds);
    if (loadBoardStyles) {
      try {
        const meta = await loadBoardSheetStyles();
        sheetFills = meta.fills || {};
        sheetFonts = meta.fonts || {};
        sheetRich = meta.rich || {};
        if (isDrinks && Object.keys(sheetRich).length) {
          tokiInfo(
            "announcement rich-text runs loaded",
            Object.keys(sheetRich).length
          );
        }
      } catch (err) {
        tokiWarn("Could not load sheet styles (typed hex still works):", err);
        sheetFills = {};
        sheetFonts = {};
        sheetRich = {};
      }
    } else {
      if (isPreviewWall() && isHandhelds) {
        tokiInfo("sheet styles skipped (preview-wall handhelds)");
      }
      sheetFills = {};
      sheetFonts = {};
      sheetRich = {};
    }

    let parsed = parsedMenuFromRows(csv.main, col);

    if (cfg.proteinSheetGid || cfg.saucesSheetGid) {
      parsed = await attachSharedProteinSauces(parsed, csv.main, {
        proteinRows: csv.protein,
        saucesRows: csv.sauces,
      });
    }

    if (cfg.drinksSheetGid) {
      if (isDrinks) {
        parsed = await attachSharedDrinksSheet(parsed, {
          drinksRows: csv.drinks,
        });
      } else {
        parsed = await attachFooterDrinksBox(parsed, csv.main, {
          drinksRows: csv.drinks,
        });
      }
    }

    if (cfg.styleThemeGid != null && cfg.styleThemeGid !== "") {
      try {
        const theme = await loadStyleTheme({ styleRows: csv.style });
        if (theme) applyThemeToParsed(parsed, theme);
      } catch (err) {
        console.warn("Could not load Style & Theme tab:", err);
      }
    } else if (cfg.inheritConfigGid != null && cfg.inheritConfigGid !== "") {
      try {
        const rows = await fetchSheetRows(cfg.inheritConfigGid);
        const inherited = parsedMenuFromRows(rows, BOWLS_COLUMNS);
        if (inherited) {
          parsed.bgScrollSpeed = inherited.bgScrollSpeed;
          parsed.slideshowSpeed = inherited.slideshowSpeed;
          parsed.highlight = inherited.highlight;
          parsed.highlightSpecial = inherited.highlightSpecial;
        }
      } catch (err) {
        console.warn("Could not inherit config:", err);
      }
    }

    const ms =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      t0;
    tokiInfo(
      "Google load finished in",
      Math.round(ms) + "ms",
      opts.soft ? "(soft)" : "(cold)",
      "csv=" + csvKeys.join("+"),
      "fp=" + dataFingerprint
    );
    parsed._fingerprint = dataFingerprint;
    return parsed;
  }

  function pickWorkbookSheetName(wb) {
    const names = wb.SheetNames || [];
    // Prefer generic Board N titles, then legacy product tab names.
    const prefer = {
      bowls: [/board\s*1/i, /bowls/i],
      handhelds: [/board\s*2/i, /handheld/i],
      munchies: [/board\s*3/i, /munchies/i],
      drinks: [/drinks/i, /announce/i],
    };
    const patterns = prefer[cfg.layout] || [];
    for (let p = 0; p < patterns.length; p++) {
      const hit = names.find(function (n) {
        return patterns[p].test(n);
      });
      if (hit) return hit;
    }
    // Never use Style/Theme as menu data (it's usually first after the reorder)
    const notStyle = names.find(function (n) {
      return !/style|theme/i.test(n);
    });
    return notStyle || names[0];
  }

  function pickStyleSheetName(wb) {
    const names = wb.SheetNames || [];
    return (
      names.find(function (n) {
        return /style|theme/i.test(n);
      }) || null
    );
  }

  async function fetchLocalXlsxBuffer() {
    const path = localXlsxPath();
    const res = await fetch(path + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) {
      throw new Error("Failed to load " + path + " (" + res.status + ")");
    }
    return res.arrayBuffer();
  }

  /**
   * Full local workbook drive: board rows + Style theme + cell fills/fonts.
   * Closest parity with Google Sheets for offline / stress testing.
   */
  async function loadMenuFromXlsx() {
    if (typeof XLSX === "undefined") {
      throw new Error("SheetJS (XLSX) not loaded");
    }
    const buf = await fetchLocalXlsxBuffer();

    // Cell fills / fonts / rich text for this board (drinks + handhelds)
    if (isDrinks || isHandhelds) {
      try {
        let meta = { fills: {}, fonts: {}, rich: {} };
        if (isHandhelds) {
          meta = await extractSheetStylesFromXlsx(buf, "Handhelds");
        } else {
          // Prefer Board 4 / Announcements over "Drinks" (items sheet)
          const localMatches = [
            "Board 4",
            "Announcements",
            "Drinks Deals",
            "Deals",
            "Announcement",
          ];
          for (let i = 0; i < localMatches.length; i++) {
            try {
              const m = await extractSheetStylesFromXlsx(buf, localMatches[i]);
              if (
                Object.keys(m.fonts || {}).length ||
                Object.keys(m.rich || {}).length ||
                Object.keys(m.fills || {}).length
              ) {
                meta = m;
                break;
              }
            } catch (e) {
              /* try next */
            }
          }
        }
        sheetFills = meta.fills || {};
        sheetFonts = meta.fonts || {};
        sheetRich = meta.rich || {};
      } catch (err) {
        console.warn("Local xlsx board styles unavailable:", err);
        sheetFills = {};
        sheetFonts = {};
        sheetRich = {};
      }
    } else {
      sheetFills = {};
      sheetFonts = {};
      sheetRich = {};
    }

    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = pickWorkbookSheetName(wb);
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      throw new Error(
        localXlsxPath() + " missing sheet for layout " + cfg.layout
      );
    }
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    const parsed = parsedMenuFromRows(rows, col);

    // Style & Theme from the same workbook
    try {
      const styleName = pickStyleSheetName(wb);
      if (styleName) {
        let styleFills = {};
        try {
          const styleMeta = await extractSheetStylesFromXlsx(buf, "Style");
          styleFills = styleMeta.fills || {};
        } catch (e) {
          /* fills optional */
        }
        const styleSheet = wb.Sheets[styleName];
        const styleRows = XLSX.utils.sheet_to_json(styleSheet, {
          header: 1,
          defval: null,
          raw: true,
        });
        const theme = parseStyleThemeFromRows(styleRows, styleFills);
        applyThemeToParsed(parsed, theme);
      }
    } catch (err) {
      console.warn("Could not load Style tab from local xlsx:", err);
    }

    // Shared Protein / Sauces sheets in the same workbook (if present)
    try {
      attachSharedProteinSaucesFromWorkbook(parsed, wb);
    } catch (err) {
      console.warn("Local protein/sauces sheets unavailable:", err);
    }

    // Dedicated drinks content sheet when present
    try {
      let drinkFills = {};
      try {
        const drinkMeta = await extractSheetStylesFromXlsx(buf, "Drink");
        drinkFills = drinkMeta.fills || {};
      } catch (e) {
        /* optional */
      }
      if (isDrinks) {
        attachSharedDrinksFromWorkbook(parsed, wb, drinkFills);
      } else if (parsed.footerDrinksBox && parsed.footerDrinksBox.include) {
        attachFooterDrinksFromWorkbook(parsed, wb, drinkFills);
      }
    } catch (err) {
      console.warn("Local drinks content sheet unavailable:", err);
    }

    return parsed;
  }

  /** Local xlsx → footer drinks box (boards 1–3). */
  function attachFooterDrinksFromWorkbook(parsed, wb, fills) {
    if (!parsed || !wb || isDrinks) return parsed;
    const names = wb.SheetNames || [];
    const contentName =
      names.find(function (n) {
        return /^drinks?$/i.test(String(n).trim());
      }) ||
      names.find(function (n) {
        return /drink/i.test(n) && !/deal/i.test(n) && !/board/i.test(n);
      });
    if (!contentName || !wb.Sheets[contentName]) return parsed;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[contentName], {
      header: 1,
      defval: null,
      raw: true,
    });
    const content = parseDrinksContentSheetRows(rows, fills || {});
    const box = content.drinkBox || {};
    const items = (content.items || [])
      .filter(function (it) {
        return it && it.include !== false;
      })
      .map(function (it) {
        return { name: it.name, subtitle: it.subtitle || "" };
      });
    const flag = !!(parsed.footerDrinksBox && parsed.footerDrinksBox.include);
    parsed.footerDrinksBox = {
      title: box.title || "",
      subtitle: box.subtitle || "",
      items: items,
      bgChoice: box.bgChoice,
      bgFill: box.bgFill,
      createColumns: !!box.createColumns,
      textAlign: box.textAlign || "center",
      include: flag,
    };
    return parsed;
  }

  function loadMenuFromEmbedded() {
    if (!window.TOKI_MENU || !window.TOKI_MENU.items) {
      throw new Error("No embedded menu data (js/menu-data.js)");
    }
    return window.TOKI_MENU;
  }

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.soft] soft reload — never fall back to embedded/xlsx
   *   (offline must keep last good menu on screen)
   * @returns {Promise<string>} dataSource id, or "unchanged" when soft + no sheet delta
   */
  async function loadMenu(opts) {
    opts = opts || {};
    const errors = [];
    const mode = resolvedDataSource();
    const soft = !!opts.soft;

    // —— Soft refresh: only live sources; throw on failure (caller keeps UI) ——
    if (soft) {
      if (mode === "local") {
        const parsed = await loadMenuFromXlsx();
        const fp = fingerprintSheetPayload(parsed);
        if (_lastDataFingerprint != null && fp === _lastDataFingerprint) {
          tokiInfo("refresh: local xlsx unchanged");
          return "unchanged";
        }
        applyParsedMenu(parsed);
        _lastDataFingerprint = fp;
        dataSource = "xlsx-local";
        return dataSource;
      }
      if (!(cfg.googleSheetId || "").trim()) {
        throw new Error("soft refresh: no Google sheet configured");
      }
      const parsed = await loadMenuFromGoogleSheet({
        soft: true,
        forceXlsxRefresh: !!opts.forceXlsxRefresh,
      });
      if (parsed && parsed.__tokiUnchanged) {
        return "unchanged";
      }
      const fp = parsed._fingerprint || null;
      if (parsed._fingerprint) delete parsed._fingerprint;
      applyParsedMenu(parsed);
      if (fp) _lastDataFingerprint = fp;
      dataSource = "google-sheet";
      tokiInfo("refresh: applied sheet changes", "fp=" + (fp || "?"));
      return dataSource;
    }

    // —— Cold load: Local Menu.xlsx first when switch is "local" ——
    if (mode === "local") {
      try {
        const parsed = await loadMenuFromXlsx();
        applyParsedMenu(parsed);
        _lastDataFingerprint = fingerprintSheetPayload(parsed);
        dataSource = "xlsx-local";
        tokiInfo("TokiMenu data source: LOCAL (" + localXlsxPath() + ")");
        return dataSource;
      } catch (err) {
        errors.push("local xlsx: " + (err.message || err));
        tokiWarn(errors[errors.length - 1]);
        // fall through to google / fallbacks so first paint isn't stuck blank
      }
    }

    // —— Live Google Sheet ——
    if ((cfg.googleSheetId || "").trim()) {
      try {
        const parsed = await loadMenuFromGoogleSheet({
          soft: false,
          forceXlsxRefresh: !!opts.forceXlsxRefresh,
        });
        if (parsed._fingerprint) {
          _lastDataFingerprint = parsed._fingerprint;
          delete parsed._fingerprint;
        }
        applyParsedMenu(parsed);
        dataSource = "google-sheet";
        tokiInfo("TokiMenu data source: GOOGLE SHEET");
        return dataSource;
      } catch (err) {
        errors.push("Google Sheet: " + (err.message || err));
        tokiWarn(errors[errors.length - 1]);
      }
    }

    // —— Fallbacks (cold load only) ——
    const fallbacks = cfg.fallbacks || ["xlsx", "embedded"];
    for (const fb of fallbacks) {
      try {
        if (fb === "xlsx") {
          applyParsedMenu(await loadMenuFromXlsx());
          dataSource = "xlsx";
          return dataSource;
        }
        if (fb === "embedded") {
          applyParsedMenu(loadMenuFromEmbedded());
          dataSource = "embedded";
          return dataSource;
        }
      } catch (err) {
        errors.push(fb + ": " + (err.message || err));
        tokiWarn(errors[errors.length - 1]);
      }
    }

    throw new Error("Could not load menu. " + errors.join(" | "));
  }

  // ---------- render ----------

  function renderTitle() {
    let t = config.title || "";
    // Drinks mockup: single-line title, vertically centered in header
    if (isDrinks) {
      t = t.replace(/\s+/g, " ").trim();
    } else if (t.includes(" & ")) {
      // Bowls / munchies: "X & Y" → two lines
      t = t.replace(" & ", " &\n");
    } else if (isHandhelds && /\s/.test(t)) {
      // "Fusion Handhelds" → two lines like the mockup
      t = t.replace(/\s+/, "\n");
    }
    els.title.textContent = t;
    fitTitle();
  }

  function renderList() {
    if (isDrinks) {
      renderDrinksBoxes();
      return;
    }
    if (!els.list) return;
    els.list.innerHTML = "";
    items.forEach((item, i) => {
      const el = document.createElement("div");
      el.className = "menu-item";
      el.dataset.index = String(i);
      el.setAttribute("role", "listitem");

      if (isMunchies) {
        el.appendChild(buildMunchiesLine(item));
      } else {
        const line = document.createElement("div");
        line.className = "item-line";
        line.textContent = formatItemPriceLine(item);
        el.appendChild(line);
      }

      // Description column — show when filled (all board layouts share the schema)
      if (item.description) {
        const desc = document.createElement("div");
        desc.className = "item-desc";
        desc.textContent = item.description;
        el.appendChild(desc);
      }
      els.list.appendChild(el);
    });

    fitMenuText();
  }

  /**
   * Split rich-text runs across \n into line groups (character offsets).
   * @returns {Array<Array<run>>}
   */
  function splitRunsByNewline(runs) {
    const lines = [[]];
    (runs || []).forEach(function (run) {
      const parts = String(run.text || "").split("\n");
      parts.forEach(function (part, pi) {
        if (pi > 0) lines.push([]);
        if (part.length || (pi === 0 && parts.length === 1)) {
          lines[lines.length - 1].push({
            text: part,
            bold: !!run.bold,
            italic: !!run.italic,
            color: run.color,
          });
        }
      });
    });
    return lines.length ? lines : [[]];
  }

  /**
   * Paint announcement body from one message.
   * Rich runs: per-span bold/color only (no whole-cell style bleed).
   * No runs: whole-cell font from sheet (legacy).
   */
  function paintAnnouncementBody(msg, annBodyText) {
    if (!els.announcementBody) return;
    els.announcementBody.innerHTML = "";
    els.announcementBody.style.setProperty("--box-scale", "1");
    els.announcementBody.style.color = annBodyText;

    const hasRuns = msg && msg.runs && msg.runs.length > 0;

    if (hasRuns) {
      // Per-run formatting only — default contrast for unstyled runs
      const lineGroups = splitRunsByNewline(msg.runs);
      lineGroups.forEach(function (group) {
        const p = document.createElement("p");
        p.className = "announcement-line";
        p.style.fontWeight = "400";
        p.style.fontStyle = "normal";
        p.style.color = annBodyText;
        if (!group.length) {
          p.innerHTML = "&nbsp;";
          els.announcementBody.appendChild(p);
          return;
        }
        group.forEach(function (run) {
          const span = document.createElement("span");
          span.className = "announcement-run";
          span.textContent = run.text || "";
          span.style.fontWeight = run.bold ? "700" : "400";
          span.style.fontStyle = run.italic ? "italic" : "normal";
          span.classList.toggle("is-bold", !!run.bold);
          span.classList.toggle("is-italic", !!run.italic);
          // Intentional run color only; never inherit cell-level orange onto normals
          const runCol = announcementFontColor(run.color);
          span.style.color = runCol || annBodyText;
          p.appendChild(span);
        });
        els.announcementBody.appendChild(p);
      });
      return;
    }

    // No rich runs: whole-cell style from sheetFonts (or plain contrast)
    const lineBold = !!(msg && msg.bold);
    const lineItalic = !!(msg && msg.italic);
    const lineColor =
      announcementFontColor(msg && msg.color) || annBodyText;
    const chunks = String((msg && msg.text) || "").split(/\n/);
    chunks.forEach(function (t) {
      const p = document.createElement("p");
      p.className = "announcement-line";
      p.classList.toggle("is-bold", lineBold);
      p.classList.toggle("is-italic", lineItalic);
      p.style.color = lineColor;
      p.style.fontWeight = lineBold ? "700" : "400";
      p.style.fontStyle = lineItalic ? "italic" : "normal";
      p.textContent = t;
      els.announcementBody.appendChild(p);
    });
  }

  /**
   * Show announcement message at index.
   * @param {number} index
   * @param {object} [opts]
   * @param {boolean} [opts.instant] skip fades (first paint / soft rebuild)
   * @param {object|null} [opts.prev] previous message for selective title/subtitle fade
   */
  function setAnnouncementMessage(index, opts) {
    opts = opts || {};
    const msgs = announcementBox.messages || [];
    const annShell = document.getElementById("announcement-box");
    if (!msgs.length) {
      announcementIndex = 0;
      if (els.announcementTitle) els.announcementTitle.textContent = "";
      if (els.announcementSubtitle) els.announcementSubtitle.textContent = "";
      if (els.announcementBody) els.announcementBody.innerHTML = "";
      setAnnouncementShoutClass(false);
      if (els.announcementBody) {
        setBoxTextAlign(els.announcementBody, "center");
      }
      return;
    }
    const i = ((index % msgs.length) + msgs.length) % msgs.length;
    const msg = msgs[i];
    const prev = opts.prev || null;
    const instant = !!opts.instant;
    const annBodyText =
      config.announcementBodyText ||
      pickContrastingThemeColor(
        announcementBox.bg ||
          config.announcementBg ||
          config.mainColor ||
          "#000000",
        config.mainColor,
        config.secondaryColor
      );

    const titleChanged = !prev || prev.title !== msg.title;
    const subChanged = !prev || prev.subtitle !== msg.subtitle;
    const FADE_MS = 350;

    function applyTitleSub() {
      if (els.announcementTitle && (instant || titleChanged || !prev)) {
        els.announcementTitle.textContent = msg.title || "";
      }
      if (els.announcementSubtitle && (instant || subChanged || !prev)) {
        els.announcementSubtitle.textContent = msg.subtitle || "";
      }
      announcementBox.title = msg.title || "";
      announcementBox.subtitle = msg.subtitle || "";
    }

    function applyAlignAndShout() {
      // Message body only — titles/header stay default (left cluster)
      const align = parseTextAlign(msg.textAlign, "center");
      const shoutOn = !!msg.shout;
      const shakeI =
        msg.shakeIntensity != null && Number.isFinite(Number(msg.shakeIntensity))
          ? Number(msg.shakeIntensity)
          : 0.75;
      setBoxTextAlign(els.announcementBody, align);
      const header = annShell
        ? annShell.querySelector(".drinks-box-header")
        : null;
      if (header) {
        header.classList.remove("align-left", "align-center", "align-right");
        header.removeAttribute("data-align");
      }
      setAnnouncementShoutClass(shoutOn, shakeI);
      if (shoutOn) {
        tokiInfo(
          "announcement shout",
          (msg.text || "").slice(0, 40),
          "shake",
          shakeI
        );
      }
    }

    function applyBody() {
      applyAlignAndShout();
      paintAnnouncementBody(msg, annBodyText);
      announcementBox.lines = String(msg.text || "")
        .split(/\n/)
        .map(function (t) {
          return {
            text: t,
            color: msg.color,
            bold: msg.bold,
            italic: msg.italic,
            runs: null,
          };
        });
      if (typeof fitDrinksBoxes === "function") {
        try {
          fitDrinksBoxes();
        } catch (e) {
          /* fit may run before drink box ready */
        }
      }
    }

    function fadeEl(el, doFade, onHidden) {
      if (!el) {
        if (onHidden) onHidden();
        return;
      }
      if (instant || !doFade) {
        el.classList.remove("ann-fading");
        if (onHidden) onHidden();
        el.classList.remove("ann-fading");
        return;
      }
      el.classList.add("ann-fading");
      window.setTimeout(function () {
        if (onHidden) onHidden();
        // next frame: fade back in
        requestAnimationFrame(function () {
          el.classList.remove("ann-fading");
        });
      }, FADE_MS);
    }

    // Title / subtitle: only fade when resolved string changes
    fadeEl(els.announcementTitle, titleChanged && !instant, function () {
      if (els.announcementTitle && (instant || titleChanged || !prev)) {
        els.announcementTitle.textContent = msg.title || "";
      }
    });
    fadeEl(els.announcementSubtitle, subChanged && !instant, function () {
      if (els.announcementSubtitle && (instant || subChanged || !prev)) {
        els.announcementSubtitle.textContent = msg.subtitle || "";
      }
    });
    // Body always transitions (except instant first paint)
    fadeEl(els.announcementBody, !instant, function () {
      applyBody();
    });

    if (instant) {
      applyTitleSub();
      applyBody();
      if (els.announcementTitle) els.announcementTitle.classList.remove("ann-fading");
      if (els.announcementSubtitle)
        els.announcementSubtitle.classList.remove("ann-fading");
      if (els.announcementBody) els.announcementBody.classList.remove("ann-fading");
    }

    announcementIndex = i;
    announcementBox.title = msg.title || "";
    announcementBox.subtitle = msg.subtitle || "";
  }

  function stopAnnouncementSlideshow() {
    if (announcementTimer) {
      clearTimeout(announcementTimer);
      announcementTimer = null;
    }
  }

  function scheduleNextAnnouncement() {
    stopAnnouncementSlideshow();
    const msgs = announcementBox.messages || [];
    if (msgs.length <= 1) return;
    if (
      new URLSearchParams(window.location.search || "").get("pause") === "1"
    ) {
      return;
    }
    const cur = msgs[announcementIndex] || msgs[0];
    const sec = Math.max(0.5, Number(cur.speedSec) || 4);
    announcementTimer = window.setTimeout(function () {
      const prev = msgs[announcementIndex];
      setAnnouncementMessage(announcementIndex + 1, { prev: prev });
      scheduleNextAnnouncement();
    }, sec * 1000);
  }

  function startAnnouncementSlideshow() {
    stopAnnouncementSlideshow();
    const msgs = announcementBox.messages || [];
    if (!msgs.length) return;
    setAnnouncementMessage(announcementIndex, { instant: true });
    scheduleNextAnnouncement();
    tokiInfo(
      "announcement board",
      msgs.length,
      "messages; first speed",
      (msgs[0] && msgs[0].speedSec) || "?"
    );
  }

  function renderDrinksBoxes() {
    const annBg =
      announcementBox.bg ||
      config.announcementBg ||
      config.mainColor ||
      "#000000";

    if (els.announcementBodyRect) {
      els.announcementBodyRect.style.fill = annBg;
    }

    // Message board: show current (or first) announcement slide
    if ((announcementBox.messages || []).length) {
      setAnnouncementMessage(announcementIndex, { instant: true });
    } else {
      if (els.announcementTitle) els.announcementTitle.textContent = "";
      if (els.announcementSubtitle) els.announcementSubtitle.textContent = "";
      if (els.announcementBody) els.announcementBody.innerHTML = "";
    }

    if (els.drinkBoxTitle) {
      els.drinkBoxTitle.textContent = drinkBox.title || "";
    }
    if (els.drinkBoxSubtitle) {
      els.drinkBoxSubtitle.textContent = drinkBox.subtitle || "";
    }
    if (els.drinkBoxBody) {
      els.drinkBoxBody.innerHTML = "";
      els.drinkBoxBody.style.setProperty("--box-scale", "1");
      const useCols = !!drinkBox.createColumns;
      setBoxLayoutMode(els.drinkBoxBody, useCols);
      setBoxTextAlign(els.drinkBoxBody, drinkBox.textAlign);

      function appendDrinkItemEl(it, index) {
        const span = document.createElement("span");
        span.className = useCols
          ? "drink-item drink-col-item box-col-item"
          : "drink-item wrap-item";
        span.dataset.index = String(index);

        const nameEl = document.createElement("span");
        nameEl.className = "drink-item-name";
        nameEl.textContent = it.name;
        span.appendChild(nameEl);

        if (it.subtitle) {
          const sub = String(it.subtitle).trim();
          const subEl = document.createElement("span");
          subEl.className = "drink-item-sub";
          subEl.textContent =
            sub.charAt(0) === "(" ? " " + sub : " (" + sub + ")";
          span.appendChild(subEl);
        }
        return span;
      }

      if (useCols) {
        items.forEach(function (it, i) {
          els.drinkBoxBody.appendChild(appendDrinkItemEl(it, i));
        });
      } else {
        // Balanced wrap: preserve slideshow index; measure name + subtitle
        const drinkEntries = items.map(function (it, i) {
          return {
            label: drinkItemMeasureLabel(it),
            item: it,
            index: i,
          };
        });
        const lines = balanceItemsIntoLines(
          drinkEntries,
          balanceOptsFromBox(els.drinkBoxBody, {
            sepText: " • ",
            maxLines: 8,
            measureLabel: function (entry, font) {
              return measureDrinkEntryWidth(entry.item, font);
            },
          })
        );
        lines.forEach(function (line, li) {
          line.forEach(function (entry, i) {
            els.drinkBoxBody.appendChild(
              appendDrinkItemEl(entry.item, entry.index)
            );
            if (i < line.length - 1) {
              const sep = document.createElement("span");
              sep.className = "drink-sep wrap-sep";
              sep.textContent = " • ";
              sep.setAttribute("aria-hidden", "true");
              els.drinkBoxBody.appendChild(sep);
            }
          });
          if (li < lines.length - 1) {
            const br = document.createElement("span");
            br.className = "drink-line-break wrap-line-break";
            br.setAttribute("aria-hidden", "true");
            els.drinkBoxBody.appendChild(br);
          }
        });
      }
    }

    fitDrinksBoxes();
  }

  /**
   * Shout chrome on the announcement body (Black + max fit + line quake).
   * Shell never animates.
   * @param {boolean} on
   * @param {number} [intensity] sheet K; 0.75 = previous default amplitude
   */
  function setAnnouncementShoutClass(on, intensity) {
    const shell = document.getElementById("announcement-box");
    const body = els.announcementBody;
    if (shell) {
      shell.classList.remove("is-shout");
      shell.removeAttribute("data-shout");
      shell.style.removeProperty("animation");
    }
    if (!body) return;
    // Keyframes are authored at intensity 0.75. Scale amp so:
    //   0.75 → 1.0× (current look), 1.0 → ~1.33×, 0.5 → ~0.67×, 0 → off
    const i =
      intensity != null && Number.isFinite(Number(intensity))
        ? Math.max(0, Number(intensity))
        : 0.75;
    const amp = i <= 0 ? 0 : i / 0.75;
    body.style.setProperty("--shout-shake-amp", String(amp));
    body.classList.toggle("is-shout", !!on && amp > 0);
    body.classList.toggle("is-shout-type", !!on);
    if (on) {
      body.setAttribute("data-shout", "1");
      body.setAttribute("data-shake", String(i));
    } else {
      body.removeAttribute("data-shout");
      body.removeAttribute("data-shake");
      body.style.removeProperty("--shout-shake-amp");
    }
  }

  /**
   * Shout fit: maximize type to fill body height (padding kept).
   * Measures line boxes + gap directly — flex + justify-content:center makes
   * scrollHeight unreliable (especially if overflow was ever visible).
   */
  function fitAnnouncementShout(el) {
    if (!el || !el.children || !el.children.length) return;
    // Type metrics only while measuring (shake class restored by setAnnouncementShoutClass)
    el.classList.add("is-shout-type");
    // Honest clip while measuring (CSS also keeps overflow:hidden on shout)
    el.style.overflow = "hidden";

    const minS = 0.3;
    const maxS = 20;

    const contentMetrics = function () {
      const cs = window.getComputedStyle(el);
      const padX =
        (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const padY =
        (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const gap = parseFloat(cs.rowGap || cs.gap) || 0;
      const contentW = Math.max(1, el.clientWidth - padX);
      const availH = Math.max(1, el.clientHeight - padY);
      const lines = el.querySelectorAll(".announcement-line");
      let contentH = 0;
      let overflowW = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // offsetHeight at current wrap width (allow soft-wrap multi-line)
        contentH += line.offsetHeight || 0;
        // Unbreakable overflow only (long word); soft wrap is fine
        const lineBoxW = Math.max(line.clientWidth || 0, contentW);
        if (line.scrollWidth > lineBoxW + 2) overflowW = true;
      }
      if (lines.length > 1) contentH += gap * (lines.length - 1);
      return {
        contentH: contentH || 1,
        availH: availH,
        overflowW: overflowW,
        lineCount: lines.length,
      };
    };

    const fits = function (scale) {
      el.style.setProperty("--box-scale", String(scale));
      void el.offsetHeight;
      const m = contentMetrics();
      // Height first: packed lines must sit inside padding box
      if (m.contentH > m.availH + 1) return false;
      // Width: only fail on unbreakable overflow (soft wrap is allowed)
      if (m.overflowW) return false;
      return true;
    };

    let lo = minS;
    let hi = maxS;
    let best = minS;

    if (!fits(lo)) {
      // Even min overflows — walk down a bit
      let s = lo;
      while (s > 0.15 && !fits(s)) s -= 0.02;
      best = Math.max(0.15, s);
      el.style.setProperty("--box-scale", String(best));
    } else {
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) {
          best = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      // Tiny cushion so multi-line glyphs don't kiss the clip edge
      best = Math.max(minS, best * 0.99);
      let guard = 0;
      while (!fits(best) && best > minS && guard < 40) {
        best -= 0.02;
        guard++;
      }
      fits(best);
    }

    el.style.removeProperty("overflow");
    tokiInfo(
      "shout fit scale",
      el.style.getPropertyValue("--box-scale"),
      "lines",
      el.querySelectorAll(".announcement-line").length
    );
  }

  function fitDrinksBoxes() {
    // Announcement: tasteful cap ~1.55, unless Shout → extreme vertical fill
    const annLines = els.announcementBody
      ? els.announcementBody.querySelectorAll(".announcement-line").length
      : 0;
    const msgs = announcementBox.messages || [];
    const curMsg = msgs[announcementIndex] || msgs[0] || null;
    const isShout = !!(curMsg && curMsg.shout);
    if (els.announcementBody) {
      els.announcementBody.classList.toggle("many-lines", annLines >= 4);
      els.announcementBody.dataset.lineCount = String(annLines);
    }
    const shakeI =
      curMsg && curMsg.shakeIntensity != null
        ? Number(curMsg.shakeIntensity)
        : 0.75;
    setAnnouncementShoutClass(isShout, shakeI);

    if (isShout) {
      fitAnnouncementShout(els.announcementBody);
    } else {
      const annMin =
        annLines >= 6 ? 0.2 : annLines >= 4 ? 0.26 : annLines >= 3 ? 0.34 : 0.45;
      fitBoxScale(els.announcementBody, annMin, 1.55, {
        checkChildWidth: false,
      });
    }
    if (!els.drinkBoxBody) return;

    if (drinkBox.createColumns) {
      fitColumnBox(els.drinkBoxBody, {
        rowSelector: ".box-col-item, .drink-item",
        label: "Drinks",
      });
    } else {
      fitWrapBox(els.drinkBoxBody, {
        sepSelector: ".drink-sep, .wrap-sep",
        forceBreakSelector: ".drink-force-break",
        lineBreakClass: "drink-line-break",
        forceBreakClass: "drink-force-break",
        itemClass: "drink-item",
      });
    }
  }

  function hideDrinkSepsAtLineBreaks() {
    hideWrapSepsAtLineBreaks(els.drinkBoxBody, {
      sepSelector: ".drink-sep, .wrap-sep",
      forceBreakClass: "drink-force-break",
      lineBreakClass: "drink-line-break",
      itemClass: "drink-item",
    });
  }

  /**
   * Keep info-box SVG "borders" a constant screen pixel width.
   * Outer shell + inset body (4px sides/bottom, 64px header) must be defined in
   * the same unit as the displayed box size — if we only stretch a small
   * viewBox (e.g. sauces 299→1082), a 4px inset becomes ~14px visually.
   */
  function syncInfoBoxShell(boxEl) {
    if (!boxEl || boxEl.hidden) return;
    const svg =
      boxEl.querySelector(".info-box-shell") ||
      boxEl.querySelector("svg");
    if (!svg) return;
    const w = Math.round(boxEl.clientWidth || boxEl.offsetWidth || 0);
    const h = Math.round(boxEl.clientHeight || boxEl.offsetHeight || 0);
    if (w < 8 || h < 8) return;

    const border = 4;
    const header = 64;
    const bodyW = Math.max(1, w - border * 2);
    const bodyH = Math.max(1, h - header - border);

    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));

    const outer = svg.querySelector(".shell-outer");
    if (outer) {
      outer.setAttribute("width", String(w));
      outer.setAttribute("height", String(h));
      outer.setAttribute("x", "0");
      outer.setAttribute("y", "0");
    }
    const body = svg.querySelector(".shell-body");
    if (body) {
      body.setAttribute("x", String(border));
      body.setAttribute("y", String(header));
      body.setAttribute("width", String(bodyW));
      body.setAttribute("height", String(bodyH));
    }
  }

  function syncFooterBoxShells() {
    syncInfoBoxShell(document.getElementById("protein-box"));
    syncInfoBoxShell(document.getElementById("sauces-box"));
    syncInfoBoxShell(document.getElementById("footer-drinks-box"));
  }

  /**
   * Footer layout (boards 1–3) — docs/FOOTER_BOXES.md
   *  0 → hide strip
   *  1 → one box 1082px
   *  2 → left-heavy 768 + 299 (order: protein → sauces → drinks)
   *  3 → even thirds, 15px gaps
   */
  function applyFooterBoxesLayout() {
    if (!els.footerBoxes) return;
    const showP = proteinBox.include !== false;
    const showS = saucesBox.include !== false;
    const showD = !!footerDrinksBox.include;

    const slots = [
      { id: "protein-box", show: showP },
      { id: "sauces-box", show: showS },
      { id: "footer-drinks-box", show: showD },
    ];
    const visible = [];
    slots.forEach(function (s) {
      const el = document.getElementById(s.id);
      if (!el) return;
      el.hidden = !s.show;
      el.classList.remove("footer-major", "footer-minor");
      if (s.show) visible.push(el);
    });

    const bodyModes = [
      "footer-none",
      "footer-one",
      "footer-two",
      "footer-three",
      "footer-both",
      "footer-protein-only",
      "footer-sauces-only",
    ];
    bodyModes.forEach(function (m) {
      document.body.classList.remove(m);
    });
    const stripModes = ["footer-one", "footer-two", "footer-three"];
    stripModes.forEach(function (m) {
      els.footerBoxes.classList.remove(m);
    });

    const n = visible.length;
    let mode = "footer-none";
    if (n === 1) mode = "footer-one";
    else if (n === 2) mode = "footer-two";
    else if (n >= 3) mode = "footer-three";

    document.body.classList.add(mode);
    if (n > 0) els.footerBoxes.classList.add(mode);

    // Legacy aliases for any leftover CSS
    if (n === 2 && showP && showS && !showD) {
      document.body.classList.add("footer-both");
    } else if (n === 1 && showP) {
      document.body.classList.add("footer-protein-only");
    } else if (n === 1 && showS) {
      document.body.classList.add("footer-sauces-only");
    }

    if (n === 2) {
      visible[0].classList.add("footer-major");
      visible[1].classList.add("footer-minor");
    }

    const any = n > 0;
    els.footerBoxes.hidden = !any;
    els.footerBoxes.style.display = any ? "" : "none";

    void els.footerBoxes.offsetWidth;
    syncFooterBoxShells();
    console.info(
      "Footer boxes:",
      mode,
      "protein",
      showP,
      "sauces",
      showS,
      "drinks",
      showD
    );
  }

  /** @deprecated use applyFooterBoxesLayout */
  function applyHandheldsFooterLayout() {
    applyFooterBoxesLayout();
  }

  function renderFooterBoxes() {
    if (!els.footerBoxes) return;
    applyHandheldsFooterLayout();

    if (els.proteinTitle) els.proteinTitle.textContent = proteinBox.title || "";
    if (els.proteinSubtitle) {
      els.proteinSubtitle.textContent = proteinBox.subtitle || "";
    }
    if (els.saucesTitle) els.saucesTitle.textContent = saucesBox.title || "";
    if (els.saucesSubtitle) {
      els.saucesSubtitle.textContent = saucesBox.subtitle || "";
    }

    if (els.proteinBody) {
      els.proteinBody.innerHTML = "";
      els.proteinBody.style.setProperty("--box-scale", "1");
      setBoxLayoutMode(els.proteinBody, proteinBox.createColumns !== false);
      setBoxTextAlign(els.proteinBody, proteinBox.textAlign);
      if (proteinBox.include !== false) {
        const list = proteinBox.items || [];
        if (proteinBox.createColumns !== false) {
          list.forEach((it) => {
            const row = document.createElement("div");
            row.className = "protein-row box-col-item";

            const name = document.createElement("span");
            name.className = "protein-name";
            name.textContent = it.name;
            row.appendChild(name);

            if (it.price) {
              const cleaned = String(it.price)
                .replace(/^\+\s*/, "")
                .replace(/^\$/, "")
                .trim();
              const priceEl = document.createElement("span");
              priceEl.className = "protein-price";
              priceEl.textContent = " + $" + cleaned;
              row.appendChild(priceEl);
            }

            els.proteinBody.appendChild(row);
          });
        } else {
          // Balanced wrap with bold name + regular-weight price (same as columns)
          const lines = balanceItemsIntoLines(
            list.map(function (it) {
              return {
                label: proteinWrapLabel(it),
                name: it.name,
                price: it.price,
              };
            }),
            balanceOptsFromBox(els.proteinBody, {
              sepText: " · ",
              maxLines: 8,
            })
          );
          lines.forEach(function (line, li) {
            line.forEach(function (it, i) {
              const span = document.createElement("span");
              span.className = "protein-wrap-item wrap-item";

              const nameEl = document.createElement("span");
              nameEl.className = "protein-name";
              nameEl.textContent = it.name || "";
              span.appendChild(nameEl);

              if (it.price) {
                const cleaned = String(it.price)
                  .replace(/^\+\s*/, "")
                  .replace(/^\$/, "")
                  .trim();
                if (cleaned) {
                  const priceEl = document.createElement("span");
                  priceEl.className = "protein-price";
                  priceEl.textContent = " + $" + cleaned;
                  span.appendChild(priceEl);
                }
              }

              els.proteinBody.appendChild(span);
              if (i < line.length - 1) {
                const sep = document.createElement("span");
                sep.className = "protein-wrap-sep wrap-sep";
                sep.textContent = " · ";
                sep.setAttribute("aria-hidden", "true");
                els.proteinBody.appendChild(sep);
              }
            });
            if (li < lines.length - 1) {
              const br = document.createElement("span");
              br.className = "protein-line-break wrap-line-break";
              br.setAttribute("aria-hidden", "true");
              els.proteinBody.appendChild(br);
            }
          });
        }
      }
    }

    if (els.saucesBody) {
      els.saucesBody.innerHTML = "";
      els.saucesBody.style.setProperty("--box-scale", "1");
      setBoxLayoutMode(els.saucesBody, !!saucesBox.createColumns);
      setBoxTextAlign(els.saucesBody, saucesBox.textAlign);
      if (saucesBox.include !== false) {
        const list = saucesBox.items || [];
        if (saucesBox.createColumns) {
          list.forEach(function (it) {
            const row = document.createElement("div");
            row.className = "sauce-col-item box-col-item";
            // Inner span → reliable max-content width in fitColumnBox
            const label = document.createElement("span");
            label.className = "sauce-col-label";
            label.textContent = it.name;
            row.appendChild(label);
            els.saucesBody.appendChild(row);
          });
        } else {
          const lines = balanceItemsIntoLines(
            list.map(function (it) {
              return { label: String(it.name || ""), name: it.name };
            }),
            balanceOptsFromBox(els.saucesBody, {
              sepText: " · ",
              maxLines: 8,
            })
          );
          appendBalancedWrapItems(els.saucesBody, lines, {
            itemClass: "sauce-item wrap-item",
            sepClass: "sauce-sep wrap-sep",
            breakClass: "sauce-line-break wrap-line-break",
            sepText: " · ",
            getText: function (it) {
              return it.name;
            },
          });
        }
      }
    }

    if (els.footerDrinksTitle) {
      els.footerDrinksTitle.textContent = footerDrinksBox.title || "";
    }
    if (els.footerDrinksSubtitle) {
      els.footerDrinksSubtitle.textContent = footerDrinksBox.subtitle || "";
    }
    if (els.footerDrinksBody) {
      els.footerDrinksBody.innerHTML = "";
      els.footerDrinksBody.style.setProperty("--box-scale", "1");
      setBoxLayoutMode(els.footerDrinksBody, !!footerDrinksBox.createColumns);
      setBoxTextAlign(els.footerDrinksBody, footerDrinksBox.textAlign);
      if (footerDrinksBox.include) {
        const list = footerDrinksBox.items || [];
        if (footerDrinksBox.createColumns) {
          list.forEach(function (it) {
            const row = document.createElement("div");
            row.className = "footer-drink-col-item box-col-item";
            const label = document.createElement("span");
            label.className = "footer-drink-col-label";
            label.textContent = it.name;
            row.appendChild(label);
            els.footerDrinksBody.appendChild(row);
          });
        } else {
          const lines = balanceItemsIntoLines(
            list.map(function (it) {
              return { label: String(it.name || ""), name: it.name };
            }),
            balanceOptsFromBox(els.footerDrinksBody, {
              sepText: " · ",
              maxLines: 8,
            })
          );
          appendBalancedWrapItems(els.footerDrinksBody, lines, {
            itemClass: "footer-drink-item wrap-item",
            sepClass: "footer-drink-sep wrap-sep",
            breakClass: "footer-drink-line-break wrap-line-break",
            sepText: " · ",
            getText: function (it) {
              return it.name;
            },
          });
        }
      }
    }

    // Shells after content/layout settle (width may change when solo)
    syncFooterBoxShells();
    fitFooterBoxes();
  }

  function proteinWrapLabel(it) {
    const name = String((it && it.name) || "").trim();
    if (!it || !it.price) return name;
    const cleaned = String(it.price)
      .replace(/^\+\s*/, "")
      .replace(/^\$/, "")
      .trim();
    if (!cleaned) return name;
    return name + " + $" + cleaned;
  }

  /** Toggle body between grid columns and balanced wrap. */
  function setBoxLayoutMode(el, columns) {
    if (!el) return;
    el.classList.toggle("layout-columns", !!columns);
    el.classList.toggle("layout-wrap", !columns);
    if (columns) {
      el.style.setProperty("--box-cols", "2");
      el.setAttribute("data-cols", "2");
    } else {
      el.removeAttribute("data-cols");
      el.style.removeProperty("--protein-cols");
      el.style.removeProperty("--box-cols");
    }
  }

  /** Apply Text Align dropdown: left | center | right (columns + wrap). */
  function setBoxTextAlign(el, align) {
    if (!el) return;
    const a = parseTextAlign(align, "center");
    el.setAttribute("data-align", a);
    el.classList.remove("align-left", "align-center", "align-right");
    el.classList.add("align-" + a);
  }

  // ---------- balanced wrap packing (sauces, sodas, …) ----------

  let _measureCanvas = null;
  let _measureProbe = null;

  /**
   * Measure text width for packing. Prefer a DOM probe (matches Roboto
   * Condensed + letter-spacing); canvas is a fallback only.
   * Canvas alone under/over-estimates seps and condensed glyphs enough to
   * plan lines that flex-wrap, which crushes --box-scale via height.
   */
  function measureTextPx(text, font) {
    const str = String(text || "");
    const fontStr =
      font || "700 30px Roboto Condensed, Roboto, sans-serif";
    try {
      if (!_measureProbe) {
        _measureProbe = document.createElement("span");
        _measureProbe.setAttribute("aria-hidden", "true");
        _measureProbe.style.cssText =
          "position:absolute;left:-99999px;top:0;white-space:nowrap;" +
          "visibility:hidden;pointer-events:none;margin:0;padding:0;border:0;";
        document.body.appendChild(_measureProbe);
      }
      _measureProbe.style.font = fontStr;
      // Match sauces wrap tracking when font mentions Condensed
      if (/condensed/i.test(fontStr)) {
        _measureProbe.style.letterSpacing = "-0.015em";
      } else {
        _measureProbe.style.letterSpacing = "normal";
      }
      _measureProbe.textContent = str;
      const w = _measureProbe.offsetWidth;
      if (w > 0) return w;
    } catch (err) {
      /* fall through to canvas */
    }
    if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
    const ctx = _measureCanvas.getContext("2d");
    if (!ctx) return str.length * 10;
    ctx.font = fontStr;
    return ctx.measureText(str).width;
  }

  function parsePadXY(cs) {
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pt = parseFloat(cs.paddingTop) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
    return { x: pl + pr, y: pt + pb };
  }

  /**
   * Build measure/layout options from a flex wrap box (at current --box-scale).
   */
  function balanceOptsFromBox(el, extra) {
    const cs = window.getComputedStyle(el);
    const pad = parsePadXY(cs);
    const fontSize = parseFloat(cs.fontSize) || 30;
    const lineHeight =
      cs.lineHeight && cs.lineHeight !== "normal"
        ? parseFloat(cs.lineHeight)
        : fontSize * 1.25;
    const rowGap = parseFloat(cs.rowGap) || 0;
    // Small safety so planned lines don't flex-wrap after seps/rounding
    const innerW = Math.max(1, (el.clientWidth || 0) - pad.x);
    return Object.assign(
      {
        font:
          (cs.fontStyle !== "normal" ? cs.fontStyle + " " : "") +
          (cs.fontWeight || "700") +
          " " +
          cs.fontSize +
          " " +
          cs.fontFamily,
        containerWidth: Math.max(1, innerW * 0.98),
        containerHeight: Math.max(1, (el.clientHeight || 0) - pad.y),
        lineHeight: lineHeight + rowGap,
        maxLines: 8,
      },
      extra || {}
    );
  }

  /**
   * LPT multifit: assign each item (longest first) to the currently lightest
   * line so line widths stay as even as possible.
   */
  function packLptLines(items, lineCount, sepW) {
    const lines = [];
    for (let i = 0; i < lineCount; i++) {
      lines.push({ items: [], width: 0 });
    }
    const sorted = items.slice().sort(function (a, b) {
      if (b.width !== a.width) return b.width - a.width;
      return a.idx - b.idx;
    });
    for (let s = 0; s < sorted.length; s++) {
      const it = sorted[s];
      let best = lines[0];
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].width < best.width) best = lines[i];
      }
      best.width += it.width + (best.items.length ? sepW : 0);
      best.items.push(it);
    }
    // Stable order within each line (sheet / original index)
    lines.forEach(function (line) {
      line.items.sort(function (a, b) {
        return a.idx - b.idx;
      });
      line.width = 0;
      for (let i = 0; i < line.items.length; i++) {
        line.width += line.items[i].width + (i ? sepW : 0);
      }
    });
    // Top-to-bottom: keep earliest original items first among lines
    lines.sort(function (a, b) {
      if (!a.items.length) return 1;
      if (!b.items.length) return -1;
      return a.items[0].idx - b.items[0].idx;
    });
    return lines.filter(function (ln) {
      return ln.items.length > 0;
    });
  }

  /**
   * Greedy pack in sheet order: fill each line up to boxW before wrapping.
   * Better for wide footer-major boxes (full rows, reading order, no orphans).
   */
  function packGreedyByWidth(items, sepW, boxW) {
    const lines = [];
    let cur = { items: [], width: 0 };
    const limit = Math.max(1, boxW);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const add = it.width + (cur.items.length ? sepW : 0);
      if (cur.items.length && cur.width + add > limit) {
        lines.push(cur);
        cur = { items: [], width: 0 };
      }
      cur.width += (cur.items.length ? sepW : 0) + it.width;
      cur.items.push(it);
    }
    if (cur.items.length) lines.push(cur);
    return lines;
  }

  /**
   * Reorder wrap items into balanced flex lines.
   * Picks line count that maximizes estimated type scale (width + height),
   * with preference for even rows AND width fill.
   *
   * Width fill matters in the wide footer-major slot (~768px): a 3–4 line pack
   * can be height-capped at ~same type size as a 2-line pack while each row only
   * uses ~60% of the box — looks sparse. Reward packs that use the row width.
   *
   * rawItems: [{ label, ...payload }]
   * opts: { font, sepText, containerWidth, containerHeight, lineHeight, maxLines,
   *         measureLabel?(item, font) → px }
   * Returns: array of lines, each line an array of original raw item objects
   *          (with idx/width stripped — same references as input payloads).
   */
  function balanceItemsIntoLines(rawItems, opts) {
    const list = Array.isArray(rawItems) ? rawItems : [];
    const n = list.length;
    if (n === 0) return [];
    if (n === 1) return [list.slice()];

    const o = opts || {};
    const font = o.font || "700 30px sans-serif";
    const sepText = o.sepText != null ? o.sepText : " · ";
    const sepW = measureTextPx(sepText, font);
    const boxW = Math.max(1, o.containerWidth || 280);
    const boxH = Math.max(1, o.containerHeight || 120);
    const lineH = Math.max(8, o.lineHeight || 36);
    const maxLines = Math.min(n, Math.max(1, o.maxLines || 8));
    const measureLabel =
      typeof o.measureLabel === "function"
        ? o.measureLabel
        : function (it, f) {
            return measureTextPx(it.label, f);
          };

    // Inflate measured widths slightly — canvas/DOM probe is still a hair
    // narrower than live flex+middot layout, which caused mid-line wraps
    // (e.g. lone "Spicy Toki") in the wide sauces slot.
    const WIDTH_PAD = 1.08;
    const items = list.map(function (it, idx) {
      return {
        idx: idx,
        width: Math.max(1, measureLabel(it, font) * WIDTH_PAD),
        raw: it,
      };
    });

    // If box isn't laid out yet, fall back to single balanced guess by chars
    const unmeasured = boxW < 8 || boxH < 8;

    let bestLines = null;
    let bestScore = -Infinity;
    let bestType = -Infinity;
    let bestTag = "";
    const candidates = [];

    function considerPacked(packed, tag) {
      if (!packed || !packed.length) return;
      let maxW = 0;
      let minW = Infinity;
      for (let i = 0; i < packed.length; i++) {
        if (packed[i].width > maxW) maxW = packed[i].width;
        if (packed[i].width < minW) minW = packed[i].width;
      }
      if (maxW < 1) maxW = 1;
      if (minW === Infinity) minW = maxW;

      const scaleW = unmeasured ? 1 / maxW : boxW / maxW;
      const scaleH = unmeasured
        ? 1 / packed.length
        : boxH / (packed.length * lineH);
      const balance = minW / maxW;
      const fill = unmeasured ? 0.85 : Math.min(1, maxW / boxW);
      const typeScore = Math.min(scaleW, scaleH);
      const L = packed.length;
      // Type size primary; width fill heavy (wide major slot); even rows; fewer lines
      const score =
        typeScore * (0.58 + 0.12 * balance + 0.3 * fill) - L * 0.008;

      const lines = packed.map(function (ln) {
        return ln.items.map(function (it) {
          return it.raw;
        });
      });
      candidates.push({
        tag: tag,
        L: L,
        score: score,
        typeScore: typeScore,
        fill: fill,
        lines: lines,
      });
      if (score > bestScore) {
        bestScore = score;
        bestType = typeScore;
        bestLines = lines;
        bestTag = tag;
      }
    }

    for (let L = 1; L <= maxLines; L++) {
      considerPacked(packLptLines(items, L, sepW), "lpt-" + L);
    }
    // Sheet-order greedy: fills wide boxes without single-item orphan rows
    if (!unmeasured) {
      considerPacked(packGreedyByWidth(items, sepW, boxW * 0.96), "greedy");
      considerPacked(
        packGreedyByWidth(items, sepW, boxW * 0.88),
        "greedy-tight"
      );
    }

    // Among packs within 8% of best type size, pick fullest width (then fewer lines)
    if (candidates.length && bestType > 0) {
      let pick = null;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c.typeScore < bestType * 0.92) continue;
        if (
          !pick ||
          c.fill > pick.fill + 0.03 ||
          (Math.abs(c.fill - pick.fill) <= 0.03 && c.L < pick.L) ||
          (Math.abs(c.fill - pick.fill) <= 0.03 &&
            c.L === pick.L &&
            c.score > pick.score)
        ) {
          pick = c;
        }
      }
      if (pick) {
        bestLines = pick.lines;
        bestScore = pick.score;
        bestTag = (pick.tag || "?") + "*";
      }
    }

    if (!bestLines) return [list.slice()];

    if (typeof console !== "undefined" && console.info) {
      const summary = bestLines
        .map(function (ln) {
          return ln
            .map(function (it) {
              return it.label || it.name || "?";
            })
            .join(" · ");
        })
        .join(" || ");
      console.info(
        "Balanced wrap (" + bestLines.length + " lines, " + bestTag + "):",
        summary,
        "boxW=" + Math.round(boxW)
      );
    }
    return bestLines;
  }

  function drinkItemMeasureLabel(it) {
    let s = String((it && it.name) || "");
    if (it && it.subtitle) {
      const sub = String(it.subtitle).trim();
      s += sub.charAt(0) === "(" ? " " + sub : " (" + sub + ")";
    }
    return s;
  }

  function measureDrinkEntryWidth(it, font) {
    const name = String((it && it.name) || "");
    let w = measureTextPx(name, font);
    if (it && it.subtitle) {
      const sub = String(it.subtitle).trim();
      const subText = sub.charAt(0) === "(" ? " " + sub : " (" + sub + ")";
      // Subtitle renders at 0.75em
      const font75 = String(font).replace(
        /(\d+(?:\.\d+)?)px/,
        function (_, n) {
          return parseFloat(n) * 0.75 + "px";
        }
      );
      w += measureTextPx(subText, font75);
    }
    return w;
  }

  /**
   * Append balanced lines as item/sep/force-break flex children.
   * onItem(el, item, globalIndex) optional hook after creating the item span.
   */
  function appendBalancedWrapItems(body, lines, conf) {
    const c = conf || {};
    const itemClass = c.itemClass || "wrap-item";
    const sepClass = c.sepClass || "wrap-sep";
    const breakClass = c.breakClass || "wrap-force-break";
    const sepText = c.sepText != null ? c.sepText : " · ";
    const getText =
      c.getText ||
      function (it) {
        return it.label != null ? it.label : it.name;
      };

    // Each planned line is a nowrap row so items never flex-wrap mid-line
    // (orphans like a lone "Spicy Toki" between force-breaks).
    lines.forEach(function (line, li) {
      const row = document.createElement("span");
      row.className = "wrap-line-row";
      row.setAttribute("data-line", String(li));
      line.forEach(function (it, i) {
        const span = document.createElement("span");
        span.className = itemClass;
        span.textContent = getText(it);
        if (typeof c.onItem === "function") c.onItem(span, it, li, i);
        row.appendChild(span);
        if (i < line.length - 1) {
          const sep = document.createElement("span");
          sep.className = sepClass;
          sep.textContent = sepText;
          sep.setAttribute("aria-hidden", "true");
          row.appendChild(sep);
        }
      });
      body.appendChild(row);
      if (li < lines.length - 1) {
        const br = document.createElement("span");
        br.className = breakClass;
        br.setAttribute("aria-hidden", "true");
        body.appendChild(br);
      }
    });
  }

  /**
   * Hide middot/bullet separators that sit on a line break (wrap layout).
   * conf: { sepSelector, forceBreakClass, lineBreakClass, itemClass }
   */
  function hideWrapSepsAtLineBreaks(body, conf) {
    if (!body) return;
    conf = conf || {};
    const forceClass = conf.forceBreakClass || "wrap-force-break";
    const lineClass = conf.lineBreakClass || "wrap-line-break";
    const itemClass = conf.itemClass || "wrap-item";
    const sepSel =
      conf.sepSelector ||
      ".wrap-sep, .sauce-sep, .drink-sep, .protein-wrap-sep";

    body.querySelectorAll("." + forceClass).forEach(function (el) {
      el.remove();
    });

    const seps = Array.prototype.slice.call(body.querySelectorAll(sepSel));
    seps.forEach(function (sep) {
      sep.style.display = "";
    });

    function isBreak(el) {
      return (
        el &&
        (el.classList.contains(forceClass) ||
          el.classList.contains(lineClass) ||
          el.classList.contains("wrap-line-break") ||
          el.classList.contains("wrap-force-break") ||
          el.classList.contains("sauce-line-break") ||
          el.classList.contains("sauce-force-break") ||
          el.classList.contains("drink-line-break") ||
          el.classList.contains("protein-line-break") ||
          el.classList.contains("protein-force-break"))
      );
    }

    function isItem(el) {
      if (!el) return false;
      if (itemClass && el.classList.contains(itemClass)) return true;
      return (
        el.classList.contains("wrap-item") ||
        el.classList.contains("sauce-item") ||
        el.classList.contains("drink-item") ||
        el.classList.contains("protein-wrap-item")
      );
    }

    function itemNeighbors(sep) {
      let prev = sep.previousElementSibling;
      let next = sep.nextElementSibling;
      while (isBreak(prev)) prev = prev.previousElementSibling;
      while (isBreak(next)) next = next.nextElementSibling;
      if (!isItem(prev) || !isItem(next)) return null;
      return { prev: prev, next: next };
    }

    function tops(sep) {
      const n = itemNeighbors(sep);
      if (!n) return null;
      const st =
        sep.style.display === "none"
          ? n.prev.getBoundingClientRect().top
          : sep.getBoundingClientRect().top;
      return {
        prev: n.prev,
        next: n.next,
        pt: n.prev.getBoundingClientRect().top,
        st: st,
        nt: n.next.getBoundingClientRect().top,
      };
    }

    function straddlesBreak(t) {
      return t.st > t.pt + 3 || t.nt > t.st + 3;
    }

    function ensureForceBreakBefore(next) {
      const before = next.previousElementSibling;
      if (isBreak(before)) return;
      const br = document.createElement("span");
      br.className = forceClass;
      br.setAttribute("aria-hidden", "true");
      next.parentNode.insertBefore(br, next);
    }

    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      seps.forEach(function (sep) {
        if (sep.style.display === "none") return;
        const t = tops(sep);
        if (!t) return;
        if (straddlesBreak(t)) {
          sep.style.display = "none";
          changed = true;
        }
      });
      seps.forEach(function (sep) {
        if (sep.style.display !== "none") return;
        const n = itemNeighbors(sep);
        if (!n) return;
        const pt = n.prev.getBoundingClientRect().top;
        const nt = n.next.getBoundingClientRect().top;
        if (Math.abs(nt - pt) > 3) return;
        sep.style.display = "";
        void body.offsetWidth;
        const t = tops(sep);
        if (t && !straddlesBreak(t) && Math.abs(t.nt - t.pt) <= 3) {
          changed = true;
          return;
        }
        sep.style.display = "none";
        ensureForceBreakBefore(n.next);
        void body.offsetWidth;
        changed = true;
      });
      if (!changed) break;
    }
  }

  function hideSaucesSepsAtLineBreaks() {
    hideWrapSepsAtLineBreaks(els.saucesBody, {
      sepSelector: ".sauce-sep, .wrap-sep",
      forceBreakClass: "sauce-force-break",
      lineBreakClass: "sauce-line-break",
      itemClass: "sauce-item",
    });
  }

  /**
   * Scale protein/sauces body type to fill each black panel.
   * Create Columns? on → 1–3 col grid bake-off; off → balanced wrap fit.
   */
  function fitFooterBoxes() {
    if (proteinBox.include !== false && els.proteinBody) {
      if (proteinBox.createColumns !== false) {
        fitColumnBox(els.proteinBody, {
          rowSelector: ".box-col-item, .protein-row",
          label: "Protein",
        });
      } else {
        fitWrapBox(els.proteinBody, {
          sepSelector: ".protein-wrap-sep, .wrap-sep",
          forceBreakSelector: ".protein-force-break",
          lineBreakClass: "protein-line-break",
          forceBreakClass: "protein-force-break",
          itemClass: "protein-wrap-item",
        });
      }
    }

    if (saucesBox.include !== false && els.saucesBody) {
      if (saucesBox.createColumns) {
        fitColumnBox(els.saucesBody, {
          rowSelector: ".box-col-item, .sauce-col-item",
          label: "Sauces",
          minColPx: 140,
        });
      } else {
        fitWrapBox(els.saucesBody, {
          sepSelector: ".sauce-sep, .wrap-sep",
          forceBreakSelector: ".sauce-force-break",
          lineBreakClass: "sauce-line-break",
          forceBreakClass: "sauce-force-break",
          itemClass: "sauce-item",
        });
      }
    }

    if (footerDrinksBox.include && els.footerDrinksBody) {
      if (footerDrinksBox.createColumns) {
        fitColumnBox(els.footerDrinksBody, {
          rowSelector: ".box-col-item, .footer-drink-col-item",
          label: "FooterDrinks",
          minColPx: 120,
        });
      } else {
        fitWrapBox(els.footerDrinksBody, {
          sepSelector: ".footer-drink-sep, .wrap-sep",
          forceBreakSelector: ".footer-drink-force-break",
          lineBreakClass: "footer-drink-line-break",
          forceBreakClass: "footer-drink-force-break",
          itemClass: "footer-drink-item",
        });
      }
    }
  }

  /**
   * Grid layout: try 1…MAX_BOX_COLS columns; keep largest --box-scale that fits.
   * Cap columns by width so a narrow Sauces box (299px) doesn't force too many
   * unreadably-thin columns. Hard ceiling is MAX_BOX_COLS (not a physics law —
   * just keeps the bake-off small).
   */
  const MAX_BOX_COLS = 4;

  function fitColumnBox(el, opts) {
    opts = opts || {};
    if (!el || !el.children || !el.children.length) return;
    if (el.clientHeight <= 0 || el.clientWidth <= 0) return;

    const rowSel = opts.rowSelector || ".box-col-item";
    const n = el.querySelectorAll(rowSel).length;
    if (!n) return;

    // ~150px min slot keeps condensed labels readable in the 299px sauces box
    const minColPx = opts.minColPx != null ? opts.minColPx : 150;
    const maxColsByWidth = Math.max(
      1,
      Math.floor((el.clientWidth + 8) / minColPx)
    );
    const hardMax = opts.maxCols != null ? opts.maxCols : MAX_BOX_COLS;
    const maxCols = Math.min(hardMax, Math.max(1, n), maxColsByWidth);
    let bestCols = 1;
    let bestScale = 0;

    for (let cols = 1; cols <= maxCols; cols++) {
      el.style.setProperty("--box-cols", String(cols));
      el.style.setProperty("--protein-cols", String(cols)); // protein CSS alias
      el.setAttribute("data-cols", String(cols));
      void el.offsetWidth;
      const scale = fitBoxScale(el, 0.35, 2.0, {
        checkChildWidth: true,
        proteinRows: true,
        returnScale: true,
      });
      if (typeof scale !== "number") continue;
      if (
        scale > bestScale + 0.01 ||
        (scale >= bestScale - 0.005 &&
          cols > bestCols &&
          n >= 6 &&
          scale >= bestScale * 0.98)
      ) {
        bestScale = scale;
        bestCols = cols;
      }
    }

    el.style.setProperty("--box-cols", String(bestCols));
    el.style.setProperty("--protein-cols", String(bestCols));
    el.setAttribute("data-cols", String(bestCols));
    fitBoxScale(el, 0.35, 2.0, {
      checkChildWidth: true,
      proteinRows: true,
    });
    console.info(
      (opts.label || "Columns") + ":",
      bestCols,
      "cols (max",
      maxCols + ")",
      "scale",
      bestScale ? bestScale.toFixed(3) : "?",
      "w=" + el.clientWidth
    );
  }

  /**
   * Balanced wrap layout: fit type, then clean middots at line breaks.
   * Sauces use a higher max scale + gentler shrink so dense packing (see
   * footer-verify) is not undercut by the global 0.97 fudge.
   */
  function fitWrapBox(el, conf) {
    if (!el || !el.children || !el.children.length) return;
    conf = conf || {};
    const forceSel = conf.forceBreakSelector || ".wrap-force-break";
    const sepSel = conf.sepSelector || ".wrap-sep";
    const isDenseFooter =
      el.id === "sauces-body" || el.id === "footer-drinks-body";
    const minS = isDenseFooter ? 0.45 : 0.5;
    const maxS = isDenseFooter ? 2.4 : 2.2;
    const shrink = isDenseFooter ? 0.995 : 0.97;

    function resetSeps() {
      el.querySelectorAll(forceSel).forEach(function (n) {
        n.remove();
      });
      el.querySelectorAll(sepSel).forEach(function (s) {
        s.style.display = "";
      });
    }

    resetSeps();
    fitBoxScale(el, minS, maxS, {
      checkChildWidth: true,
      shrinkFactor: shrink,
    });
    hideWrapSepsAtLineBreaks(el, conf);
    resetSeps();
    fitBoxScale(el, minS, maxS, {
      checkChildWidth: true,
      shrinkFactor: shrink,
    });
    hideWrapSepsAtLineBreaks(el, conf);
  }

  /** Legacy name → column fit (protein default path). */
  function fitProteinBox() {
    if (!els.proteinBody) return;
    fitColumnBox(els.proteinBody, {
      rowSelector: ".box-col-item, .protein-row",
      label: "Protein",
    });
  }

  function fitBoxScale(el, minS, maxS, opts) {
    opts = opts || {};
    if (!el || !el.children || !el.children.length) return opts.returnScale ? minS : undefined;
    if (el.clientHeight <= 0 || el.clientWidth <= 0) {
      return opts.returnScale ? minS : undefined;
    }

    const fits = (scale) => {
      el.style.setProperty("--box-scale", String(scale));
      // space-evenly / space-between hide overflow: scrollHeight stays == clientHeight
      // while rows are clipped. Pack from the top while measuring height.
      if (opts.proteinRows) {
        el.style.alignContent = "start";
      }
      void el.offsetHeight;

      let heightOk = el.scrollHeight <= el.clientHeight + 1;
      if (opts.proteinRows) {
        // Column-mode rows (protein / sauces / drinks)
        const rows = el.querySelectorAll(
          ".protein-row, .box-col-item, .sauce-col-item, .drink-col-item"
        );
        if (rows.length) {
          const last = rows[rows.length - 1];
          const padBot =
            parseFloat(window.getComputedStyle(el).paddingBottom) || 0;
          // Prefer content box (name span) — row offsetHeight can still lie if
          // overflow clipped the line box during an intermediate layout.
          let contentH = last.offsetHeight;
          Array.prototype.forEach.call(last.children, function (ch) {
            if (ch.offsetHeight > contentH) contentH = ch.offsetHeight;
          });
          const bottom = last.offsetTop + contentH;
          heightOk = bottom + padBot <= el.clientHeight + 1;
        }
      }
      if (!heightOk) return false;

      if (opts.checkChildWidth) {
        const padXY = parsePadXY(window.getComputedStyle(el));
        // Content box width (clientWidth includes padding)
        const contentW = Math.max(1, el.clientWidth - padXY.x);
        for (let i = 0; i < el.children.length; i++) {
          const child = el.children[i];
          const isColRow =
            opts.proteinRows &&
            (child.classList.contains("protein-row") ||
              child.classList.contains("box-col-item") ||
              child.classList.contains("sauce-col-item") ||
              child.classList.contains("drink-col-item"));
          if (isColRow) {
            // Rows are width:100%; measure content (name+price), not the cell box.
            let natural = 0;
            Array.prototype.forEach.call(child.children, function (ch) {
              natural += ch.offsetWidth;
            });
            // Single-text cell (sauces/drinks): use max-content width
            if (natural < 1) {
              const prev = child.style.width;
              child.style.width = "max-content";
              natural = child.offsetWidth;
              child.style.width = prev;
            }
            if (natural > child.clientWidth + 1) return false;
          } else if (child.classList.contains("wrap-line-row")) {
            // Sum children — flex scrollWidth can lie when justify is end/center
            let natural = 0;
            Array.prototype.forEach.call(child.children, function (ch) {
              natural += ch.offsetWidth;
            });
            if (natural < 1) {
              natural = child.scrollWidth;
            }
            // 2px AA cushion so right-aligned glyphs are not clipped
            if (natural > contentW - 2) return false;
          } else if (child.offsetWidth > contentW + 1) {
            return false;
          }
        }
      }
      return true;
    };

    let lo = minS;
    let hi = maxS;
    let best = minS;

    if (!fits(lo)) {
      let s = lo;
      while (s > 0.3 && !fits(s)) s -= 0.02;
      best = Math.max(0.3, s);
      el.style.setProperty("--box-scale", String(best));
      if (opts.proteinRows) el.style.alignContent = "";
      return opts.returnScale ? best : undefined;
    }

    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const shrink =
      opts.shrinkFactor != null && isFinite(opts.shrinkFactor)
        ? opts.shrinkFactor
        : 0.97;
    best = Math.max(minS, best * shrink);
    let guard = 0;
    while (!fits(best) && best > minS && guard < 40) {
      best -= 0.015;
      guard++;
    }
    fits(best);
    // Restore CSS align-content (space-evenly) after measuring
    if (opts.proteinRows) el.style.alignContent = "";
    return opts.returnScale ? best : undefined;
  }

  function fitTitle() {
    const title = els.title;
    const maxH = title.clientHeight || 200;
    const maxW = title.clientWidth || 600;
    let size = 104;
    title.style.fontSize = size + "px";
    while (
      size > 40 &&
      (title.scrollHeight > maxH + 2 || title.scrollWidth > maxW + 2)
    ) {
      size -= 2;
      title.style.fontSize = size + "px";
    }
  }

  function menuColumnLabel() {
    if (isHandhelds) return "Handhelds";
    if (isMunchies) return "Munchies";
    return "Bowls";
  }

  /**
   * Menu list columns for bowls/handhelds/munchies.
   * cols=1 → flex column; cols=2|3 → grid, column-major.
   */
  function setMenuColumnMode(list, cols) {
    if (!list) return;
    const n = Math.max(1, Math.min(3, cols | 0));
    list.classList.remove("cols-2", "cols-3");
    if (n >= 2) {
      const rows = Math.max(1, Math.ceil(items.length / n));
      list.classList.add(n === 3 ? "cols-3" : "cols-2");
      list.style.setProperty("--menu-col-rows", String(rows));
      list.style.setProperty("--menu-cols", String(n));
    } else {
      list.style.removeProperty("--menu-col-rows");
      list.style.removeProperty("--menu-cols");
    }
  }

  function fitMenuText() {
    const list = els.list;
    if (!list || items.length === 0) return;
    if (list.clientHeight <= 0) return;

    // Measure with top packing so height isn't inflated by centering
    list.style.justifyContent = "flex-start";
    list.style.alignContent = "start";

    /**
     * Height must fit the panel AND every .item-line (name+price) must stay
     * on one line — same idea as protein: scale is limited by the longest
     * nowrap line so nothing wraps mid-name.
     */
    const fits = (scale) => {
      list.style.setProperty("--menu-scale", String(scale));
      void list.offsetHeight;
      if (list.scrollHeight > list.clientHeight + 0.5) return false;

      const lines = list.querySelectorAll(".item-line");
      for (let i = 0; i < lines.length; i++) {
        // scrollWidth > clientWidth when nowrap text overflows the cell
        if (lines[i].scrollWidth > lines[i].clientWidth + 1) return false;
      }
      return true;
    };

    function bestScaleForCurrentLayout() {
      let lo = MIN_MENU_SCALE;
      let hi = MAX_MENU_SCALE;
      let best = lo;

      if (!fits(lo)) {
        list.style.setProperty("--menu-scale", String(lo));
        return lo;
      }

      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) {
          best = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }

      // Handhelds: midpoint pull (was 0.97 default, then 0.995 tight)
      const pull = isHandhelds ? 0.983 : 0.97;
      best = Math.max(MIN_MENU_SCALE, best * pull);
      let guard = 0;
      while (!fits(best) && best > MIN_MENU_SCALE && guard < 40) {
        best = Math.max(MIN_MENU_SCALE, best - (isHandhelds ? 0.01 : 0.015));
        guard++;
      }
      fits(best);
      return best;
    }

    const forced =
      boardListOptions.columns === 1 ||
      boardListOptions.columns === 2 ||
      boardListOptions.columns === 3
        ? boardListOptions.columns
        : null;

    let chosenCols = 1;
    let chosenScale;

    if (forced != null) {
      // Sheet Columns? override — Auto is handled below
      setMenuColumnMode(list, forced);
      chosenCols = forced;
      chosenScale = bestScaleForCurrentLayout();
      console.info(
        menuColumnLabel() + " columns: " + forced + " (forced, scale",
        chosenScale.toFixed(3) + ")"
      );
    } else {
      // —— Pass 1: single column ——
      setMenuColumnMode(list, 1);
      const scale1 = bestScaleForCurrentLayout();
      chosenCols = 1;
      chosenScale = scale1;

      // —— Pass 2: try 2-col when dense / type is small (legacy Auto) ——
      if (usesAutoMenuColumns && items.length >= MENU_COLS_MIN_ITEMS) {
        const shouldTry =
          items.length >= MENU_COLS_ALWAYS_TRY ||
          scale1 < MENU_COLS_SCALE_FLOOR;
        if (shouldTry) {
          setMenuColumnMode(list, 2);
          const scale2 = bestScaleForCurrentLayout();
          if (scale2 >= chosenScale * MENU_COLS_WIN_RATIO) {
            chosenCols = 2;
            chosenScale = scale2;
            console.info(
              menuColumnLabel() + " columns: 2 auto (scale",
              scale1.toFixed(3),
              "→",
              scale2.toFixed(3) + ")"
            );
          } else {
            setMenuColumnMode(list, 1);
            fits(scale1);
            console.info(
              menuColumnLabel() + " columns: 1 auto (2-col scale",
              scale2.toFixed(3),
              "not enough better than",
              scale1.toFixed(3) + ")"
            );
          }
        }
      }
    }

    // Apply winner
    setMenuColumnMode(list, chosenCols);
    fits(chosenScale);

    // Short menus: vertically center in the panel. Full/overflow: stick to top.
    // Don't use scrollHeight — with flex + overflow it often equals clientHeight
    // even when children leave empty space at the bottom.
    void list.offsetHeight;
    const kids = list.children;
    let spare = 0;
    if (kids.length) {
      const padBottom =
        parseFloat(window.getComputedStyle(list).paddingBottom) || 0;
      let maxBottom = 0;
      for (let i = 0; i < kids.length; i++) {
        const b = kids[i].offsetTop + kids[i].offsetHeight;
        if (b > maxBottom) maxBottom = b;
      }
      spare = list.clientHeight - maxBottom - padBottom;
    }
    if (chosenCols >= 2) {
      list.style.alignContent = spare > 12 ? "center" : "start";
      list.style.justifyContent = "flex-start";
    } else {
      list.style.justifyContent = spare > 12 ? "center" : "flex-start";
      list.style.alignContent = "";
    }
  }

  // ---------- slideshow ----------

  function setActive(index, instant) {
    if (isDrinks) {
      setActiveDrinks(index, instant);
      return;
    }
    if (items.length === 0) return;
    activeIndex = ((index % items.length) + items.length) % items.length;
    const item = items[activeIndex];

    const nodes = els.list
      ? els.list.querySelectorAll(".menu-item")
      : [];
    nodes.forEach((node, i) => {
      const on = i === activeIndex;
      node.classList.toggle("active", on);
      if (on) {
        const color = item.isNew ? config.highlightSpecial : config.highlight;
        node.style.setProperty("--item-highlight", color);
      } else {
        node.style.removeProperty("--item-highlight");
      }
    });

    if (cfg.showHero !== false) {
      updateHero(item, instant);
    } else if (els.hero) {
      els.hero.classList.remove("visible");
      els.hero.hidden = true;
    }

    if (cfg.showSticker !== false) {
      updateSticker(item, instant);
    } else if (els.sticker) {
      els.sticker.classList.remove("visible");
      els.sticker.hidden = true;
    }
  }

  function setActiveDrinks(index, instant) {
    if (!slides.length) return;
    activeIndex = ((index % slides.length) + slides.length) % slides.length;
    const slide = slides[activeIndex];

    // Highlight active drink only for individual slides (not overview)
    if (els.drinkBoxBody) {
      const nodes = els.drinkBoxBody.querySelectorAll(".drink-item");
      nodes.forEach((node) => {
        const i = Number(node.dataset.index);
        const on = slide.type === "item" && i === slide.itemIndex;
        node.classList.toggle("active", on);
        if (on) {
          const item = items[slide.itemIndex];
          const color =
            item && item.isNew ? config.highlightSpecial : config.highlight;
          node.style.setProperty("--item-highlight", color);
        } else {
          node.style.removeProperty("--item-highlight");
        }
      });
    }

    const heroItem = {
      image: slide.image,
      isNew: !!slide.isNew,
    };
    if (cfg.showHero !== false) {
      updateHero(heroItem, instant);
    }
    if (cfg.showSticker !== false) {
      updateSticker(heroItem, instant);
    } else if (els.sticker) {
      els.sticker.classList.remove("visible");
      els.sticker.hidden = true;
    }
  }

  function updateHero(item, instant) {
    const img = els.hero;
    if (!img) return;
    if (!item || !item.image) {
      img.classList.remove("visible");
      img.hidden = true;
      img.removeAttribute("src");
      return;
    }

    const show = () => {
      img.hidden = false;
      requestAnimationFrame(() => img.classList.add("visible"));
    };

    const applySrc = () => {
      img.onload = () => show();
      img.onerror = () => {
        img.classList.remove("visible");
        img.hidden = true;
        img.removeAttribute("src");
      };
      if (img.getAttribute("src") === item.image) {
        show();
        return;
      }
      img.src = item.image;
    };

    if (instant) {
      img.classList.remove("visible");
      applySrc();
      return;
    }

    img.classList.remove("visible");
    window.setTimeout(applySrc, 200);
  }

  /**
   * New sticker fade — same cadence as updateHero:
   *  fade-out → short gap → unhide at opacity 0 → paint → fade-in.
   * Instant unhide+visible in one frame skips the CSS transition (pop-in).
   */
  function updateSticker(item, instant) {
    if (!els.sticker) return;
    const FADE_MS = 450; // match #hero / #new-sticker CSS
    const HERO_GAP_MS = 200; // match updateHero delay before show()
    const wantNew = !!(item && item.isNew);

    function stillWantsHidden() {
      if (isDrinks) {
        const slide = slides[activeIndex];
        return !slide || !slide.isNew;
      }
      return !items[activeIndex]?.isNew;
    }

    function reveal() {
      // May have been cancelled if user advanced to a non-new slide
      if (!wantNew && stillWantsHidden()) return;
      if (isDrinks) {
        const slide = slides[activeIndex];
        if (!slide || !slide.isNew) return;
      } else if (!items[activeIndex]?.isNew) {
        return;
      }

      els.sticker.hidden = false;
      els.sticker.classList.remove("visible");
      // Force a style flush at opacity:0 so transition to .visible is honored
      void els.sticker.offsetWidth;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (els.sticker && !els.sticker.hidden) {
            els.sticker.classList.add("visible");
          }
        });
      });
    }

    if (wantNew) {
      // Already showing on a New item → leave as-is (no flicker between New slides)
      if (
        !instant &&
        !els.sticker.hidden &&
        els.sticker.classList.contains("visible")
      ) {
        return;
      }
      if (instant) {
        reveal();
        return;
      }
      // Sync with hero: drop opacity first, wait, then fade in
      els.sticker.classList.remove("visible");
      window.setTimeout(reveal, HERO_GAP_MS);
    } else {
      els.sticker.classList.remove("visible");
      window.setTimeout(function () {
        if (stillWantsHidden()) els.sticker.hidden = true;
      }, FADE_MS);
    }
  }

  function startSlideshow() {
    if (slideshowTimer) clearInterval(slideshowTimer);
    const count = isDrinks ? slides.length : items.length;
    if (count <= 1) return;
    const ms = Math.max(0.5, config.slideshowSpeed) * 1000;
    slideshowTimer = setInterval(() => {
      setActive(activeIndex + 1, false);
    }, ms);
  }

  function stopSlideshow() {
    if (slideshowTimer) {
      clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
  }

  // ---------- galaxy ----------

  // Module-level so we never stack multiple rAF loops (load race used to).
  let galaxyRaf = 0;
  let galaxyStarted = false;

  function startGalaxyScroll() {
    applyStageBackground();
    // Color-only (no image): no pan/crossfade loop
    if (!config.bgImage) return;
    if (!els.galaxyA) return;
    if (galaxyStarted) return; // idempotent — softReload must not re-enter
    galaxyStarted = true;

    // Wall: single-layer pan (scroll on). Solo: dual-layer crossfade when B exists.
    const singleLayer =
      isPreviewWall() || !els.galaxyB || els.galaxyB.hidden;

    const layers = singleLayer
      ? [{ el: els.galaxyA, x: 0 }]
      : [
          { el: els.galaxyA, x: 0 },
          { el: els.galaxyB, x: 0 },
        ];
    let active = 0;
    let lastTs = null;
    let fading = false;
    let fadeUntil = 0;

    function peakOpacity() {
      return bgImageOpacityPeak();
    }

    function layerWidth(layer) {
      const el = layer.el;
      // Prefer laid-out width (includes min-width: 120% etc.) in design px
      if (el.offsetWidth && el.offsetWidth > 0) return el.offsetWidth;
      const nh = el.naturalHeight || 2400;
      const nw = el.naturalWidth || 3600;
      // Use design-space height (stage), not transformed viewport metrics
      const renderedH = STAGE_H * 1.2;
      return (nw / nh) * renderedH;
    }

    /**
     * Visible galaxy region differs by board:
     * - bowls/handhelds/munchies: right of the left-frame cutout (frame hides left edge)
     * - drinks: left of the right-frame cutout (left edge is fully exposed — must stay off-screen)
     */
    function initialX(layer) {
      const w = layerWidth(layer);
      if (isDrinks) {
        // Start with the image shifted left so its right edge still covers the
        // panel cutout, leaving maximum room to pan right without ever
        // bringing the photo's left edge into the open galaxy area.
        const coverRight = CUTOUT_RIGHT_BOARD + 60;
        const edgePad = 80; // keep left edge this many px past stage left (≤ -edgePad)
        return Math.min(-edgePad, coverRight - w);
      }
      // Start fully covering the stage with spare off the left
      const spare = Math.max(80, w - STAGE_W);
      return -spare * 0.15;
    }

    // When the image's left edge nears the frame cutout, loop
    function maxTravel() {
      if (isDrinks) {
        // Crossfade before the photo's left edge enters the stage.
        // Leave headroom for the ~1.2s crossfade (still drifts +dx).
        const speed = BASE_SCROLL_PX_PER_SEC * (config.bgScrollSpeed || 1);
        const fadeDrift = speed * (FADE_DURATION_MS / 1000) + 24;
        return -Math.max(48, fadeDrift);
      }
      return CUTOUT_LEFT - 80;
    }

    function apply(layer) {
      layer.el.style.transform =
        "translate3d(" + layer.x + "px, -50%, 0)";
    }

    function setOpacity(el, value, withTransition) {
      if (withTransition) {
        el.style.transition = "opacity " + FADE_DURATION_MS + "ms ease-in-out";
      } else {
        el.style.transition = "none";
      }
      el.style.opacity = String(value);
    }

    function prepareLayer(layer, x, visible) {
      layer.x = x;
      apply(layer);
      layer.el.classList.remove("active", "fading-in", "fading-out");
      setOpacity(layer.el, visible ? peakOpacity() : 0, false);
      // Force style flush so the next opacity transition isn't skipped
      void layer.el.offsetWidth;
      layer.el.style.transition = "";
    }

    function onReady() {
      if (singleLayer) {
        prepareLayer(layers[0], initialX(layers[0]), true);
        layers[0].el.classList.add("active");
        tokiInfo("galaxy: single-layer pan (preview-wall)");
      } else {
        prepareLayer(layers[0], initialX(layers[0]), true);
        prepareLayer(layers[1], initialX(layers[1]), false);
        layers[0].el.classList.add("active");
        tokiInfo("galaxy: dual-layer pan + crossfade");
      }
      lastTs = null;
      if (galaxyRaf) cancelAnimationFrame(galaxyRaf);
      galaxyRaf = requestAnimationFrame(tick);
    }

    // Wait for natural dimensions once; never start two loops
    const img = els.galaxyA;
    if (img.complete && img.naturalWidth) {
      onReady();
    } else {
      img.addEventListener(
        "load",
        function onLoad() {
          onReady();
        },
        { once: true }
      );
    }

    // After tab sleep, don't apply a multi-second dt spike (belt + suspenders)
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) lastTs = null;
    });

    function beginCrossfade(now) {
      if (singleLayer || fading || layers.length < 2) return;
      fading = true;
      fadeUntil = now + FADE_DURATION_MS;

      const from = layers[active];
      const to = layers[1 - active];

      // Position the incoming copy while fully transparent, THEN fade.
      // Without this order, you briefly see a teleported pan of the photo.
      prepareLayer(to, initialX(to), false);

      from.el.classList.remove("active", "fading-in");
      to.el.classList.remove("fading-out");

      // Next frame: enable transitions and crossfade (peak = sheet opacity)
      requestAnimationFrame(function () {
        setOpacity(to.el, peakOpacity(), true);
        setOpacity(from.el, 0, true);
        to.el.classList.add("fading-in");
        from.el.classList.add("fading-out");
      });
    }

    function finishCrossfade() {
      if (singleLayer || layers.length < 2) return;
      const from = layers[active];
      const to = layers[1 - active];

      from.el.classList.remove("fading-out");
      to.el.classList.remove("fading-in");
      to.el.classList.add("active");
      setOpacity(from.el, 0, false);
      setOpacity(to.el, peakOpacity(), false);

      active = 1 - active;
      fading = false;
      fadeUntil = 0;
    }

    function tick(ts) {
      galaxyRaf = requestAnimationFrame(tick);

      if (lastTs == null) {
        lastTs = ts;
        return;
      }

      // Cap dt so background tabs / debugger pauses can't teleport the BG
      const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
      lastTs = ts;
      if (dt === 0) return;

      const speed = BASE_SCROLL_PX_PER_SEC * (config.bgScrollSpeed || 1);
      const dx = speed * dt;

      // Keep both layers moving in lockstep during a crossfade so the blend
      // doesn't shear apart (old code only moved active + incoming, but
      // after swap the parked layer could be far out of date).
      if (fading && !singleLayer && layers.length > 1) {
        layers[0].x += dx;
        layers[1].x += dx;
        apply(layers[0]);
        apply(layers[1]);
        if (ts >= fadeUntil) finishCrossfade();
      } else {
        const cur = layers[active];
        cur.x += dx;
        apply(cur);

        if (cur.x >= maxTravel() - 10) {
          if (singleLayer) {
            // Loop by snapping back (no second texture for seamless crossfade)
            cur.x = initialX(cur);
            apply(cur);
          } else {
            beginCrossfade(ts);
          }
        }
      }
    }
  }

  /**
   * Fit the fixed 1920×1080 stage into the viewport, letterboxed and centered.
   * Tall pages (portrait monitors/phones): scale by width, equal bars top/bottom.
   * Wide pages: scale by height, equal bars left/right.
   * (Column-stack “vertical wall” logic lives only in preview-all.html.)
   */
  function scaleStageToWindow() {
    if (!els.stage) return;
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    if (!sw || !sh) return;

    const scale = Math.min(sw / STAGE_W, sh / STAGE_H);
    if (!(scale > 0)) return;

    // Center origin is reliable on tall viewports; top-left + translate can
    // read as “stuck to the top” on some WebViews.
    els.stage.style.top = "50%";
    els.stage.style.left = "50%";
    els.stage.style.right = "auto";
    els.stage.style.bottom = "auto";
    els.stage.style.margin = "0";
    els.stage.style.transformOrigin = "center center";
    els.stage.style.transform =
      "translate(-50%, -50%) scale(" + scale + ")";
  }

  function itemsSignature() {
    return JSON.stringify({
      title: config.title,
      main: config.mainColor,
      secondary: config.secondaryColor,
      bgMode: config.bgMode,
      bgColor: config.bgColor,
      bgImage: config.bgImage,
      bgSolid: config.bgSolid,
      bgBlur: config.bgBlur,
      bgBlendMode: config.bgBlendMode,
      bgOpacity: config.bgOpacity,
      bg: config.bgScrollSpeed,
      speed: config.slideshowSpeed,
      hl: config.highlight,
      hln: config.highlightSpecial,
      s1: config.stripeColor1,
      s2: config.stripeColor2,
      includeStripes: config.includeStripes,
      annBg: config.announcementBg,
      annImg: config.announcementBgImage,
      proteinBg: config.proteinBoxBg,
      proteinImg: config.proteinBoxImage,
      saucesBg: config.saucesBoxBg,
      saucesImg: config.saucesBoxImage,
      drinkBg: config.drinkBoxBg,
      drinkImg: config.drinkBoxImage,
      overview: config.drinksOverview,
      individual: config.drinksIndividual,
      overviewImage: config.overviewImage,
      items: items.map((it) => [
        it.name,
        it.price,
        it.description,
        it.subtitle,
        it.isNew,
        it.image,
      ]),
      protein: proteinBox,
      sauces: saucesBox,
      announcement: announcementBox,
      drinkBox: drinkBox,
      fills: sheetFills,
    });
  }

  async function softReload() {
    const prevIndex = activeIndex;
    try {
      // Soft: re-fetch CSVs only. No embedded/xlsx fallback if offline.
      // Unchanged fingerprint → skip re-render. Network error → keep last UI.
      const source = await loadMenu({ soft: true });
      if (source === "unchanged") return;
      tokiInfo("refreshed from", source);
      const pause =
        new URLSearchParams(window.location.search).get("pause") === "1";
      stopSlideshow();
      stopAnnouncementSlideshow();
      renderTitle();
      renderList();
      renderFooterBoxes(); // includes fitFooterBoxes()
      applyStageBackground();
      // Image may be enabled after a color-only load — start pan if needed
      if (config.bgImage) startGalaxyScroll();
      const maxIdx = isDrinks
        ? Math.max(0, slides.length - 1)
        : Math.max(0, items.length - 1);
      setActive(Math.min(prevIndex, maxIdx), true);
      if (!pause) {
        startSlideshow();
        if (isDrinks) startAnnouncementSlideshow();
      }
    } catch (err) {
      // Offline / incomplete fetch: leave slideshow + items as-is
      tokiWarn("refresh: keeping last good menu —", err && err.message ? err.message : err);
    }
  }

  /** 0–3 board index in the 4-up wall (from ?wall=); 0 if solo. */
  function wallBoardIndex() {
    try {
      const n = parseInt(
        new URLSearchParams(location.search || "").get("wall"),
        10
      );
      if (Number.isFinite(n) && n >= 0 && n <= 3) return n;
    } catch (e) {}
    return 0;
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    const sec = Number(cfg.refreshSeconds) || 0;
    if (sec <= 0) return;
    // Refresh for google + local xlsx; skip only pure embedded offline
    if (
      dataSource === "embedded" &&
      !(cfg.googleSheetId || "").trim() &&
      resolvedDataSource() !== "local"
    ) {
      return;
    }
    const arm = function () {
      refreshTimer = setInterval(softReload, sec * 1000);
    };
    // Wall: stagger first tick so all four boards don't refetch in the same
    // frame every 30s (Fix 2). Interval stays refreshSeconds after that.
    if (isPreviewWall()) {
      const delayMs = wallBoardIndex() * 7000;
      tokiInfo(
        "auto-refresh wall stagger",
        wallBoardIndex(),
        "delayMs=",
        delayMs,
        "intervalSec=",
        sec
      );
      window.setTimeout(function () {
        softReload();
        arm();
      }, delayMs);
      return;
    }
    arm();
  }

  // ---------- boot ----------

  async function init() {
    if (isPreviewWall()) {
      document.documentElement.classList.add("preview-wall");
      document.body.classList.add("preview-wall");
      tokiInfo("preview-wall mode: lean GPU path, per-board BG scroll");
    }
    if (isBowls) {
      document.body.classList.add("board-bowls");
    }
    if (isHandhelds) {
      document.body.classList.add("board-handhelds");
    }
    if (isMunchies) {
      document.body.classList.add("board-munchies");
    }
    if (isDrinks) {
      document.body.classList.add("board-drinks");
    }
    if (cfg.showHero === false && els.heroWrap) {
      els.heroWrap.hidden = true;
    } else if (els.heroWrap) {
      els.heroWrap.hidden = false;
    }
    if (cfg.showDisclaimer === false && els.disclaimer) {
      els.disclaimer.hidden = true;
    }
    applyDisclaimerContent();

    scaleStageToWindow();
    window.addEventListener("resize", () => {
      scaleStageToWindow();
      fitTitle();
      fitMenuText();
      syncFooterBoxShells();
      fitFooterBoxes();
      if (isDrinks) fitDrinksBoxes();
    });

    try {
      tokiInfo("loadMenu start");
      const source = await loadMenu();
      tokiInfo(
        "loaded from",
        source,
        "layout=" + (cfg.layout || "bowls"),
        "items=" + (items && items.length),
        "bgImage=" + (config.bgImage || "(none)")
      );
    } catch (err) {
      tokiError("loadMenu failed", err);
      els.title.textContent = "Menu unavailable";
      startGalaxyScroll();
      return;
    }

    renderTitle();
    renderList();
    renderFooterBoxes();

    const params = new URLSearchParams(window.location.search);
    const hashMatch = (window.location.hash || "").match(/item=(\d+)/i);
    const startRaw = params.get("item") || (hashMatch ? hashMatch[1] : null);
    if (startRaw != null) {
      const idx = parseInt(startRaw, 10);
      if (Number.isFinite(idx)) setActive(idx, true);
      else setActive(0, true);
    } else {
      setActive(0, true);
    }

    if (params.get("pause") !== "1") {
      startSlideshow();
      if (isDrinks) startAnnouncementSlideshow();
    } else if (isDrinks) {
      // Still paint first message when paused
      setAnnouncementMessage(announcementIndex, { instant: true });
    }
    startGalaxyScroll();
    startAutoRefresh();

    function refitAll() {
      fitTitle();
      fitMenuText();
      fitFooterBoxes();
      if (isDrinks) fitDrinksBoxes();
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(refitAll);
    }
    // Extra passes: fonts/layout can settle after first paint (esp. Condensed)
    window.setTimeout(refitAll, 50);
    window.setTimeout(refitAll, 250);
    window.setTimeout(refitAll, 600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

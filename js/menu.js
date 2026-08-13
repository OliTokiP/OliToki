/**
 * TokiMenu — spreadsheet-driven animated menu board (1920×1080)
 *
 * Supports layouts: bowls | handhelds | munchies | drinks via TOKI_CONFIG.
 *
 * Data sources (see js/data-source.js — TOKI_DATA_SOURCE):
 *  "local"  → Menu.xlsx cell values only (fills/fonts/rich quarantined)
 *  "google" → live Google Sheet values via /api/sheets/csv (API-only)
 *  fallbacks: local xlsx values → embedded (when google fails or is unset)
 *  Cell fills / rich text: deprecated/sheet-styles/ — not loaded.
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
   * Presentation motion mode (see docs/MOTION_QUARANTINE.md).
   * "static" — snap images, highlight opacity only (debug / fallback).
   * "engine" — Beta Features → Motion table drives Ken Burns (and later Encore).
   * Legacy motion remains in-file for inspiration; live path is engine or static.
   */
  let PRESENTATION_MOTION_MODE = "engine";

  /**
   * Family Portrait overview highlight (Alpha header/title + Box shell).
   * false = off (current). true = restore the old chrome.
   * Implementation: armFpOverviewHighlight / fadeFp* / CSS
   *   body.fp-alpha-header-hl  (Alpha header fill + title/logo → Secondary)
   *   .fp-shell-hl             (Box shell fill → Highlight)
   *   FP_ALPHA_OVERVIEW_HL     ("header" | "title") when this is on
   * See docs/FAMILY_PORTRAIT_LATTICE.md §7.
   */
  const FP_OVERVIEW_HIGHLIGHT = false;

  /**
   * Alpha Family Portrait overview chrome (easy flip — Alpha only).
   * Box-segment FP always uses box shell shape (not this switch).
   * Ignored while FP_OVERVIEW_HIGHLIGHT is false.
   *
   *   "header" — simultaneous Punch-Out ease (default, bold):
   *                #frame .frame-header fill → Highlight
   *                #menu-title color         → Secondary
   *                #logo stroke + eyes       → Secondary
   *   "title"  — only #menu-title color → Highlight (legacy title-only)
   */
  const FP_ALPHA_OVERVIEW_HL = "header";

  /** Separator used when a menu item has multiple prices (e.g. S $7.95 | M $12.45) */
  const MULTI_PRICE_SEPARATOR = " | ";

  function isPresentationStatic() {
    return PRESENTATION_MOTION_MODE === "static";
  }

  function isPresentationEngine() {
    return PRESENTATION_MOTION_MODE === "engine";
  }

  function fpAlphaOverviewIsHeader() {
    return String(FP_ALPHA_OVERVIEW_HL || "header").toLowerCase() !== "title";
  }

  /**
   * Defaults only if Beta Features → Motion row is missing.
   * Must match live Motion grid (Ken Burns / Slideshow rows), not invent longer holds.
   */
  const MOTION_DEFAULTS_KEN_BURNS = {
    name: "Ken Burns",
    windUp: 0,
    punchIn: 3.4,
    hold: 1,
    punchOut: 0.45,
    windDown: 0,
    zoomMin: 0.93,
    zoomMax: 1,
  };

  /** Slideshow = same phase digits as Ken Burns, but no scale zoom (opacity only). */
  const MOTION_DEFAULTS_SLIDESHOW = {
    name: "Slideshow",
    windUp: 0,
    punchIn: 3.4,
    hold: 1,
    punchOut: 0.45,
    windDown: 0,
    zoomMin: 1,
    zoomMax: 1,
  };

  /** name → motion style from Beta Features → Motion */
  let motionStylesByName = {};

  /**
   * Encore bespoke multipliers (sheet digits stay authoritative; these only scale).
   * ENCORE_VEIL_IN_MULT — veil *fade-in* = phaseSeconds × mult (zoom/phase wait unchanged).
   * ENCORE_HOLD_MULT — Hold dwell = sheet Hold × mult (entrance/exit unchanged).
   * FP on an Encore segment inherits this Hold scale automatically.
   */
  const ENCORE_VEIL_IN_MULT = 0.5;
  const ENCORE_HOLD_MULT = 0.5;

  function encoreVeilInSeconds(phaseSec) {
    const p = Number(phaseSec);
    const base = Number.isFinite(p) && p > 0 ? p : 0.45;
    const m =
      Number.isFinite(ENCORE_VEIL_IN_MULT) && ENCORE_VEIL_IN_MULT > 0
        ? ENCORE_VEIL_IN_MULT
        : 1;
    return Math.max(0.05, base * m);
  }

  function encoreHoldSeconds(sheetHold) {
    const h = Number(sheetHold);
    const base = Number.isFinite(h) && h > 0 ? h : 0;
    const m =
      Number.isFinite(ENCORE_HOLD_MULT) && ENCORE_HOLD_MULT > 0
        ? ENCORE_HOLD_MULT
        : 1;
    return Math.max(0, base * m);
  }

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

  /**
   * Prefer WebP when the path is a common raster. Sheet/source may still say
   * .png/.jpg — we request .webp (masters kept as fallback via attachWebpFallback).
   */
  function toWebpPath(path) {
    if (path == null || path === "") return path;
    const s = String(path);
    if (/\.webp$/i.test(s)) return s;
    if (/\.(png|jpe?g|gif)$/i.test(s)) {
      return s.replace(/\.(png|jpe?g|gif)$/i, ".webp");
    }
    return s;
  }

  /**
   * DEBUG: runtime pixel downsample after load (not CSS scale).
   *   ?imgScale=0.01  → 1/100 resolution extreme test
   *   ?imgScale=0.25  → quarter res, etc.
   *   omit / 0 / 1    → off
   * Replaces img.src with a tiny canvas data-URL so GPU holds fewer texels.
   */
  function debugImgScaleFactor() {
    try {
      const q = new URLSearchParams(location.search || "");
      if (!q.has("imgScale")) return 0;
      const raw = q.get("imgScale");
      // bare ?imgScale → extreme 1/100 test
      if (raw === "" || raw == null) return 0.01;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n >= 1) return 0;
      return n;
    } catch (e) {
      return 0;
    }
  }
  const DEBUG_IMG_SCALE = debugImgScaleFactor();
  if (DEBUG_IMG_SCALE > 0 && DEBUG_IMG_SCALE < 1) {
    console.info(
      "[TokiMenu] DEBUG imgScale=" +
        DEBUG_IMG_SCALE +
        " — runtime downsample ON (looks terrible on purpose)"
    );
  }

  /**
   * URL pin for AbleSign / Fire Stick HD (WebView often reports 3840×2160 dpr2
   * on a 1080p stick). ?w=1920&dpr=1 or ?display=1920x1080.
   * See docs/SUPPORTED_DEVICES.md.
   */
  function displayBudgetOverrideFromUrl() {
    try {
      const q = new URLSearchParams(location.search || "");
      let w = 0;
      let h = 0;
      let dpr = 0;
      const disp = q.get("display") || "";
      const dm = String(disp).match(/^(\d+)\s*[x×]\s*(\d+)/i);
      if (dm) {
        w = Number(dm[1]);
        h = Number(dm[2]);
      }
      const wRaw = q.get("w") || q.get("width");
      const hRaw = q.get("h") || q.get("height");
      const dRaw = q.get("dpr");
      if (wRaw != null && wRaw !== "") w = Number(wRaw);
      if (hRaw != null && hRaw !== "") h = Number(hRaw);
      if (dRaw != null && dRaw !== "") dpr = Number(dRaw);
      if (!(w > 0) && !(h > 0) && !(dpr > 0)) return null;
      if (!(w > 0) && h > 0) w = Math.round((h * 16) / 9);
      if (!(h > 0) && w > 0) h = Math.round((w * 9) / 16);
      if (!(dpr > 0)) dpr = 1;
      if (dpr > 2) dpr = 2;
      return { w: w, h: h, dpr: dpr };
    } catch (e) {
      return null;
    }
  }

  /**
   * Live measure (CSS box × dpr). Playtime uses freezeDisplayBudget() so
   * window drag does not rebuild rasters.
   */
  function computeDisplayPixelBudget() {
    const pinned = displayBudgetOverrideFromUrl();
    if (pinned && pinned.w > 0 && pinned.h > 0) {
      return {
        w: pinned.w * pinned.dpr,
        h: pinned.h * pinned.dpr,
        dpr: pinned.dpr,
      };
    }
    let w = window.innerWidth || 1920;
    let h = window.innerHeight || 1080;
    try {
      const stage = document.getElementById("stage");
      if (stage && stage.getBoundingClientRect) {
        const r = stage.getBoundingClientRect();
        if (r.width > 8 && r.height > 8) {
          w = r.width;
          h = r.height;
        }
      }
    } catch (e) {
      /* keep inner* */
    }
    let dpr = 1;
    try {
      dpr = window.devicePixelRatio || 1;
    } catch (e2) {
      dpr = 1;
    }
    if (dpr > 2) dpr = 2;
    if (pinned && pinned.dpr > 0) dpr = pinned.dpr;
    return { w: w * dpr, h: h * dpr, dpr: dpr };
  }

  let _displayBudgetFrozen = null;

  function freezeDisplayBudget() {
    if (_displayBudgetFrozen) return _displayBudgetFrozen;
    _displayBudgetFrozen = computeDisplayPixelBudget();
    tokiInfo("display budget frozen", _displayBudgetFrozen);
    return _displayBudgetFrozen;
  }

  function displayPixelBudget() {
    return _displayBudgetFrozen || computeDisplayPixelBudget();
  }

  const _rasterBakeCache = {};

  function rasterBakeKey(path, tw, th) {
    return String(path || "") + "|" + tw + "x" + th;
  }

  /** Canonical texel target. gridN 0 = full stage; 1 = solo hero; 2+ = lattice cell. */
  function bakeTargetPx(gridN) {
    const b = displayPixelBudget();
    const slack = 1.28;
    const n = Number(gridN) || 0;
    if (n <= 0) {
      return {
        w: Math.max(1, Math.round(b.w * slack)),
        h: Math.max(1, Math.round(b.h * slack)),
      };
    }
    if (n >= 2 && typeof buildPortraitLayout === "function") {
      const layout = buildPortraitLayout(n, PORTRAIT_STAGE_W, PORTRAIT_STAGE_H);
      const sx = b.w / STAGE_W;
      const sy = b.h / STAGE_H;
      return {
        w: Math.max(
          1,
          Math.round(PORTRAIT_IMG_W * layout.scale * sx * slack)
        ),
        h: Math.max(
          1,
          Math.round(PORTRAIT_IMG_H * layout.scale * sy * slack)
        ),
      };
    }
    return {
      w: Math.max(1, Math.round(b.w * 0.58 * slack)),
      h: Math.max(1, Math.round(b.h * 0.88 * slack)),
    };
  }

  function peekRasterBake(path, gridN) {
    if (!path) return null;
    const t = bakeTargetPx(gridN);
    return _rasterBakeCache[rasterBakeKey(path, t.w, t.h)] || null;
  }

  function putRasterBake(path, gridN, entry) {
    if (!path || !entry) return;
    const t = bakeTargetPx(gridN);
    _rasterBakeCache[rasterBakeKey(path, t.w, t.h)] = entry;
  }

  /**
   * How many texels this <img> should hold (frozen budget, not live resize).
   */
  function displayNeedForImg(img) {
    const gridN = parseInt(
      (img && img.dataset && img.dataset.tokiGridN) || "0",
      10
    );
    const id = (img && img.id) || "";
    const cls = (img && img.className) || "";
    if (
      id === "galaxy-a" ||
      id === "galaxy-b" ||
      (typeof cls === "string" && cls.indexOf("family-portrait-bg-img") !== -1)
    ) {
      const t = bakeTargetPx(0);
      return { dw: t.w, dh: t.h };
    }
    const t = bakeTargetPx(gridN >= 2 ? gridN : 1);
    return { dw: t.w, dh: t.h };
  }

  /**
   * After decode, redraw to painted size and swap src (once per element).
   * ?imgScale= still forces a debug fraction. Otherwise shrink only when the
   * bitmap is meaningfully larger than the window (e.g. 3600px galaxy on 1080p).
   * @param {HTMLImageElement} img
   * @param {function():void} [then]
   */
  function maybeDownsampleImg(img, then) {
    const done = typeof then === "function" ? then : function () {};
    if (!img) {
      done();
      return;
    }
    if (img.dataset.downsampled === "1") {
      done();
      return;
    }
    const master0 = (img.dataset && img.dataset.tokiMaster) || "";
    const grid0 = parseInt((img.dataset && img.dataset.tokiGridN) || "1", 10) || 1;
    const baked0 = peekRasterBake(master0, grid0 >= 2 ? grid0 : 1);
    if (baked0 && baked0.url) {
      img.dataset.downsampled = "1";
      if (baked0.from) img.dataset.tokiFrom = baked0.from;
      if (baked0.px) img.dataset.tokiPx = baked0.px;
      if ((img.getAttribute("src") || "") !== baked0.url) {
        img.onload = function () {
          img.onload = null;
          done();
        };
        img.src = baked0.url;
      } else {
        done();
      }
      return;
    }
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (nw < 2 || nh < 2) {
      done();
      return;
    }
    let w;
    let h;
    const debug = DEBUG_IMG_SCALE > 0 && DEBUG_IMG_SCALE < 1;
    if (debug) {
      w = Math.max(1, Math.round(nw * DEBUG_IMG_SCALE));
      h = Math.max(1, Math.round(nh * DEBUG_IMG_SCALE));
    } else {
      if (nw < 256 && nh < 256) {
        done();
        return;
      }
      const need = displayNeedForImg(img);
      if (nw <= need.dw * 1.05 && nh <= need.dh * 1.05) {
        done();
        return;
      }
      const scale = Math.min(1, need.dw / nw, need.dh / nh);
      if (!(scale > 0) || scale >= 0.92) {
        done();
        return;
      }
      w = Math.max(1, Math.round(nw * scale));
      h = Math.max(1, Math.round(nh * scale));
    }
    try {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) {
        done();
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, 0, 0, w, h);
      img.dataset.downsampled = "1";
      img.dataset.tokiFrom = nw + "x" + nh;
      img.dataset.tokiPx = w + "x" + h;
      let dataUrl;
      try {
        dataUrl = c.toDataURL("image/webp", 0.82);
        if (!dataUrl || dataUrl.indexOf("image/webp") === -1) {
          dataUrl = c.toDataURL("image/png");
        }
      } catch (e1) {
        dataUrl = c.toDataURL("image/png");
      }
      if (master0) {
        putRasterBake(master0, grid0 >= 2 ? grid0 : 1, {
          url: dataUrl,
          from: nw + "x" + nh,
          px: w + "x" + h,
        });
      }
      img.onload = function () {
        img.onload = null;
        done();
      };
      img.src = dataUrl;
    } catch (e) {
      console.warn("downsample failed", e);
      done();
    }
  }

  function stampRasterMaster(img, path) {
    if (!img) return;
    img.dataset.tokiMaster = path || "";
    img.dataset.tokiFrom = "";
    img.dataset.tokiPx = "";
    img.dataset.downsampled = "";
  }

  /**
   * Load one hero bitmap, then downsample. Uses addEventListener so
   * maybeDownsampleImg cannot overwrite img.onload and stall the engine.
   */
  function loadHeroRaster(img, src, onOk, onFail) {
    const ok = typeof onOk === "function" ? onOk : function () {};
    const fail = typeof onFail === "function" ? onFail : function () {};
    if (!img || !src) {
      fail();
      return;
    }
    const heroNeed = bakeTargetPx(1);
    src = preferFoodPathForNeed(src, heroNeed.w, heroNeed.h);
    const baked = peekRasterBake(src, 1);
    if (baked && baked.url) {
      stampRasterMaster(img, src);
      img.dataset.downsampled = "1";
      if (baked.from) img.dataset.tokiFrom = baked.from;
      if (baked.px) img.dataset.tokiPx = baked.px;
      img.src = baked.url;
      ok();
      return;
    }
    const sameFile =
      (img.dataset.tokiMaster || "") === src &&
      img.complete &&
      img.naturalWidth > 0;
    if (sameFile) {
      ok();
      return;
    }
    let settled = false;
    function succeed() {
      if (settled) return;
      settled = true;
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onErr);
      maybeDownsampleImg(img, ok);
    }
    function onLoad() {
      succeed();
    }
    function onErr() {
      if (settled) return;
      // webp fallback may still recover — only fail if src is not a candidate
      const now = img.getAttribute("src") || "";
      if (/\.webp$/i.test(now) || /\.png$/i.test(now)) return;
      settled = true;
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onErr);
      fail();
    }
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onErr);
    attachWebpFallback(img);
    stampRasterMaster(img, src);
    img.src = src;
    if (
      img.getAttribute("src") === src &&
      img.complete &&
      img.naturalWidth > 0
    ) {
      succeed();
    }
  }

  /** Wire load → maybeDownsampleImg (idempotent). */
  function bindDownsampleOnLoad(img) {
    if (!img) return;
    if (img.dataset.downsampled === "1") return;
    if (img.complete && img.naturalWidth) {
      maybeDownsampleImg(img);
      return;
    }
    img.addEventListener(
      "load",
      function onLoad() {
        maybeDownsampleImg(img);
      },
      { once: true }
    );
  }

  /**
   * Downsample stickers / scaffold BG / galaxy layers after paint.
   */
  function downsampleAuxRasters(root) {
    const scope = root || document;
    const sel =
      "#galaxy-a, #galaxy-b, .family-portrait-bg-img, " +
      ".family-portrait-item, " +
      ".new-sticker-shadow, .new-sticker-body-img, " +
      "#family-portrait-stage .new-sticker-shadow, " +
      "#family-portrait-stage .new-sticker-body-img";
    scope.querySelectorAll(sel).forEach(function (img) {
      if (img && img.tagName === "IMG") bindDownsampleOnLoad(img);
    });
  }

  /**
   * If a .webp 404s, try .png then .jpg (one chain per element).
   * Safe when only one format exists.
   */
  function attachWebpFallback(el) {
    if (!el || el.dataset.webpFbBound === "1") return;
    el.dataset.webpFbBound = "1";
    el.addEventListener("error", function onRasterError() {
      if (el.dataset.downsampled === "1") return;
      if (el.dataset.tokiParked === "1") return;
      const src = el.getAttribute("src") || "";
      if (!src) return;
      // food-pics/foo-sm.webp missing → full foo.webp
      if (/-sm\.webp$/i.test(src)) {
        el.src = src.replace(/-sm\.webp$/i, ".webp");
        return;
      }
      if (/-sm\.(png|jpe?g)$/i.test(src)) {
        el.src = src.replace(/-sm\.(png|jpe?g)$/i, ".webp");
        return;
      }
      if (/\.webp$/i.test(src)) {
        el.src = src.replace(/\.webp$/i, ".png");
        return;
      }
      if (/\.png$/i.test(src)) {
        el.src = src.replace(/\.png$/i, ".jpg");
        return;
      }
      el.removeEventListener("error", onRasterError);
    });
  }

  /** food-pics/foo.webp → food-pics/foo-sm.webp (750×500 masters). */
  function toFoodSmPath(path) {
    if (!path) return path;
    const s = String(path);
    if (!/food-pics\//i.test(s)) return toWebpPath(s);
    if (/-sm\.(webp|png|jpe?g)$/i.test(s)) return s.replace(/\.(png|jpe?g)$/i, ".webp");
    const webp = toWebpPath(s);
    return webp.replace(/\.webp$/i, "-sm.webp");
  }

  /** Use -sm when the painted long edge fits in 750px (50% of 1500×1000). */
  const FOOD_SM_LONG_PX = 750;

  function preferFoodPathForNeed(path, needW, needH) {
    if (!path || !/food-pics\//i.test(path)) return toWebpPath(path);
    const need = Math.max(Number(needW) || 0, Number(needH) || 0);
    if (need > FOOD_SM_LONG_PX * 1.08) return toWebpPath(path);
    return toFoodSmPath(path);
  }

  /**
   * Wallpaper path for this window. 1080p / wall / modest viewports get
   * galaxy-bg-sm (1920×1280) instead of the 3600×2400 master.
   */
  function displayFriendlyBgPath(path) {
    if (!path) return path;
    const s = String(path);
    if (/galaxy-bg-sm|galaxy-bg-xs/i.test(s)) return toWebpPath(s);
    const b = displayPixelBudget();
    const need = Math.max(b.w, b.h);
    const useSm = isPreviewWall() || need <= 1920 * 1.15;
    if (useSm && /galaxy-bg/i.test(s)) {
      return toWebpPath("assets/bgs/galaxy-bg-sm.jpg");
    }
    return toWebpPath(s);
  }

  /** @deprecated name kept — same as displayFriendlyBgPath */
  function wallFriendlyBgPath(path) {
    return displayFriendlyBgPath(path);
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
    // Board 1 inserts Family Portrait at K and shifts box includes +1.
    // Boards 2–3 keep protein at 10 via their own config.columns.
    familyPortrait: null,
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

  /**
   * Board Revised tabs (gids 1058015863 / 314919644 / 1684494006) — restructured (Settings block at top for singles; Inventory headers below for items).
   * Settings block (label → headers → 1 data row) at top for single selections:
   *   Menu Title, Family Portrait, Presentation Mode, Include * Box?, Columns?
   * Inventory (expanding glossary) has headers below the Settings data:
   *   Item | Price 1 | ... | Include
   * (No per-item FP / box includes; those live only in top Settings.)
   */
  const BOARD_REVISED_GIDS = ["1058015863", "314919644", "1684494006"]; // Board 1/2/3 Revised gids (structure: Settings top + Inventory)
  const BOARD_REVISED_SETTINGS = {
    title: 0,
    familyPortrait: 1,
    presentationMode: 2, // Slideshow | Encore | Static (grid of all photos, ignores FP)
    includeFooterBoxes: 3,   // comma list e.g. "Proteins, Sauces, Veggies" — replaces the old individual Include*? flags
    // columns 4 and 5 are currently empty/spacers in the Settings row
    includeDescriptions: 6,
    menuColumns: 7,
  };
  const BOARD_REVISED_INVENTORY = {
    item: 0,
    price1: 1,
    price2: 2,
    price3: 3,
    subtitle: 4,
    description: 5,
    isNew: 6,
    image: 7,
    include: 8,
  };

  /**
   * Board 4 Announcements tab (gid 149404218) — Settings + message Inventory.
   * Live Settings only: A Title | B Include Footer Box | C BG Pattern (None|Stripes).
   * Old C BG Color / D Pattern / E–F stripe colors are dead — do not read.
   * Inventory (headers under Settings data; may omit "Inventory" label):
   *   Announcement Title | Subtitle | Text | Box Color | Speed |
   *   Motion Style | Motion Setting
   */
  const ANNOUNCEMENTS_REVISED_GID = "149404218";
  const ANN_REVISED_SETTINGS = {
    title: 0,
    includeFooterBox: 1, // singular: "Drinks" | "Proteins" | "Sauces" | "Veggies" | blank/none
    bgPattern: 2, // None | Stripes
  };
  const ANN_REVISED_INVENTORY = {
    announcementTitle: 0,
    announcementSubtitle: 1,
    announcementCopy: 2,
    announcementColor: 3,
    announcementSpeed: 4,
    motionStyle: 5,
    motionSetting: 6,
  };

  /**
   * Uniform column layout for shared footer boxes (Proteins / Sauces / Drinks / Veggies).
   * Settings (label → headers → data row):
   *   A Title | B Subtitle | C BG Color | D Create Columns? | E Text Align | F Priority
   *   G Include in Presentation? | H Family Portrait | I Presentation Mode
   * Inventory:
   *   A Item | B Item Subtitle | C Item Price | D New | E Image | F Include
   *
   * Priority (F): lower number = higher priority — strip order AND presentation cue order.
   * Alpha menu is implicit Priority 0 (not in the sheet).
   * Include in Presentation (G): box runs its own FP + Slideshow/Encore after Alpha.
   * Image (E): resolved for hero/FP; blank → text-only highlight during that item’s beat.
   */
  const BOX_REVISED_SETTINGS = {
    title: 0,
    subtitle: 1,
    bgColor: 2,
    createColumns: 3,
    textAlign: 4,
    priority: 5, // F — strip + presentation order (lower = higher priority)
    includeInPresentation: 6, // G
    familyPortrait: 7, // H
    presentationMode: 8, // I — Slideshow | Encore | Static (grid of all photos, ignores FP)
  };
  const BOX_REVISED_INVENTORY = {
    item: 0,
    itemSubtitle: 1,
    price: 2,
    isNew: 3,
    image: 4,
    include: 5,
  };
  /**
   * Default Priority when Settings F is blank.
   * Semantics: lower number = higher priority.
   *   1 = leftmost / major (when two boxes)
   *   For three boxes: lowest number appears leftmost.
   * These defaults keep the traditional Protein-left layout.
   */
  const FOOTER_PRIORITY_DEFAULTS = {
    protein: 1,
    sauces: 2,
    drinks: 3,
  };

  /**
   * Legacy Style & Theme tab (gid 1076652078, now "Style and Theme (old)") — flat layout:
   * Theme palette (selected row — Theme Selector in col A):
   *   A Theme Selector | B Theme Name | C Main | D Secondary |
   *   E Highlight | F Highlight Special
   * Board-wide (first data row = sheet row 2, not per theme):
   *   G2 BG Color | H2 BG Image | I2 BG Blur | J2 BG Blend Mode |
   *   K2 BG Opacity | L2 BG Scroll Speed | M2 Presentation Speed
   *   N Color Picker | O Show Version |
   *   P Encore Spotlight Type (Hard|Hard_Shadow|Soft) | Q Encore Spotlight Color (Black|Highlight)
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
    /** M — Presentation Speed (seconds; 0 = pause). Was “Slideshow Speed”. */
    slideshowSpeed: 12,
    // N Color Picker · O Show Version · P/Q Encore spotlight
    colorPicker: 13,
    showVersion: 14,
    encoreSpotlightType: 15,
    encoreSpotlightColor: 16,
  };

  /**
   * Style and Theme (gid 183083022, revised) — sectioned layout (verified live API).
   * See docs/SHEET_MIGRATION.md § Style and Theme (revised) layout.
   *
   * Settings (rows: section label → column headers → ONE values row):
   *   A Theme Selector | B BG Color | C BG Pattern | D BG Wallpaper |
   *   E BG Blur | F BG Blend Mode | G BG Opacity | H BG Scroll Speed |
   *   I Presentation Speed | J Show Github Version |
   *   K Encore Spotlight Type | L Encore Spotlight Color
   *
   * Themes Database (rows: section label → headers → theme rows):
   *   A Theme Name | B Main | C Secondary | D Highlight | E Highlight Special
   *   (F+ are Styles Glossary lists — ignore for theme application)
   *
   * When columns are inserted in Settings, shift every index AFTER the insert.
   */
  const STYLE_REVISED_GID = "183083022"; // "Style and Theme" tab (revised layout)
  /** Central Beta Features tab (fallback for Include Footer Boxes if not present on the board row). */
  const BETA_FEATURES_GID = "1710200195";
  const STYLE_REVISED_SETTINGS = {
    themeSelector: 0,
    bgColor: 1,
    bgPattern: 2, // wired (re-uses announcement stripe anim)
    bgImage: 3, // BG Wallpaper
    bgBlur: 4,
    bgBlendMode: 5,
    bgOpacity: 6,
    bgScrollSpeed: 7,
    slideshowSpeed: 8,
    showVersion: 9,
    encoreSpotlightType: 10,
    encoreSpotlightColor: 11,
  };
  const STYLE_REVISED_THEME = {
    themeName: 0,
    mainColor: 1,
    secondaryColor: 2,
    highlight: 3,
    highlightSpecial: 4,
    // Pattern Color labels live in row 6 (Themes Database first data row) and per-theme rows
    patternColor1: 10,
    patternColor2: 11,
  };
  /** Excel row 2 = first data row (index 1) on legacy Style tab */
  const STYLE_BOARD_WIDE_ROW_INDEX = 1;
  /** Default allergy copy (HTML uses &lt;br /&gt; between lines). */
  const DEFAULT_DISCLAIMER_HTML =
    "Before placing your order, please inform us if you have a food allergy.<br />" +
    "Consuming raw or undercooked food may lead to foodborne illness.";

  const DEFAULT_BG_IMAGE = "assets/bgs/galaxy-bg.webp";
  const BG_IMAGE_FOLDER = "assets/bgs";
  const STICKER_BODY_SRC = "assets/stickers/Sticker-Body.webp";
  const STICKER_SHADOW_SRC = "assets/stickers/Sticker-Shadow.webp";
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
      googleSheetGid: "0", // legacy; board1 now uses 1058015863 via config
      styleThemeGid: "183083022", // Style and Theme (revised)
      proteinSheetGid: null, // shared Protein sheet (all boards)
      saucesSheetGid: null, // shared Sauces (revised uniform)
      drinksSheetGid: null, // board 4 + footer drinks (revised uniform)
      drinksSheetColumns: null, // column map for drinksSheetGid
      veggiesSheetGid: null, // Veggies footer box (new 4th type)
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
    galaxy: document.getElementById("galaxy"),
    title: document.getElementById("menu-title"),
    list: document.getElementById("menu-list"),
    hero: document.getElementById("hero"),
    heroPlate: document.getElementById("hero-plate"),
    heroWrap: document.getElementById("hero-wrap"),
    familyPortrait: document.getElementById("family-portrait-stage"),
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
    // Veggies box (4th footer type, selected via Include Footer Boxes list)
    veggiesTitle: document.getElementById("veggies-title"),
    veggiesSubtitle: document.getElementById("veggies-subtitle"),
    veggiesBody: document.getElementById("veggies-body"),
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
    bgPattern: document.getElementById("bg-pattern"),
    bgPatternTrack: document.getElementById("bg-pattern-track"),
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
    includeStripes: false,
    bgPattern: null,
    patternColor1: "#000000",
    patternColor2: "#ffffff",
    announcementBg: null, // null → Main after theme apply
    proteinBoxBg: null,
    saucesBoxBg: null,
    drinkBoxBg: null,
    drinksOverview: true,
    drinksIndividual: true,
    overviewImage: null,
    familyPortrait: false,
    /** "slideshow" | "encore" — board Presentation Mode column */
    presentationMode: "slideshow",
    /**
     * Slideshow hero Ken Burns (zoom 0.93↔1 between items).
     * On by default; wire to a Style sheet column later.
     */
    slideshowKenBurns: true,
    /** Style P: "hard" | "hard_shadow" | "soft" — Encore spotlight shape */
    encoreSpotlightType: "hard",
    /** Style Q: "black" | "highlight" — veil color (highlight = item highlight) */
    encoreSpotlightColor: "black",
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
    priority: FOOTER_PRIORITY_DEFAULTS.protein,
    includeInPresentation: false,
    familyPortrait: false,
    presentationMode: "slideshow",
  };
  let saucesBox = {
    title: "",
    subtitle: "",
    items: [],
    bg: null,
    include: true,
    createColumns: false, // default: balanced wrap (legacy sauces)
    textAlign: "center",
    priority: FOOTER_PRIORITY_DEFAULTS.sauces,
    includeInPresentation: false,
    familyPortrait: false,
    presentationMode: "slideshow",
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
    priority: FOOTER_PRIORITY_DEFAULTS.drinks,
    includeInPresentation: false,
    familyPortrait: false,
    presentationMode: "slideshow",
  };
  /** New 4th footer box type (Veggies) — selected via the Include Footer Boxes list */
  let veggiesBox = {
    title: "",
    subtitle: "",
    items: [],
    bg: null,
    include: false,
    createColumns: false,
    textAlign: "center",
    priority: 4, // default lower than Drinks (3)
    includeInPresentation: false,
    familyPortrait: false,
    presentationMode: "slideshow",
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
    priority: FOOTER_PRIORITY_DEFAULTS.drinks,
    includeInPresentation: false,
    familyPortrait: false,
    presentationMode: "slideshow",
  };
  /**
   * Board 4 selected footer content key (protein|sauces|drinks|veggies).
   * Content paints into #drink-options-box; presentation is box-only (no Alpha).
   */
  let _board4FooterKey = "drinks";
  /** Slideshow / motion slides (boards 1–3 multi-segment; Board 4 box-only) */
  let slides = [];
  let activeIndex = 0;
  /** Active presentation segment mode ("slideshow"|"encore") — Box Menus may differ from Alpha */
  let _activeSegmentMode = "slideshow";
  /** Last encore bow item (for veil color through zoom-out) */
  let _lastEncoreBowItem = null;
  let _presHandoffTimer = null;
  /** True after first Wind-up is allowed (page visible / fonts / layout ready) */
  let _presSurfaceReady = false;
  /** True while a Wind-down handoff is running (block timer double-advance) */
  let _presHandoffBusy = false;
  /**
   * Presentation advance timer. One clock for every step (Encore, Slideshow,
   * Family Portrait): Style → Presentation Speed from *paint* → next paint.
   */
  let slideshowTimer = null;
  /** True while presentation should keep auto-advancing (startSlideshow…stopSlideshow). */
  let _presentationRunning = false;
  /** performance.now() when the current slide became the active step (clock origin). */
  let _presentationStepStartedAt = 0;
  /** Bumped on every notePresentationStepStart — invalidates stale step timers. */
  let _presentationStepGen = 0;
  /**
   * When true, applyBoardSlideContent must NOT start collage Wind-down again —
   * leaveCurrentSlideThen already ran it between steps (so FP/Encore don't
   * "hold" into the next slide's clock).
   */
  let _skipNextCollageWindDown = false;
  let refreshTimer = null;
  let dataSource = "";

  /** Parsed from Debug Menu sheet (when debugMenuGid configured) */
  let debugConfig = { debugMode: false, features: {} };

  // Transient debug activity flags for accurate "doing work right now" detection
  let kbZoomActive = false;
  let refreshInProgress = false;

  // Direct "activation signal" from the real code that turns features on/off.
  // This is the simple 1/0 the activation sites can just call.
  // The observer (computeActive) is fallback; live state takes precedence for accuracy.
  const liveDebugState = {}; // id -> {active: bool, reason: string}

  function setFeatureActive(id, on, reason) {
    liveDebugState[id] = { active: !!on, reason: reason || (on ? 'activated' : 'deactivated') };
    // Push the change to the live views immediately
    if (shouldShowDebugVisuals()) {
      updateDebugVisuals();
    }
  }
  /** Quarantined xlsx fills — always empty in API-only mode. */
  let sheetFills = {};
  /** Quarantined xlsx fonts — always empty in API-only mode. */
  let sheetFonts = {};
  /** Quarantined xlsx rich-text runs — always empty in API-only mode. */
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

  function hexToRgb(hex) {
    const h = normalizeHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  function rgbToHex(r, g, b) {
    function to2(n) {
      const x = Math.max(0, Math.min(255, Math.round(n)));
      return (x < 16 ? "0" : "") + x.toString(16);
    }
    return "#" + to2(r) + to2(g) + to2(b);
  }

  /** src at `alpha` over dst — same look as CSS opacity without a translucent layer. */
  function blendHexOver(srcHex, dstHex, alpha) {
    const src = hexToRgb(srcHex);
    const dst = hexToRgb(dstHex);
    if (!src) return srcHex;
    if (!dst) return normalizeHex(srcHex) || srcHex;
    const a = Math.max(0, Math.min(1, Number(alpha)));
    const ia = 1 - a;
    return rgbToHex(src.r * a + dst.r * ia, src.g * a + dst.g * ia, src.b * a + dst.b * ia);
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

  /**
   * Per-box image roots (bare sheet filenames). Board Alpha uses cfg.imageFolder.
   * Future: rename folders to match box Titles exactly (see WHATS_NEW / SHEET_MIGRATION).
   */
  const FOOTER_BOX_IMAGE_FOLDERS = {
    protein: "food-pics/proteins",
    sauces: "food-pics/sauces",
    drinks: "food-pics/drinks",
    veggies: "food-pics/veggies",
  };

  /**
   * @param {string} imageName
   * @param {string} [folderOverride] e.g. "food-pics/drinks" for Box Menu inventory
   */
  function resolveImagePath(imageName, folderOverride) {
    if (
      imageName === "" ||
      imageName == null ||
      String(imageName).toLowerCase() === "null"
    ) {
      return null;
    }
    const s = String(imageName).replace(/^\/+/, "").trim();
    if (!s) return null;
    if (s.indexOf("food-pics/") === 0) return toWebpPath(s);
    const folder = String(
      folderOverride || cfg.imageFolder || "food-pics"
    ).replace(/\/+$/, "");
    // Sheet may list "foo.png" or "foo" — attach folder then prefer .webp
    let path = folder + "/" + s;
    if (!/\.(png|jpe?g|gif|webp)$/i.test(s)) {
      path = path + ".webp";
      return path;
    }
    return toWebpPath(path);
  }

  /**
   * Parse the Image cell which may contain a single name or multiple
   * comma/semicolon-separated names (e.g. "PorkDumplings, KimchiDumplings").
   * Extensions are optional (resolveImagePath will prefer .webp).
   * Returns array of cleaned basenames (no leading /).
   */
  function parseImageCell(raw) {
    if (raw === "" || raw == null) return [];
    const s = String(raw).trim();
    if (!s || s.toLowerCase() === "null") return [];
    const parts = s.split(/[,;]/).map(function (p) {
      return p.trim().replace(/[.\s]+$/g, ""); // tolerate trailing . or spaces from copy-paste
    }).filter(Boolean);
    return parts.map(function (p) { return p.replace(/^\/+/, ""); });
  }

  /**
   * All photo URLs for one menu item. Every token is run through
   * resolveImagePath so a leftover basename ("PorkDumplings.png") never
   * becomes img.src (that 404s, flashes the broken-image icon, then vanishes).
   */
  function itemImagePaths(item, folderOverride) {
    if (!item) return [];
    const tokens = [];
    function pushToken(x) {
      if (x == null || x === "") return;
      const s = String(x).trim();
      if (!s || s.toLowerCase() === "null") return;
      if (s.indexOf("food-pics/") === 0) {
        tokens.push(s);
        return;
      }
      const parts = parseImageCell(s);
      if (parts.length) {
        for (let i = 0; i < parts.length; i++) tokens.push(parts[i]);
      } else {
        tokens.push(s);
      }
    }
    if (Array.isArray(item.rawImages) && item.rawImages.length) {
      item.rawImages.forEach(pushToken);
    } else if (Array.isArray(item.images) && item.images.length) {
      item.images.forEach(pushToken);
    } else {
      pushToken(item.image);
    }
    const paths = [];
    const seen = {};
    for (let i = 0; i < tokens.length; i++) {
      const p = resolveImagePath(tokens[i], folderOverride);
      if (!p || seen[p]) continue;
      seen[p] = true;
      paths.push(p);
    }
    return paths;
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
    return item.name + " - " + prices.join(MULTI_PRICE_SEPARATOR);
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
      priceEl.textContent = prices.join(MULTI_PRICE_SEPARATOR);
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

  /** New column (checkbox / 1 / TRUE) — blank → false. */
  function parseIsNew(raw) {
    return parseYesNo(raw, false);
  }

  /**
   * Box Settings G–I: Include in Presentation?, Family Portrait, Presentation Mode.
   * Blank Include/FP → false (opt-in). Mode blank → slideshow.
   */
  function applyBoxPresentationSettings(box, srow) {
    if (!box) return box;
    const bs = BOX_REVISED_SETTINGS;
    box.includeInPresentation = parseYesNo(
      cell(srow, bs.includeInPresentation),
      false
    );
    box.familyPortrait = parseYesNo(cell(srow, bs.familyPortrait), false);
    box.presentationMode = parsePresentationMode(
      cell(srow, bs.presentationMode),
      "slideshow"
    );
    if (box.presentationMode === "static") {
      box.familyPortrait = true; // static = force + hold Family Portrait multiview forever (ignores sheet FP flag)
    }
    return box;
  }

  /**
   * Inventory Image cell → resolved hero path(s). Blank → { image:null, images:null }.
   * @param {*} raw
   * @param {string} [folderOverride] Box Menu folder (not the Alpha board folder)
   */
  function parseBoxItemImages(raw, folderOverride) {
    const names = parseImageCell(raw);
    if (!names.length) return { image: null, images: null };
    const paths = [];
    for (let i = 0; i < names.length; i++) {
      const p = resolveImagePath(names[i], folderOverride);
      if (p) paths.push(p);
    }
    if (!paths.length) return { image: null, images: null };
    return {
      image: paths[0],
      images: paths.length > 1 ? paths : null,
    };
  }

  /**
   * One inventory row → footer box item (name/sub/price/new/image).
   * @param {string} [imageFolder] e.g. FOOTER_BOX_IMAGE_FOLDERS.drinks
   */
  function parseBoxInventoryItemRow(row, imageFolder) {
    const bi = BOX_REVISED_INVENTORY;
    const name = cell(row, bi.item);
    if (!name) return null;
    const includeRaw = cell(row, bi.include);
    if (includeRaw !== "" && includeRaw != null && !parseInclude(includeRaw)) {
      return null;
    }
    const imgs = parseBoxItemImages(cell(row, bi.image), imageFolder);
    return {
      name: String(name).trim(),
      subtitle: String(cell(row, bi.itemSubtitle) || "").trim(),
      price: formatPrice(cell(row, bi.price)),
      isNew: parseIsNew(cell(row, bi.isNew)),
      image: imgs.image,
      images: imgs.images,
    };
  }

  /**
   * Footer box Priority (Settings F).
   * Lower number = higher priority (1 wins over 2).
   *   When two boxes visible: lowest number gets the major (left/768) slot.
   *   When three boxes: lowest number is leftmost.
   * Blank / non-numeric → defaultVal.
   */
  function parsePriority(raw, defaultVal) {
    const fallback =
      defaultVal != null && Number.isFinite(Number(defaultVal))
        ? Number(defaultVal)
        : 0;
    if (raw === undefined || raw === null || raw === "") return fallback;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const n = Number(String(raw).trim().replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
    return fallback;
  }

  /**
   * Beta Features → Veil Shadow Settings (Hard_Shadow cutout only).
   * Numbers feed --veil-shadow-filter. Style type Hard_Shadow paints them;
   * Hard is the same hole with no drop-shadow. Soft never gets a veil shadow.
   */
  const VEIL_SHADOW_DEFAULTS = {
    enabled: false,
    shiftRight: 18,
    shiftDown: 22,
    spread: 3,
    blur: 2,
    opacity: 0.5,
  };

  /** Hard Encore hole pinch — hardcoded (was Beta Pinch? / Pinch by: / Pinch out?). */
  const ENCORE_HOLE_PINCH_PX = 40;
  const ENCORE_HOLE_PINCH_OUT = false;

  let veilShadowSettings = Object.assign({}, VEIL_SHADOW_DEFAULTS);

  function parseVeilShadowLength(raw, fallback) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return fallback;
    }
    // "20 px" / "20px" / 20
    const n = parseFloat(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(n)) return fallback;
    return n;
  }

  function veilShadowHeaderKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[?:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseVeilShadowOpacity(raw, fallback) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return fallback;
    }
    let n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    if (n > 1) n = n / 100;
    if (n < 0) n = 0;
    if (n > 1) n = 1;
    return n;
  }

  function parseVeilShadowSettings(rows) {
    const out = Object.assign({}, VEIL_SHADOW_DEFAULTS);
    if (!rows || !rows.length) return out;

    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const a = String(cell(rows[i], 0) || "").trim().toLowerCase();
      if (a === "veil shadow settings") {
        for (let j = i + 1; j < Math.min(i + 6, rows.length); j++) {
          if (String(cell(rows[j], 0) || "").trim().toLowerCase() === "enabled?") {
            headerIdx = j;
            break;
          }
        }
        break;
      }
      if (
        a === "enabled?" &&
        String(cell(rows[i], 1) || "")
          .trim()
          .toLowerCase()
          .indexOf("shift") !== -1
      ) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return out;

    const header = rows[headerIdx] || [];
    const data = rows[headerIdx + 1] || [];
    const col = {};
    for (let c = 0; c < header.length; c++) {
      const key = veilShadowHeaderKey(header[c]);
      if (key) col[key] = c;
    }

    function colVal(name, fallbackIdx) {
      const key = veilShadowHeaderKey(name);
      const idx = col[key] != null ? col[key] : fallbackIdx;
      return cell(data, idx);
    }

    out.enabled = parseYesNo(colVal("enabled", 0), false);
    out.shiftRight = parseVeilShadowLength(
      colVal("shift right", 1),
      VEIL_SHADOW_DEFAULTS.shiftRight
    );
    out.shiftDown = parseVeilShadowLength(
      colVal("shift down", 2),
      VEIL_SHADOW_DEFAULTS.shiftDown
    );
    out.spread = Math.max(
      0,
      parseVeilShadowLength(colVal("spread", 3), VEIL_SHADOW_DEFAULTS.spread)
    );
    out.blur = Math.max(
      0,
      parseVeilShadowLength(colVal("blur", 4), VEIL_SHADOW_DEFAULTS.blur)
    );
    out.opacity = parseVeilShadowOpacity(
      colVal("opacity", 5),
      VEIL_SHADOW_DEFAULTS.opacity
    );
    return out;
  }

  /** drop-shadow follows veil alpha (Hard hole). Spread is faked — CSS filter has no spread. */
  function buildVeilShadowFilter(s) {
    const x = Number(s.shiftRight) || 0;
    const y = Number(s.shiftDown) || 0;
    const blur = Math.max(0, Number(s.blur) || 0);
    const spread = Math.max(0, Number(s.spread) || 0);
    const opacity = Math.max(0, Math.min(1, Number(s.opacity)));
    const color = "rgba(0, 0, 0, " + opacity + ")";
    const layers = [];
    if (spread > 0) {
      const step = Math.max(1, Math.round(spread));
      layers.push("drop-shadow(" + (x + step) + "px " + y + "px 0 " + color + ")");
      layers.push("drop-shadow(" + (x - step) + "px " + y + "px 0 " + color + ")");
      layers.push("drop-shadow(" + x + "px " + (y + step) + "px 0 " + color + ")");
      layers.push("drop-shadow(" + x + "px " + (y - step) + "px 0 " + color + ")");
    }
    layers.push(
      "drop-shadow(" + x + "px " + y + "px " + blur + "px " + color + ")"
    );
    return layers.join(" ");
  }

  function applyVeilShadowConfig(settings) {
    veilShadowSettings = Object.assign(
      {},
      VEIL_SHADOW_DEFAULTS,
      settings && typeof settings === "object" ? settings : {}
    );
    const root = document.documentElement;
    // Filter numbers always live on :root. Style type Hard_Shadow is what
    // paints them — Hard is the same hole with no drop-shadow (Fire Stick).
    if (root && root.style) {
      root.style.setProperty(
        "--veil-shadow-filter",
        buildVeilShadowFilter(veilShadowSettings)
      );
    }
    if (root) root.classList.remove("beta-veil-shadow");
    if (document.body) document.body.classList.remove("beta-veil-shadow");
    tokiInfo(
      "Veil Shadow params x/y/spread/blur/op=" +
        [
          veilShadowSettings.shiftRight,
          veilShadowSettings.shiftDown,
          veilShadowSettings.spread,
          veilShadowSettings.blur,
          veilShadowSettings.opacity,
        ].join("/") +
        " (applied only when Spotlight Type = Hard_Shadow)"
    );
  }

  /**
   * Beta Features → Pattern Bake (checkbox).
   * ON  = paint #bg-pattern at opacity 1 using hex = stripe @ 0.35 over BG Color.
   * OFF = old look (true 0.35 opacity over whatever is behind).
   */
  const PATTERN_BAKE_ALPHA = 0.35;
  let patternBakeOn = false;

  function isPatternBakeFlagCell(raw) {
    if (typeof raw === "boolean") return true;
    if (raw === 1 || raw === 0) return true;
    const s = String(raw == null ? "" : raw).trim().toLowerCase();
    return /^(1|0|yes|no|y|n|true|false|on|off|checked|unchecked)$/.test(s);
  }

  function parsePatternBake(rows) {
    if (!rows || !rows.length) return false;

    // Beta Features sheet: checkbox is A7 (1-based) = rows[6][0]
    if (rows.length >= 7) {
      const a7 = cell(rows[6], 0);
      if (isPatternBakeFlagCell(a7)) return parseYesNo(a7, false);
      const b7 = cell(rows[6], 1);
      if (isPatternBakeFlagCell(b7)) return parseYesNo(b7, false);
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const width = Math.max(row.length, 10);
      for (let c = 0; c < width; c++) {
        const label = String(cell(row, c) || "").trim().toLowerCase();
        if (
          label.indexOf("pattern transparency bake") === -1 &&
          label.indexOf("pattern bake") === -1
        ) {
          continue;
        }
        for (let k = c + 1; k < width; k++) {
          const v = cell(row, k);
          if (isPatternBakeFlagCell(v)) return parseYesNo(v, false);
        }
        for (let j = i + 1; j <= i + 3 && j < rows.length; j++) {
          const nr = rows[j] || [];
          const nw = Math.max(nr.length, 10);
          for (let k = 0; k < nw; k++) {
            const v = cell(nr, k);
            if (isPatternBakeFlagCell(v)) return parseYesNo(v, false);
          }
        }
      }
    }
    return false;
  }

  function patternPlateHex() {
    return (
      normalizeHex(config.bgColor) ||
      normalizeHex(config.bgSolid) ||
      normalizeHex(config.mainColor) ||
      "#000000"
    );
  }

  function patternBakeHex(fgHex, fallback) {
    const fg = normalizeHex(fgHex) || normalizeHex(fallback) || fgHex;
    if (!patternBakeOn) return fg;
    // stripe×0.35 + BG×0.65  (identical to CSS opacity 0.35 over the plate)
    return blendHexOver(fg, patternPlateHex(), 0.35);
  }

  function applyPatternBakeConfig(on) {
    patternBakeOn = !!on;
    config.patternBake = patternBakeOn;
    if (document.documentElement) {
      document.documentElement.classList.toggle("pattern-bake", patternBakeOn);
    }
    if (document.body) {
      document.body.classList.toggle("pattern-bake", patternBakeOn);
    }
    const plate = patternPlateHex();
    tokiInfo(
      "Pattern Bake:",
      patternBakeOn ? "ON" : "OFF",
      patternBakeOn
        ? "out = stripe*0.35 + " + plate + "*0.65, opacity 1"
        : "raw hex, opacity 0.35"
    );
    try {
      applyConfigColors();
    } catch (e) {
      try {
        applyBgPattern();
      } catch (e2) {
        /* theme/pattern may not be ready yet */
      }
    }
  }

  /**
   * Parse the central Beta Features tab.
   * Boards → Include Footer Boxes (fallback), Motion table, Veil Shadow Settings.
   */
  function parseBetaFeatures(rows) {
    if (!rows || rows.length < 3) {
      return {
        footerBoxes: [],
        motionStyles: {},
        veilShadow: Object.assign({}, VEIL_SHADOW_DEFAULTS),
        patternBake: false,
      };
    }
    const result = {
      footerBoxes: [],
      motionStyles: {},
      veilShadow: Object.assign({}, VEIL_SHADOW_DEFAULTS),
      patternBake: false,
    };

    // Find "Boards" section (label row, then headers, then data)
    let boardsIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || "").trim().toLowerCase() === "boards") {
        boardsIdx = i;
        break;
      }
    }
    if (boardsIdx !== -1) {
      // Look for "Include Footer Boxes" header in the next few rows
      for (let i = boardsIdx + 1; i < Math.min(boardsIdx + 6, rows.length); i++) {
        const label = String(rows[i][0] || "").trim();
        if (label.toLowerCase() === "include footer boxes") {
          const dataRow = rows[i + 1] || rows[i];
          const raw = cell(dataRow, 0);
          if (raw) {
            result.footerBoxes = String(raw)
              .split(",")
              .map(function (s) {
                return s.trim();
              })
              .filter(Boolean);
          }
          break;
        }
      }
    }

    result.motionStyles = parseMotionStylesTable(rows);
    result.veilShadow = parseVeilShadowSettings(rows);
    result.patternBake = parsePatternBake(rows);
    tokiInfo(
      "Pattern Transparency Bake A7=",
      rows[6] ? cell(rows[6], 0) : "(no row 7)",
      "→",
      result.patternBake
    );
    return result;
  }

  /** Parse seconds from a Motion table cell; blank → fallback. */
  function parseMotionSeconds(raw, fallback) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return fallback;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  }

  /**
   * Beta Features → Motion section.
   * Columns: Motion Style | Explanation | Wind-up | Punch-In | Hold | Punch-Out | Wind-Down | Grok's Notes
   * Wind-up/Wind-down 0 = no override (use Punch-in / Punch-out on first/last).
   */
  function parseMotionStylesTable(rows) {
    const styles = {};
    if (!rows || !rows.length) return styles;

    let motionIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const a = String(cell(rows[i], 0) || "").trim().toLowerCase();
      if (a === "motion") {
        motionIdx = i;
        break;
      }
    }
    if (motionIdx < 0) return styles;

    let headerIdx = -1;
    for (let i = motionIdx + 1; i < Math.min(motionIdx + 8, rows.length); i++) {
      const a = String(cell(rows[i], 0) || "").trim().toLowerCase();
      if (a.indexOf("motion style") !== -1) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return styles;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const name = String(cell(rows[i], 0) || "").trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      // End of section / placeholder row
      if (
        lower === "boards" ||
        lower === "style and theme" ||
        lower === "swipe up" ||
        lower === "veil shadow settings" ||
        lower.indexOf("name of motion") === 0
      ) {
        if (lower.indexOf("name of motion") === 0) continue;
        break;
      }
      // Stop if we hit another section title (single cell-ish row)
      if (
        !String(cell(rows[i], 2) || "").trim() &&
        !String(cell(rows[i], 3) || "").trim() &&
        lower !== "ken burns" &&
        lower !== "encore"
      ) {
        // might still be a valid style with empty times — only break on known sections
        if (
          lower === "herotext" ||
          lower.indexOf("include footer") === 0
        ) {
          break;
        }
      }

      styles[name] = {
        name: name,
        explanation: String(cell(rows[i], 1) || "").trim(),
        windUp: parseMotionSeconds(cell(rows[i], 2), 0),
        punchIn: parseMotionSeconds(cell(rows[i], 3), 3.4),
        hold: parseMotionSeconds(cell(rows[i], 4), 1),
        punchOut: parseMotionSeconds(cell(rows[i], 5), 0.45),
        windDown: parseMotionSeconds(cell(rows[i], 6), 0),
        notes: String(cell(rows[i], 7) || "").trim(),
        zoomMin: 0.93,
        zoomMax: 1,
      };
    }
    return styles;
  }

  function applyMotionStylesConfig(stylesMap) {
    motionStylesByName = stylesMap && typeof stylesMap === "object" ? stylesMap : {};
    const kb = getMotionStyle("Ken Burns");
    const ss = getMotionStyle("Slideshow");
    // CSS vars track Ken Burns by default; engine sets per-phase inline too
    const root = document.documentElement;
    if (root && root.style) {
      root.style.setProperty("--motion-punch-in", String(kb.punchIn) + "s");
      root.style.setProperty("--motion-punch-out", String(kb.punchOut) + "s");
      root.style.setProperty(
        "--motion-opacity",
        String(Math.min(0.45, kb.punchIn || 0.45)) + "s"
      );
      root.style.setProperty(
        "--hero-zoom-min",
        String(kb.zoomMin != null ? kb.zoomMin : 0.93)
      );
      root.style.setProperty(
        "--hero-zoom-max",
        String(kb.zoomMax != null ? kb.zoomMax : 1)
      );
    }
    tokiInfo(
      "Motion styles loaded:",
      Object.keys(motionStylesByName).join(", ") || "(defaults)",
      "| Ken Burns",
      "in/hold/out=",
      kb.punchIn + "/" + kb.hold + "/" + kb.punchOut,
      "| Slideshow",
      "in/hold/out=",
      ss.punchIn + "/" + ss.hold + "/" + ss.punchOut
    );
  }

  function getMotionStyle(name) {
    const want = String(name || "Slideshow").trim();
    if (want && motionStylesByName[want]) {
      return normalizeMotionStyle(motionStylesByName[want]);
    }
    const keys = Object.keys(motionStylesByName);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === want.toLowerCase()) {
        return normalizeMotionStyle(motionStylesByName[keys[i]]);
      }
    }
    if (want.toLowerCase() === "ken burns") {
      return Object.assign({}, MOTION_DEFAULTS_KEN_BURNS);
    }
    if (want.toLowerCase() === "encore") {
      // Not implemented yet — opacity-only like Slideshow, not Ken Burns zoom
      return Object.assign({}, MOTION_DEFAULTS_SLIDESHOW, { name: "Encore" });
    }
    return Object.assign({}, MOTION_DEFAULTS_SLIDESHOW);
  }

  function normalizeMotionStyle(s) {
    const name = s.name || "Slideshow";
    const isKb = String(name).toLowerCase() === "ken burns";
    return {
      name: name,
      explanation: s.explanation || "",
      windUp: parseMotionSeconds(s.windUp, 0),
      punchIn: parseMotionSeconds(s.punchIn, 3.4),
      hold: parseMotionSeconds(s.hold, 1),
      punchOut: parseMotionSeconds(s.punchOut, 0.45),
      windDown: parseMotionSeconds(s.windDown, 0),
      notes: s.notes || "",
      // Ken Burns zooms; Slideshow (and others) stay at 1×
      zoomMin: isKb ? (s.zoomMin != null ? s.zoomMin : 0.93) : 1,
      zoomMax: isKb ? (s.zoomMax != null ? s.zoomMax : 1) : 1,
    };
  }

  /** True only for Motion Style "Ken Burns" — hero plate scale zoom. */
  function motionStyleUsesZoom(style) {
    return String((style && style.name) || "").toLowerCase() === "ken burns";
  }

  /** Motion Style "Encore" — grid + veil camera (not hero Ken Burns). */
  function motionStyleIsEncore(style) {
    return String((style && style.name) || "").toLowerCase() === "encore";
  }

  /**
   * Presentation Mode (board/box Settings) → Motion Style name (Beta Motion col A).
   *   Slideshow  → "Slideshow"  (opacity in/out, no scale zoom)
   *   Ken Burns  → "Ken Burns"  (opacity + scale 0.93↔1)
   *   Encore     → "Encore"     (not built; falls back to Slideshow-like)
   * Do not treat Presentation Mode "Slideshow" as Motion Style "Ken Burns".
   */
  function motionStyleNameForSlide(slide) {
    if (slide && slide.motionStyle) return slide.motionStyle;
    const mode = String(
      (slide && slide.segmentMode) || config.presentationMode || "slideshow"
    ).toLowerCase();
    if (mode === "encore") return "Encore";
    if (mode === "kenburns" || mode.indexOf("ken") !== -1) return "Ken Burns";
    return "Slideshow";
  }

  /**
   * Normalize Presentation Mode from sheet: slideshow | encore | kenburns
   */
  function presentationModeToStructureAndMotion(mode) {
    const m = String(mode || "slideshow").toLowerCase();
    if (m === "encore") {
      return { structure: "encore", motionStyle: "Encore" };
    }
    if (m === "static") {
      return { structure: "static", motionStyle: "Static" };
    }
    if (m === "kenburns" || m.indexOf("ken") !== -1) {
      // Same slide list as Slideshow (items + optional FP); motion is Ken Burns
      return { structure: "slideshow", motionStyle: "Ken Burns" };
    }
    return { structure: "slideshow", motionStyle: "Slideshow" };
  }

  function isPresSegmentBoundary(a, b) {
    if (!a || !b) return true;
    if (a.segment !== b.segment) return true;
    if ((a.boxKey || "") !== (b.boxKey || "")) return true;
    return false;
  }

  /**
   * Given the comma-separated list (from board Settings or Beta fallback),
   * return the ordered set of footer boxes to use (max 3, sorted by Priority asc).
   * Boxes beyond top 3 are exiled. Case-sensitive title match.
   */
  function selectFooterBoxesFromBeta(betaList, boxRegistry) {
    if (!betaList || !betaList.length) return [];
    const selected = [];
    for (let i = 0; i < betaList.length; i++) {
      const title = betaList[i];
      // Find matching box in registry (canonical title match)
      for (let j = 0; j < boxRegistry.length; j++) {
        if (boxRegistry[j].title === title) {
          selected.push(boxRegistry[j]);
          break;
        }
      }
    }
    // Sort by Priority (ascending = highest priority first)
    selected.sort(function (a, b) {
      const pa = Number.isFinite(a.priority) ? a.priority : 999;
      const pb = Number.isFinite(b.priority) ? b.priority : 999;
      return pa - pb;
    });
    // Exile anything past 3
    return selected.slice(0, 3);
  }

  /**
   * Parse Veggies sheet (gid 640368705) — identical revised structure to Proteins/Sauces/Drinks.
   */
  function parseVeggiesSheetRows(rows, fills) {
    fills = fills || {};
    const box = {
      title: "",
      subtitle: "",
      items: [],
      bgChoice: null,
      bgFill: null,
      createColumns: false,
      textAlign: "center",
      priority: 4,
      includeInPresentation: false,
      familyPortrait: false,
      presentationMode: "slideshow",
    };
    if (!rows || rows.length < 2) return box;

    const isRevised =
      rows &&
      rows[0] &&
      String(rows[0][0] || "").trim().toLowerCase() === "settings";
    if (!isRevised) return box;

    const settingsIdx = findRevisedSectionDataStart(rows, "settings");
    const srow =
      settingsIdx >= 0 && settingsIdx < rows.length ? rows[settingsIdx] : rows[2];
    const bs = BOX_REVISED_SETTINGS;

    box.title = String(cell(srow, bs.title) || "").trim();
    box.subtitle = String(cell(srow, bs.subtitle) || "").trim();
    box.bgChoice = String(cell(srow, bs.bgColor) || "").trim() || null;
    const sRow1 = settingsIdx + 1;
    box.bgFill =
      fills["C" + sRow1] ||
      fills["C" + (sRow1 + 1)] ||
      fills["C2"] ||
      null;

    box.createColumns = parseYesNo(cell(srow, bs.createColumns), false);
    box.textAlign = parseTextAlign(cell(srow, bs.textAlign), "center");
    box.priority = parsePriority(cell(srow, bs.priority), 4);
    applyBoxPresentationSettings(box, srow);

    const invIdx = findRevisedSectionDataStart(rows, "inventory");
    const start = invIdx >= 0 ? invIdx : 5;
    const vegFolder = FOOTER_BOX_IMAGE_FOLDERS.veggies;
    for (let i = start; i < rows.length; i++) {
      const it = parseBoxInventoryItemRow(rows[i], vegFolder);
      if (it) box.items.push(it);
    }
    return box;
  }

  /**
   * Clean price token for footer display (strip leading + / $).
   * Returns "" if empty after clean.
   */
  function footerPriceClean(price) {
    if (price == null || price === "") return "";
    return String(price)
      .replace(/^\+\s*/, "")
      .replace(/^\$/, "")
      .trim();
  }

  /** Full measure label for wrap packing: name + optional (sub) + optional + $price. */
  function footerItemMeasureLabel(it) {
    const name = String((it && it.name) || "").trim();
    if (!name) return "";
    let label = name;
    const sub = it && it.subtitle ? String(it.subtitle).trim() : "";
    if (sub) label += " (" + sub + ")";
    const cleaned = footerPriceClean(it && it.price);
    if (cleaned) label += " + $" + cleaned;
    return label;
  }

  /**
   * Table-level typography mode from the richest inventory row.
   * Richest = most filled of {name, subtitle, price}. All rows inherit that mode.
   *   typo-name           → Thin name
   *   typo-name-price     → Bold name + Thin price
   *   typo-name-sub       → Bold name + Regular subtitle
   *   typo-name-sub-price → Bold name + Regular subtitle + Thin price
   */
  function footerTypoModeClass(items) {
    const list = items || [];
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it || !it.name) continue;
      const hasSub = !!(it.subtitle && String(it.subtitle).trim());
      const hasPrice = !!footerPriceClean(it.price);
      const score = 1 + (hasSub ? 1 : 0) + (hasPrice ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { hasSub: hasSub, hasPrice: hasPrice };
      }
    }
    if (!best || bestScore <= 1) return "typo-name";
    if (best.hasSub && best.hasPrice) return "typo-name-sub-price";
    if (best.hasPrice) return "typo-name-price";
    if (best.hasSub) return "typo-name-sub";
    return "typo-name";
  }

  function setFooterTypoMode(el, modeClass) {
    if (!el) return;
    el.classList.remove(
      "typo-name",
      "typo-name-price",
      "typo-name-sub",
      "typo-name-sub-price"
    );
    el.classList.add(modeClass || "typo-name");
  }

  /**
   * Append name / subtitle / price spans into a footer item row or wrap chip.
   * Shared by protein, sauces, and footer-drinks.
   */
  /**
   * @param {HTMLElement} parent
   * @param {object} it
   * @param {{ suppressNewStyle?: boolean }} [opts]
   *   suppressNewStyle: box is in presentation — no static Special color;
   *   turn highlight applies Special/Highlight only when active.
   */
  function appendFooterItemParts(parent, it, opts) {
    if (!parent || !it) return;
    opts = opts || {};
    const markNew = !!it.isNew && !opts.suppressNewStyle;
    const nameEl = document.createElement("span");
    nameEl.className = "box-item-name" + (markNew ? " is-new" : "");
    nameEl.textContent = it.name || "";
    parent.appendChild(nameEl);

    if (it.subtitle) {
      const sub = document.createElement("span");
      sub.className =
        "item-paren-sub box-item-sub" + (markNew ? " is-new" : "");
      sub.textContent = " (" + it.subtitle + ")";
      parent.appendChild(sub);
    }

    const cleaned = footerPriceClean(it.price);
    if (cleaned) {
      const priceEl = document.createElement("span");
      priceEl.className = "box-item-price" + (markNew ? " is-new" : "");
      priceEl.textContent = " + $" + cleaned;
      parent.appendChild(priceEl);
    }
  }

  /** Mark a box row/chip with inventory index for presentation highlight. */
  function setBoxItemIndexAttr(el, index) {
    if (!el || index == null || index < 0) return;
    el.dataset.boxItemIndex = String(index);
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
    applyBgPattern();
    // Box overrides + contrast text (all boards that have boxes)
    applyBoxChrome();
    applyDisclaimerContent();
    applyDisclaimerColor();
    applyEncoreSpotlightChrome(null);
  }

  /**
   * Spotlight Veil only during an Encore *bow* (type === "encore"), never during
   * Family Portrait lineup Wind-up (type === "portrait") even when the segment
   * mode is Encore (FP composes as Encore's Wind-up without the veil).
   */
  function isEncoreActiveNow() {
    if (usesBoardSlides() && slides.length) {
      const s = slides[activeIndex];
      return !!(
        s &&
        s.segmentMode === "encore" &&
        s.type === "encore"
      );
    }
    return (
      _activeSegmentMode === "encore" ||
      config.presentationMode === "encore"
    );
  }

  /**
   * Whole Encore *segment* (FP wind-up + bows). Used to kill wallpaper / stripes.
   * Do not use isEncoreActiveNow() for BG — that is bow-only, so wallpaper
   * would stay up during the Encore family-portrait lineup.
   * Box Slideshow / other modes stay false so their BG can return on handoff.
   */
  function isEncoreSegmentNow() {
    if (usesBoardSlides() && slides.length) {
      const s = slides[activeIndex];
      if (s && String(s.segmentMode || "").toLowerCase() === "encore") {
        return true;
      }
    }
    return String(_activeSegmentMode || "").toLowerCase() === "encore";
  }

  /**
   * Encore plate is Secondary Color. Wallpaper fades out, then we park it
   * (drop src + stop pan RAF) so Fire Stick is not compositing two invisible
   * full-stage bitmaps under a solid veil. Pan X stays on the img transform
   * so unpark resumes where it left off. Pattern is display:none while parked.
   */
  let _encoreSolidBg = false;
  let _encoreBgFadeTimer = null;

  function encoreWallpaperEls() {
    const out = [];
    if (els.galaxyA) out.push(els.galaxyA);
    if (els.galaxyB) out.push(els.galaxyB);
    return out;
  }

  function parkEncoreWallpaper() {
    pauseGalaxyScroll();
    document.body.classList.add("encore-wallpaper-parked");
    const galaxy = document.getElementById("galaxy") || els.galaxy;
    if (galaxy) {
      galaxy.style.setProperty("--bg-image-blur", "none");
      galaxy.classList.remove("has-blur");
    }
    encoreWallpaperEls().forEach(function (el) {
      const src = el.getAttribute("src") || "";
      if (src && !el.dataset.tokiParkedSrc) {
        el.dataset.tokiParkedSrc = src;
      }
      el.dataset.tokiParked = "1";
      if (src) el.removeAttribute("src");
    });
    tokiInfo("encore wallpaper parked (scroll off, bitmaps dropped)");
  }

  function unparkEncoreWallpaper() {
    document.body.classList.remove("encore-wallpaper-parked");
    encoreWallpaperEls().forEach(function (el) {
      const parked = el.dataset.tokiParkedSrc || "";
      el.dataset.tokiParked = "";
      if (parked && el.getAttribute("src") !== parked) {
        el.src = parked;
      }
      if (el.dataset.tokiParkedSrc) delete el.dataset.tokiParkedSrc;
    });
    const galaxy = document.getElementById("galaxy") || els.galaxy;
    if (galaxy && config.bgImage) {
      const wall = isPreviewWall();
      applyBgEffects(
        galaxy,
        wall ? 0 : parseUnit01(config.bgBlur, 0),
        parseUnit01(config.bgOpacity, 1),
        wall ? "normal" : parseBgBlendMode(config.bgBlendMode)
      );
    }
    resumeGalaxyScroll();
    tokiInfo("encore wallpaper unparked");
  }

  /** Park/unpark from the live segment — not only on a mode *change*. */
  function syncEncoreWallpaperPark(opts) {
    setEncoreSolidBackground(isEncoreSegmentNow(), opts);
  }

  function setEncoreSolidBackground(on, opts) {
    opts = opts || {};
    const want = !!on;
    const instant = !!opts.instant;
    if (_encoreSolidBg === want && !instant) return;
    _encoreSolidBg = want;

    if (_encoreBgFadeTimer) {
      clearTimeout(_encoreBgFadeTimer);
      _encoreBgFadeTimer = null;
    }

    // Scroll is unused under Encore — stop the RAF immediately (src drops after fade).
    if (want) pauseGalaxyScroll();

    const galaxy = document.getElementById("galaxy") || els.galaxy;
    if (instant) {
      document.body.classList.remove("encore-bg-fading");
      if (!want) unparkEncoreWallpaper();
      document.body.classList.toggle("encore-solid-bg", want);
      if (want) parkEncoreWallpaper();
    } else {
      document.body.classList.add("encore-bg-fading");
      void document.body.offsetWidth;
      // Restore bitmaps while still opacity-0, then fade the solid class off.
      if (!want) unparkEncoreWallpaper();
      document.body.classList.toggle("encore-solid-bg", want);
      const fadeMs = presentationFadeMs(
        els.familyPortrait || document.documentElement
      );
      _encoreBgFadeTimer = window.setTimeout(function () {
        _encoreBgFadeTimer = null;
        document.body.classList.remove("encore-bg-fading");
        if (want) parkEncoreWallpaper();
      }, fadeMs + 40);
    }

    if (galaxy) {
      if (want) {
        galaxy.style.backgroundColor = config.secondaryColor || "#000000";
        galaxy.classList.remove("is-solid");
        galaxy.classList.toggle("has-image", !!config.bgImage);
      } else {
        const plate =
          normalizeHex(config.bgColor) ||
          normalizeHex(config.bgSolid) ||
          config.mainColor ||
          "#000000";
        galaxy.style.backgroundColor = plate;
      }
    }
  }

  /**
   * Style → Encore Spotlight Type/Color classes + --encore-veil-color.
   * @param {{isNew?: boolean}|null} [item] active bow item (for Highlight color).
   *   When null/omitted and already in Encore, **keep** the current veil color
   *   so New → Special does not snap to regular Highlight during zoom-out.
   * @param {{forceClear?: boolean}} [opts]
   */
  function applyEncoreSpotlightChrome(item, opts) {
    opts = opts || {};
    const stage = els.familyPortrait;
    if (!stage) return;

    // Spotlight Veil only during Encore (active presentation segment).
    // forceClear: hard teardown (finishHide) even if segment mode still says encore.
    if (!isEncoreActiveNow() || opts.forceClear) {
      // During Encore Wind-down the stage is still on-screen (fading). Keep veil
      // classes so Punch-out undim can animate; finishHide forceClear removes them.
      if (!opts.forceClear && !stage.hidden) {
        return;
      }
      stage.classList.remove(
        "encore-spot-hard",
        "encore-spot-hard-shadow",
        "encore-spot-soft",
        "encore-spot-color-highlight",
        "encore-spot-color-black"
      );
      if (opts.forceClear || !isEncoreActiveNow()) {
        stage.style.removeProperty("--encore-veil-color");
        stage.style.removeProperty("background-color");
      }
      return;
    }

    const type = normalizedEncoreSpotlightType(config.encoreSpotlightType);
    const colorMode =
      config.encoreSpotlightColor === "highlight" ? "highlight" : "black";
    const hard = type === "hard" || type === "hard_shadow";

    stage.classList.toggle("encore-spot-hard", hard);
    stage.classList.toggle("encore-spot-hard-shadow", type === "hard_shadow");
    stage.classList.toggle("encore-spot-soft", type === "soft");
    stage.classList.toggle(
      "encore-spot-color-highlight",
      colorMode === "highlight"
    );
    stage.classList.toggle("encore-spot-color-black", colorMode === "black");

    if (colorMode === "highlight") {
      // Only update color when we know the bow item — preserve Special through zoom-out
      if (item) {
        let veilColor = item.isNew
          ? config.highlightSpecial || config.highlight || "#fff900"
          : config.highlight || "#26bbcb";
        veilColor = normalizeHex(veilColor) || veilColor || "#26bbcb";
        stage.style.setProperty("--encore-veil-color", veilColor);
        tokiInfo(
          "encore spotlight",
          type,
          colorMode,
          "veil",
          veilColor,
          item.isNew ? "(special)" : ""
        );
      } else if (opts.forceClear || !stage.style.getPropertyValue("--encore-veil-color")) {
        const fallback =
          normalizeHex(config.highlight) || config.highlight || "#26bbcb";
        stage.style.setProperty("--encore-veil-color", fallback);
      }
    } else {
      stage.style.setProperty("--encore-veil-color", "#000000");
    }
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
  const _imageAvgPlateCache = Object.create(null);

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
   * Average of the *entire* source PNG (all pixels). Downscaled only for perf.
   * Used solely for the crossfade plate-override when 100% + Normal.
   */
  function computeAverageOfImage(img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    // Reasonable cap keeps getImageData fast while mean color remains accurate.
    const MAX_DIM = 512;
    let cw = W,
      ch = H;
    if (Math.max(W, H) > MAX_DIM) {
      const scale = MAX_DIM / Math.max(W, H);
      cw = Math.max(1, Math.round(W * scale));
      ch = Math.max(1, Math.round(H * scale));
    }
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);
    return averageCanvasHex(ctx, cw, ch);
  }

  /**
   * IF wallpaper selected AND opacity===100% AND blend==="normal" (or wall-forced normal),
   * compute the PNG average *once* and override the #galaxy backgroundColor plate.
   * This eliminates the BG COLOR flash/peek during dual-layer crossfades.
   * Only overrides in exactly those conditions. Called from applyStageBackground.
   * Idempotent per resolved display image path.
   */
  async function maybeApplyImageAverageAsPlate(displayPath) {
    if (!displayPath) return;
    const opacity01 = bgImageOpacityPeak();
    let effBlend = parseBgBlendMode(config.bgBlendMode);
    if (isPreviewWall()) effBlend = "normal";
    if (opacity01 < 0.999 || effBlend !== "normal") {
      return;
    }
    if (_imageAvgPlateCache[displayPath]) {
      // Ensure the plate is using the averaged color for this image
      // (setting is cheap and avoids rgb vs hex comparison gotchas).
      const galaxy = document.getElementById("galaxy");
      if (galaxy) {
        galaxy.style.backgroundColor = _imageAvgPlateCache[displayPath];
      }
      return;
    }
    try {
      const img = await loadBgImageCached(displayPath);
      // Revalidate conditions + that this image is still the active one
      if (!config.bgImage) return;
      const currentDisplay = wallFriendlyBgPath(config.bgImage);
      if (currentDisplay !== displayPath) return;
      const curOpacity = bgImageOpacityPeak();
      let curBlend = parseBgBlendMode(config.bgBlendMode);
      if (isPreviewWall()) curBlend = "normal";
      if (curOpacity < 0.999 || curBlend !== "normal") return;

      const avg = computeAverageOfImage(img);
      if (!avg) return;

      _imageAvgPlateCache[displayPath] = avg;

      const galaxy = document.getElementById("galaxy");
      if (galaxy) {
        galaxy.style.backgroundColor = avg;
      }
      tokiInfo("BG plate overridden with PNG average for crossfade (image+100%+Normal only):", avg);
    } catch (err) {
      // Load/decode/getImageData issue (e.g. unexpected cross-origin). Keep user plate.
    }
  }

  /**
   * Resolve git build stamp for Show Version.
   * Version is appended to the Toki Debug HUD header (not the disclaimer).
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

  /** Apply the normal allergy disclaimer. Version stamp no longer lives here. */
  function applyDisclaimerContent() {
    if (!els.disclaimer) return;
    if (cfg.showDisclaimer === false) {
      els.disclaimer.hidden = true;
      return;
    }
    els.disclaimer.hidden = false;
    // Always show the standard disclaimer text.
    // Version info is now appended only to the Toki Debug HUD header.
    els.disclaimer.innerHTML = DEFAULT_DISCLAIMER_HTML;
    els.disclaimer.classList.remove("is-version");
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

  /**
   * Clamp sheet 0–1 controls (blur, opacity). Blank → fallback.
   * Accepts decimals (0.5), whole 0/1, and percent strings ("100%", "50%").
   * Revised Style sheet uses Sheets Percent format which often arrives as "100%".
   */
  function parseUnit01(raw, fallback) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return fallback;
    }
    let s = String(raw).trim().replace(/,/g, "");
    const isPct = /%\s*$/.test(s);
    if (isPct) s = s.replace(/%\s*$/, "").trim();
    const n = Number(s);
    if (!Number.isFinite(n)) return fallback;
    // "100%" → 1; bare 100 (without %) also treated as percent if > 1
    if (isPct || Math.abs(n) > 1) {
      return Math.max(0, Math.min(1, n / 100));
    }
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
    // Support bare names (e.g. "film") the same way item images do.
    // If the sheet already specifies an extension (film.jpg), respect it.
    const file = token.replace(/^\/+/, "");
    let path;
    let forceWebpPreference = false;
    if (file.indexOf("assets/") === 0 || file.indexOf("/") !== -1) {
      path = file;
    } else {
      path = BG_IMAGE_FOLDER + "/" + file;
      if (!/\.(jpe?g|png|webp|gif)$/i.test(file)) {
        path += ".webp";
        forceWebpPreference = true;
      }
    }
    return forceWebpPreference ? toWebpPath(path) : path;
  }

  /**
   * Stage BG image is board-wide (never per-theme).
   * Legacy: H2. Revised Settings: column C on the Settings values row.
   */
  function resolveStageBgImageFromRows(rows, sc, boardRowIndex) {
    const idx =
      boardRowIndex != null && Number.isFinite(boardRowIndex)
        ? boardRowIndex
        : STYLE_BOARD_WIDE_ROW_INDEX;
    const row = rows && rows[idx];
    const col = sc && sc.bgImage != null ? sc.bgImage : 7;
    const raw = row ? cell(row, col) : "";
    return {
      raw: raw,
      path: parseBgImagePath(raw),
      from: "settings-row " + (idx + 1) + " col " + col,
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
   * Suggest a sensible default blend mode for known artistic/texture wallpapers
   * (e.g. "film", "grain", "noise"). Only used when the Style row cell is blank.
   * Blur and opacity remain purely global (Style Settings row).
   */
  function suggestBlendForWallpaper(path) {
    if (!path) return null;
    const low = String(path).toLowerCase();
    if (low.includes("film") || low.includes("grain") || low.includes("noise")) {
      return "overlay";
    }
    return null;
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

  /**
   * Apply global Style background effects (blur, opacity, blend) to a galaxy layer.
   * This is the single place that decides visual treatment — never derived from
   * the wallpaper filename itself.
   */
  function applyBgEffects(el, blur01, opacity01, blend) {
    if (!el) return;
    if (blur01 <= 0) {
      el.style.setProperty("--bg-image-blur", "none");
      el.classList.remove("has-blur");
    } else {
      const px = (blur01 * BG_BLUR_MAX_PX).toFixed(2);
      el.style.setProperty("--bg-image-blur", "blur(" + px + "px)");
      el.classList.add("has-blur");
    }
    el.style.setProperty("--bg-image-opacity", String(opacity01));
    el.style.setProperty("--bg-image-blend", blend || "normal");
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
    if (imagePath) {
      const rawPath = imagePath;
      imagePath = displayFriendlyBgPath(imagePath);
      if (rawPath !== imagePath) {
        tokiInfo(
          "bg master → display size",
          rawPath,
          "→",
          imagePath,
          displayPixelBudget()
        );
      }
    }

    // Multi-board wall: still per-board BG (4 copies), but leaner:
    // no CSS blur/blend, stage-sized galaxy asset, single-layer pan.
    const blur01 = wall ? 0 : parseUnit01(config.bgBlur, 0);
    const opacity01 = parseUnit01(config.bgOpacity, 1);
    const blend = wall ? "normal" : parseBgBlendMode(config.bgBlendMode);

    // Special-case plate override (only when image + 100% opacity + Normal):
    // Use a pre-computed PNG average (if we have it from a prior load) so the
    // first paint of the galaxy also uses the matching tone. The async compute
    // (kicked off below) will fill the cache for subsequent applies / reloads.
    if (imagePath && opacity01 >= 0.999 && blend === "normal") {
      const cachedAvg = _imageAvgPlateCache[imagePath];
      if (cachedAvg) {
        plate = cachedAvg;
      }
    }

    // Encore: plate is Secondary. Wallpaper is faded then parked (src dropped).
    // Do not restore src here while tokiParked — that would undo the GPU win.
    if (_encoreSolidBg) {
      plate = config.secondaryColor || plate;
      document.body.classList.add("encore-solid-bg");
    } else {
      document.body.classList.remove("encore-solid-bg");
    }

    // Color plate always under the image
    galaxy.style.backgroundColor = plate;
    galaxy.classList.toggle("has-image", !!imagePath);
    galaxy.classList.toggle("is-solid", !imagePath);

    // Global Style-driven effects (never per-wallpaper).
    // See applyBgEffects below.
    // Encore holds wallpaper off. Do not re-apply blur onto parked layers.
    applyBgEffects(
      galaxy,
      _encoreSolidBg ? 0 : blur01,
      opacity01,
      _encoreSolidBg ? "normal" : blend
    );

    // One layer when not scrolling (or wall). Dual only for seamless pan.
    const scrollOn =
      !wall && parseBgScrollSpeed(config.bgScrollSpeed, 1) > 0;
    const layerEls = scrollOn
      ? [els.galaxyA, els.galaxyB]
      : [els.galaxyA];
    if (!scrollOn && els.galaxyB) {
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
          el.dataset.tokiMaster = "";
          el.dataset.tokiFrom = "";
          el.dataset.tokiPx = "";
          tokiLog("bg image cleared (solid / unused)");
        }
        return;
      }
      el.hidden = false;
      attachWebpFallback(el);
      el.dataset.tokiMaster = imagePath;
      if (el.dataset.tokiParked === "1" || _encoreSolidBg) return;
      if (el.getAttribute("src") !== imagePath) {
        tokiLog("bg image load", imagePath, wall ? "(preview-wall)" : "");
        el.dataset.downsampled = "";
        el.dataset.tokiFrom = "";
        el.dataset.tokiPx = "";
        bindDownsampleOnLoad(el);
        el.src = imagePath;
      } else {
        bindDownsampleOnLoad(el);
      }
    });
    // Board stickers (static HTML) — same debug path as plates
    downsampleAuxRasters(document);

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

    // If wallpaper + 100% + Normal (the only case we override), compute the
    // full PNG average color once and set it as the galaxy plate. This is the
    // exact condition requested; the work is async and only on image load.
    if (imagePath) {
      maybeApplyImageAverageAsPlate(imagePath);
    }

    updateDebugVisuals();
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

  // ---------- API-only (xlsx fills / rich text quarantined) ----------
  // Live boards use Sheets values (CSV) only. Fill/font/rich parsers live in
  // deprecated/sheet-styles/ — not loaded. Proof: no /api/sheets/xlsx fetch.
  window.TOKI_API_ONLY = true;
  try {
    document.documentElement.setAttribute("data-toki-api-only", "true");
  } catch (e) {
    /* ignore */
  }
  tokiInfo(
    "API-only: Drive xlsx export OFF. Cell fills + rich text disabled. See deprecated/sheet-styles/PROOF.md"
  );
  setFeatureActive("xlsxStyles", false, "API-only: Drive xlsx disabled");

  function emptySheetStyles() {
    return { fills: {}, fonts: {}, rich: {} };
  }

  function invalidateWorkbookXlsxCache() {
    /* no-op — workbook cache removed */
  }

  async function fetchWorkbookXlsxBuffer() {
    throw new Error(
      "API-only: Drive xlsx export is disabled (deprecated/sheet-styles/)"
    );
  }

  async function extractSheetStylesFromXlsx() {
    return emptySheetStyles();
  }

  async function extractSheetFillsFromXlsx() {
    return {};
  }

  async function loadSheetStylesByName() {
    return emptySheetStyles();
  }

  async function loadSheetFillsByName() {
    return {};
  }

  async function loadBoardSheetStyles() {
    return emptySheetStyles();
  }

  // ---------- data ----------

  function parsedMenuFromRows(rows, columnMap) {
    const c = columnMap || col;

    // Detect Board 1 Revised structure (Settings block + Inventory block with headers below)
    // Prefer row structure (for xlsx local with tab names), fallback to gid.
    const isBoardRevised =
      (rows &&
        rows[0] &&
        String(rows[0][0] || "")
          .trim()
          .toLowerCase() === "settings") ||
      BOARD_REVISED_GIDS.includes(String(cfg.googleSheetGid || ""));

    let dataRows;
    let settingsRow = null;
    let itemColMap = c;
    if (isBoardRevised) {
      // Settings: single row of board-wide choices (title, FP, mode, includes, columns)
      const settingsIdx = findRevisedSectionDataStart(rows, "settings");
      if (settingsIdx >= 0 && settingsIdx < rows.length) {
        settingsRow = rows[settingsIdx];
      }
      // Inventory items: headers after "Inventory" label; data after that
      const invIdx = findRevisedSectionDataStart(rows, "inventory");
      const invStart = invIdx >= 0 ? invIdx : 4; // fallback
      // invStart points at the first data row (find returns label index + 2)
      dataRows = rows
        .slice(invStart)
        .filter((r) => r && r.some((v) => v != null && String(v).trim() !== ""));
      itemColMap = BOARD_REVISED_INVENTORY;
    } else {
      dataRows = rows
        .slice(1)
        .filter((r) => r && r.some((v) => v != null && String(v).trim() !== ""));
    }

    if (dataRows.length === 0) {
      throw new Error("Spreadsheet has no data rows");
    }

    // Drinks / Announcements board has a dedicated shape (revised or legacy)
    if (isDrinks) {
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
      const name = cell(row, itemColMap.item);
      if (name !== "" && name != null) {
        const rawImageCell = cell(row, itemColMap.image);
        const imageNames = parseImageCell(rawImageCell);

        // Prices: multi-price boards (price1/2/3) must NOT also read bowls' `price`
        // column — that index collides with New/Image on munchies sheets.
        const priceTokens = [];
        const multiPrice =
          itemColMap.price1 != null || itemColMap.price2 != null || itemColMap.price3 != null;
        if (multiPrice) {
          [itemColMap.price1, itemColMap.price2, itemColMap.price3].forEach((idx) => {
            if (idx == null) return;
            const p = cell(row, idx);
            if (isUsablePriceCell(p)) priceTokens.push(String(p).trim());
          });
        } else if (itemColMap.price != null) {
          const p = cell(row, itemColMap.price);
          if (isUsablePriceCell(p)) priceTokens.push(String(p).trim());
        }

        // Subtitle (munchies) and description (bowls/handhelds) are separate —
        // never fall back across column types (avoids Image filename as subtitle).
        const subtitle =
          itemColMap.subtitle != null
            ? String(cell(row, itemColMap.subtitle) || "").trim()
            : "";
        const description =
          itemColMap.description != null
            ? String(cell(row, itemColMap.description) || "").trim()
            : "";

        parsedItems.push({
          name: String(name).trim(),
          price: priceTokens[0] || "",
          prices: priceTokens,
          description,
          subtitle,
          isNew: Number(cell(row, itemColMap.isNew)) === 1,
          rawImages: imageNames,
          include: parseInclude(cell(row, itemColMap.include)),
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

    let includeProteinBox;
    let includeSaucesBox;
    let includeDrinksBox;
    let familyPortrait;
    let presentationMode = "slideshow";
    let includeDescriptions;
    let menuColumns = "auto";
    let titleRowForTitle = first;
    let includeFooterBoxes = [];  // per-board comma list from Settings (new unified control)

    if (isBoardRevised && settingsRow) {
      const rs = BOARD_REVISED_SETTINGS;
      titleRowForTitle = settingsRow;

      // New per-page control (replaces the old individual Include Protein/Sauces/Drinks/Veggies? flags)
      const footerBoxesRaw = cell(settingsRow, rs.includeFooterBoxes);
      includeFooterBoxes = String(footerBoxesRaw || "")
        .split(",")
        .map(function (s) { return s.trim(); })
        .filter(Boolean);

      // Old per-box flags no longer exist in the row. Default conservatively; the list + selection will decide.
      includeProteinBox = true;
      includeSaucesBox = true;
      includeDrinksBox = false;

      familyPortrait = parseInclude(cell(settingsRow, rs.familyPortrait));
      presentationMode = parsePresentationMode(cell(settingsRow, rs.presentationMode), "slideshow");
      if (presentationMode === "static") {
        familyPortrait = true; // static = force + hold Family Portrait multiview forever (ignores sheet FP flag)
        PRESENTATION_MOTION_MODE = "static";
      }
      includeDescriptions = parseInclude(cell(settingsRow, rs.includeDescriptions));
      // Columns?
      const colRaw = cell(settingsRow, rs.menuColumns);
      const s = String(colRaw || "").trim().toLowerCase();
      if (!s || s === "auto") menuColumns = "auto";
      else if (s === "1" || s === "one") menuColumns = 1;
      else if (s === "2" || s === "two") menuColumns = 2;
      else if (s === "3" || s === "three") menuColumns = 3;
      else {
        const n = Number(s);
        menuColumns = (n === 1 || n === 2 || n === 3) ? n : "auto";
      }
    } else {
      // Include flags — first non-empty cell in the column (legacy)
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
      includeProteinBox = firstColumnInclude(c.includeProteinBox, true);
      includeSaucesBox = firstColumnInclude(c.includeSaucesBox, true);
      // Drinks/soda footer: default OFF when column missing or blank
      includeDrinksBox = firstColumnInclude(c.includeDrinksBox, false);
      // Family Portrait collage overview (Board K): default OFF
      familyPortrait = firstColumnInclude(c.familyPortrait, false);
      // Presentation Mode (Board L): Slideshow | Encore — default Slideshow
      if (c.presentationMode != null) {
        for (let i = 1; i < rows.length; i++) {
          const raw = cell(rows[i], c.presentationMode);
          if (raw === "" || raw == null) continue;
          presentationMode = parsePresentationMode(raw, "slideshow");
          break;
        }
      }
      // Descriptions: default ON when column missing (legacy boards)
      includeDescriptions = firstColumnInclude(
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
      menuColumns = firstColumnMenuColumns(c.menuColumns);
    }

    const out = {
      title: String(cell(titleRowForTitle, isBoardRevised ? BOARD_REVISED_SETTINGS.title : c.title) || ""),
      items: parsedItems,
      includeDescriptions: includeDescriptions,
      menuColumns: menuColumns,
      familyPortrait: familyPortrait,
      presentationMode: presentationMode,
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
      includeFooterBoxes: includeFooterBoxes,
    };

    // Speeds / colors only when those columns exist on this sheet
    if (c.bgScrollSpeed != null) {
      out.bgScrollSpeed = parseBgScrollSpeed(cell(first, c.bgScrollSpeed), 1);
    }
    if (c.slideshowSpeed != null) {
      out.slideshowSpeed = parseSlideshowSpeed(
        cell(first, c.slideshowSpeed),
        3
      );
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

  function isAnnouncementsRevisedSheet(rows) {
    if (
      String(cfg.googleSheetGid || "") === ANNOUNCEMENTS_REVISED_GID
    ) {
      return true;
    }
    return !!(
      rows &&
      rows[0] &&
      String(rows[0][0] || "")
        .trim()
        .toLowerCase() === "settings"
    );
  }

  /**
   * First inventory data row for Announcements revised tab.
   * Prefer labeled Inventory section; else headers after Settings data row.
   */
  function findAnnouncementInventoryDataStart(rows) {
    const inv = findRevisedSectionDataStart(rows, "inventory");
    if (inv >= 0) return inv;
    const setData = findRevisedSectionDataStart(rows, "settings");
    if (setData >= 0 && setData + 1 < rows.length) {
      const hdr = rows[setData + 1] || [];
      const blob =
        String(hdr[0] || "") +
        " " +
        String(hdr[1] || "") +
        " " +
        String(hdr[2] || "");
      if (/announcement/i.test(blob)) {
        return setData + 2;
      }
    }
    return 4;
  }

  /** Normalize Include Footer Box cell → protein|sauces|drinks|veggies|"" */
  function normalizeFooterBoxSelection(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase();
    if (!s || /^(none|off|0|false|no|-|—)$/i.test(s)) return "";
    if (/protein/.test(s)) return "protein";
    if (/sauce/.test(s)) return "sauces";
    if (/veggie|vegetable|side/.test(s)) return "veggies";
    if (/drink|soda|beverage/.test(s)) return "drinks";
    return s;
  }

  function parsedDrinksFromRows(rows, columnMap) {
    const c = columnMap || col;
    if (isAnnouncementsRevisedSheet(rows)) {
      return parsedAnnouncementsRevisedFromRows(rows);
    }
    return parsedDrinksLegacyFromRows(rows, c);
  }

  /**
   * Announcements tab (gid 149404218): Settings + message inventory under it.
   * Each non-empty Announcement Text is one message-board slide.
   * Title/subtitle married; speed/box-color/shout inherit blanks.
   * Plain text from the Text cell (xlsx rich runs quarantined). Motion Style/Setting stored for later.
   */
  /** Style / Announcements BG Pattern: "Stripes" vs None. Blank → None. */
  function isStripesPatternToken(raw) {
    const s = String(raw == null ? "" : raw).trim().toLowerCase();
    if (!s) return false;
    if (/^(none|off|0|false|no|-|—)$/i.test(s)) return false;
    return s.indexOf("stripe") !== -1;
  }

  function parsedAnnouncementsRevisedFromRows(rows) {
    if (
      !rows ||
      !rows.some(function (r) {
        return r && r.some(function (v) {
          return v != null && String(v).trim() !== "";
        });
      })
    ) {
      throw new Error("Announcements sheet has no data rows");
    }

    const rs = ANN_REVISED_SETTINGS;
    const inv = ANN_REVISED_INVENTORY;
    const settingsIdx = findRevisedSectionDataStart(rows, "settings");
    const settingsRow =
      settingsIdx >= 0 && settingsIdx < rows.length
        ? rows[settingsIdx]
        : rows[2] || rows[0];

    const invStart = findAnnouncementInventoryDataStart(rows);
    const messages = [];
    let lastTitle = "";
    let lastSubtitle = "";
    let lastSpeed = Number(config.slideshowSpeed) || 4;
    let lastShout = false;
    const DEFAULT_SHAKE_INTENSITY = 0.75;
    let lastShakeIntensity = DEFAULT_SHAKE_INTENSITY;
    let lastBgChoice = null;
    let lastBgFill = null;
    let lastMotionStyle = "";
    let lastMotionSetting = null;

    for (let i = invStart; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const excelRow = i + 1;
      const copyText = cell(row, inv.announcementCopy);
      if (copyText == null || String(copyText).trim() === "") continue;

      const ref = cellRef(inv.announcementCopy, excelRow);
      const font = sheetFonts[ref] || {};
      const runs = sheetRich[ref] || null;
      const rawTitle = String(
        cell(row, inv.announcementTitle) || ""
      ).trim();
      const rawSub = String(
        cell(row, inv.announcementSubtitle) || ""
      ).trim();
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
        cell(row, inv.announcementSpeed),
        lastSpeed
      );
      const textAlign = parseTextAlign(font.align, "center");

      // Per-message box color (blank inherits)
      const colorRef = cellRef(inv.announcementColor, excelRow);
      const rawColor = String(
        cell(row, inv.announcementColor) || ""
      ).trim();
      const colorFill = sheetFills[colorRef] || null;
      let bgChoice = lastBgChoice;
      let bgFill = lastBgFill;
      if (rawColor || colorFill) {
        bgChoice = rawColor || null;
        bgFill = colorFill;
        lastBgChoice = bgChoice;
        lastBgFill = bgFill;
      }

      // Motion Style / Setting — store for upcoming announcement motion (blank inherits style)
      let motionStyle = lastMotionStyle;
      const rawMs = String(cell(row, inv.motionStyle) || "").trim();
      if (rawMs) {
        motionStyle = rawMs;
        lastMotionStyle = motionStyle;
      }
      let motionSetting = lastMotionSetting;
      const rawSet = cell(row, inv.motionSetting);
      if (rawSet != null && String(rawSet).trim() !== "") {
        const n = Number(rawSet);
        motionSetting = Number.isFinite(n) ? n : String(rawSet).trim();
        lastMotionSetting = motionSetting;
      }

      messages.push({
        title: title,
        subtitle: subtitle,
        text: String(copyText).trim(),
        speedSec: speed,
        textAlign: textAlign,
        shout: !!lastShout,
        shakeIntensity: lastShakeIntensity,
        color: announcementFontColor(font.color),
        bold: !!font.bold,
        italic: !!font.italic,
        runs: runs,
        bgChoice: bgChoice,
        bgFill: bgFill,
        motionStyle: motionStyle,
        motionSetting: motionSetting,
      });
      lastSpeed = speed;
    }

    // Live Settings: A Title | B Include Footer Box | C BG Pattern only.
    const showPanelPattern = isStripesPatternToken(
      cell(settingsRow, rs.bgPattern)
    );

    const footerSel = normalizeFooterBoxSelection(
      cell(settingsRow, rs.includeFooterBox)
    );

    const firstMsg = messages[0] || null;
    const annChoice =
      (firstMsg && firstMsg.bgChoice) || lastBgChoice || null;
    const annFill = (firstMsg && firstMsg.bgFill) || lastBgFill || null;

    return {
      title: String(cell(settingsRow, rs.title) || "").trim(),
      items: [], // filled by attachBoard4FooterBox from shared box sheets
      includeFooterBox: footerSel,
      includeStripes: showPanelPattern,
      announcementBox: {
        title: firstMsg ? firstMsg.title : "",
        subtitle: firstMsg ? firstMsg.subtitle : "",
        messages: messages,
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
        title: "",
        subtitle: "",
        bgChoice: null,
        bgFill: null,
        createColumns: false,
        textAlign: "center",
      },
      // Defaults until footer sheet attaches
      drinksOverview: true,
      drinksIndividual: true,
      overviewImage: null,
    };
  }

  /**
   * Legacy Board 4 chrome tab (gid 1962117802) — flat columns.
   * Walk every data row by original CSV index so Excel rows align with xlsx styles.
   */
  function parsedDrinksLegacyFromRows(rows, columnMap) {
    const c = columnMap || col;
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
    const DEFAULT_SHAKE_INTENSITY = 0.75;
    let lastShakeIntensity = DEFAULT_SHAKE_INTENSITY;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row) continue;
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
        const textAlign = parseTextAlign(font.align, "center");
        let shout = lastShout;
        if (c.announcementShout != null) {
          const rawShout = cell(row, c.announcementShout);
          if (rawShout != null && String(rawShout).trim() !== "") {
            shout = parseYesNo(rawShout, false);
          }
        }
        let shakeIntensity = lastShakeIntensity;
        if (c.announcementShakeIntensity != null) {
          const rawI = cell(row, c.announcementShakeIntensity);
          if (rawI != null && String(rawI).trim() !== "") {
            const n = Number(rawI);
            if (Number.isFinite(n) && n >= 0) {
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
        const rawImageCell = cell(row, c.image);
        const imageNames = parseImageCell(rawImageCell);
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
          rawImages: imageNames,
          include: parseInclude(cell(row, c.include)),
        });
      }
    }

    const s1Fill =
      c.stripeColor1 != null
        ? sheetFills[cellRef(c.stripeColor1, 2)] || null
        : null;
    const s2Fill =
      c.stripeColor2 != null
        ? sheetFills[cellRef(c.stripeColor2, 2)] || null
        : null;
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

    let overviewImg =
      c.overviewImage != null
        ? String(cell(first, c.overviewImage) || "").trim()
        : "";
    if (!overviewImg || overviewImg.toLowerCase() === "null") {
      overviewImg = null;
    }

    const stripe1Choice =
      c.stripeColor1 != null
        ? String(cell(first, c.stripeColor1) || "").trim() || null
        : null;
    const stripe2Choice =
      c.stripeColor2 != null
        ? String(cell(first, c.stripeColor2) || "").trim() || null
        : null;
    const includeStripes =
      c.includeStripes != null
        ? parseInclude(cell(first, c.includeStripes))
        : true;

    const firstMsg = messages[0] || null;
    return {
      title: String(cell(first, c.title) || ""),
      items: parsedItems,
      includeFooterBox: "drinks",
      includeStripes: includeStripes,
      stripeColor1Choice: stripe1Choice,
      stripeColor1Fill: s1Fill,
      stripeColor2Choice: stripe2Choice,
      stripeColor2Fill: s2Fill,
      announcementBox: {
        title: firstMsg ? firstMsg.title : "",
        subtitle: firstMsg ? firstMsg.subtitle : "",
        messages: messages,
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
        const path = toWebpPath(
          file.indexOf("assets/") === 0 || file.indexOf("food-pics/") === 0
            ? file
            : BG_IMAGE_FOLDER + "/" + file
        );
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

    // Frame / Style stripe pair — always Style & Theme Pattern Color 1/2.
    // Announcement-tab stripe colors are dead (spoof cells ignored).
    const stripe1 =
      resolveNamedThemeColor(
        parsed.patternColor1Choice != null
          ? parsed.patternColor1Choice
          : "main color",
        null,
        themeColors
      ) || main;
    const stripe2 =
      resolveNamedThemeColor(
        parsed.patternColor2Choice != null
          ? parsed.patternColor2Choice
          : "secondary color",
        null,
        themeColors
      ) || secondary;

    // BG Pattern colors (from Style Theme row; labels resolve against palette)
    const patternColor1 =
      resolveNamedThemeColor(
        parsed.patternColor1Choice != null
          ? parsed.patternColor1Choice
          : "main color",
        null,
        themeColors
      ) || main;
    const patternColor2 =
      resolveNamedThemeColor(
        parsed.patternColor2Choice != null
          ? parsed.patternColor2Choice
          : "secondary color",
        null,
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
    // Style BG Pattern owns the hero texture — wallpaper is not part of that theme.
    if (isStripesPatternToken(parsed.bgPattern)) {
      bgImage = null;
    }
    const bgBlur = parseUnit01(
      parsed.bgBlur != null ? parsed.bgBlur : config.bgBlur,
      0
    );
    const bgOpacity = parseUnit01(
      parsed.bgOpacity != null ? parsed.bgOpacity : config.bgOpacity,
      1
    );
    let bgBlendMode = parseBgBlendMode(
      parsed.bgBlendMode != null ? parsed.bgBlendMode : config.bgBlendMode
    );
    // For texture overlays like "film", default to overlay when the cell is blank
    // (blur/opacity stay global; only the blend mode gets a helpful default).
    if (
      (parsed.bgBlendMode == null || parsed.bgBlendMode === "") &&
      bgBlendMode === "normal" &&
      parsed.bgImage
    ) {
      const suggested = suggestBlendForWallpaper(parsed.bgImage);
      if (suggested) bgBlendMode = suggested;
    }

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
      bgPattern: parsed.bgPattern != null ? parsed.bgPattern : config.bgPattern,
      bgScrollSpeed: parseBgScrollSpeed(
        parsed.bgScrollSpeed != null
          ? parsed.bgScrollSpeed
          : config.bgScrollSpeed,
        1
      ),
      slideshowSpeed: parseSlideshowSpeed(
        parsed.slideshowSpeed != null
          ? parsed.slideshowSpeed
          : config.slideshowSpeed,
        3
      ),
      highlight: highlight,
      highlightSpecial: highlightSpecial,
      stripeColor1: stripe1,
      stripeColor2: stripe2,
      patternColor1: patternColor1,
      patternColor2: patternColor2,
      includeStripes: isDrinks ? !!parsed.includeStripes : false,
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
      familyPortrait:
        parsed.familyPortrait !== undefined
          ? !!parsed.familyPortrait
          : !!config.familyPortrait,
      presentationMode: parsePresentationMode(
        parsed.presentationMode != null
          ? parsed.presentationMode
          : config.presentationMode,
        "slideshow"
      ),
      // Sheet column later — keep explicit false if already toggled off in-session
      slideshowKenBurns:
        parsed.slideshowKenBurns !== undefined
          ? !!parsed.slideshowKenBurns
          : config.slideshowKenBurns !== false,
      encoreSpotlightType: parseEncoreSpotlightType(
        parsed.encoreSpotlightType != null
          ? parsed.encoreSpotlightType
          : config.encoreSpotlightType,
        "hard"
      ),
      encoreSpotlightColor: parseEncoreSpotlightColor(
        parsed.encoreSpotlightColor != null
          ? parsed.encoreSpotlightColor
          : config.encoreSpotlightColor,
        "black"
      ),
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
        priority: parsePriority(
          parsed.proteinBox.priority,
          FOOTER_PRIORITY_DEFAULTS.protein
        ),
        includeInPresentation: !!parsed.proteinBox.includeInPresentation,
        familyPortrait: !!parsed.proteinBox.familyPortrait,
        presentationMode: parsePresentationMode(
          parsed.proteinBox.presentationMode,
          "slideshow"
        ),
      };
      console.info(
        "Protein Create Columns?",
        proteinBox.createColumns ? "Yes" : "No",
        "align",
        proteinBox.textAlign,
        "priority",
        proteinBox.priority,
        "pres",
        proteinBox.includeInPresentation
          ? proteinBox.presentationMode +
              (proteinBox.familyPortrait ? "+FP" : "")
          : "off"
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
        priority: parsePriority(
          parsed.saucesBox.priority,
          FOOTER_PRIORITY_DEFAULTS.sauces
        ),
        includeInPresentation: !!parsed.saucesBox.includeInPresentation,
        familyPortrait: !!parsed.saucesBox.familyPortrait,
        presentationMode: parsePresentationMode(
          parsed.saucesBox.presentationMode,
          "slideshow"
        ),
      };
      console.info(
        "Sauces Create Columns?",
        saucesBox.createColumns ? "Yes" : "No",
        "align",
        saucesBox.textAlign,
        "priority",
        saucesBox.priority,
        "pres",
        saucesBox.includeInPresentation
          ? saucesBox.presentationMode +
              (saucesBox.familyPortrait ? "+FP" : "")
          : "off"
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
        priority: parsePriority(
          parsed.footerDrinksBox.priority,
          FOOTER_PRIORITY_DEFAULTS.drinks
        ),
        includeInPresentation: !!parsed.footerDrinksBox.includeInPresentation,
        familyPortrait: !!parsed.footerDrinksBox.familyPortrait,
        presentationMode: parsePresentationMode(
          parsed.footerDrinksBox.presentationMode,
          "slideshow"
        ),
      };
      console.info(
        "Footer drinks include?",
        footerDrinksBox.include ? "Yes" : "No",
        "Create Columns?",
        footerDrinksBox.createColumns ? "Yes" : "No",
        "priority",
        footerDrinksBox.priority,
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
        priority: parsePriority(
          parsed.drinkBox.priority,
          FOOTER_PRIORITY_DEFAULTS.drinks
        ),
        includeInPresentation: !!parsed.drinkBox.includeInPresentation,
        familyPortrait: !!parsed.drinkBox.familyPortrait,
        presentationMode: parsePresentationMode(
          parsed.drinkBox.presentationMode,
          "slideshow"
        ),
      };
      if (parsed.includeFooterBox) {
        _board4FooterKey = normalizeFooterBoxSelection(
          parsed.includeFooterBox
        ) || "drinks";
      }
      console.info(
        "Board 4 box:",
        _board4FooterKey,
        "Create Columns?",
        drinkBox.createColumns ? "Yes" : "No",
        "align",
        drinkBox.textAlign,
        "priority",
        drinkBox.priority,
        "present?",
        drinkBox.includeInPresentation ? "Yes" : "No",
        "FP?",
        drinkBox.familyPortrait ? "Yes" : "No",
        "mode",
        drinkBox.presentationMode
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
        const images = itemImagePaths(it);
        const image = images[0] || null;

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
          images: images.length > 1 ? images : null,
          include: cfg.forceIncludeAll
            ? true
            : parseInclude(it.include !== undefined ? it.include : 1),
        };
      })
      .filter((it) => it.name && it.include);

    if (isDrinks) buildDrinksSlides();
    else buildBoardSlides();
    applyConfigColors(); // includes applyBoxChrome()
  }

  /**
   * Multi-segment presentation for boards 1–3 (not Board 4).
   *
   * Segments in cue order:
   *   1. Alpha Menu (board items) — implicit Priority 0
   *   2. Footer Box Menus with Include in Presentation? — by Priority (lower first)
   *
   * Each segment has its own Family Portrait + Presentation Mode (Slideshow|Encore).
   * Alpha never mixes box items; each box presents only its inventory.
   * Blank Image → textOnly slide (highlight only, no hero).
   * After the last slide, setActive wraps to 0 → loop back to Alpha.
   */
  function buildBoardSlides() {
    slides = [];
    if (isDrinks) return;

    appendPresSegment({
      segment: "alpha",
      boxKey: null,
      mode: config.presentationMode,
      familyPortrait: !!config.familyPortrait,
      itemList: items
        .map(function (it, i) {
          if (!it || !it.name || it.include === false) return null;
          return {
            name: it.name,
            image: it.image || null,
            images: it.images || null,
            isNew: !!it.isNew,
            itemIndex: i,
            boxItemIndex: -1,
          };
        })
        .filter(Boolean),
    });

    const boxSpecs = [
      { key: "protein", box: proteinBox },
      { key: "sauces", box: saucesBox },
      { key: "drinks", box: footerDrinksBox },
      { key: "veggies", box: veggiesBox },
    ]
      .filter(function (s) {
        return (
          s.box &&
          s.box.include !== false &&
          s.box.includeInPresentation &&
          s.box.items &&
          s.box.items.length > 0
        );
      })
      .sort(function (a, b) {
        const pa = Number.isFinite(a.box.priority) ? a.box.priority : 999;
        const pb = Number.isFinite(b.box.priority) ? b.box.priority : 999;
        return pa - pb;
      });

    boxSpecs.forEach(function (s) {
      const box = s.box;
      const inv = box.items || [];
      // Display order (wrap/columns paint order) — fall back to sheet order
      let order =
        Array.isArray(box.displayOrder) && box.displayOrder.length
          ? box.displayOrder.slice()
          : inv.map(function (_it, i) {
              return i;
            });
      // De-dupe + drop invalid indices
      const seen = {};
      order = order.filter(function (idx) {
        if (seen[idx] || idx < 0 || idx >= inv.length) return false;
        seen[idx] = true;
        return true;
      });
      // Append any inventory rows missing from displayOrder (safety)
      for (let i = 0; i < inv.length; i++) {
        if (!seen[i]) order.push(i);
      }
      appendPresSegment({
        segment: "box",
        boxKey: s.key,
        mode: box.presentationMode || "slideshow",
        familyPortrait: !!box.familyPortrait,
        itemList: order.map(function (idx) {
          const it = inv[idx];
          return {
            name: it.name,
            image: it.image || null,
            images: it.images || null,
            isNew: !!it.isNew,
            itemIndex: idx,
            boxItemIndex: idx,
          };
        }),
      });
    });

    tokiInfo(
      "presentation slides",
      slides.length,
      "(alpha +",
      boxSpecs.length,
      "box segment(s):",
      boxSpecs
        .map(function (s) {
          return (
            s.key +
            "@" +
            s.box.priority +
            ":" +
            (s.box.presentationMode || "slideshow") +
            (s.box.familyPortrait ? "+FP" : "")
          );
        })
        .join(", ") ||
        "none",
      ")"
    );
  }

  /**
   * Append one presentation segment’s slides (portrait / encore / item).
   * Display order of itemList is the cue order (sheet order for Alpha; box
   * displayOrder for Box Menus). FP/Encore cast = only items with image paths.
   * Zero images → skip FP and Encore entirely (slideshow text highlights only).
   * Partial images → FP layout for those only; Encore bows only those (no empty seats).
   *
   * @param {{ segment: string, boxKey: string|null, mode: string, familyPortrait: boolean, itemList: Array }} opts
   */
  function appendPresSegment(opts) {
    const list = opts.itemList || [];
    if (!list.length) return;

    // Presentation Mode (Settings) → structure (which slides) + Motion Style name
    const mapped = presentationModeToStructureAndMotion(opts.mode);
    let structureMode = mapped.structure; // "encore" | "slideshow"
    const motionStyleName = mapped.motionStyle; // "Ken Burns" | "Slideshow" | "Encore"

    // Only items with a non-empty image path count for cast (broken loads stripped at paint)
    const portraitItems = list.filter(function (it) {
      return !!(it && it.name && it.image);
    });
    const hasCast = portraitItems.length > 0;
    // No images at all → cannot run FP or Encore; fall back to item slideshow structure
    if (!hasCast && structureMode === "encore") {
      structureMode = "slideshow";
    }
    const portraitOn = !!opts.familyPortrait && hasCast;
    const encoreLineup = !!opts.familyPortrait && hasCast;
    const seg = opts.segment || "alpha";
    const boxKey = opts.boxKey || null;

    /**
     * Animation Block id (product sense — barriers for Wind-up/Wind-down):
     *   encore (FP on or off) → one block for the whole encore sequence
     *   slideshow FP overview → its own block
     *   slideshow items → one block for the item cycle
     * See docs/UI_NOMENCLATURE.md §4.
     */
    function blockId(kind) {
      return seg + ":" + (boxKey || "alpha") + ":" + kind;
    }

    function base(kind, extra) {
      return Object.assign(
        {
          segment: seg,
          boxKey: boxKey,
          // structure for FP/Encore slide types
          segmentMode: structureMode,
          // Beta Motion table row name (Ken Burns vs Slideshow vs Encore)
          motionStyle: motionStyleName,
          animationBlockId: blockId(kind),
        },
        extra
      );
    }

    if (structureMode === "encore" && hasCast) {
      if (encoreLineup) {
        slides.push(
          base("encore", {
            type: "portrait",
            items: portraitItems,
            itemIndex: -1,
            boxItemIndex: -1,
            isNew: false,
            image: null,
            textOnly: false,
            // Lineup is Encore Wind-up when FP is on (composed into same block)
            isBlockWindUp: true,
          })
        );
      }
      // Encore bows ONLY items with images (partial cast → fewer bows, denser grid)
      portraitItems.forEach(function (it, bowIndex) {
        slides.push(
          base("encore", {
            type: "encore",
            items: portraitItems,
            itemIndex: it.itemIndex,
            boxItemIndex:
              it.boxItemIndex != null ? it.boxItemIndex : it.itemIndex,
            image: it.image,
            images: it.images || null,
            isNew: !!it.isNew,
            withPortrait: true,
            textOnly: false,
            // First bow is Encore Wind-up when FP lineup was skipped
            isBlockWindUp: !encoreLineup && bowIndex === 0,
          })
        );
      });
      return;
    }

    // Slideshow (or Encore-with-no-images fallback)
    if (portraitOn) {
      slides.push(
        base("fp", {
          type: "portrait",
          items: portraitItems,
          itemIndex: -1,
          boxItemIndex: -1,
          isNew: false,
          image: null,
          textOnly: false,
          isBlockWindUp: true,
        })
      );
    }
    // Every inventory row still gets a highlight beat; missing image → textOnly
    list.forEach(function (it, i) {
      slides.push(
        base("slideshow", {
          type: "item",
          itemIndex: it.itemIndex,
          boxItemIndex:
            it.boxItemIndex != null ? it.boxItemIndex : it.itemIndex,
          image: it.image || null,
          images: it.images || null,
          isNew: !!it.isNew,
          textOnly: !it.image,
          isBlockWindUp: !portraitOn && i === 0,
        })
      );
    });
  }

  let _portraitRenderKey = "";

  /**
   * Board 4 presentation = ONE box segment only (no Alpha).
   * Same appendPresSegment + Beta Motion digits as boards 1–3 box menus.
   * Mode/FP/Include come from the selected box sheet Settings (G–I).
   * Timing is NEVER local — only motionStylesByName from Beta Features → Motion.
   */
  function buildDrinksSlides() {
    slides = [];
    const inv = items || [];
    if (!inv.length) return;

    // Same gate as buildBoardSlides boxSpecs filter
    if (!drinkBox.includeInPresentation) {
      tokiInfo(
        "Board 4: box Include in Presentation? off — no motion segment"
      );
      return;
    }

    // Same displayOrder logic as boards 1–3 footer box segments
    let order =
      Array.isArray(drinkBox.displayOrder) && drinkBox.displayOrder.length
        ? drinkBox.displayOrder.slice()
        : inv.map(function (_it, i) {
            return i;
          });
    const seen = {};
    order = order.filter(function (idx) {
      if (seen[idx] || idx < 0 || idx >= inv.length) return false;
      seen[idx] = true;
      return true;
    });
    for (let i = 0; i < inv.length; i++) {
      if (!seen[i]) order.push(i);
    }

    const list = order
      .map(function (idx) {
        const it = inv[idx];
        if (!it || !it.name || it.include === false) return null;
        return {
          name: it.name,
          image: it.image || null,
          images: it.images || null,
          isNew: !!it.isNew,
          itemIndex: idx,
          boxItemIndex: idx,
        };
      })
      .filter(Boolean);
    if (!list.length) return;

    // Identical call shape to buildBoardSlides → appendPresSegment for a box
    appendPresSegment({
      segment: "box",
      boxKey: "drinks",
      mode: drinkBox.presentationMode || "slideshow",
      familyPortrait: !!drinkBox.familyPortrait,
      itemList: list,
    });

    tokiInfo(
      "presentation slides (Board 4 box-only)",
      slides.length,
      "box=",
      _board4FooterKey || "drinks",
      "@",
      drinkBox.priority,
      ":",
      drinkBox.presentationMode || "slideshow",
      drinkBox.familyPortrait ? "+FP" : "",
      "| motion from Beta Motion table"
    );
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
      // Frame stripes: raw Style & Theme hex — never Pattern Bake.
      root.style.setProperty(
        "--stripe-1",
        normalizeHex(config.stripeColor1) ||
          normalizeHex(config.patternColor1) ||
          main
      );
      root.style.setProperty(
        "--stripe-2",
        normalizeHex(config.stripeColor2) ||
          normalizeHex(config.patternColor2) ||
          secondary
      );
      const showStripes = !!config.includeStripes;
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
    // Keep BG pattern (if active) in sync with shared bgScrollSpeed
    updateBgPatternAnimation();
  }

  function updateStripeAnimation() {
    if (!els.stripesTrack) return;
    if (config.includeStripes === false) {
      els.stripesTrack.style.animationPlayState = "paused";
      return;
    }
    // One full period = black 93px + white 93px (CSS --stripe-period)
    const periodPx = 186;
    const mult = parseBgScrollSpeed(config.bgScrollSpeed, 1);
    // 0 = freeze stripes (same meaning as BG Scroll Speed on the galaxy)
    if (mult <= 0) {
      els.stripesTrack.style.animationPlayState = "paused";
      return;
    }
    const speed = BASE_SCROLL_PX_PER_SEC * mult * STRIPE_SPEED_FACTOR;
    const duration = Math.max(0.5, periodPx / Math.max(0.01, speed));
    els.stripesTrack.style.animationDuration = duration + "s";
    els.stripesTrack.style.animationPlayState = "running";
  }

  /** Apply animated BG pattern (currently "stripes" re-uses the announcement/drinks stripe anim). */
  function applyBgPattern() {
    const root = document.documentElement;
    const pat = config && config.bgPattern;
    const isStripes = isStripesPatternToken(pat);
    let bp = els.bgPattern;
    let track = els.bgPatternTrack;

    if (!bp) {
      bp = document.getElementById("bg-pattern");
      els.bgPattern = bp;
    }
    if (bp && !track) {
      track = bp.querySelector("#bg-pattern-track") || document.getElementById("bg-pattern-track");
      els.bgPatternTrack = track;
    }

    if (!bp && els.stage) {
      // Dynamically create (keeps all index*.html untouched; works in preview iframes too)
      bp = document.createElement("div");
      bp.id = "bg-pattern";
      bp.setAttribute("aria-hidden", "true");
      const tr = document.createElement("div");
      tr.id = "bg-pattern-track";
      bp.appendChild(tr);
      // Insert right after #galaxy so it paints above galaxy layers but below #frame
      const galaxy = els.galaxy || document.getElementById("galaxy");
      if (galaxy && galaxy.parentNode === els.stage) {
        if (galaxy.nextSibling) {
          els.stage.insertBefore(bp, galaxy.nextSibling);
        } else {
          els.stage.appendChild(bp);
        }
      } else {
        els.stage.appendChild(bp);
      }
      els.bgPattern = bp;
      els.bgPatternTrack = tr;
      track = tr;
    }
    if (!bp) return;

    // Board 4 frame stripes already own the only stripe animation.
    if (isDrinks && config.includeStripes) {
      bp.hidden = true;
      bp.style.display = "none";
      bp.classList.remove("active");
      document.body.classList.remove("has-bg-pattern-stripes");
      return;
    }

    if (isStripes) {
      bp.hidden = false;
      bp.style.display = "block";
      bp.classList.add("active");
      document.body.classList.add("has-bg-pattern-stripes");
      const main = config.mainColor || "#000000";
      const secondary = config.secondaryColor || "#ffffff";
      const c1 = patternBakeHex(config.patternColor1, main);
      const c2 = patternBakeHex(config.patternColor2, secondary);
      root.style.setProperty("--bg-pattern-1", c1);
      root.style.setProperty("--bg-pattern-2", c2);
      updateBgPatternAnimation(track);
    } else {
      bp.hidden = true;
      bp.style.display = "none";
      bp.classList.remove("active");
      document.body.classList.remove("has-bg-pattern-stripes");
    }
  }

  function updateBgPatternAnimation(trackEl) {
    const track = trackEl || els.bgPatternTrack || (els.bgPattern && els.bgPattern.querySelector("#bg-pattern-track"));
    if (!track) return;
    const mult = parseBgScrollSpeed(config && config.bgScrollSpeed, 1);
    const pat = config && config.bgPattern;
    if (!pat || !isStripesPatternToken(pat) || mult <= 0) {
      track.style.animationPlayState = "paused";
      return;
    }
    const periodPx = 186;
    const speed = BASE_SCROLL_PX_PER_SEC * mult * STRIPE_SPEED_FACTOR;
    const duration = Math.max(0.5, periodPx / Math.max(0.01, speed));
    track.style.animationDuration = duration + "s";
    track.style.animationPlayState = "running";
  }

  // ---------- loaders ----------

  /**
   * Prefer local Toki server Sheets API proxy (/api/sheets/*) so the spreadsheet
   * can stay private. Falls back to public Google /export URLs if the proxy is
   * not running (legacy "Anyone with the link" setup).
   */
  let _sheetsApiProxy = null; // null = unknown, true/false after probe
  /** From OliToki Menu Settings (via /api/settings). */
  let liveSettings = {
    dataSource: "",
    requireRestart: false,
    sheetId: "",
  };

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
        tokiInfo(
          "sheets proxy: yes",
          j.email || "",
          j.dataSource ? "dataSource=" + j.dataSource : ""
        );
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

  function settingsSheetId() {
    const fromWin =
      typeof window !== "undefined" && window.TOKI_SETTINGS_SHEET_ID
        ? String(window.TOKI_SETTINGS_SHEET_ID).trim()
        : "";
    return fromWin || "1OwNKHzjP46xKJBW8sTm4IOWhIzf0lENdZ8rv_GY37fY";
  }

  function extractSpreadsheetId(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]{30,}$/.test(s) && s.indexOf(" ") === -1) return s;
    return "";
  }

  function parseSettingsRows(rows) {
    let dataSource = "";
    let requireRestart = false;
    const catalog = [];
    let headerIdx = -1;
    let catalogIdx = -1;
    for (let i = 0; i < (rows || []).length; i++) {
      const a = String((rows[i] && rows[i][0]) || "")
        .trim()
        .toLowerCase();
      const b = String((rows[i] && rows[i][1]) || "")
        .trim()
        .toLowerCase();
      if (headerIdx < 0 && a === "data source") headerIdx = i;
      if (catalogIdx < 0 && (a + " " + b).indexOf("gsheet") !== -1 && (a + " " + b).indexOf("url") !== -1) {
        catalogIdx = i;
      }
    }
    if (headerIdx >= 0 && headerIdx + 1 < rows.length) {
      dataSource = String((rows[headerIdx + 1] && rows[headerIdx + 1][0]) || "").trim();
      requireRestart = parseYesNo(
        rows[headerIdx + 1] && rows[headerIdx + 1][1],
        false
      );
    }
    if (catalogIdx >= 0) {
      for (let i = catalogIdx + 1; i < rows.length; i++) {
        const name = String((rows[i] && rows[i][0]) || "").trim();
        const url = String((rows[i] && rows[i][1]) || "").trim();
        if (!name && !url) continue;
        catalog.push({
          name: name,
          url: url,
          sheetId: extractSpreadsheetId(url),
        });
      }
    }
    const key = dataSource.toLowerCase();
    let match = null;
    if (key) {
      for (let i = 0; i < catalog.length; i++) {
        if (String(catalog[i].name || "").trim().toLowerCase() === key) {
          match = catalog[i];
          break;
        }
      }
    }
    return {
      dataSource: dataSource || "Alpha Copy",
      requireRestart: requireRestart,
      sheetId: (match && match.sheetId) || "",
      sourceName: (match && match.name) || "",
    };
  }

  function applyLiveSettingsPayload(j) {
    liveSettings = {
      dataSource: j.dataSource || "",
      requireRestart: !!j.requireRestart,
      sheetId: j.sheetId || "",
    };
    if (liveSettings.sheetId) {
      cfg.googleSheetId = liveSettings.sheetId;
    }
    tokiInfo(
      "live settings:",
      "dataSource=" + (liveSettings.dataSource || "?"),
      "requireRestart=" + liveSettings.requireRestart,
      "sheet=" + (liveSettings.sheetId || "?")
    );
  }

  async function fetchLiveSettingsFromPublicExport() {
    const sid = settingsSheetId();
    const url =
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(sid) +
      "/export?format=csv&gid=0&cachebust=" +
      Date.now();
    const res = await fetch(url, { cache: "no-store", mode: "cors" });
    if (!res.ok) {
      throw new Error("Settings export HTTP " + res.status);
    }
    const text = await res.text();
    if (/^\s*</.test(text)) {
      throw new Error(
        "Settings sheet is not public (Google returned a login page). Share OliToki Menu Settings as Anyone with the link → Viewer."
      );
    }
    return parseSettingsRows(parseCsv(text));
  }

  async function fetchLiveSettings() {
    try {
      const useProxy = await detectSheetsApiProxy();
      if (useProxy) {
        try {
          const res = await fetch("/api/settings?t=" + Date.now(), {
            cache: "no-store",
          });
          if (res.ok) {
            applyLiveSettingsPayload(await res.json());
            return liveSettings;
          }
          tokiWarn("live settings: proxy HTTP " + res.status + " — trying public Settings");
        } catch (proxyErr) {
          tokiWarn(
            "live settings: proxy failed — trying public Settings",
            proxyErr && proxyErr.message ? proxyErr.message : proxyErr
          );
        }
      }
      applyLiveSettingsPayload(await fetchLiveSettingsFromPublicExport());
    } catch (err) {
      tokiWarn(
        "live settings unavailable (staying on config.js sheet):",
        err && err.message ? err.message : err
      );
    }
    return liveSettings;
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

  /**
   * Fetch one sheet as rows.
   * @param {string|number} gid
   * @param {{ force?: boolean }} [opts]
   *   force (default true): ask proxy to re-batchGet from Google so sheet edits
   *   show on hard refresh / soft reload. Concurrent boards coalesce server-side.
   *   force:false only for opportunistic reads (rare).
   */
  async function fetchSheetRows(gid, opts) {
    opts = opts || {};
    const force = opts.force !== false; // default TRUE — live sheet is the CMS
    const useProxy = await detectSheetsApiProxy();
    let url;
    if (useProxy) {
      url =
        "/api/sheets/csv?gid=" +
        encodeURIComponent(String(gid)) +
        (force ? "&force=1" : "") +
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
   * themesCols: { themeName, mainColor, secondaryColor, highlight, highlightSpecial }
   * fill letters: legacy C–F (cols 2–5) or revised B–E (cols 1–4).
   */
  function isStyleThemeRow(row, excelRow, fills, themesCols, fillLetters) {
    const tc = themesCols || STYLE_COLUMNS;
    const letters = fillLetters || ["C", "D", "E", "F"];
    const name = String(cell(row, tc.themeName) || "").trim();
    // Skip section headers / glossary headers
    const low = name.toLowerCase();
    if (
      low === "theme name" ||
      low === "settings" ||
      low.indexOf("themes database") === 0 ||
      low.indexOf("styles glossary") === 0
    ) {
      return false;
    }
    if (name) return true;
    if (
      cell(row, tc.mainColor) ||
      cell(row, tc.secondaryColor) ||
      cell(row, tc.highlight) ||
      cell(row, tc.highlightSpecial)
    ) {
      return true;
    }
    const f = fills || {};
    for (let i = 0; i < letters.length; i++) {
      if (f[letters[i] + excelRow]) return true;
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
   * Theme Selector: first non-empty selector cell that matches a known theme name.
   * Legacy: scans column A. Revised: pass settingsSelector only (Settings values row col A).
   */
  function findSelectedThemeName(rows, sc, themes, settingsSelector) {
    if (settingsSelector != null && String(settingsSelector).trim() !== "") {
      const sel = String(settingsSelector).trim();
      const key = normalizeThemeKey(sel);
      if (key === "0" || key === "1" || key === "true" || key === "false") {
        return null;
      }
      for (let k = 0; k < themes.length; k++) {
        const tn = String(cell(themes[k].row, sc.themeName) || "").trim();
        if (normalizeThemeKey(tn) === key) return tn;
      }
      return sel; // still return for logging even if not found
    }
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
      if (key === "0" || key === "1" || key === "true" || key === "false") {
        continue;
      }
      if (nameSet[key]) return sel.trim();
      for (let k = 0; k < themes.length; k++) {
        const tn = String(cell(themes[k].row, sc.themeName) || "").trim();
        if (normalizeThemeKey(tn) === key) return tn;
      }
    }
    return null;
  }

  /**
   * Locate section data row in revised Style sheet.
   * Layout: section label → column-header row → data row(s).
   * Returns 0-based index of the first data row after headers, or -1.
   */
  function findRevisedSectionDataStart(rows, sectionLabel) {
    const want = String(sectionLabel || "")
      .trim()
      .toLowerCase();
    for (let i = 0; i < rows.length; i++) {
      const label = String((rows[i] && rows[i][0]) || "")
        .trim()
        .toLowerCase();
      if (label === want || label.indexOf(want) === 0) {
        // i = section label, i+1 = headers, i+2 = first data
        return i + 2;
      }
    }
    return -1;
  }

  /**
   * Parse Style & Theme rows (+ optional cell fills) into a theme object.
   * Shared by Google Sheet and local Menu.xlsx paths.
   *
   * Supports:
   * - Legacy flat Style tab (STYLE_COLUMNS)
   * - Style and Theme (gid 183083022, revised): Settings + Themes Database sections
   */
  function parseStyleThemeFromRows(rows, fills) {
    fills = fills || {};
    if (!rows || rows.length < 2) {
      throw new Error("Style sheet has no data row");
    }

    const isRevised =
      String(cfg.styleThemeGid) === STYLE_REVISED_GID ||
      (rows[0] &&
        String(rows[0][0] || "")
          .trim()
          .toLowerCase() === "settings");

    // Column maps + fill letters depend on sheet layout
    const setCols = isRevised ? STYLE_REVISED_SETTINGS : STYLE_COLUMNS;
    const themeCols = isRevised ? STYLE_REVISED_THEME : STYLE_COLUMNS;
    const themeFillLetters = isRevised
      ? ["B", "C", "D", "E"]
      : ["C", "D", "E", "F"];
    const bgColorFillLetter = isRevised ? "B" : "G";

    // --- Board-wide settings row ---
    let boardRowIndex = STYLE_BOARD_WIDE_ROW_INDEX;
    let themesStart = 1;
    let settingsSelector = null;

    if (isRevised) {
      const settingsData = findRevisedSectionDataStart(rows, "settings");
      if (settingsData < 0) {
        throw new Error(
          "Style and Theme (revised): could not find Settings section (label → headers → values)"
        );
      }
      boardRowIndex = settingsData;
      const themesData = findRevisedSectionDataStart(rows, "themes database");
      themesStart = themesData >= 0 ? themesData : settingsData + 1;
      settingsSelector = cell(rows[boardRowIndex], setCols.themeSelector);
    }

    const themes = [];
    for (let i = themesStart; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.some((v) => v != null && String(v).trim() !== "")) {
        continue;
      }
      const excelRow = i + 1;
      if (
        !isStyleThemeRow(
          row,
          excelRow,
          fills,
          themeCols,
          themeFillLetters
        )
      ) {
        continue;
      }
      themes.push({ row: row, excelRow: excelRow });
    }

    if (!themes.length) throw new Error("Style sheet has no theme rows");

    const selectedName = findSelectedThemeName(
      rows,
      isRevised
        ? { themeSelector: setCols.themeSelector, themeName: themeCols.themeName }
        : STYLE_COLUMNS,
      themes,
      isRevised ? settingsSelector : null
    );
    let chosen = null;
    if (selectedName) {
      const key = normalizeThemeKey(selectedName);
      chosen = themes.find(function (t) {
        return normalizeThemeKey(cell(t.row, themeCols.themeName)) === key;
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
        cell(chosen.row, themeCols.themeName) || "row " + chosen.excelRow
      );
    }

    const first = chosen.row;
    const er = chosen.excelRow;
    const themeName =
      String(cell(first, themeCols.themeName) || "").trim() || null;

    // Theme palette — fills use B–E (revised) or C–F (legacy)
    const main = resolveColor(
      cell(first, themeCols.mainColor),
      fills[themeFillLetters[0] + er],
      "#000000"
    );
    const secondary = resolveColor(
      cell(first, themeCols.secondaryColor),
      fills[themeFillLetters[1] + er],
      "#ffffff"
    );
    const highlight =
      resolveColor(
        cell(first, themeCols.highlight),
        fills[themeFillLetters[2] + er],
        "#26bbcb"
      ) || "#26bbcb";
    const highlightSpecial =
      resolveColor(
        cell(first, themeCols.highlightSpecial),
        fills[themeFillLetters[3] + er],
        "#fff900"
      ) || "#fff900";

    // Pattern Color 1 / 2 are dropdowns (values from the "Color Picker (for dropdowns)" glossary).
    // If the chosen theme row leaves the cell blank, inherit the selection label from
    // the defaults row (Toki Default / row 6 in the Themes Database).
    let patternColor1Choice = isRevised
      ? String(cell(first, themeCols.patternColor1) || "").trim() || null
      : null;
    let patternColor2Choice = isRevised
      ? String(cell(first, themeCols.patternColor2) || "").trim() || null
      : null;

    if (isRevised && (!patternColor1Choice || !patternColor2Choice)) {
      let defaultRow = null;
      const defKey = "tokidefault";
      for (let t of themes) {
        if (normalizeThemeKey(cell(t.row, themeCols.themeName)) === defKey) {
          defaultRow = t.row;
          break;
        }
      }
      if (!defaultRow && themes.length) {
        defaultRow = themes[0].row;
      }
      if (defaultRow) {
        if (!patternColor1Choice) {
          patternColor1Choice =
            String(cell(defaultRow, themeCols.patternColor1) || "").trim() || null;
        }
        if (!patternColor2Choice) {
          patternColor2Choice =
            String(cell(defaultRow, themeCols.patternColor2) || "").trim() || null;
        }
      }
    }

    // Ensure we always have explicit dropdown labels for resolution (never null)
    if (isRevised) {
      if (!patternColor1Choice) patternColor1Choice = "main color";
      if (!patternColor2Choice) patternColor2Choice = "secondary color";
    }

    const palette = {
      mainColor: main,
      secondaryColor: secondary,
      highlight: highlight,
      highlightSpecial: highlightSpecial,
    };

    const boardRow = rows[boardRowIndex] || rows[1];
    const boardEr = boardRowIndex + 1;

    const bgColor = parseBgColor(
      cell(boardRow, setCols.bgColor),
      fills[bgColorFillLetter + boardEr],
      palette
    );
    // BG Pattern (revised only)
    const bgPatternRaw =
      setCols.bgPattern != null
        ? String(cell(boardRow, setCols.bgPattern) || "").trim()
        : "";
    const bgPattern =
      !bgPatternRaw ||
      /^(none|off|0|false|no|-|—)$/i.test(bgPatternRaw)
        ? null
        : bgPatternRaw;
    const bgImgResolved = resolveStageBgImageFromRows(
      rows,
      setCols,
      boardRowIndex
    );
    const bgImage = bgImgResolved.path;
    const bgBlur = parseUnit01(cell(boardRow, setCols.bgBlur), 0);
    const bgBlendMode = parseBgBlendMode(cell(boardRow, setCols.bgBlendMode));
    const bgOpacity = parseUnit01(cell(boardRow, setCols.bgOpacity), 1);
    const bgScrollSpeed = parseBgScrollSpeed(
      cell(boardRow, setCols.bgScrollSpeed),
      1
    );
    const slideshowSpeed = parseSlideshowSpeed(
      cell(boardRow, setCols.slideshowSpeed),
      3
    );
    const showVersion =
      setCols.showVersion != null
        ? parseYesNo(cell(boardRow, setCols.showVersion), false)
        : false;
    const encoreSpotlightType = parseEncoreSpotlightType(
      setCols.encoreSpotlightType != null
        ? cell(boardRow, setCols.encoreSpotlightType)
        : "",
      "hard"
    );
    const encoreSpotlightColor = parseEncoreSpotlightColor(
      setCols.encoreSpotlightColor != null
        ? cell(boardRow, setCols.encoreSpotlightColor)
        : "",
      "black"
    );

    const theme = {
      themeName: themeName,
      mainColor: main,
      secondaryColor: secondary,
      highlight: highlight,
      highlightSpecial: highlightSpecial,
      bgColor: bgColor,
      bgPattern: bgPattern,
      patternColor1Choice: patternColor1Choice,
      patternColor2Choice: patternColor2Choice,
      bgImage: bgImage,
      bgBlur: bgBlur,
      bgBlendMode: bgBlendMode,
      bgOpacity: bgOpacity,
      bgMode: bgImage ? "image" : "solid",
      bgSolid: bgColor,
      bgScrollSpeed: bgScrollSpeed,
      slideshowSpeed: slideshowSpeed,
      showVersion: !!showVersion,
      encoreSpotlightType: encoreSpotlightType,
      encoreSpotlightColor: encoreSpotlightColor,
    };
    tokiInfo(
      "Style theme:",
      isRevised ? "(revised)" : "(legacy)",
      theme.themeName || "(unnamed)",
      "main",
      theme.mainColor,
      "secondary",
      theme.secondaryColor,
      "bgColor",
      theme.bgColor,
      "bgPattern",
      theme.bgPattern || "(none)",
      "patternColors",
      (theme.patternColor1Choice || "main") + "/" + (theme.patternColor2Choice || "secondary"),
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
      theme.bgBlendMode,
      "encoreSpot",
      theme.encoreSpotlightType,
      theme.encoreSpotlightColor
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
    parsed.bgPattern = theme.bgPattern != null ? theme.bgPattern : null;
    parsed.patternColor1Choice = theme.patternColor1Choice || null;
    parsed.patternColor2Choice = theme.patternColor2Choice || null;
    parsed.bgImage = theme.bgImage;
    parsed.bgBlur = theme.bgBlur;
    parsed.bgBlendMode = theme.bgBlendMode;
    parsed.bgOpacity = theme.bgOpacity;
    parsed.bgMode = theme.bgMode;
    parsed.bgSolid = theme.bgSolid;
    parsed.bgScrollSpeed = theme.bgScrollSpeed;
    parsed.slideshowSpeed = theme.slideshowSpeed;
    parsed.showVersion = !!theme.showVersion;
    parsed.encoreSpotlightType = theme.encoreSpotlightType;
    parsed.encoreSpotlightColor = theme.encoreSpotlightColor;
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

    // Cell-fill colors quarantined (typed hex in the Style tab still works).
    const fills = {};

    const rows =
      opts.styleRows != null
        ? opts.styleRows
        : await fetchSheetRows(gid);
    if (!rows) return null;
    return parseStyleThemeFromRows(rows, fills);
  }

  /**
   * Parse Debug Menu tab.
   * Structure:
   *   A1: "Debug Mode"   A2: TRUE/FALSE
   *   Then "Debug Features"
   *   Next row: column headers (Performance Console, Version History, ...)
   *   Next row: values (TRUE/FALSE or 1/0 or checkboxes)
   *
   * Only when debugMode && features["Performance Console"] are both true
   * will the menu automatically emit detailed console flag output.
   */
  function parseDebugMenu(rows) {
    const out = {
      debugMode: false,
      features: {},
    };
    if (!rows || !rows.length) return out;

    // Debug Mode (vertical label + value)
    for (let i = 0; i < rows.length - 1; i++) {
      const label = String(rows[i][0] || "").trim().toLowerCase();
      if (label === "debug mode") {
        out.debugMode = parseYesNo(rows[i + 1] ? rows[i + 1][0] : "", false);
        break;
      }
    }

    // Debug Features table (horizontal headers + values row)
    // Headers may include: Performance Console, Version History, Full View, ...
    for (let i = 0; i < rows.length - 2; i++) {
      const label = String(rows[i][0] || "").trim().toLowerCase();
      if (label === "debug features") {
        const headers = rows[i + 1] || [];
        const values = rows[i + 2] || [];
        for (let c = 0; c < headers.length; c++) {
          const name = String(headers[c] || "").trim();
          if (name) {
            out.features[name] = parseYesNo(values[c], false);
          }
        }
        break;
      }
    }
    return out;
  }

  /** Debug Menu → Full View: show entire HUD without scroll (Fire Stick). */
  function isDebugFullView() {
    if (!debugConfig || !debugConfig.debugMode) return false;
    const fv =
      debugConfig.features["Full View"] ||
      debugConfig.features["FullView"] ||
      debugConfig.features["full view"];
    return !!fv;
  }

  /** True only when both the master Debug Mode and "Performance Console" are enabled in the sheet. */
  function shouldSendPerformanceConsole() {
    if (!debugConfig || !debugConfig.debugMode) return false;
    const pc = debugConfig.features["Performance Console"];
    return !!pc;
  }

  /**
   * Shared Protein sheet:
   * Title | Subtitle | Color | Item | Price | Create Columns? | Text Align
   */
  /**
   * Shared Proteins sheet (footer box add-ons).
   * Supports legacy flat layout and revised (Settings + Inventory sections).
   * New "Image" column in revised Inventory is ignored for now.
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
      priority: FOOTER_PRIORITY_DEFAULTS.protein,
      includeInPresentation: false,
      familyPortrait: false,
      presentationMode: "slideshow",
    };
    if (!rows || rows.length < 2) return box;

    // Detect revised Proteins sheet (gid 1420775786+): Settings section + Inventory section
    const isProteinRevised =
      rows &&
      rows[0] &&
      String(rows[0][0] || "").trim().toLowerCase() === "settings";

    if (isProteinRevised) {
      // Settings: label at i, headers i+1, data at i+2
      const settingsIdx = findRevisedSectionDataStart(rows, "settings");
      const srow =
        settingsIdx >= 0 && settingsIdx < rows.length ? rows[settingsIdx] : rows[2];
      const bs = BOX_REVISED_SETTINGS;

      box.title = String(cell(srow, bs.title) || "").trim();
      box.subtitle = String(cell(srow, bs.subtitle) || "").trim();
      box.bgChoice = String(cell(srow, bs.bgColor) || "").trim() || null;
      // Color fill likely on the data row (e.g. C3); fall back to legacy C2
      const sRow1 = settingsIdx + 1;
      box.bgFill =
        fills["C" + sRow1] ||
        fills["C" + (sRow1 + 1)] ||
        fills["C2"] ||
        fills["C" + 2] ||
        null;

      box.createColumns = parseYesNo(cell(srow, bs.createColumns), true);
      box.textAlign = parseTextAlign(cell(srow, bs.textAlign), "right");
      box.priority = parsePriority(
        cell(srow, bs.priority),
        FOOTER_PRIORITY_DEFAULTS.protein
      );
      applyBoxPresentationSettings(box, srow);

      // Inventory items using uniform BOX_REVISED_INVENTORY
      const invIdx = findRevisedSectionDataStart(rows, "inventory");
      const start = invIdx >= 0 ? invIdx : 5;
      const proteinFolder = FOOTER_BOX_IMAGE_FOLDERS.protein;
      for (let i = start; i < rows.length; i++) {
        const it = parseBoxInventoryItemRow(rows[i], proteinFolder);
        if (it) box.items.push(it);
      }
      return box;
    }

    // Legacy flat structure (old Proteins gid) — no per-item New/Include columns
    const first = rows[1];
    box.title = String(cell(first, 0) || "").trim();
    box.subtitle = String(cell(first, 1) || "").trim();
    box.bgChoice = String(cell(first, 2) || "").trim() || null;
    box.bgFill = fills["C2"] || fills["C" + 2] || null;
    // F = Create Columns? · G = Text Align (legacy flat layout)
    box.createColumns = firstColumnYesNo(rows, 5, true);
    box.textAlign = firstColumnTextAlign(rows, 6, "right");
    box.priority = FOOTER_PRIORITY_DEFAULTS.protein;
    for (let i = 1; i < rows.length; i++) {
      const name = cell(rows[i], 3);
      if (!name) continue;
      box.items.push({
        name: String(name).trim(),
        price: formatPrice(cell(rows[i], 4)),
        isNew: false,
      });
    }
    return box;
  }

  /**
   * Shared Sauces sheet (revised or legacy).
   * Revised (Sauces Revised gid=1630545949): uses uniform BOX_* columns.
   *   Settings: Title | Subtitle | BG Color | Create Columns? | Text Align
   *   Inventory: Item | Item Subtitle | Item Price | New | Image | Include
   * Legacy: flat row with Sauces Box Title etc + items in col D.
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
      priority: FOOTER_PRIORITY_DEFAULTS.sauces,
      includeInPresentation: false,
      familyPortrait: false,
      presentationMode: "slideshow",
    };
    if (!rows || rows.length < 2) return box;

    const isSaucesRevised =
      rows &&
      rows[0] &&
      String(rows[0][0] || "").trim().toLowerCase() === "settings";

    if (isSaucesRevised) {
      const settingsIdx = findRevisedSectionDataStart(rows, "settings");
      const srow =
        settingsIdx >= 0 && settingsIdx < rows.length ? rows[settingsIdx] : rows[2];
      const bs = BOX_REVISED_SETTINGS;

      box.title = String(cell(srow, bs.title) || "").trim();
      box.subtitle = String(cell(srow, bs.subtitle) || "").trim();
      box.bgChoice = String(cell(srow, bs.bgColor) || "").trim() || null;
      const sRow1 = settingsIdx + 1;
      box.bgFill =
        fills["C" + sRow1] ||
        fills["C" + (sRow1 + 1)] ||
        fills["C2"] ||
        null;

      box.createColumns = parseYesNo(cell(srow, bs.createColumns), false);
      box.textAlign = parseTextAlign(cell(srow, bs.textAlign), "center");
      box.priority = parsePriority(
        cell(srow, bs.priority),
        FOOTER_PRIORITY_DEFAULTS.sauces
      );
      applyBoxPresentationSettings(box, srow);

      const invIdx = findRevisedSectionDataStart(rows, "inventory");
      const start = invIdx >= 0 ? invIdx : 5;
      const saucesFolder = FOOTER_BOX_IMAGE_FOLDERS.sauces;
      for (let i = start; i < rows.length; i++) {
        const it = parseBoxInventoryItemRow(rows[i], saucesFolder);
        if (it) box.items.push(it);
      }
      return box;
    }

    // Legacy flat structure
    const first = rows[1];
    box.title = String(cell(first, 0) || "").trim();
    box.subtitle = String(cell(first, 1) || "").trim();
    box.bgChoice = String(cell(first, 2) || "").trim() || null;
    box.bgFill = fills["C2"] || null;
    // E = Create Columns? · F = Text Align (legacy)
    box.createColumns = firstColumnYesNo(rows, 4, false);
    box.textAlign = firstColumnTextAlign(rows, 5, "center");
    box.priority = FOOTER_PRIORITY_DEFAULTS.sauces;
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
    const isRevBoard = BOARD_REVISED_GIDS.includes(String(cfg.googleSheetGid || "")) ||
      (boardRows && boardRows[0] && String(boardRows[0][0] || "").trim().toLowerCase() === "settings");
    if (isRevBoard) {
      // already read from Settings block in main parse
      if (parsed.proteinBox && parsed.proteinBox.include !== undefined) flagP = !!parsed.proteinBox.include;
      if (parsed.saucesBox && parsed.saucesBox.include !== undefined) flagS = !!parsed.saucesBox.include;
    } else if (boardRows && col.includeProteinBox != null) {
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
    if (isRevBoard) {
      // already handled above
    } else if (boardRows && col.includeSaucesBox != null) {
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
            const fills = {};
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
            const fills = {};
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
   * Boards 1–3: load Veggies sheet (new 4th footer box) when selected via the list.
   * Always loads content when called — caller decides include/exile afterward.
   */
  async function attachVeggiesBox(parsed, prefetched) {
    if (!parsed || !cfg.veggiesSheetGid) return parsed;
    prefetched = prefetched || {};

    try {
      const fills = {};

      const rows =
        prefetched.veggiesRows != null
          ? prefetched.veggiesRows
          : await fetchSheetRows(cfg.veggiesSheetGid);

      if (!rows) throw new Error("no veggies rows");

      const box = parseVeggiesSheetRows(rows, fills);
      parsed.veggiesBox = {
        title: box.title || "Veggies",
        subtitle: box.subtitle || "",
        items: box.items || [],
        bgChoice: box.bgChoice,
        bgFill: box.bgFill,
        createColumns: !!box.createColumns,
        textAlign: box.textAlign || "center",
        priority: box.priority != null ? box.priority : 4,
        include: true,
        includeInPresentation: !!box.includeInPresentation,
        familyPortrait: !!box.familyPortrait,
        presentationMode: parsePresentationMode(
          box.presentationMode,
          "slideshow"
        ),
      };
      console.info(
        "Veggies sheet loaded:",
        cfg.veggiesSheetGid,
        "items",
        (box.items || []).length,
        "title",
        parsed.veggiesBox.title,
        "priority",
        parsed.veggiesBox.priority
      );
    } catch (err) {
      console.warn("Could not load Veggies sheet:", err);
      if (!parsed.veggiesBox) {
        parsed.veggiesBox = {
          title: "Veggies",
          items: [],
          include: true,
          priority: 4,
        };
      } else {
        parsed.veggiesBox.include = true;
      }
    }
    return parsed;
  }

  /** Paint one footer box chrome (bg / text CSS vars + body surface). */
  function paintFooterBoxChrome(elId, bgVar, textVar, color, image, text) {
    const main = config.mainColor || "#000000";
    const secondary = config.secondaryColor || "#ffffff";
    const bg = normalizeHex(color) || main;
    const textColor = text || pickContrastingThemeColor(bg, main, secondary);
    const root = document.documentElement;
    root.style.setProperty(bgVar, bg);
    root.style.setProperty(textVar, textColor);
    if (typeof applyBoxBodySurface === "function") {
      applyBoxBodySurface(document.getElementById(elId), bg, image || null);
    }
    return { bg: bg, text: textColor };
  }

  /**
   * Resolve a footer box Settings BG Color without needing applyParsedMenu's
   * nested boxSurfaceFrom (not in outer scope).
   */
  function resolveFooterBoxBg(box) {
    const main = config.mainColor || "#000000";
    if (!box) return main;
    const choice = box.bgChoice != null ? box.bgChoice : box.bg;
    const s = String(choice == null ? "" : choice).trim();
    const low = s.toLowerCase();
    if (!s) {
      return normalizeHex(box.bgFill) || main;
    }
    if (low === "main color" || low === "main") return main;
    if (low === "secondary color" || low === "secondary") {
      return config.secondaryColor || "#ffffff";
    }
    if (low === "highlight") return config.highlight || main;
    if (low === "highlight special" || low === "special") {
      return config.highlightSpecial || main;
    }
    const hex = normalizeHex(s);
    if (hex) return hex;
    return normalizeHex(box.bgFill) || main;
  }

  /** Turn off every footer box and repaint (explicit empty Include Footer Boxes). */
  function exileAllFooterBoxes(parsed) {
    if (parsed) {
      if (parsed.proteinBox) parsed.proteinBox.include = false;
      if (parsed.saucesBox) parsed.saucesBox.include = false;
      if (parsed.footerDrinksBox) parsed.footerDrinksBox.include = false;
      if (parsed.veggiesBox) parsed.veggiesBox.include = false;
    }
    proteinBox.include = false;
    saucesBox.include = false;
    footerDrinksBox.include = false;
    footerDrinksBox.items = [];
    footerDrinksBox.includeInPresentation = false;
    veggiesBox.include = false;
    veggiesBox.items = [];
    veggiesBox.includeInPresentation = false;
    renderFooterBoxes();
    if (!isDrinks) buildBoardSlides();
  }

  /**
   * Apply "Include Footer Boxes" list (from per-board Settings row if present,
   * else central Beta Features tab) as the source of truth for boards 1–3.
   * Loads named boxes not yet attached (Drinks/Veggies), ranks by Priority (lower=higher),
   * keeps top 3, exiles the rest (include=false, never rendered), re-paints.
   *
   * Empty per-board cell = show no footer boxes (does not keep last state / defaults).
   */
  async function applyBetaFooterBoxesOverride(parsed) {
    if (!parsed || isDrinks) return parsed;

    let want = null; // null = board did not own the list → Beta / legacy flags
    // Revised boards always pass an array (possibly empty). Empty is authoritative.
    if (Array.isArray(parsed.includeFooterBoxes)) {
      want = parsed.includeFooterBoxes;
      console.info("Per-board Include Footer Boxes:", want.length ? want : "(empty)");
    } else {
      // Fallback to central Beta Features tab
      try {
        const betaRows =
          parsed._betaRows != null
            ? parsed._betaRows
            : await fetchSheetRows(BETA_FEATURES_GID);
        const beta = parseBetaFeatures(betaRows);
        want = beta.footerBoxes || [];
      } catch (err) {
        console.warn("No per-board list and Beta Features tab unavailable; using board flags", err);
        return parsed;
      }
    }

    if (!want || !want.length) {
      console.info("Include Footer Boxes empty — no footer boxes");
      exileAllFooterBoxes(parsed);
      return parsed;
    }

    const wantSet = {};
    want.forEach(function (t) {
      wantSet[t] = true;
    });
    console.info("Include Footer Boxes raw:", want);

    // Load every named box that needs content (before ranking so Priority is real)
    if (wantSet.Veggies && cfg.veggiesSheetGid) {
      await attachVeggiesBox(parsed, {
        veggiesRows: parsed._veggiesRows || null,
      });
    }
    if (wantSet.Drinks && cfg.drinksSheetGid) {
      // Force include true so attachFooterDrinksBox does not early-return empty
      parsed.footerDrinksBox = Object.assign(
        {},
        parsed.footerDrinksBox || {},
        { include: true }
      );
      await attachFooterDrinksBox(parsed, null, {});
    }

    // Build registry with live priorities from loaded sheet data
    function prioOf(box, fallback) {
      if (!box) return fallback;
      return parsePriority(box.priority, fallback);
    }
    const registry = [
      {
        title: "Proteins",
        priority: prioOf(parsed.proteinBox || proteinBox, FOOTER_PRIORITY_DEFAULTS.protein),
      },
      {
        title: "Sauces",
        priority: prioOf(parsed.saucesBox || saucesBox, FOOTER_PRIORITY_DEFAULTS.sauces),
      },
      {
        title: "Drinks",
        priority: prioOf(
          parsed.footerDrinksBox || footerDrinksBox,
          FOOTER_PRIORITY_DEFAULTS.drinks
        ),
      },
      {
        title: "Veggies",
        priority: prioOf(parsed.veggiesBox || veggiesBox, 4),
      },
    ];
    const selected = selectFooterBoxesFromBeta(want, registry);
    const selectedTitles = selected.map(function (s) {
      return s.title;
    });
    console.info(
      "Footer Boxes active (top 3 by Priority):",
      selected.map(function (s) {
        return s.title + "@" + s.priority;
      })
    );

    const showP = selectedTitles.indexOf("Proteins") !== -1;
    const showS = selectedTitles.indexOf("Sauces") !== -1;
    const showD = selectedTitles.indexOf("Drinks") !== -1;
    const showV = selectedTitles.indexOf("Veggies") !== -1;

    // Sync include flags onto parsed + globals
    if (parsed.proteinBox) parsed.proteinBox.include = showP;
    if (parsed.saucesBox) parsed.saucesBox.include = showS;
    if (parsed.footerDrinksBox) parsed.footerDrinksBox.include = showD;
    if (parsed.veggiesBox) parsed.veggiesBox.include = showV;
    else if (showV) {
      parsed.veggiesBox = { title: "Veggies", items: [], include: true, priority: 4 };
    }

    proteinBox.include = showP;
    saucesBox.include = showS;
    // Keep presentation flags from sheet parse (applyParsedMenu) for proteins/sauces

    // Promote fully loaded drinks / veggies into global runtime boxes
    if (showD && parsed.footerDrinksBox) {
      const fd = parsed.footerDrinksBox;
      const bg = resolveFooterBoxBg(fd);
      footerDrinksBox = {
        title: fd.title || "",
        subtitle: fd.subtitle || "",
        items: fd.items || [],
        bg: bg,
        bgImage: null,
        bgChoice: fd.bgChoice,
        bgFill: fd.bgFill,
        include: true,
        createColumns: !!fd.createColumns,
        textAlign: parseTextAlign(fd.textAlign, "center"),
        priority: parsePriority(fd.priority, FOOTER_PRIORITY_DEFAULTS.drinks),
        includeInPresentation: !!fd.includeInPresentation,
        familyPortrait: !!fd.familyPortrait,
        presentationMode: parsePresentationMode(
          fd.presentationMode,
          "slideshow"
        ),
      };
      paintFooterBoxChrome(
        "footer-drinks-box",
        "--footer-drinks-box-bg",
        "--footer-drinks-box-text",
        footerDrinksBox.bg,
        null,
        null
      );
    } else {
      footerDrinksBox.include = false;
      footerDrinksBox.items = [];
      footerDrinksBox.includeInPresentation = false;
    }

    if (showV && parsed.veggiesBox) {
      const vb = parsed.veggiesBox;
      const bg = resolveFooterBoxBg(vb);
      veggiesBox = {
        title: vb.title || "Veggies",
        subtitle: vb.subtitle || "",
        items: vb.items || [],
        bg: bg,
        bgImage: null,
        bgChoice: vb.bgChoice,
        bgFill: vb.bgFill,
        include: true,
        createColumns: !!vb.createColumns,
        textAlign: parseTextAlign(vb.textAlign, "center"),
        priority: parsePriority(vb.priority, 4),
        includeInPresentation: !!vb.includeInPresentation,
        familyPortrait: !!vb.familyPortrait,
        presentationMode: parsePresentationMode(
          vb.presentationMode,
          "slideshow"
        ),
      };
      paintFooterBoxChrome(
        "veggies-box",
        "--veggies-box-bg",
        "--veggies-box-text",
        veggiesBox.bg,
        null,
        null
      );
    } else {
      veggiesBox.include = false;
      veggiesBox.items = [];
      veggiesBox.includeInPresentation = false;
    }

    // Re-paint layout + bodies with the final set
    renderFooterBoxes();
    // Rebuild presentation after include/exile is final (box segments depend on it)
    if (!isDrinks) {
      buildBoardSlides();
    }
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
    const isRevBoard = BOARD_REVISED_GIDS.includes(String(cfg.googleSheetGid || "")) ||
      (boardRows && boardRows[0] && String(boardRows[0][0] || "").trim().toLowerCase() === "settings");
    if (isRevBoard) {
      // For revised, the include* were already read from the Settings data row in parsedMenuFromRows
      if (parsed.footerDrinksBox && parsed.footerDrinksBox.include !== undefined) {
        flagD = !!parsed.footerDrinksBox.include;
      }
    } else if (boardRows && col.includeDrinksBox != null) {
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
      const fills = {};
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
            price: it.price || "",
            isNew: !!it.isNew,
            image: it.image || null,
            images: it.images || null,
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
        priority:
          box.priority != null
            ? box.priority
            : FOOTER_PRIORITY_DEFAULTS.drinks,
        include: true,
        includeInPresentation: !!box.includeInPresentation,
        familyPortrait: !!box.familyPortrait,
        presentationMode: parsePresentationMode(
          box.presentationMode,
          "slideshow"
        ),
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
    const proteinName = pickBestSheetName(names, {
      exact: ["Proteins", "Protein"],
      match: /protein/i,
    });
    const saucesName = pickBestSheetName(names, {
      exact: ["Sauces", "Sauce"],
      match: /sauce/i,
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

    // Detect revised Drinks sheet (uniform Settings + Inventory like Proteins/Sauces)
    const isDrinksRevised =
      rows &&
      rows[0] &&
      String(rows[0][0] || "").trim().toLowerCase() === "settings";

    if (isDrinksRevised) {
      const bs = BOX_REVISED_SETTINGS;
      const bi = BOX_REVISED_INVENTORY;

      const settingsIdx = findRevisedSectionDataStart(rows, "settings");
      const srow =
        settingsIdx >= 0 && settingsIdx < rows.length ? rows[settingsIdx] : rows[2];

      const drinkChoice = String(cell(srow, bs.bgColor) || "").trim() || null;
      // Fills for drinks box use the BG Color cell in settings data row
      const sRow1 = settingsIdx + 1;
      const drinkFill =
        fills["C" + sRow1] || fills["C" + (sRow1 + 1)] || fills["C2"] || null;

      const invIdx = findRevisedSectionDataStart(rows, "inventory");
      const start = invIdx >= 0 ? invIdx : 5;

      const items = [];
      for (let i = start; i < rows.length; i++) {
        const row = rows[i];
        const name = cell(row, bi.item);
        if (name === "" || name == null) continue;
        const includeRaw = cell(row, bi.include);
        const inc =
          includeRaw !== "" && includeRaw != null
            ? parseInclude(includeRaw)
            : true;
        if (!inc) continue;

        const imgs = parseBoxItemImages(
          cell(row, bi.image),
          FOOTER_BOX_IMAGE_FOLDERS.drinks
        );
        const subtitle = String(cell(row, bi.itemSubtitle) || "").trim();
        const priceStr = formatPrice(cell(row, bi.price));
        items.push({
          name: String(name).trim(),
          price: priceStr,
          prices: priceStr ? [priceStr] : [],
          description: "",
          subtitle: subtitle,
          isNew: parseIsNew(cell(row, bi.isNew)),
          image: imgs.image,
          images: imgs.images,
          include: true,
        });
      }

      // Settings: Title…Priority + presentation G–I. Overview/individual stay true
      // for Board 4 slideshow until dedicated Settings columns are added.
      const drinkBox = {
        title: String(cell(srow, bs.title) || "").trim(),
        subtitle: String(cell(srow, bs.subtitle) || "").trim(),
        bgChoice: drinkChoice,
        bgFill: drinkFill,
        createColumns: parseYesNo(cell(srow, bs.createColumns), false),
        textAlign: parseTextAlign(cell(srow, bs.textAlign), "center"),
        priority: parsePriority(
          cell(srow, bs.priority),
          FOOTER_PRIORITY_DEFAULTS.drinks
        ),
        includeInPresentation: false,
        familyPortrait: false,
        presentationMode: "slideshow",
      };
      applyBoxPresentationSettings(drinkBox, srow);
      return {
        items: items,
        drinkBox: drinkBox,
        drinksOverview: true,
        drinksIndividual: true,
        overviewImage: null,
      };
    }

    // Legacy flat drinks content
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
   * Board 4: load the single selected footer box into #drink-options-box.
   * Selection from Announcements Settings "Include Footer Box" (singular):
   *   Drinks | Proteins | Sauces | Veggies | blank/none
   * Each box honors its own sheet Settings (BG color/CF, Create Columns, Align).
   * @param {object} [prefetched] optional { drinksRows, proteinRows, saucesRows, veggiesRows }
   */
  async function attachSharedDrinksSheet(parsed, prefetched) {
    if (!parsed || !isDrinks) return parsed;
    prefetched = prefetched || {};

    const sel = normalizeFooterBoxSelection(
      parsed.includeFooterBox != null
        ? parsed.includeFooterBox
        : "drinks"
    );

    if (!sel) {
      parsed.items = [];
      parsed.drinkBox = Object.assign({}, parsed.drinkBox || {}, {
        title: "",
        subtitle: "",
        items: [],
        include: false,
        createColumns: false,
        textAlign: "center",
      });
      parsed.drinksOverview = false;
      parsed.drinksIndividual = false;
      console.info("Board 4 Include Footer Box: (none) — options box empty");
      return parsed;
    }

    try {
      if (sel === "drinks") {
        if (cfg.drinksSheetGid == null || cfg.drinksSheetGid === "") {
          console.warn(
            "Include Footer Box=Drinks but drinksSheetGid is not set"
          );
          return parsed;
        }
        const fills = {};
        const rows =
          prefetched.drinksRows != null
            ? prefetched.drinksRows
            : await fetchSheetRows(cfg.drinksSheetGid);
        if (!rows) throw new Error("no drinks content rows");
        const content = parseDrinksContentSheetRows(rows, fills);
        mergeDrinksContentIntoParsed(parsed, content);
        console.info(
          "Board 4 footer box: Drinks",
          "items",
          (content.items || []).length,
          "title",
          content.drinkBox && content.drinkBox.title
        );
        return parsed;
      }

      // Proteins / Sauces / Veggies → same drink-options slot, their sheet settings
      let box = null;
      let items = [];
      if (sel === "protein") {
        if (!cfg.proteinSheetGid) {
          console.warn("Include Footer Box=Proteins but proteinSheetGid unset");
          return parsed;
        }
        const fills = {};
        const rows =
          prefetched.proteinRows != null
            ? prefetched.proteinRows
            : await fetchSheetRows(cfg.proteinSheetGid);
        box = parseProteinSheetRows(rows, fills);
        items = (box.items || []).filter(function (it) {
          return it && it.include !== false;
        });
      } else if (sel === "sauces") {
        if (!cfg.saucesSheetGid) {
          console.warn("Include Footer Box=Sauces but saucesSheetGid unset");
          return parsed;
        }
        const fills = {};
        const rows =
          prefetched.saucesRows != null
            ? prefetched.saucesRows
            : await fetchSheetRows(cfg.saucesSheetGid);
        box = parseSaucesSheetRows(rows, fills);
        items = (box.items || []).filter(function (it) {
          return it && it.include !== false;
        });
      } else if (sel === "veggies") {
        if (!cfg.veggiesSheetGid) {
          console.warn("Include Footer Box=Veggies but veggiesSheetGid unset");
          return parsed;
        }
        const fills = {};
        const rows =
          prefetched.veggiesRows != null
            ? prefetched.veggiesRows
            : await fetchSheetRows(cfg.veggiesSheetGid);
        box = parseVeggiesSheetRows(rows, fills);
        items = (box.items || []).filter(function (it) {
          return it && it.include !== false;
        });
      } else {
        console.warn(
          "Board 4 Include Footer Box unknown selection:",
          parsed.includeFooterBox
        );
        return parsed;
      }

      if (!box) return parsed;

      const mappedItems = items.map(function (it) {
        return {
          name: it.name,
          subtitle: it.subtitle || "",
          price: it.price || "",
          prices: it.prices || (it.price ? [it.price] : []),
          description: "",
          isNew: !!it.isNew,
          image: it.image || null,
          images: it.images || null,
          include: true,
        };
      });

      parsed.items = mappedItems;
      parsed.includeFooterBox = sel;
      parsed.drinkBox = {
        title: box.title || "",
        subtitle: box.subtitle || "",
        bgChoice: box.bgChoice,
        bgFill: box.bgFill,
        createColumns: !!box.createColumns,
        textAlign: parseTextAlign(box.textAlign, "center"),
        priority: parsePriority(
          box.priority,
          sel === "protein"
            ? FOOTER_PRIORITY_DEFAULTS.protein
            : sel === "sauces"
              ? FOOTER_PRIORITY_DEFAULTS.sauces
              : sel === "veggies"
                ? 4
                : FOOTER_PRIORITY_DEFAULTS.drinks
        ),
        includeInPresentation: !!box.includeInPresentation,
        familyPortrait: !!box.familyPortrait,
        presentationMode: parsePresentationMode(
          box.presentationMode,
          "slideshow"
        ),
      };
      parsed.drinksOverview = true;
      parsed.drinksIndividual = true;
      parsed.overviewImage = null;
      console.info(
        "Board 4 footer box:",
        sel,
        "items",
        mappedItems.length,
        "title",
        box.title,
        "Create Columns?",
        box.createColumns ? "Yes" : "No",
        "align",
        box.textAlign,
        "present?",
        box.includeInPresentation ? "Yes" : "No",
        "FP?",
        box.familyPortrait ? "Yes" : "No",
        "mode",
        box.presentationMode
      );
    } catch (err) {
      console.warn(
        "Board 4 footer box attach failed (" + sel + "):",
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
    const contentName = pickBestSheetName(names, {
      exact: ["Drinks", "Drink Options", "Drinks Menu", "Drinks Content"],
      match: function (n) {
        if (/drink\s*option/i.test(n)) return true;
        return /drink/i.test(n) && !/deal/i.test(n) && !/announce/i.test(n);
      },
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
   * Live Google Sheet load (API-only: values/CSV, no Drive xlsx).
   * @param {object} [opts]
   * @param {boolean} [opts.soft] soft reload: re-fetch CSVs; skip re-render if unchanged.
   */
  async function loadMenuFromGoogleSheet(opts) {
    opts = opts || {};
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();

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
    if (cfg.veggiesSheetGid != null && cfg.veggiesSheetGid !== "") {
      // Boards 1–3 footer + Board 4 Include Footer Box=Veggies
      csvJobs.veggies = fetchSheetRows(cfg.veggiesSheetGid);
    }
    // Beta Features on EVERY board — Motion table drives Punch/Hold/Out digits
    // (Board 4 previously skipped this → hardcoded defaults → different timing).
    // Boards 1–3 also use Include Footer Boxes fallback from the same tab.
    csvJobs.beta = fetchSheetRows(BETA_FEATURES_GID);
    if (cfg.styleThemeGid != null && cfg.styleThemeGid !== "") {
      csvJobs.style = fetchSheetRows(cfg.styleThemeGid);
    }
    if (cfg.debugMenuGid != null && cfg.debugMenuGid !== "") {
      csvJobs.debug = fetchSheetRows(cfg.debugMenuGid);
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
      veggies: csv.veggies || null,
      beta: csv.beta || null,
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

    sheetFills = {};
    sheetFonts = {};
    sheetRich = {};

    let parsed = parsedMenuFromRows(csv.main, col);

    if (cfg.proteinSheetGid || cfg.saucesSheetGid) {
      parsed = await attachSharedProteinSauces(parsed, csv.main, {
        proteinRows: csv.protein,
        saucesRows: csv.sauces,
      });
    }

    if (isDrinks) {
      // Announcements Settings → single footer box (Drinks / Proteins / Sauces / Veggies)
      parsed = await attachSharedDrinksSheet(parsed, {
        drinksRows: csv.drinks,
        proteinRows: csv.protein,
        saucesRows: csv.sauces,
        veggiesRows: csv.veggies,
      });
    } else if (cfg.drinksSheetGid) {
      parsed = await attachFooterDrinksBox(parsed, csv.main, {
        drinksRows: csv.drinks,
      });
    }

    // Prefetch stash for Beta override (avoid second network round-trip / 429)
    parsed._betaRows = csv.beta || null;
    parsed._veggiesRows = csv.veggies || null;

    // Beta → Motion table (Ken Burns digits, etc.) — always apply when present
    try {
      if (csv.beta) {
        const betaMotion = parseBetaFeatures(csv.beta);
        applyMotionStylesConfig(betaMotion.motionStyles || {});
        applyVeilShadowConfig(betaMotion.veilShadow);
        applyPatternBakeConfig(betaMotion.patternBake);
      } else {
        applyMotionStylesConfig({});
        applyVeilShadowConfig(VEIL_SHADOW_DEFAULTS);
        applyPatternBakeConfig(false);
      }
    } catch (motionErr) {
      tokiWarn("Motion styles load failed; using Ken Burns defaults", motionErr);
      applyMotionStylesConfig({});
      applyVeilShadowConfig(VEIL_SHADOW_DEFAULTS);
      applyPatternBakeConfig(false);
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

    // Debug Menu (master switch + feature toggles)
    if (cfg.debugMenuGid != null && cfg.debugMenuGid !== "") {
      try {
        debugConfig = parseDebugMenu(csv.debug);
        tokiInfo(
          "debug menu",
          "mode=",
          debugConfig.debugMode,
          "features=",
          debugConfig.features
        );
      } catch (err) {
        console.warn("Could not load Debug Menu:", err);
        debugConfig = { debugMode: false, features: {} };
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
    // Prefer bare Board N titles (skip "Board 1 (old)"), then product names.
    const prefer = {
      bowls: {
        exact: ["Board 1", "Bowls"],
        patterns: [/board\s*1/i, /bowls/i],
      },
      handhelds: {
        exact: ["Board 2", "Handhelds"],
        patterns: [/board\s*2/i, /handheld/i],
      },
      munchies: {
        exact: ["Board 3", "Munchies"],
        patterns: [/board\s*3/i, /munchies/i],
      },
      drinks: {
        exact: ["Board 4", "Announcements"],
        patterns: [/board\s*4/i, /announce/i],
      },
    };
    const spec = prefer[cfg.layout] || { exact: [], patterns: [] };
    for (let p = 0; p < (spec.patterns || []).length; p++) {
      const hit = pickBestSheetName(names, {
        exact: p === 0 ? spec.exact : [],
        match: spec.patterns[p],
      });
      if (hit) return hit;
    }
    // Never use Style/Theme as menu data (it's usually first after the reorder)
    const notStyle = pickBestSheetName(names, {
      match: function (n) {
        return !/style|theme/i.test(n);
      },
    });
    return notStyle || names[0];
  }

  function pickStyleSheetName(wb) {
    const names = wb.SheetNames || [];
    return pickBestSheetName(names, {
      exact: ["Style and Theme", "Style & Theme"],
      match: /style|theme/i,
    });
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
   * Local workbook: cell values only. Fills/fonts/rich are quarantined
   * (deprecated/sheet-styles/). Requires vendor/xlsx.full.min.js if you
   * re-enable the local data source.
   */
  async function loadMenuFromXlsx() {
    if (typeof XLSX === "undefined") {
      throw new Error("SheetJS (XLSX) not loaded");
    }
    const buf = await fetchLocalXlsxBuffer();
    sheetFills = {};
    sheetFonts = {};
    sheetRich = {};

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
        const styleFills = {};
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
      const drinkFills = {};
      if (isDrinks) {
        attachSharedDrinksFromWorkbook(parsed, wb, drinkFills);
      } else if (parsed.footerDrinksBox && parsed.footerDrinksBox.include) {
        attachFooterDrinksFromWorkbook(parsed, wb, drinkFills);
      }
    } catch (err) {
      console.warn("Local drinks content sheet unavailable:", err);
    }

    // Beta Features → Motion (same table as Google path; all boards)
    try {
      const betaName = pickBestSheetName(wb.SheetNames || [], {
        exact: ["Beta Features", "Beta"],
        match: /beta/i,
      });
      if (betaName && wb.Sheets[betaName]) {
        const betaRows = XLSX.utils.sheet_to_json(wb.Sheets[betaName], {
          header: 1,
          defval: null,
          raw: true,
        });
        const betaMotion = parseBetaFeatures(betaRows);
        applyMotionStylesConfig(betaMotion.motionStyles || {});
        applyVeilShadowConfig(betaMotion.veilShadow);
        applyPatternBakeConfig(betaMotion.patternBake);
      } else {
        applyMotionStylesConfig({});
        applyVeilShadowConfig(VEIL_SHADOW_DEFAULTS);
        applyPatternBakeConfig(false);
      }
    } catch (err) {
      console.warn("Local Beta Motion unavailable:", err);
      applyMotionStylesConfig({});
      applyVeilShadowConfig(VEIL_SHADOW_DEFAULTS);
      applyPatternBakeConfig(false);
    }

    return parsed;
  }

  /** Local xlsx → footer drinks box (boards 1–3). */
  function attachFooterDrinksFromWorkbook(parsed, wb, fills) {
    if (!parsed || !wb || isDrinks) return parsed;
    const names = wb.SheetNames || [];
    const contentName = pickBestSheetName(names, {
      exact: ["Drinks", "Drink"],
      match: function (n) {
        return /drink/i.test(n) && !/deal/i.test(n) && !/board/i.test(n);
      },
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
        return {
          name: it.name,
          subtitle: it.subtitle || "",
          price: it.price || "",
          isNew: !!it.isNew,
        };
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
      priority:
        box.priority != null
          ? box.priority
          : FOOTER_PRIORITY_DEFAULTS.drinks,
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
    await fetchLiveSettings();

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
      });
      if (parsed && parsed.__tokiUnchanged) {
        return "unchanged";
      }
      const fp = parsed._fingerprint || null;
      if (parsed._fingerprint) delete parsed._fingerprint;
      applyParsedMenu(parsed);
      try {
        await applyBetaFooterBoxesOverride(parsed);
      } catch (betaErr) {
        console.warn(
          "Beta footer override failed (soft refresh):",
          betaErr && betaErr.message ? betaErr.message : betaErr
        );
      }
      if (fp) _lastDataFingerprint = fp;
      dataSource = "google-sheet";
      tokiInfo("refresh: applied sheet changes", "fp=" + (fp || "?"));
      updateDebugVisuals();
      if (shouldSendPerformanceConsole()) {
        try { window.TokiMenuDebug && window.TokiMenuDebug.list && window.TokiMenuDebug.list(); } catch (e) {}
      }
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
        // Apply Beta override on top (main board data from xlsx; Beta + Veggies/Drinks fetch live)
        try {
          await applyBetaFooterBoxesOverride(parsed);
        } catch (betaErr) {
          console.warn(
            "Beta footer override failed (local xlsx):",
            betaErr && betaErr.message ? betaErr.message : betaErr
          );
        }
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
        });
        if (parsed._fingerprint) {
          _lastDataFingerprint = parsed._fingerprint;
          delete parsed._fingerprint;
        }
        applyParsedMenu(parsed);
        try {
          await applyBetaFooterBoxesOverride(parsed);
        } catch (betaErr) {
          // Never let Beta override kill the whole board load
          console.warn(
            "Beta footer override failed (board still loaded):",
            betaErr && betaErr.message ? betaErr.message : betaErr
          );
        }

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
          const p = await loadMenuFromXlsx();
          applyParsedMenu(p);
          try {
            await applyBetaFooterBoxesOverride(p);
          } catch (betaErr) {
            console.warn(
              "Beta footer override failed (xlsx fallback):",
              betaErr && betaErr.message ? betaErr.message : betaErr
            );
          }
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

    const titleChanged = !prev || prev.title !== msg.title;
    const subChanged = !prev || prev.subtitle !== msg.subtitle;
    const FADE_MS = 350;

    // Per-message Announcement Box Color (inherits blanks at parse time)
    (function applyAnnouncementBoxColor() {
      const theme = {
        mainColor: config.mainColor,
        secondaryColor: config.secondaryColor,
        highlight: config.highlight,
        highlightSpecial: config.highlightSpecial,
      };
      const bg =
        resolveNamedThemeColor(msg.bgChoice, msg.bgFill, theme) ||
        announcementBox.bg ||
        config.announcementBg ||
        config.mainColor ||
        "#000000";
      announcementBox.bg = bg;
      config.announcementBg = bg;
      if (els.announcementBodyRect) {
        els.announcementBodyRect.style.fill = bg;
      }
      config.announcementBodyText = pickContrastingThemeColor(
        bg,
        config.mainColor,
        config.secondaryColor
      );
    })();

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

    const drinkShell = document.getElementById("drink-options-box");
    const hasDrinkItems = Array.isArray(items) && items.length > 0;
    const drinkBoxOn =
      hasDrinkItems ||
      !!(drinkBox && (drinkBox.title || drinkBox.subtitle));
    if (drinkShell) {
      drinkShell.hidden = !drinkBoxOn;
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
        // Presentation highlight path uses data-box-item-index (same as footer boxes)
        span.dataset.boxItemIndex = String(index);

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
        // Proteins / priced boxes: honor Item Price from their sheet
        const priceStr =
          (it.price && String(it.price).trim()) ||
          (it.prices && it.prices[0] ? String(it.prices[0]).trim() : "");
        if (priceStr) {
          const priceEl = document.createElement("span");
          priceEl.className = "drink-item-price";
          priceEl.textContent = " " + priceStr;
          span.appendChild(priceEl);
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
    // Presentation cue order follows painted DOM (wrap L→R / columns)
    captureBoxDisplayOrderFromDom(els.drinkBoxBody, drinkBox);
    if (isDrinks) buildDrinksSlides();
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
    syncInfoBoxShell(document.getElementById("veggies-box"));
  }

  /**
   * Footer layout (boards 1–3) — docs/FOOTER_BOXES.md
   *  0 → hide strip
   *  1 → one box 1082px
   *  2 → left-heavy 768 + 299 (lowest Priority number = major/left)
   *  3 → even thirds, 15px gaps (Priority only affects left→right order)
   * Sizes never change — only which box sits in major/minor/slots.
   */
  function applyFooterBoxesLayout() {
    if (!els.footerBoxes) return;
    const showP = proteinBox.include !== false;
    const showS = saucesBox.include !== false;
    const showD = !!footerDrinksBox.include;
    const showV = !!veggiesBox.include;

    // typeOrder is the stable tie-break when Priority values match.
    const slots = [
      {
        id: "protein-box",
        show: showP,
        priority: proteinBox.priority,
        typeOrder: 0,
      },
      {
        id: "sauces-box",
        show: showS,
        priority: saucesBox.priority,
        typeOrder: 1,
      },
      {
        id: "footer-drinks-box",
        show: showD,
        priority: footerDrinksBox.priority,
        typeOrder: 2,
      },
      {
        id: "veggies-box",
        show: showV,
        priority: veggiesBox.priority != null ? veggiesBox.priority : 4,
        typeOrder: 3,
      },
    ];
    const visible = [];
    slots.forEach(function (s) {
      const el = document.getElementById(s.id);
      if (!el) return;
      el.hidden = !s.show;
      el.classList.remove("footer-major", "footer-minor");
      if (s.show) {
        // Use the box's own default if the value is missing
        let defP = FOOTER_PRIORITY_DEFAULTS.protein;
        if (s.id === "sauces-box") defP = FOOTER_PRIORITY_DEFAULTS.sauces;
        else if (s.id === "footer-drinks-box") defP = FOOTER_PRIORITY_DEFAULTS.drinks;
        else if (s.id === "veggies-box") defP = 4;
        visible.push({
          el: el,
          priority: s.priority != null ? Number(s.priority) : defP,
          typeOrder: s.typeOrder,
          id: s.id,
        });
      }
    });

    // Lowest Priority number first (leftmost). Tie → protein, sauces, drinks.
    visible.sort(function (a, b) {
      const pa = Number.isFinite(a.priority) ? a.priority : 0;
      const pb = Number.isFinite(b.priority) ? b.priority : 0;
      if (pa !== pb) return pa - pb; // smaller number wins (higher priority)
      return a.typeOrder - b.typeOrder;
    });

    // DOM order = left → right so flex major/minor land correctly.
    visible.forEach(function (v) {
      els.footerBoxes.appendChild(v.el);
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

    // Two boxes: lowest Priority number = major (768 left), higher number = minor (299).
    // Three boxes: equal thirds — Priority only affects left→right order (via DOM sort above).
    if (n === 2) {
      visible[0].el.classList.add("footer-major");
      visible[1].el.classList.add("footer-minor");
    }

    const any = n > 0;
    els.footerBoxes.hidden = !any;
    els.footerBoxes.style.display = any ? "" : "none";

    void els.footerBoxes.offsetWidth;
    syncFooterBoxShells();
    console.info(
      "Footer boxes:",
      mode,
      "order",
      visible.map(function (v) {
        return v.id + "@" + v.priority;
      }),
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

  /**
   * Shared footer-box body paint (protein / sauces / footer drinks).
   * Same datapoints → same structure: name · (subtitle) · + $price · is-new.
   * @param {HTMLElement} bodyEl
   * @param {object} box — { items, createColumns, textAlign, include }
   * @param {object} conf
   * @param {string} conf.colItemClass — extra class on column row
   * @param {string} conf.wrapItemClass — extra class on wrap chip
   * @param {string} conf.sepClass
   * @param {string} conf.breakClass
   * @param {boolean} [conf.defaultColumns]
   */
  function renderFooterBoxBody(bodyEl, box, conf) {
    if (!bodyEl || !box) return;
    conf = conf || {};
    bodyEl.innerHTML = "";
    bodyEl.style.setProperty("--box-scale", "1");

    // reset line-count conditional classes
    bodyEl.classList.remove("lines-1", "lines-2", "lines-3", "lines-4", "lines-many");
    bodyEl.removeAttribute("data-line-count");
    // Display order for presentation cue (sheet index order until packed)
    box.displayOrder = [];

    // protein defaultColumns:true → on unless explicit No
    // sauces/drinks defaultColumns:false → off unless explicit Yes
    const columnsOn =
      conf.defaultColumns === true
        ? box.createColumns !== false
        : !!box.createColumns;

    setBoxLayoutMode(bodyEl, columnsOn);
    setBoxTextAlign(bodyEl, box.textAlign);
    setFooterTypoMode(bodyEl, footerTypoModeClass(box.items));

    if (box.include === false) return;

    const list = box.items || [];
    if (!list.length) return;

    // Boxes in presentation: no static Special on New — only turn highlight
    const suppressNewStyle = !!box.includeInPresentation;
    const partOpts = { suppressNewStyle: suppressNewStyle };

    if (columnsOn) {
      list.forEach(function (it, idx) {
        const row = document.createElement("div");
        row.className =
          (conf.colItemClass || "box-col-item") + " box-col-item";
        setBoxItemIndexAttr(row, idx);
        appendFooterItemParts(row, it, partOpts);
        bodyEl.appendChild(row);
        box.displayOrder.push(idx);
      });
      return;
    }

    // Preserve inventory indices through wrap packing
    const measured = list.map(function (it, idx) {
      return {
        label: footerItemMeasureLabel(it),
        name: it.name,
        subtitle: it.subtitle || "",
        price: it.price || "",
        isNew: !!it.isNew,
        _boxItemIndex: idx,
      };
    });
    const lines = balanceItemsIntoLines(
      measured,
      balanceOptsFromBox(bodyEl, {
        sepText: " · ",
        maxLines: 8,
      })
    );

    // Conditional formatting for line count (used for tighter 2-line spacing)
    bodyEl.classList.remove("lines-1", "lines-2", "lines-3", "lines-4", "lines-many");
    const lc = lines.length || 1;
    bodyEl.classList.add(lc >= 5 ? "lines-many" : "lines-" + lc);
    bodyEl.dataset.lineCount = String(lc);

    lines.forEach(function (line, li) {
      line.forEach(function (it, i) {
        const span = document.createElement("span");
        span.className =
          (conf.wrapItemClass || "wrap-item") + " wrap-item";
        const invIdx = it._boxItemIndex != null ? it._boxItemIndex : -1;
        setBoxItemIndexAttr(span, invIdx);
        if (invIdx >= 0) box.displayOrder.push(invIdx);
        appendFooterItemParts(span, it, partOpts);
        bodyEl.appendChild(span);
        if (i < line.length - 1) {
          const sep = document.createElement("span");
          sep.className = (conf.sepClass || "wrap-sep") + " wrap-sep";
          sep.textContent = " · ";
          sep.setAttribute("aria-hidden", "true");
          bodyEl.appendChild(sep);
        }
      });
      if (li < lines.length - 1) {
        const br = document.createElement("span");
        br.className =
          (conf.breakClass || "wrap-line-break") + " wrap-line-break";
        br.setAttribute("aria-hidden", "true");
        bodyEl.appendChild(br);
      }
    });
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
    if (els.footerDrinksTitle) {
      els.footerDrinksTitle.textContent = footerDrinksBox.title || "";
    }
    if (els.footerDrinksSubtitle) {
      els.footerDrinksSubtitle.textContent = footerDrinksBox.subtitle || "";
    }
    // Re-bind in case HTML loaded after els init (defensive)
    if (!els.veggiesTitle) els.veggiesTitle = document.getElementById("veggies-title");
    if (!els.veggiesSubtitle) els.veggiesSubtitle = document.getElementById("veggies-subtitle");
    if (!els.veggiesBody) els.veggiesBody = document.getElementById("veggies-body");
    if (els.veggiesTitle) els.veggiesTitle.textContent = veggiesBox.title || "";
    if (els.veggiesSubtitle) {
      els.veggiesSubtitle.textContent = veggiesBox.subtitle || "";
    }

    renderFooterBoxBody(els.proteinBody, proteinBox, {
      defaultColumns: true,
      colItemClass: "protein-row",
      wrapItemClass: "protein-wrap-item",
      sepClass: "protein-wrap-sep",
      breakClass: "protein-line-break",
    });

    renderFooterBoxBody(els.saucesBody, saucesBox, {
      defaultColumns: false,
      colItemClass: "sauce-col-item",
      wrapItemClass: "sauce-item",
      sepClass: "sauce-sep",
      breakClass: "sauce-line-break",
    });

    renderFooterBoxBody(els.footerDrinksBody, footerDrinksBox, {
      defaultColumns: false,
      colItemClass: "footer-drink-col-item",
      wrapItemClass: "footer-drink-item",
      sepClass: "footer-drink-sep",
      breakClass: "footer-drink-line-break",
    });

    renderFooterBoxBody(els.veggiesBody, veggiesBox, {
      defaultColumns: false,
      colItemClass: "veggie-col-item",
      wrapItemClass: "veggie-item",
      sepClass: "veggie-sep",
      breakClass: "veggie-line-break",
    });

    // Shells after content/layout settle (width may change when solo)
    syncFooterBoxShells();
    fitFooterBoxes();
    // Presentation cue follows painted DOM order (wrap L→R, columns top→bottom)
    captureBoxDisplayOrderFromDom(els.proteinBody, proteinBox);
    captureBoxDisplayOrderFromDom(els.saucesBody, saucesBox);
    captureBoxDisplayOrderFromDom(els.footerDrinksBody, footerDrinksBox);
    captureBoxDisplayOrderFromDom(
      els.veggiesBody || document.getElementById("veggies-body"),
      veggiesBox
    );
    if (!isDrinks) {
      buildBoardSlides();
    }
  }

  /** Read data-box-item-index in DOM paint order → box.displayOrder */
  function captureBoxDisplayOrderFromDom(bodyEl, box) {
    if (!bodyEl || !box) return;
    const order = [];
    bodyEl.querySelectorAll("[data-box-item-index]").forEach(function (el) {
      const idx = Number(el.dataset.boxItemIndex);
      if (Number.isFinite(idx) && idx >= 0) order.push(idx);
    });
    if (order.length) box.displayOrder = order;
  }

  /** @deprecated use footerItemMeasureLabel */
  function proteinWrapLabel(it) {
    return footerItemMeasureLabel(it);
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
        el.classList.contains("footer-drink-item") ||
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

    if (veggiesBox.include && els.veggiesBody) {
      if (veggiesBox.createColumns) {
        fitColumnBox(els.veggiesBody, {
          rowSelector: ".box-col-item, .veggie-col-item",
          label: "Veggies",
          minColPx: 120,
        });
      } else {
        fitWrapBox(els.veggiesBody, {
          sepSelector: ".veggie-sep, .wrap-sep",
          forceBreakSelector: ".veggie-force-break",
          lineBreakClass: "veggie-line-break",
          forceBreakClass: "veggie-force-break",
          itemClass: "veggie-item",
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

    // Set line count class for 2-row (and other) conditional spacing
    const visualRows = Math.max(1, Math.ceil(n / bestCols));
    el.classList.remove("lines-1", "lines-2", "lines-3", "lines-4", "lines-many");
    el.classList.add(visualRows >= 5 ? "lines-many" : "lines-" + visualRows);
    el.dataset.lineCount = String(visualRows);

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

  // ---------- Family Portrait lattice + render ----------

  /**
   * Photo-side trapezoid from #frame vector (Board 1–3):
   *   TL (1071.9, 0) → TR (1920, 0) → BR (1920, 1080) → BL (1156.5, 1080)
   * x_cutout(y) = 1071.925 + 0.078335 * y  (same fit as frame comment)
   * Stage AABB is left-aligned at TL.x with full height; lattice rows use
   * the local left edge along the cutout so points sit in the visible wedge.
   */
  const PORTRAIT_CUTOUT_X0 = 1071.9;
  const PORTRAIT_CUTOUT_SLOPE = 0.078335; // dx/dy of frame diagonal
  const PORTRAIT_STAGE_LEFT = PORTRAIT_CUTOUT_X0;
  const PORTRAIT_STAGE_W = 1920 - PORTRAIT_CUTOUT_X0; // ~848.1
  const PORTRAIT_STAGE_H = 1080;
  const PORTRAIT_IMG_W = 1500;
  const PORTRAIT_IMG_H = 1000;
  /** Board 4 hero-wrap CSS left (mirrored photo side). Keep in sync with menu.css */
  const HERO_WRAP_LEFT_DRINKS = -255;
  const HERO_WRAP_LEFT_DEFAULT = 870;
  const HERO_WRAP_TOP = 133;

  /**
   * Board 4 mirrors the frame: photo on the LEFT, panel on the RIGHT.
   * FP / Encore lattice uses flat left + diagonal right (quarantine from boards 1–3).
   */
  function isHeroPhotoLeft() {
    return isDrinks;
  }

  function portraitStageLeftPx() {
    return isHeroPhotoLeft() ? 0 : PORTRAIT_CUTOUT_X0;
  }

  function heroWrapLeftPx() {
    return isHeroPhotoLeft() ? HERO_WRAP_LEFT_DRINKS : HERO_WRAP_LEFT_DEFAULT;
  }

  /** Local cutout inset along the diagonal (px into the photo wedge from the frame edge). */
  function portraitCutoutLocalX(y) {
    return PORTRAIT_CUTOUT_SLOPE * Math.max(0, Math.min(PORTRAIT_STAGE_H, y));
  }

  /**
   * Choose rows×cols lattice and slot positions for n photos.
   * Incomplete last row is centered (bottom shortfall).
   * Coordinates in portrait-stage-local px; origin at photo center.
   *
   * Boards 1–3: diagonal on LEFT of wedge (inset grows with y).
   * Board 4: diagonal on RIGHT of wedge (flat left, right inset grows with y).
   */
  function buildPortraitLayout(n, stageW, stageH, opts) {
    opts = opts || {};
    const useCutout = opts.useCutout !== false; // default true (for family portrait)
    const photoLeft = opts.photoLeft != null ? !!opts.photoLeft : isHeroPhotoLeft();
    stageW = stageW || PORTRAIT_STAGE_W;
    stageH = stageH || PORTRAIT_STAGE_H;
    if (n <= 0) {
      return { slots: [], cols: 0, rows: 0, scale: 1, stageW: stageW, stageH: stageH };
    }

    // Usable width is narrower at bottom (~764) than top (~848) — use mid width for aspect
    const midInset = portraitCutoutLocalX(stageH * 0.5);
    const midW = Math.max(1, stageW - midInset);
    const targetAspect = midW / stageH;
    const ideal = Math.sqrt(n);
    let best = null;
    // Also try padded n' = n..n+3 so e.g. 11 → 12 (3×4) instead of 1×11
    const candidates = [];
    for (let nPad = n; nPad <= n + 3; nPad++) {
      for (let cols = 1; cols <= nPad; cols++) {
        const rows = Math.ceil(nPad / cols);
        if (rows * cols < n) continue;
        candidates.push({ cols: cols, rows: rows, capacity: rows * cols });
      }
    }
    candidates.forEach(function (c) {
      const cols = c.cols;
      const rows = c.rows;
      const empty = cols * rows - n;
      const latticeAspect = cols / rows;
      const aspectErr = Math.abs(Math.log((latticeAspect || 1) / targetAspect));
      const balance = Math.abs(cols - ideal) + Math.abs(rows - ideal);
      // Prefer near-square, few empties, aspect near wedge; avoid 1×n strips
      let score =
        empty * 8 +
        aspectErr * 3 +
        balance * 1.4 +
        Math.abs(rows - cols) * 0.25;
      if (cols === 1 && n > 3) score += 25;
      if (rows === 1 && n > 3) score += 18;
      // Mild prefer taller (more rows) for this tall-ish wedge
      if (rows >= cols) score -= 0.2;
      if (!best || score < best.score) {
        best = { cols: cols, rows: rows, empty: empty, score: score };
      }
    });

    const cols = best.cols;
    const rows = best.rows;
    // Keep fill-the-wedge bias; only a hair more margin when sparse
    const padY = stageH * (n <= 3 ? 0.065 : 0.05);
    const padXFrac = n <= 3 ? 0.075 : 0.06;
    const innerH = Math.max(1, stageH - 2 * padY);
    const cellH = innerH / rows;

    const slots = [];
    let placed = 0;
    let minCellW = Infinity;
    for (let r = 0; r < rows && placed < n; r++) {
      const remaining = n - placed;
      const inRow = r === rows - 1 ? remaining : Math.min(cols, remaining);
      const incomplete = inRow < cols;
      const y = padY + (r + 0.5) * cellH;
      // Cutout inset along diagonal; board 4 puts it on the RIGHT (flat left edge)
      const inset = useCutout ? portraitCutoutLocalX(y) : 0;
      const xLeftEdge = useCutout && !photoLeft ? inset : 0;
      const xRightInset = useCutout && photoLeft ? inset : 0;
      const rowW = Math.max(1, stageW - xLeftEdge - xRightInset);
      const padX = rowW * padXFrac;
      const innerW = Math.max(1, rowW - 2 * padX);
      const cellW = innerW / cols;
      if (cellW < minCellW) minCellW = cellW;

      for (let k = 0; k < inRow; k++) {
        let x;
        if (incomplete) {
          const blockW = inRow * cellW;
          const blockLeft = xLeftEdge + padX + (innerW - blockW) / 2;
          x = blockLeft + (k + 0.5) * cellW;
        } else {
          x = xLeftEdge + padX + (k + 0.5) * cellW;
        }
        const colIndex = incomplete
          ? Math.floor((cols - inRow) / 2 + k)
          : k;
        // Queue line among plates only (lower-right in front). Keep values
        // small so the front veil (z≈1000) always covers every plate.
        const zIndex = 10 + r * 20 + colIndex;
        slots.push({
          x: x,
          y: y,
          row: r,
          col: colIndex,
          zIndex: zIndex,
        });
        placed++;
      }
    }

    // Still lean fill; sparse n only a touch less aggressive than before
    const overlap =
      n <= 2 ? 1.28 : n <= 3 ? 1.32 : n <= 4 ? 1.36 : n <= 6 ? 1.4 : 1.42;
    const refCellW = Number.isFinite(minCellW) ? minCellW : midW / cols;
    let scale = Math.min(
      (refCellW * overlap) / PORTRAIT_IMG_W,
      (cellH * overlap) / PORTRAIT_IMG_H
    );
    // Density dampen for large n; hair-cut for 2–3 only (~8–12% smaller)
    scale *= Math.min(1.15, 1.05 / Math.sqrt(Math.max(1, n) / 6));
    if (n <= 2) scale *= 0.9;
    else if (n <= 3) scale *= 0.93;
    scale = Math.max(0.2, Math.min(0.7, scale));

    return {
      slots: slots,
      cols: cols,
      rows: rows,
      scale: scale,
      stageW: stageW,
      stageH: stageH,
    };
  }

  /**
   * Freeze free galaxy pan only during an Encore *segment*.
   * Family Portrait (Slideshow / Static) must not change BG scroll at all.
   */
  function bgScrollFrozen() {
    return isEncoreSegmentNow();
  }

  let _scaffoldPinTimer = null;

  function setEncoreScaffoldBgActive(on) {
    const galaxy = document.getElementById("galaxy");
    if (!galaxy) return;
    if (_scaffoldPinTimer) {
      clearTimeout(_scaffoldPinTimer);
      _scaffoldPinTimer = null;
    }
    galaxy.classList.toggle("encore-scaffold-bg", !!on);
    // After unpin: free layers were forced to opacity 0 !important — restore
    // the active plate so the first hero after FP isn’t on a blank void.
    if (!on && config.bgImage) {
      const peak = bgImageOpacityPeak();
      const a = els.galaxyA;
      const b = els.galaxyB;
      if (a && !a.hidden) {
        const aOn =
          a.classList.contains("active") ||
          !(b && !b.hidden && b.classList.contains("active"));
        if (aOn) {
          a.classList.add("active");
          a.style.opacity = String(peak);
        }
      }
      if (b && !b.hidden && b.classList.contains("active")) {
        b.style.opacity = String(peak);
      }
    }
  }

  /**
   * Hide free galaxy only after the collage has fully faded in.
   * Scaffold already holds its own BG image copy — free layers cover the
   * gap so we never flash solid BG Color during the handoff.
   */
  function scheduleScaffoldPinAfterFadeIn(stage) {
    // Slideshow / Static FP: leave free galaxy scrolling. Pin is Encore-only.
    if (!isEncoreSegmentNow()) return;
    if (!stage || !stage.querySelector(".family-portrait-bg")) return;
    if (_scaffoldPinTimer) {
      clearTimeout(_scaffoldPinTimer);
      _scaffoldPinTimer = null;
    }
    // Keep free galaxy up until collage opacity settles
    setEncoreScaffoldBgActive(false);
    const fadeMs = readCssDurationMs(stage, "--dur-mid", 450);
    _scaffoldPinTimer = window.setTimeout(function () {
      _scaffoldPinTimer = null;
      if (
        !stage ||
        stage.hidden ||
        !stage.classList.contains("visible")
      ) {
        return;
      }
      setEncoreScaffoldBgActive(true);
    }, fadeMs + 40);
  }

  function readEncoreZoomTo(stage) {
    let zoomTo = 1.24;
    try {
      const el = stage || els.familyPortrait || document.documentElement;
      const raw = getComputedStyle(el).getPropertyValue("--encore-zoom-to").trim();
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 1) zoomTo = n;
    } catch (e) {
      /* keep default */
    }
    return zoomTo;
  }

  /**
   * Spotlight hole + Ken Burns origin: always the item lattice point (no bias).
   */
  function setEncoreZoomOrigin(stage, latticeX, latticeY) {
    if (!stage) return;
    stage.style.setProperty("--encore-hole-x", latticeX + "px");
    stage.style.setProperty("--encore-hole-y", latticeY + "px");
  }

  /** Hard Encore only. Soft never pinches. Amount is hardcoded. */
  function encoreHolePinchPx() {
    if (config.encoreSpotlightType === "soft") return 0;
    const n = Number(ENCORE_HOLE_PINCH_PX);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function encorePinchNode(stage) {
    if (!stage) return null;
    return stage.querySelector(".family-portrait-rig") || stage;
  }

  function snapEncoreHolePinch(stage, px) {
    const node = encorePinchNode(stage);
    if (!node) return;
    const prev = node.style.transition;
    node.style.transition = "none";
    node.style.setProperty("--encore-hole-pinch", Math.max(0, px) + "px");
    void node.offsetWidth;
    node.style.transition = prev;
  }

  function setEncoreHolePinch(stage, px) {
    const node = encorePinchNode(stage);
    if (!node) return;
    node.style.setProperty("--encore-hole-pinch", Math.max(0, px) + "px");
  }

  /** Same clock as the rig zoom. includePinch adds --encore-hole-pinch to the transition. */
  function encoreRigTransition(sec, easeVar, easeFallback, includePinch) {
    const t =
      "transform " + sec + "s var(" + easeVar + ", " + easeFallback + ")";
    if (!includePinch) return t;
    return (
      t +
      ", --encore-hole-pinch " +
      sec +
      "s var(" +
      easeVar +
      ", " +
      easeFallback +
      ")"
    );
  }

  function readCssDurationMs(el, prop, fallbackMs) {
    try {
      const raw = getComputedStyle(el || document.documentElement)
        .getPropertyValue(prop)
        .trim();
      if (!raw) return fallbackMs;
      if (raw.indexOf("ms") !== -1) {
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : fallbackMs;
      }
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n * 1000 : fallbackMs;
    } catch (e) {
      return fallbackMs;
    }
  }

  /** Lattice plane center in stage-local px (transform-origin + veil hole). */
  function setPlaneCenterOrigin(stage) {
    if (!stage) return;
    stage.style.setProperty(
      "--encore-hole-x",
      PORTRAIT_STAGE_W * 0.5 + "px"
    );
    stage.style.setProperty(
      "--encore-hole-y",
      PORTRAIT_STAGE_H * 0.5 + "px"
    );
  }

  /** Snap scale with no transition (origin changes only safe at ~1× or under cover). */
  function snapPortraitZoom(stage, scale) {
    if (!stage) return;
    const rig = stage.querySelector(".family-portrait-rig");
    if (rig) {
      rig.style.transition = "none";
      stage.style.setProperty("--encore-zoom", String(scale));
      void rig.offsetWidth;
      rig.style.transition = "";
    } else {
      stage.style.setProperty("--encore-zoom", String(scale));
    }
  }

  /**
   * Collage + BG Image: pin a stage-aligned #galaxy clone under the lattice
   * (Family Portrait overview OR Encore). Slideshow individual heroes: no pin.
   * Stack matches free galaxy: color plate + image (blur / opacity / blend).
   */
  function appendScaffoldBg(rig) {
    if (!rig) return false;

    // Encore segment: color plate only (Secondary). Never copy the wallpaper
    // onto the portrait rig — that is the image that stays visible during Encore.
    if (isEncoreSegmentNow()) {
      const wrap = document.createElement("div");
      wrap.className = "family-portrait-bg";
      wrap.setAttribute("aria-hidden", "true");
      const plateEl = document.createElement("div");
      plateEl.className = "family-portrait-bg-plate";
      plateEl.style.backgroundColor = config.secondaryColor || "#000000";
      wrap.appendChild(plateEl);
      if (rig.firstChild) rig.insertBefore(wrap, rig.firstChild);
      else rig.appendChild(wrap);
      setEncoreScaffoldBgActive(true);
      tokiInfo("scaffold BG attached (encore solid secondary, no image)");
      return true;
    }

    let imagePath = config.bgImage || null;
    if (!imagePath) return false;
    imagePath = wallFriendlyBgPath(imagePath);

    const wall = isPreviewWall();
    const main = config.mainColor || "#000000";
    let plate =
      normalizeHex(config.bgColor) ||
      normalizeHex(config.bgSolid) ||
      main;
    const opacity01 = parseUnit01(config.bgOpacity, 1);
    const blur01 = wall ? 0 : parseUnit01(config.bgBlur, 0);
    const blend = wall ? "normal" : parseBgBlendMode(config.bgBlendMode);

    // Mirror the special 100%+Normal plate override for the scaffold copy
    // (uses cached avg if the main galaxy path has already computed it).
    if (imagePath && opacity01 >= 0.999 && blend === "normal") {
      const cachedAvg = _imageAvgPlateCache[imagePath];
      if (cachedAvg) plate = cachedAvg;
    }

    const wrap = document.createElement("div");
    wrap.className = "family-portrait-bg";
    wrap.setAttribute("aria-hidden", "true");
    applyBgEffects(wrap, blur01, opacity01, blend);

    const plateEl = document.createElement("div");
    plateEl.className = "family-portrait-bg-plate";
    plateEl.style.backgroundColor = plate;
    wrap.appendChild(plateEl);

    const img = document.createElement("img");
    img.className = "family-portrait-bg-img";
    img.alt = "";
    img.draggable = false;
    attachWebpFallback(img);
    bindDownsampleOnLoad(img);
    img.src = imagePath;
    if (els.galaxyA && els.galaxyA.style.transform) {
      img.style.transform = els.galaxyA.style.transform;
    }
    wrap.appendChild(img);

    if (rig.firstChild) rig.insertBefore(wrap, rig.firstChild);
    else rig.appendChild(wrap);

    // Wallpaper copy is unused for Slideshow FP; if we ever attach one,
    // still do not pin/hide free galaxy except during Encore.
    if (isEncoreSegmentNow()) {
      setEncoreScaffoldBgActive(true);
    }
    tokiInfo("scaffold BG attached", imagePath, "blend", blend || "normal");
    return true;
  }

  let _hidePortraitTimer = null;
  let _portraitIntroTimer = null;
  /** Bumped to invalidate in-flight hide transitionend / timeout (see cancelPendingPortraitHide). */
  let _hidePortraitGen = 0;
  let _hidePortraitTransitionHandler = null;

  /**
   * Stop a pending Wind-down teardown so it cannot call finishHide *after*
   * the next Wind-up has started (that killed every FP intro after the first).
   */
  function cancelPendingPortraitHide() {
    _hidePortraitGen += 1;
    if (_hidePortraitTimer) {
      clearTimeout(_hidePortraitTimer);
      _hidePortraitTimer = null;
    }
    const stage = els.familyPortrait;
    if (stage && _hidePortraitTransitionHandler) {
      stage.removeEventListener(
        "transitionend",
        _hidePortraitTransitionHandler
      );
      _hidePortraitTransitionHandler = null;
    }
  }

  function finishHideFamilyPortrait() {
    if (isPresentationStatic()) return; // static = hold multiview forever
    const stage = els.familyPortrait;
    if (_hidePortraitTimer) {
      clearTimeout(_hidePortraitTimer);
      _hidePortraitTimer = null;
    }
    if (stage && _hidePortraitTransitionHandler) {
      stage.removeEventListener(
        "transitionend",
        _hidePortraitTransitionHandler
      );
      _hidePortraitTransitionHandler = null;
    }
    if (!stage) return;
    if (_encoreSpotTimer) {
      clearTimeout(_encoreSpotTimer);
      _encoreSpotTimer = null;
    }
    stage.classList.remove("visible", "is-dimmed", "is-zoom-out");
    stage.hidden = true;
    stage.setAttribute("aria-hidden", "true");
    stage.style.opacity = "";
    snapPortraitZoom(stage, 1);
    setEncoreScaffoldBgActive(false);
    _lastEncoreBowItem = null;
    // Drop veil classes so a later Slideshow hero is not under leftover chrome
    applyEncoreSpotlightChrome(null, { forceClear: true });
    snapEncoreHolePinch(stage, 0);
    // Keep render key so re-show can reuse DOM; cleared only on full re-render
  }

  /** Encore Wind-down: zoom last bow → full spread (opaque phase). */
  function encoreWindDownZoomMs(stage) {
    return readCssDurationMs(
      stage || els.familyPortrait || document.documentElement,
      "--dur-fp-windup",
      700
    );
  }

  /** Shared opacity fade clock (Wind-up / Wind-down). */
  function presentationFadeMs(stage) {
    return readCssDurationMs(
      stage || els.familyPortrait || document.documentElement,
      "--dur-mid",
      450
    );
  }

  /** Full Encore Wind-down = zoom-out to spread + opacity fade. */
  function encoreWindDownTotalMs(stage) {
    return encoreWindDownZoomMs(stage) + presentationFadeMs(stage);
  }

  /** FP overview Wind-down duration (reverse Zoom Reveal + fade). */
  function familyPortraitWindDownMs(stage) {
    return Math.max(
      presentationFadeMs(stage),
      readCssDurationMs(
        stage || els.familyPortrait || document.documentElement,
        "--dur-fp-windup",
        700
      )
    );
  }

  function collageWindDownMs(prevType, stage) {
    if (prevType === "encore") return encoreWindDownTotalMs(stage);
    if (prevType === "portrait") return familyPortraitWindDownMs(stage);
    return presentationFadeMs(stage);
  }

  /**
   * Wind-down when leaving a collage Animation Block (FP overview or Encore).
   * - portrait (FP overview): reverse Zoom Reveal (center peak) + fade
   * - encore (last bow): undim + zoom out to full spread (opaque), *then* fade
   *   — never reverseZoom (veil-to-center), never fade while still punched-in.
   *
   * @param {string} prevType  "portrait" | "encore" | other
   * @param {boolean} [instant]
   */
  function windDownCollageStage(prevType, instant) {
    if (prevType !== "portrait" && prevType !== "encore") return;
    if (instant) {
      hideFamilyPortrait({ instant: true });
      return;
    }
    if (prevType === "encore") {
      hideFamilyPortrait({ encoreWindDown: true });
      return;
    }
    hideFamilyPortrait({ reverseZoom: true });
  }

  /**
   * Hide collage. Soft path fades opacity (and optional reverse center zoom)
   * before setting hidden — fixes Slideshow blink.
   * @param {{instant?: boolean, reverseZoom?: boolean, encoreWindDown?: boolean}} [opts]
   */
  function hideFamilyPortrait(opts) {
    if (isPresentationStatic()) return; // static = hold multiview forever
    opts = opts || {};
    const stage = els.familyPortrait;
    if (!stage) return;

    // Static quarantine: always snap hide (no reverse zoom / fade choreography)
    if (isPresentationStatic()) {
      opts = Object.assign({}, opts, { instant: true });
    }

    // New hide supersedes any prior hide (and its transitionend)
    if (_hidePortraitTimer) {
      clearTimeout(_hidePortraitTimer);
      _hidePortraitTimer = null;
    }
    if (_hidePortraitTransitionHandler) {
      stage.removeEventListener(
        "transitionend",
        _hidePortraitTransitionHandler
      );
      _hidePortraitTransitionHandler = null;
    }
    const hideGen = ++_hidePortraitGen;

    if (_portraitIntroTimer) {
      clearTimeout(_portraitIntroTimer);
      _portraitIntroTimer = null;
    }
    // Always kill a pending Encore Punch-in so it cannot re-dim after Wind-down starts
    if (_encoreSpotTimer) {
      clearTimeout(_encoreSpotTimer);
      _encoreSpotTimer = null;
    }

    if (opts.instant || stage.hidden) {
      finishHideFamilyPortrait();
      return;
    }

    // Unpin free galaxy NOW (not after reverse-zoom timeout). Scaffold keeps
    // its own BG image copy for the fade/zoom-out; free layers power heroes.
    // Waiting until finishHide left the first post-FP item with no BG.
    if (_scaffoldPinTimer) {
      clearTimeout(_scaffoldPinTimer);
      _scaffoldPinTimer = null;
    }
    setEncoreScaffoldBgActive(false);

    // Already fading out — don't restart reverse zoom mid-way
    const fadingOut = !stage.classList.contains("visible") && !stage.hidden;

    // ── Encore Wind-down ──────────────────────────────────────────────
    // Phase 1 (opaque): undim + zoom last bow → full 1× spread
    // Phase 2 (fade):   real opacity fade at full spread (must not be cancelled
    //                   by the next Wind-up — handoff waits zoom+fade total)
    if (opts.encoreWindDown && !fadingOut) {
      stage.classList.remove("is-dimmed");
      clearAllPresentationHighlights();
      const zoomMs = encoreWindDownZoomMs(stage);
      const fadeMs = presentationFadeMs(stage);
      const rig = stage.querySelector(".family-portrait-rig");
      if (rig) {
        rig.style.transition =
          "transform var(--dur-fp-windup, 0.7s) var(--ease-out)";
      }
      stage.classList.add("is-zoom-out");
      stage.style.setProperty("--encore-zoom", "1");
      // Keep full opacity for phase 1
      stage.style.opacity = "1";
      stage.classList.add("visible");

      _hidePortraitTimer = window.setTimeout(function () {
        if (hideGen !== _hidePortraitGen) return;
        // Phase 2: collage fades on --dur-mid; wallpaper/stripes unpark + fade
        // back in on the same clock (pan X kept on the img transform).
        setEncoreSolidBackground(false);
        // Phase 2: force a real opacity fade (don't rely only on .visible class)
        stage.style.transition =
          "opacity var(--dur-mid, 0.45s) var(--ease-fade, ease)";
        void stage.offsetWidth;
        stage.classList.remove("visible");
        stage.style.opacity = "0";
        _hidePortraitTimer = window.setTimeout(function () {
          if (hideGen !== _hidePortraitGen) return;
          _hidePortraitTimer = null;
          if (rig) rig.style.transition = "";
          stage.style.transition = "";
          stage.style.opacity = "";
          finishHideFamilyPortrait();
        }, fadeMs + 40);
      }, zoomMs + 40);
      return;
    }

    // ── FP reverse Zoom Reveal / generic hide ─────────────────────────
    stage.classList.remove("visible");

    if (opts.reverseZoom && !fadingOut) {
      // FP Wind-down: reverse Zoom Reveal — center origin + peak while fading
      setPlaneCenterOrigin(stage);
      stage.classList.remove("is-zoom-out");
      void stage.offsetWidth;
      stage.classList.add("is-dimmed");
      stage.style.setProperty(
        "--encore-zoom",
        String(readEncoreZoomTo(stage))
      );
    } else if (!opts.reverseZoom) {
      // Generic: undim + ease to 1× while fading
      stage.classList.remove("is-dimmed");
      easePortraitZoomOut(stage);
    }

    const zoomMs = opts.reverseZoom
      ? readCssDurationMs(stage, "--dur-fp-windup", 700)
      : readCssDurationMs(stage, "--dur-slow", 1050);
    const fadeMs = readCssDurationMs(stage, "--dur-mid", 450);
    // Wait for both fade and zoom — do not tear down on first opacity end
    // while a longer zoom-out is still mid-flight.
    const wait = Math.max(zoomMs, fadeMs) + 40;

    const onTransitionEnd = function (e) {
      if (hideGen !== _hidePortraitGen) return;
      if (e.target !== stage) return;
      // Only opacity on the stage ends the hide (not early child transforms)
      if (e.propertyName !== "opacity") return;
      // If zoom still longer than fade, let the timeout finish the job
      if (zoomMs > fadeMs + 20) return;
      stage.removeEventListener("transitionend", onTransitionEnd);
      if (_hidePortraitTransitionHandler === onTransitionEnd) {
        _hidePortraitTransitionHandler = null;
      }
      if (_hidePortraitTimer) {
        clearTimeout(_hidePortraitTimer);
        _hidePortraitTimer = null;
      }
      finishHideFamilyPortrait();
    };

    _hidePortraitTransitionHandler = onTransitionEnd;
    stage.addEventListener("transitionend", onTransitionEnd);

    _hidePortraitTimer = window.setTimeout(function () {
      if (hideGen !== _hidePortraitGen) return;
      stage.removeEventListener("transitionend", onTransitionEnd);
      if (_hidePortraitTransitionHandler === onTransitionEnd) {
        _hidePortraitTransitionHandler = null;
      }
      _hidePortraitTimer = null;
      finishHideFamilyPortrait();
    }, wait);
  }

  /**
   * Family Portrait / segment Wind-up Zoom Reveal.
   * - Opacity fade-in: --dur-mid (forced; no is-dimmed / veil)
   * - Scale peak→1×: --dur-fp-windup
   * Encore bow Punch-in uses setPortraitSpotlight (--dur-encore-zoom + veil).
   */
  function beginPortraitCenterIntro(stage) {
    if (!stage) return;
    cancelPendingPortraitHide();
    if (_portraitIntroTimer) {
      clearTimeout(_portraitIntroTimer);
      _portraitIntroTimer = null;
    }
    // FP Wind-up is never an Encore bow — strip veil so lineup isn't blacked out
    applyEncoreSpotlightChrome(null, { forceClear: true });
    setEncoreScaffoldBgActive(false);
    setPlaneCenterOrigin(stage);
    // No is-dimmed: that turns the Encore veil on; Wind-up is collage only
    stage.classList.remove("visible", "is-zoom-out", "is-dimmed");
    stage.hidden = false;
    stage.setAttribute("aria-hidden", "false");
    snapPortraitZoom(stage, readEncoreZoomTo(stage));

    // Hard reset opacity so .visible fade always runs (every Wind-up)
    stage.style.transition = "none";
    stage.style.opacity = "0";
    void stage.offsetWidth;
    stage.style.transition =
      "opacity var(--dur-mid, 0.45s) var(--ease-fade, ease)";

    // Encore Wind-up: fade wallpaper/stripes out on the same --dur-mid clock
    if (isEncoreSegmentNow()) {
      setEncoreSolidBackground(true);
    }

    requestAnimationFrame(function () {
      stage.classList.add("visible");
      stage.style.opacity = "1";
      scheduleScaffoldPinAfterFadeIn(stage);
      requestAnimationFrame(function () {
        const rig = stage.querySelector(".family-portrait-rig");
        const windMs = readCssDurationMs(stage, "--dur-fp-windup", 700);
        if (rig) {
          rig.style.transition =
            "transform var(--dur-fp-windup, 0.7s) var(--ease-out)";
        }
        stage.classList.remove("is-zoom-out");
        stage.style.setProperty("--encore-zoom", "1");
        _portraitIntroTimer = window.setTimeout(function () {
          _portraitIntroTimer = null;
          if (rig) rig.style.transition = "";
          // Leave opacity to CSS .visible after intro
          stage.style.transition = "";
          stage.style.opacity = "";
        }, windMs + 40);
      });
    });
  }

  /**
   * Slideshow last item → Family Portrait: same two-phase timing as
   * updateHero between adjacent items.
   *   phase 1: hero fade-out + zoom-out (--dur-mid)
   *   phase 2: portrait fade-in + zoom peak→1 (opacity mid, scale encore-zoom)
   */
  let _portraitHandoffTimer = null;

  /** Keep only items that have an image path (no network preload — paint ASAP). */
  function portraitItemsWithPaths(portraitItems) {
    return (portraitItems || []).filter(function (it) {
      return !!(it && it.image);
    });
  }

  /**
   * Slideshow last item → Family Portrait: same two-phase timing as
   * updateHero between adjacent items.
   *   phase 1: hero fade-out + zoom-out (--dur-mid)
   *   phase 2: portrait fade-in + zoom peak→1 (opacity mid, scale encore-zoom)
   */
  function handoffHeroToPortrait(portraitItems, instant) {
    // Static quarantine: no two-phase hero→portrait handoff
    if (isPresentationStatic()) instant = true;
    const cast = portraitItemsWithPaths(portraitItems);
    if (!cast.length) {
      hideHeroPlate({ instant: !!instant });
      return;
    }
    const stage = els.familyPortrait;
    if (!stage) return;

    if (_portraitHandoffTimer) {
      clearTimeout(_portraitHandoffTimer);
      _portraitHandoffTimer = null;
    }
    // Cancel prior Wind-down so its finishHide cannot kill this Wind-up
    cancelPendingPortraitHide();
    if (_portraitIntroTimer) {
      clearTimeout(_portraitIntroTimer);
      _portraitIntroTimer = null;
    }

    // Reset collage surface so intro can run cleanly
    stage.classList.remove("visible", "is-dimmed", "is-zoom-out");
    stage.hidden = true;
    stage.style.opacity = "";
    snapPortraitZoom(stage, 1);

    ensureFamilyPortrait(cast);

    if (instant) {
      hideHeroPlate();
      stage.hidden = false;
      stage.setAttribute("aria-hidden", "false");
      snapPortraitZoom(stage, 1);
      stage.classList.add("visible");
      if (isEncoreSegmentNow() && stage.querySelector(".family-portrait-bg")) {
        setEncoreScaffoldBgActive(true);
      }
      return;
    }

    // Keep free galaxy through hero out-phase (no solid-color flash)
    setEncoreScaffoldBgActive(false);

    // --- Phase 1: identical to updateHero outgoing ---
    const plate = heroMotionEl();
    const kb = heroKenBurnsOn();
    let zoomMin = 0.93;
    try {
      if (plate) {
        const mn = parseFloat(
          getComputedStyle(plate).getPropertyValue("--hero-zoom-min").trim()
        );
        if (Number.isFinite(mn) && mn > 0 && mn < 1) zoomMin = mn;
      }
    } catch (e) {
      /* default */
    }

    if (plate && !plate.hidden) {
      plate.classList.remove("visible");
      if (kb) setHeroZoom(zoomMin, "out");
    }

    const gap = kb
      ? readCssDurationMs(plate || document.documentElement, "--dur-mid", 450)
      : 200;

    // Pre-stage collage at peak (like holding hero at zoomMin before show)
    setPlaneCenterOrigin(stage);
    stage.classList.remove("visible");
    stage.hidden = false;
    stage.setAttribute("aria-hidden", "false");
    snapPortraitZoom(stage, readEncoreZoomTo(stage));
    stage.classList.add("is-dimmed");
    stage.style.opacity = "0";
    void stage.offsetWidth;
    stage.style.opacity = "";

    _portraitHandoffTimer = window.setTimeout(function () {
      _portraitHandoffTimer = null;
      if (plate && !plate.classList.contains("visible")) {
        plate.hidden = true;
      }
      // --- Phase 2: identical clocks to updateHero show() ---
      beginPortraitCenterIntro(stage);
    }, gap);
  }

  /**
   * Show collage. Fast path: no network preload. ensureFamilyPortrait caches DOM
   * by cast fingerprint so Encore bows do not rebuild / re-decode every step.
   * Broken URLs drop their slot via img.onerror in fillPortraitPlates.
   *
   * @param {object[]} portraitItems
   * @param {boolean} [instant]
   * @param {{fromEncore?: boolean, settle?: boolean, forceIntro?: boolean}} [opts]
   */
  function showFamilyPortrait(portraitItems, instant, opts) {
    opts = opts || {};
    const stage = els.familyPortrait;
    if (!stage) return;

    // Static quarantine: always instant collage at 1×
    if (isPresentationStatic()) instant = true;

    const cast = portraitItemsWithPaths(portraitItems);
    if (!cast.length) {
      finishHideFamilyPortrait();
      return;
    }

    if (_portraitHandoffTimer) {
      clearTimeout(_portraitHandoffTimer);
      _portraitHandoffTimer = null;
    }
    // Always cancel pending hide before show — stale finishHide was snapping
    // every Family Portrait Wind-up after the first opening.
    cancelPendingPortraitHide();
    if (_portraitIntroTimer) {
      clearTimeout(_portraitIntroTimer);
      _portraitIntroTimer = null;
    }

    ensureFamilyPortrait(cast);

    const settle =
      !instant && !!(opts.settle || opts.fromEncore) && !opts.forceIntro;

    // Same-block Encore only: keep collage, ease to 1× (no center solo).
    // Pin free galaxy immediately — collage is already fully visible in Encore.
    if (settle) {
      hideHeroPlate();
      stage.hidden = false;
      stage.setAttribute("aria-hidden", "false");
      stage.style.opacity = "";
      stage.classList.add("visible");
      if (isEncoreSegmentNow() && stage.querySelector(".family-portrait-bg")) {
        setEncoreScaffoldBgActive(true);
      }
      if (!opts.keepDimmed) {
        stage.classList.remove("is-dimmed");
        easePortraitZoomOut(stage);
      }
      return;
    }

    if (instant) {
      hideHeroPlate();
      stage.hidden = false;
      stage.setAttribute("aria-hidden", "false");
      snapPortraitZoom(stage, 1);
      stage.classList.remove("is-dimmed", "is-zoom-out");
      stage.style.opacity = "";
      stage.classList.add("visible");
      if (isEncoreSegmentNow() && stage.querySelector(".family-portrait-bg")) {
        setEncoreScaffoldBgActive(true);
      }
      return;
    }

    // Already fully settled at 1× with no forceIntro → no re-intro (bow settle).
    // Block Wind-up always passes forceIntro so every segment FP animates.
    if (
      !opts.forceIntro &&
      stage.classList.contains("visible") &&
      !stage.hidden &&
      !stage.classList.contains("is-dimmed")
    ) {
      const z = parseFloat(stage.style.getPropertyValue("--encore-zoom")) || 1;
      if (z <= 1.02) return;
    }

    const plateEl = heroMotionEl();
    if (plateEl && !plateEl.hidden) {
      hideHeroPlate();
    }
    beginPortraitCenterIntro(stage);
  }

  function ensureFamilyPortrait(portraitItems) {
    // Board 4 historically lacked the stage node — create if missing so FP/Encore can paint
    if (!els.familyPortrait) {
      const stageRoot = els.stage || document.getElementById("stage");
      if (stageRoot) {
        const created = document.createElement("div");
        created.id = "family-portrait-stage";
        created.hidden = true;
        created.setAttribute("aria-hidden", "true");
        stageRoot.appendChild(created);
        els.familyPortrait = created;
        tokiInfo("family-portrait-stage created (was missing from page DOM)");
      }
    }
    // Fingerprint cast only — do not bake Alpha presentationMode (Box segments differ)
    const key =
      (_activeSegmentMode || config.presentationMode || "slideshow") +
      "\0" +
      (config.bgImage || "") +
      "\0" +
      (portraitItems || [])
        .map(function (it) {
          return (it && it.name) + "\0" + (it && it.image) + "\0" + !!it.isNew;
        })
        .join("|");
    if (
      key === _portraitRenderKey &&
      els.familyPortrait &&
      els.familyPortrait.children.length
    ) {
      return; // reuse DOM + decoded bitmaps (critical for Encore multi-item casts)
    }
    renderFamilyPortrait(portraitItems || []);
    _portraitRenderKey = key;
    updateDebugVisuals();
  }

  /**
   * Shared lattice fill — same grid + slot DOM as Family Portrait overview.
   * See docs/FAMILY_PORTRAIT_LATTICE.md.
   *
   * @param {HTMLElement} platesEl  container for slots
   * @param {{ name?: string, image: string, isNew?: boolean }[]} portraitItems
   * @param {{ resolveItemIndex?: (it: object, i: number) => number, stickers?: boolean }} [opts]
   * @returns {object|null} layout from buildPortraitLayout
   */
  function fillPortraitPlates(platesEl, portraitItems, opts) {
    opts = opts || {};
    if (!platesEl) return null;
    platesEl.innerHTML = "";
    const list = portraitItems || [];
    const n = list.length;
    if (!n) return null;

    // Always FP defaults — one grid for overview cast AND multi-image heroes
    const layout = buildPortraitLayout(n, PORTRAIT_STAGE_W, PORTRAIT_STAGE_H);
    tokiInfo(
      "portrait layout",
      n,
      "→",
      layout.cols + "×" + layout.rows,
      "scale",
      layout.scale.toFixed(3)
    );

    const wantStickers = opts.stickers !== false && cfg.showSticker !== false;
    const resolveIndex =
      typeof opts.resolveItemIndex === "function"
        ? opts.resolveItemIndex
        : function (it, i) {
            // Prefer explicit index (box cast / alpha mapped objects)
            if (it && it.itemIndex != null && it.itemIndex >= 0) {
              return it.itemIndex;
            }
            const idx = items.indexOf(it);
            return idx >= 0 ? idx : i;
          };

    list.forEach(function (it, i) {
      const slot = layout.slots[i];
      if (!slot || !it || !it.image) return;

      const itemIndex = resolveIndex(it, i);
      const wrap = document.createElement("div");
      wrap.className = "family-portrait-slot";
      wrap.dataset.itemIndex = String(itemIndex);
      wrap.dataset.portraitIndex = String(i);
      wrap.dataset.baseZ = String(slot.zIndex);
      wrap.style.left = slot.x + "px";
      wrap.style.top = slot.y + "px";
      wrap.style.zIndex = String(slot.zIndex);

      const img = document.createElement("img");
      img.className = "family-portrait-item";
      img.alt = "";
      img.draggable = false;
      attachWebpFallback(img);
      img.dataset.tokiGridN = String(n);
      const rawSrc = resolveImagePath(it.image) || it.image;
      if (!rawSrc) return;
      const cellNeed = bakeTargetPx(n);
      const src = preferFoodPathForNeed(rawSrc, cellNeed.w, cellNeed.h);
      img.dataset.tokiMaster = src;
      const baked = peekRasterBake(src, n);
      if (baked && baked.url) {
        img.dataset.downsampled = "1";
        if (baked.from) img.dataset.tokiFrom = baked.from;
        if (baked.px) img.dataset.tokiPx = baked.px;
        img.src = baked.url;
      } else {
        img.onload = function onPlateLoad() {
          if (img.dataset.downsampled === "1") return;
          maybeDownsampleImg(img);
        };
        img.src = src;
      }
      img.style.transform =
        "translate(-50%, -50%) scale(" + layout.scale + ")";

      wrap.appendChild(img);

      if (wantStickers && it.isNew) {
        appendPortraitSticker(wrap, layout.scale);
      }

      platesEl.appendChild(wrap);
    });

    return layout;
  }

  function renderFamilyPortrait(portraitItems) {
    const stage = els.familyPortrait;
    if (!stage) return;

    if (isPresentationStatic()) {
      // Static = play FP multiview and hold forever (no further presentation, no highlights)
      _presHandoffBusy = true;
      if (slideshowTimer) {
        clearTimeout(slideshowTimer);
        slideshowTimer = null;
      }
      _presentationRunning = false;
    }

    stage.innerHTML = "";
    stage.style.setProperty("--encore-zoom", "1");
    // Boards 1–3: stage left = cutout; Board 4: stage left = 0 (photo left)
    stage.style.setProperty(
      "--portrait-stage-left",
      portraitStageLeftPx() + "px"
    );
    stage.classList.toggle("photo-left", isHeroPhotoLeft());
    setEncoreScaffoldBgActive(false);

    // Rig holds optional BG + plates + veil so Ken Burns keeps them locked.
    // Stack: bg (z=0) · plates (z=1) · veil (z=2).
    const rig = document.createElement("div");
    rig.className = "family-portrait-rig";
    stage.appendChild(rig);

    // Encore only: solid Secondary plate on the rig. Slideshow FP does not
    // attach or pin a BG copy — free galaxy keeps scrolling underneath.
    if (isEncoreSegmentNow()) {
      appendScaffoldBg(rig);
    }

    const plates = document.createElement("div");
    plates.className = "family-portrait-plates";
    rig.appendChild(plates);

    const veil = document.createElement("div");
    veil.className = "family-portrait-veil";
    veil.setAttribute("aria-hidden", "true");
    rig.appendChild(veil);

    const layout = fillPortraitPlates(plates, portraitItems || []);
    if (!layout) return;

    // Debug outline via ?portraitDebug=1
    try {
      const q = new URLSearchParams(location.search || "");
      stage.classList.toggle(
        "portrait-debug",
        q.get("portraitDebug") === "1" || q.get("portraitDebug") === "true"
      );
    } catch (e) {
      /* ignore */
    }

    // Spotlight hole tracks scaled plate size (slightly tighter than half-width)
    // CSS extends soft rim to ~1.85× this radius.
    const plateW = PORTRAIT_IMG_W * layout.scale;
    const holeR = Math.max(70, plateW * 0.42);
    stage.style.setProperty("--encore-hole-r", holeR + "px");

    // Tint any portrait stickers with current Special Highlight
    applyStickerTint();
    clearPortraitSpotlight();
  }

  /**
   * Multi-image hero content: same lattice as FP, lives inside .hero-anim (child of
   * #hero-plate) so fade + Ken Burns match single-image items. The New sticker
   * is also a direct child of the plate but does not receive the scale.
   * See docs/FAMILY_PORTRAIT_LATTICE.md §4.
   */
  const _heroMultiCache = {};

  function hideSoloHeroForMulti() {
    if (!els.hero) return;
    els.hero.style.visibility = "hidden";
    els.hero.removeAttribute("src");
  }

  function stashHeroMultiLattice(el) {
    if (!el) return;
    const key = el.dataset.tokiMultiKey || "";
    if (el.parentNode) el.parentNode.removeChild(el);
    if (key) _heroMultiCache[key] = el;
  }

  function clearHeroMultiLattice(plate) {
    plate = plate || els.heroPlate;
    if (!plate) return;
    const multi = plate.querySelector(".hero-multi-plates");
    if (multi) stashHeroMultiLattice(multi);
    if (els.hero) {
      els.hero.style.visibility = "";
      els.hero.hidden = false;
    }
  }

  function heroMultiRoot() {
    const plate = els.heroPlate || document.getElementById("hero-plate");
    if (!plate || plate.hidden) return null;
    return plate.querySelector(".hero-multi-plates");
  }

  function applyHeroMultiLattice(item, plate) {
    plate = plate || els.heroPlate;
    const paths = itemImagePaths(item);
    if (!plate || paths.length < 2) return false;

    const key = paths.join("\0");
    const anim = plate.querySelector(".hero-anim") || plate;
    const showing = plate.querySelector(".hero-multi-plates");
    if (showing && showing.dataset.tokiMultiKey === key) {
      showing.hidden = false;
      hideSoloHeroForMulti();
      return true;
    }
    if (showing) stashHeroMultiLattice(showing);

    const cached = _heroMultiCache[key];
    if (cached) {
      anim.appendChild(cached);
      cached.hidden = false;
      hideSoloHeroForMulti();
      applyStickerTint();
      tokiInfo("hero multi lattice reuse", item.name);
      return true;
    }

    const plates = document.createElement("div");
    plates.className = "hero-multi-plates family-portrait-plates";
    plates.dataset.tokiMultiKey = key;
    // Align lattice origin with #family-portrait-stage in board space
    // (Board 4: stage left 0, hero-wrap left −255 → offset +255)
    plates.style.position = "absolute";
    plates.style.left = portraitStageLeftPx() - heroWrapLeftPx() + "px";
    plates.style.top = 0 - HERO_WRAP_TOP + "px";
    plates.style.width = PORTRAIT_STAGE_W + "px";
    plates.style.height = PORTRAIT_STAGE_H + "px";
    plates.style.pointerEvents = "none";
    plates.setAttribute("aria-hidden", "true");

    const cast = [];
    for (let i = 0; i < paths.length; i++) {
      cast.push({
        name: String(item.name || "") + " (" + (i + 1) + ")",
        image: paths[i],
        isNew: !!item.isNew && i === 0,
      });
    }

    tokiInfo("hero multi lattice", item.name, paths);

    fillPortraitPlates(plates, cast, {
      stickers: false,
      resolveItemIndex: function () {
        return -1;
      },
    });

    hideSoloHeroForMulti();
    anim.appendChild(plates);
    _heroMultiCache[key] = plates;
    applyStickerTint();
    return true;
  }

  /**
   * Mini New! badge inside a portrait slot (lower-right of the plate).
   */
  function appendPortraitSticker(slotEl, photoScale) {
    if (!slotEl) return;
    const el = document.createElement("div");
    el.className = "family-portrait-sticker";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<img class="new-sticker-shadow" src="' +
      STICKER_SHADOW_SRC +
      '" alt="" draggable="false" />' +
      '<div class="new-sticker-body">' +
      '<img class="new-sticker-body-img" src="' +
      STICKER_BODY_SRC +
      '" alt="" draggable="false" />' +
      '<span class="new-sticker-tint"></span>' +
      "</div>" +
      '<span class="new-sticker-label">New!</span>';
    // imgScale debug: shrink sticker bitmaps too
    el.querySelectorAll("img").forEach(function (im) {
      attachWebpFallback(im);
      bindDownsampleOnLoad(im);
    });

    // Offset toward lower-right of the scaled plate (1500×1000 native)
    const ox = 280 * photoScale;
    const oy = 160 * photoScale;
    el.style.left = "calc(50% + " + ox + "px)";
    el.style.top = "calc(50% + " + oy + "px)";
    const stickScale = Math.max(0.16, Math.min(0.4, photoScale * 0.9));
    /* No extra rotate — Sticker-Body tilt is baked into the asset (matches mockup). */
    el.style.transform =
      "translate(-50%, -50%) scale(" + stickScale + ")";
    slotEl.appendChild(el);
  }

  /** Punch-out → Punch-in gap between Encore bows (same for every bow). */
  const ENCORE_BLACKOUT_MS = 1100;
  let _encoreSpotTimer = null;

  function boxStateByKey(boxKey) {
    // Board 4: selected content always lives in drinkBox / #drink-options-box
    if (isDrinks) return drinkBox;
    if (boxKey === "protein") return proteinBox;
    if (boxKey === "sauces") return saucesBox;
    if (boxKey === "drinks") return footerDrinksBox;
    if (boxKey === "veggies") return veggiesBox;
    return null;
  }

  function boxBodyElByKey(boxKey) {
    if (isDrinks) return els.drinkBoxBody;
    if (boxKey === "protein") return els.proteinBody;
    if (boxKey === "sauces") return els.saucesBody;
    if (boxKey === "drinks") return els.footerDrinksBody;
    if (boxKey === "veggies") {
      return (
        els.veggiesBody || document.getElementById("veggies-body")
      );
    }
    return null;
  }

  /** Footer info-box root element by segment key. */
  function boxRootElByKey(boxKey) {
    if (isDrinks) return document.getElementById("drink-options-box");
    if (boxKey === "protein") return document.getElementById("protein-box");
    if (boxKey === "sauces") return document.getElementById("sauces-box");
    if (boxKey === "drinks") return document.getElementById("footer-drinks-box");
    if (boxKey === "veggies") return document.getElementById("veggies-box");
    return null;
  }

  /** Punch-out clock for list/box highlight fade (matches veil / zoom-out). */
  function presentationHighlightFadeMs() {
    return readCssDurationMs(document.documentElement, "--dur-slow", 1050);
  }

  /**
   * Clear Alpha list + footer box presentation highlights.
   * @param {{ fade?: boolean }} [opts] fade:true = Encore Punch-out (ease color
   *   with --dur-slow). fade:false/omit = instant (segment change, instant paint).
   */
  function clearAllPresentationHighlights(opts) {
    clearEncoreListHighlight(opts);
    clearBoxPresentationHighlights(opts);
  }

  function clearBoxPresentationHighlights(opts) {
    opts = opts || {};
    const fade = !!opts.fade;
    const roots = [
      els.proteinBody,
      els.saucesBody,
      els.footerDrinksBody,
      els.veggiesBody || document.getElementById("veggies-body"),
    ];
    roots.forEach(function (body) {
      if (!body) return;
      body.querySelectorAll("[data-box-item-index].active").forEach(function (
        node
      ) {
        // Remove .active only — CSS transition on the base selector fades color.
        // Stripping --item-highlight in the same frame can snap the computed color.
        node.classList.remove("active");
        if (fade) {
          window.setTimeout(function () {
            if (!node.classList.contains("active")) {
              node.style.removeProperty("--item-highlight");
            }
          }, presentationHighlightFadeMs() + 40);
        } else {
          node.style.removeProperty("--item-highlight");
        }
      });
    });
  }

  /**
   * Highlight one footer-box inventory line (name + subtitle + price).
   * Clears Alpha list highlight while a Box Menu segment is active.
   */
  function setBoxPresentationHighlight(boxKey, itemIndex, isNew) {
    clearEncoreListHighlight({ fade: true });
    clearBoxPresentationHighlights({ fade: true });
    if (!boxKey || itemIndex == null || itemIndex < 0) return;
    const body = boxBodyElByKey(boxKey);
    if (!body) return;
    const color = isNew
      ? config.highlightSpecial || config.highlight
      : config.highlight;
    body.querySelectorAll("[data-box-item-index]").forEach(function (node) {
      const on = Number(node.dataset.boxItemIndex) === itemIndex;
      if (on) {
        node.style.setProperty("--item-highlight", color);
        // Double rAF so color transition runs from previous → highlight
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            node.classList.add("active");
          });
        });
      } else {
        node.classList.remove("active");
      }
    });
  }

  /** Active slide helper (box or alpha). */
  function activePresSlide() {
    return slides.length ? slides[activeIndex] || null : null;
  }

  function resolvePresItem(itemIndex, slide) {
    slide = slide || activePresSlide();
    if (slide && slide.segment === "box" && slide.boxKey) {
      const box = boxStateByKey(slide.boxKey);
      const bi =
        slide.boxItemIndex != null && slide.boxItemIndex >= 0
          ? slide.boxItemIndex
          : itemIndex;
      if (box && box.items && bi >= 0 && bi < box.items.length) {
        return box.items[bi];
      }
      return null;
    }
    if (itemIndex == null || itemIndex < 0) return null;
    return items[itemIndex] || null;
  }

  /**
   * Encore list highlight clear.
   * @param {{ fade?: boolean }} [opts] fade with Punch-out (--dur-slow) when true
   */
  function clearEncoreListHighlight(opts) {
    opts = opts || {};
    const fade = !!opts.fade;
    if (!els.list) return;
    els.list.querySelectorAll(".menu-item").forEach(function (node) {
      if (isPresentationStatic() && fade && node.classList.contains("active")) {
        // Opacity out, then clear
        node.style.opacity = "0.35";
        window.setTimeout(function () {
          node.classList.remove("active");
          node.style.opacity = "";
          node.style.removeProperty("--item-highlight");
        }, 350);
        return;
      }
      node.classList.remove("active");
      if (isPresentationStatic()) node.style.opacity = "";
      if (fade) {
        window.setTimeout(function () {
          if (!node.classList.contains("active")) {
            node.style.removeProperty("--item-highlight");
          }
        }, presentationHighlightFadeMs() + 40);
      } else {
        node.style.removeProperty("--item-highlight");
      }
    });
  }

  /**
   * Encore-only: list/box highlight tracks camera —
   * fade off on Punch-out, ease on with Punch-in (same --dur-slow as veil).
   */
  function setEncoreListHighlight(itemIndex) {
    if (itemIndex == null || itemIndex < 0) return;
    const slide = activePresSlide();
    if (slide && slide.segment === "box") {
      const bi =
        slide.boxItemIndex != null && slide.boxItemIndex >= 0
          ? slide.boxItemIndex
          : itemIndex;
      setBoxPresentationHighlight(slide.boxKey, bi, !!slide.isNew);
      return;
    }
    clearBoxPresentationHighlights({ fade: true });
    if (!els.list) return;
    const item = items[itemIndex];
    els.list.querySelectorAll(".menu-item").forEach(function (node, i) {
      const on = i === itemIndex;
      if (on && item) {
        const color = item.isNew
          ? config.highlightSpecial || config.highlight
          : config.highlight;
        node.style.setProperty("--item-highlight", color);
        if (isPresentationStatic()) {
          // Opacity shift only: dip then settle full
          node.style.opacity = "0.35";
          node.classList.add("active");
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              node.style.opacity = "1";
            });
          });
        } else {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              node.classList.add("active");
            });
          });
        }
      } else {
        node.classList.remove("active");
        if (isPresentationStatic()) node.style.opacity = "";
      }
    });
  }

  /**
   * Ease Ken Burns back to 1× on the same clock as the veil fade
   * (.is-zoom-out → --dur-slow). Origin retarget happens after blackout.
   */
  function easePortraitZoomOut(stage) {
    if (!stage) return;
    const rig = stage.querySelector(".family-portrait-rig");
    if (rig) rig.style.transition = ""; // CSS .is-zoom-out handles duration
    stage.classList.add("is-zoom-out");
    stage.style.setProperty("--encore-zoom", "1");
  }

  function clearPortraitSpotlight() {
    const stage = els.familyPortrait;
    if (!stage) return;
    if (_encoreSpotTimer) {
      clearTimeout(_encoreSpotTimer);
      _encoreSpotTimer = null;
    }
    // Keep Special veil through undim if last bow was New
    if (_lastEncoreBowItem) {
      applyEncoreSpotlightChrome(_lastEncoreBowItem);
    }
    stage.classList.remove("is-dimmed");
    easePortraitZoomOut(stage);
    if (isEncoreActiveNow()) {
      // Punch-out: fade highlight with veil, do not blink off
      clearAllPresentationHighlights({ fade: true });
    }
  }

  /**
   * Encore curtain-call: blackout veil + ease zoom out together, then open a
   * soft hole and Ken Burns push-in toward the bowing plate’s lattice point.
   * List highlight: fade off with Punch-out (--dur-slow), on with Punch-in.
   * @param {number} itemIndex
   * @param {{instant?: boolean}} [opts]
   */
  function setPortraitSpotlight(itemIndex, opts) {
    opts = opts || {};
    const stage = els.familyPortrait;
    if (!stage) return;
    const slide = activePresSlide();
    const segEncore = isEncoreActiveNow();
    const presItem = resolvePresItem(itemIndex, slide);

    if (_encoreSpotTimer) {
      clearTimeout(_encoreSpotTimer);
      _encoreSpotTimer = null;
    }

    // Static quarantine: collage at 1×, no veil/zoom; highlight opacity only
    if (isPresentationStatic()) {
      applyEncoreSpotlightChrome(null, { forceClear: true });
      stage.classList.remove("is-dimmed", "is-zoom-out");
      snapPortraitZoom(stage, 1);
      stage.hidden = false;
      stage.setAttribute("aria-hidden", "false");
      stage.style.opacity = "";
      stage.classList.add("visible");
      hideHeroPlate({ instant: true });
      if (segEncore && itemIndex != null && itemIndex >= 0 && presItem) {
        _lastEncoreBowItem = presItem;
        setEncoreListHighlight(itemIndex);
      } else if (segEncore) {
        clearAllPresentationHighlights({ fade: true });
      }
      return;
    }

    // Zoom-out of previous bow: keep last veil color (Special for New) until
    // the next bow applies its own color after blackout.
    if (_lastEncoreBowItem) {
      applyEncoreSpotlightChrome(_lastEncoreBowItem);
    } else {
      applyEncoreSpotlightChrome(null);
    }
    stage.classList.remove("is-dimmed");
    easePortraitZoomOut(stage);
    if (segEncore) {
      // Same clock as veil / zoom-out — not an instant class strip
      clearAllPresentationHighlights({ fade: true });
    }

    if (itemIndex == null || itemIndex < 0) return;
    if (!presItem) return;

    // Same Punch-out → Punch-in gap every bow (including first after FP lineup).
    // A shorter "first bow" gap made highlight lengths unequal under a uniform step clock.
    const gap = opts.instant ? 0 : ENCORE_BLACKOUT_MS;

    _encoreSpotTimer = window.setTimeout(function () {
      _encoreSpotTimer = null;
      const slot = stage.querySelector(
        '.family-portrait-slot[data-item-index="' + itemIndex + '"]'
      );
      if (!slot) return;

      // Lattice → origin (always pure lattice)
      const lx = parseFloat(slot.style.left) || 0;
      const ly = parseFloat(slot.style.top) || 0;
      setEncoreZoomOrigin(stage, lx, ly);
      _lastEncoreBowItem = presItem;
      applyEncoreSpotlightChrome(presItem);
      const zoomTo = readEncoreZoomTo(stage);
      // Long push-in again (drop .is-zoom-out so --dur-encore-zoom applies)
      const rig = stage.querySelector(".family-portrait-rig");
      if (rig) rig.style.transition = "";
      stage.classList.remove("is-zoom-out");
      void stage.offsetWidth;
      stage.classList.add("is-dimmed");
      stage.style.setProperty("--encore-zoom", String(zoomTo));
      // List/box highlight arrives with the zoom-in (Encore only)
      if (segEncore) {
        setEncoreListHighlight(itemIndex);
      }
    }, gap);
  }

  // ---------- slideshow ----------

  /** Last board slide type — for seamless FP ↔ Encore / Slideshow handoffs */
  let _prevBoardSlideType = "";
  /** Previous board slide (full object) for segment-exit handoffs */
  let _prevBoardSlide = null;

  /**
   * Style → Presentation Speed (ms). ONE duration for every Animation Block step:
   * Encore bow, Slideshow item, Family Portrait overview, drinks step.
   * 0 = paused.
   */
  function presentationStepMs() {
    const sec = parseSlideshowSpeed(config.slideshowSpeed, 3);
    if (!(sec > 0)) return 0;
    return Math.round(sec * 1000);
  }

  function cancelPresentationAdvance() {
    if (slideshowTimer != null) {
      clearTimeout(slideshowTimer);
      clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
  }

  /**
   * Uniform block clock: every Animation Block is active for exactly
   * Presentation Speed, then we leave (Wind-down if needed), *then* the next
   * block paints and starts its own Presentation Speed.
   *
   * Critical: collage Wind-down must NOT run on the next slide's clock
   * (that made Family Portrait look like it "held" longer than Slideshow items).
   */
  function notePresentationStepStart() {
    // Engine owns its own phase timers
    if (isPresentationEngine()) return;
    const gen = ++_presentationStepGen;
    _presentationStepStartedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    armPresentationStepDeadline(gen);
  }

  // ---------- Motion engine (Beta Motion table → sequential blocks) ----------
  let _motionEngineGen = 0;
  let _motionPhaseTimer = null;
  let _motionEngineRunning = false;

  function cancelMotionPhaseTimer() {
    if (_motionPhaseTimer != null) {
      clearTimeout(_motionPhaseTimer);
      _motionPhaseTimer = null;
    }
  }

  function stopMotionEngine() {
    _motionEngineGen += 1;
    _motionEngineRunning = false;
    cancelMotionPhaseTimer();
  }

  function afterMs(ms, gen, fn) {
    cancelMotionPhaseTimer();
    const wait = Math.max(0, Math.round(ms));
    _motionPhaseTimer = window.setTimeout(function () {
      _motionPhaseTimer = null;
      if (gen !== _motionEngineGen) return;
      if (typeof fn === "function") fn();
    }, wait);
  }

  function engineEntranceSec(style, isFirstInSegment) {
    if (isFirstInSegment && style.windUp > 0) return style.windUp;
    return style.punchIn;
  }

  function engineExitSec(style, isLastInSegment) {
    if (isLastInSegment && style.windDown > 0) return style.windDown;
    return style.punchOut;
  }

  /** Set CSS transition durations from sheet digits for this phase. */
  function engineApplyCssDurations(entranceSec, exitSec) {
    const root = document.documentElement;
    if (!root || !root.style) return;
    const opIn = Math.min(0.45, entranceSec > 0 ? entranceSec : 0.45);
    const opOut = Math.min(0.45, exitSec > 0 ? exitSec : 0.45);
    root.style.setProperty("--motion-punch-in", String(entranceSec) + "s");
    root.style.setProperty("--motion-punch-out", String(exitSec) + "s");
    root.style.setProperty("--motion-opacity-in", String(opIn) + "s");
    root.style.setProperty("--motion-opacity-out", String(opOut) + "s");
  }

  function engineLoadHeroImage(item, done) {
    const plate = els.heroPlate;
    const img = els.hero;
    finishHideFamilyPortrait();
    applyEncoreSpotlightChrome(null, { forceClear: true });
    if (!plate || !img || cfg.showHero === false) {
      if (typeof done === "function") done(false);
      return;
    }
    if (!item || !(item.image || itemHasMultiImages(item))) {
      hideHeroPlate({ clearSrc: true, instant: true });
      if (typeof done === "function") done(false);
      return;
    }
    clearHeroMultiLattice(plate);
    const wantSticker = !!(item.isNew && config && config.showSticker !== false);
    applyPlateSticker(wantSticker);
    plate.hidden = false;

    if (itemHasMultiImages(item)) {
      applyHeroMultiLattice(item, plate);
      if (typeof done === "function") done(true);
      return;
    }

    const src = item.image;
    loadHeroRaster(
      img,
      src,
      function () {
        if (typeof done === "function") done(true);
      },
      function () {
        hideHeroPlate({ clearSrc: true, instant: true });
        if (typeof done === "function") done(false);
      }
    );
  }

  /**
   * Family Portrait — hidden one-slide overview (full cast, no item punch).
   * Entrance: grid opacity 0→1 at zoom 1×, veil OFF.
   * Encore same-segment loop (last bow → this lineup): grid is already at 1×
   * after Punch-out — do not fade (that is Wind-up / Wind-down). Highlights still run.
   * True Wind-up only at presentation / segment start (including Slideshow+FP).
   * Exit into Encore (same segment): keep grid (compose); no fade-out.
   * Exit elsewhere: grid opacity out (like Slideshow/KB wind-down).
   */
  function familyPortraitPrepareSurface(slide) {
    const cast = portraitItemsWithPaths(slide.items || []);
    if (!cast.length) return null;
    hideHeroPlate({ clearSrc: true, instant: true });
    ensureFamilyPortrait(cast);
    const stage = els.familyPortrait;
    if (!stage) return null;
    cancelPendingPortraitHide();
    applyEncoreSpotlightChrome(null, { forceClear: true });
    stage.hidden = false;
    stage.setAttribute("aria-hidden", "false");
    return stage;
  }

  function familyPortraitRunEntrance(slide, style, entranceSec, gen, done, flags) {
    flags = flags || {};
    const stage = familyPortraitPrepareSurface(slide);
    // Clear item highlights; FP overview chrome (Alpha title | Box shell)
    staticClearHighlights();
    engineArmHighlightIn(style && style.punchOut);
    armFpOverviewHighlight(slide);

    // Frame 0 of Encore: last bow Punch-out already zoomed to this lineup.
    // Must NOT fade the grid — Wind-up/Wind-down are segment edges only.
    // Clock matches first FP (Wind-up if set, else Punch-in) + Hold + Punch-out.
    const resumeEncore =
      !flags.isFirstInSegment &&
      flags.prevSlide &&
      flags.prevSlide.type === "encore" &&
      !isPresSegmentBoundary(flags.prevSlide, slide);
    const resumeSec = engineEntranceSec(style, true);

    if (!stage) {
      afterMs((resumeEncore ? resumeSec : entranceSec) * 1000, gen, done);
      return;
    }
    const rig = stage.querySelector(".family-portrait-rig");

    if (resumeEncore) {
      engineApplyCssDurations(resumeSec, style.punchOut);
      if (rig) rig.style.transition = "none";
      stage.style.transition = "none";
      setPlaneCenterOrigin(stage);
      snapPortraitZoom(stage, 1);
      stage.classList.remove("is-dimmed", "is-zoom-out");
      stage.style.opacity = "1";
      stage.classList.add("visible");
      applyEncoreSpotlightChrome(null, { forceClear: true });
      tokiInfo("fp entrance resume encore (same clock, no fade)", resumeSec);
      afterMs(resumeSec * 1000, gen, function () {
        stage.style.transition = "";
        if (rig) rig.style.transition = "";
        done();
      });
      return;
    }

    const opSec = Math.min(0.45, entranceSec > 0 ? entranceSec : 0.45);
    engineApplyCssDurations(entranceSec, style.punchOut);

    if (rig) rig.style.transition = "none";
    stage.style.transition = "none";
    setPlaneCenterOrigin(stage);
    snapPortraitZoom(stage, 1);
    stage.classList.remove("is-dimmed", "is-zoom-out");
    stage.style.opacity = "0";
    stage.classList.add("visible");
    void stage.offsetWidth;

    stage.style.transition =
      "opacity " + opSec + "s var(--ease-fade, ease)";
    stage.style.opacity = "1";

    afterMs(entranceSec * 1000, gen, function () {
      stage.style.transition = "";
      if (rig) rig.style.transition = "";
      done();
    });
  }

  /**
   * @param {object|null} nextSlide  next playable slide (for compose into Encore)
   */
  function familyPortraitRunExit(
    slide,
    style,
    exitSec,
    gen,
    nextSlide,
    done
  ) {
    const stage = els.familyPortrait;
    const opSec = Math.min(0.45, exitSec > 0 ? exitSec : 0.45);
    // Color fade title (and any list/box) over Punch-Out — same as item punch-out
    engineHighlightFadeOut(exitSec);
    engineApplyCssDurations(style.punchIn, exitSec);

    // Compose into Encore: keep full-spread grid; first bow will Punch-In (veil+zoom)
    const composeEncore =
      nextSlide &&
      nextSlide.type === "encore" &&
      !isPresSegmentBoundary(slide, nextSlide);

    if (composeEncore && stage && !stage.hidden) {
      stage.style.opacity = "1";
      stage.classList.add("visible");
      stage.classList.remove("is-dimmed", "is-zoom-out");
      snapPortraitZoom(stage, 1);
      applyEncoreSpotlightChrome(null, { forceClear: true });
      afterMs(exitSec * 1000, gen, done);
      return;
    }

    // Full exit (FP alone, or before Slideshow/Ken Burns items)
    if (!stage || stage.hidden) {
      afterMs(exitSec * 1000, gen, done);
      return;
    }
    stage.style.transition =
      "opacity " + opSec + "s var(--ease-fade, ease)";
    stage.style.opacity = "0";
    afterMs(exitSec * 1000, gen, function () {
      stage.style.transition = "";
      finishHideFamilyPortrait();
      done();
    });
  }

  /** Lattice origin for Encore camera (slot center). */
  function encoreSlotOrigin(stage, itemIndex) {
    if (!stage || itemIndex == null || itemIndex < 0) return null;
    const slot = stage.querySelector(
      '.family-portrait-slot[data-item-index="' + itemIndex + '"]'
    );
    if (!slot) return null;
    return {
      x: parseFloat(slot.style.left) || 0,
      y: parseFloat(slot.style.top) || 0,
    };
  }

  /**
   * Ensure Encore collage surface is ready (cast with images).
   * Returns stage or null.
   */
  function encorePrepareSurface(slide) {
    const cast = portraitItemsWithPaths(slide.items || []);
    if (!cast.length) return null;
    hideHeroPlate({ clearSrc: true, instant: true });
    ensureFamilyPortrait(cast);
    const stage = els.familyPortrait;
    if (!stage) return null;
    cancelPendingPortraitHide();
    stage.hidden = false;
    stage.setAttribute("aria-hidden", "false");
    // Veil chrome (hard/soft) — isEncoreActiveNow true on encore bow slides
    applyEncoreSpotlightChrome(null);
    return stage;
  }

  function encoreArmHighlight(slide, colorSec) {
    // colorSec = Punch-Out (same clock as fade-out), never full Punch-In
    if (colorSec != null) engineArmHighlightIn(colorSec);
    if (slide.segment === "box") {
      staticSetBoxHighlight(
        slide.boxKey,
        slide.boxItemIndex != null ? slide.boxItemIndex : slide.itemIndex,
        !!slide.isNew
      );
    } else if (slide.itemIndex != null && slide.itemIndex >= 0) {
      staticSetListHighlight(slide.itemIndex, !!slide.isNew);
    }
  }

  /**
   * Highlight COLOR ease duration — always Punch-Out (default 0.45s).
   * Same number for fade-in and fade-out. Never full Punch-In. Never opacity.
   */
  let _highlightColorSec = 0.45;

  /**
   * Punch-Out: color eases highlight → Secondary over exitSec (--ease-fade).
   * No opacity / transparency on either phase.
   */
  function engineHighlightFadeOut(exitSec) {
    const sec =
      Number.isFinite(Number(exitSec)) && Number(exitSec) > 0
        ? Number(exitSec)
        : 0.45;
    _highlightColorSec = sec;
    const root = document.documentElement;
    if (root && root.style) {
      root.style.setProperty("--motion-highlight", String(sec) + "s");
    }
    const ms = Math.round(sec * 1000) + 40;
    const clearNode = function (node) {
      if (!node) return;
      node.style.opacity = "";
      node.style.transition =
        "color " + sec + "s var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1))";
      void node.offsetWidth;
      // Drop .active → CSS color becomes --secondary-color; transition runs
      node.classList.remove("hl-on", "active");
      window.setTimeout(function () {
        node.style.transition = "";
        node.style.removeProperty("--item-highlight");
      }, ms);
    };
    if (els.list) {
      els.list
        .querySelectorAll(".menu-item.hl-on, .menu-item.active")
        .forEach(clearNode);
    }
    ["protein", "sauces", "drinks", "veggies"].forEach(function (key) {
      const body = boxBodyElByKey(key);
      if (!body) return;
      body
        .querySelectorAll(
          "[data-box-item-index].hl-on, [data-box-item-index].active"
        )
        .forEach(clearNode);
    });
    // Alpha Family Portrait overview: title text and/or header fill
    if (
      els.title &&
      (els.title.classList.contains("hl-on") ||
        els.title.classList.contains("active"))
    ) {
      clearNode(els.title);
    }
    fadeFpAlphaHeaderHighlight(sec);
    // Box shell shape (Box Family Portrait overview) — fill eases via CSS
    fadeFpBoxShellHighlights(sec);
  }

  function encoreClearHighlight(exitSec) {
    engineHighlightFadeOut(exitSec);
  }

  /**
   * Encore entrance.
   * First of segment (Wind-up treatment, duration = Wind-Up if >0 else Punch-In):
   *   PARALLEL: grid opacity 0→1 + veil in + camera zoom overview→item
   * Mid-run Punch-In: grid stays; veil + camera only.
   */
  function encoreRunEntrance(
    slide,
    style,
    entranceSec,
    gen,
    isFirstInSegment,
    done
  ) {
    const stage = encorePrepareSurface(slide);
    if (!stage) {
      // No cast images — highlight only
      finishHideFamilyPortrait();
      encoreArmHighlight(slide, style.punchOut);
      afterMs(entranceSec * 1000, gen, done);
      return;
    }

    const itemIndex = slide.itemIndex;
    const presItem = resolvePresItem(itemIndex, slide);
    const zoomTo = readEncoreZoomTo(stage);
    const opSec = Math.min(0.45, entranceSec > 0 ? entranceSec : 0.45);
    const rig = stage.querySelector(".family-portrait-rig");
    const origin = encoreSlotOrigin(stage, itemIndex);

    // Veil *in* only: shorter than phase (ENCORE_VEIL_IN_MULT); zoom still uses full entranceSec
    stage.style.setProperty(
      "--motion-veil",
      String(encoreVeilInSeconds(entranceSec)) + "s"
    );
    engineApplyCssDurations(entranceSec, style.punchOut);

    if (isFirstInSegment) {
      // —— Wind-up treatment (FP off kicker): grid + veil + camera together ——
      setPlaneCenterOrigin(stage);
      if (rig) {
        rig.style.transition = "none";
      }
      stage.style.transition = "none";
      snapPortraitZoom(stage, 1);
      snapEncoreHolePinch(stage, 0);
      stage.classList.remove("is-dimmed", "is-zoom-out");
      stage.style.opacity = "0";
      stage.classList.add("visible");
      void stage.offsetWidth;

      const doPinch = encoreHolePinchPx() > 0;
      if (rig) {
        rig.style.transition = encoreRigTransition(
          entranceSec,
          "--ease-out",
          "ease-out",
          doPinch
        );
      }
      stage.style.transition =
        "opacity " + opSec + "s var(--ease-fade, ease)";
      stage.classList.remove("is-zoom-out");
      if (origin) setEncoreZoomOrigin(stage, origin.x, origin.y);
      if (presItem) {
        _lastEncoreBowItem = presItem;
        applyEncoreSpotlightChrome(presItem);
      } else {
        applyEncoreSpotlightChrome(null);
      }
      stage.style.setProperty("--encore-zoom", String(zoomTo));
      if (doPinch) setEncoreHolePinch(stage, encoreHolePinchPx());
      stage.classList.add("is-dimmed");
      stage.style.opacity = "1";
      encoreArmHighlight(slide, style.punchOut);

      afterMs(entranceSec * 1000, gen, function () {
        if (rig) rig.style.transition = "";
        stage.style.transition = "";
        done();
      });
      return;
    }

    // —— Punch-In (mid-run): grid already up; veil + camera only (no grid fade) ——
    // Previous Punch-Out left zoom≈1 and veil undimmed.
    stage.style.opacity = "1";
    stage.classList.add("visible");
    stage.classList.remove("is-dimmed", "is-zoom-out");
    if (rig) {
      rig.style.transition = "none";
    }
    // Reset hole while veil is undimmed, then shrink with Punch-in / zoom
    snapEncoreHolePinch(stage, 0);
    // Retarget origin while at ~1× (under undimmed veil), then punch in
    if (origin) setEncoreZoomOrigin(stage, origin.x, origin.y);
    void stage.offsetWidth;
    const doPinch = encoreHolePinchPx() > 0;
    if (rig) {
      rig.style.transition = encoreRigTransition(
        entranceSec,
        "--ease-out",
        "ease-out",
        doPinch
      );
    }
    if (presItem) {
      _lastEncoreBowItem = presItem;
      applyEncoreSpotlightChrome(presItem);
    } else {
      applyEncoreSpotlightChrome(null);
    }
    stage.style.setProperty("--encore-zoom", String(zoomTo));
    if (doPinch) setEncoreHolePinch(stage, encoreHolePinchPx());
    stage.classList.add("is-dimmed");
    encoreArmHighlight(slide, style.punchOut);
    afterMs(entranceSec * 1000, gen, function () {
      if (rig) rig.style.transition = "";
      done();
    });
  }

  /**
   * Encore exit.
   * Mid-run Punch-Out: veil out + ease zoom; grid opacity stays 1.
   * Last-of-segment Wind-Down: grid opacity out + veil out (KB/Slideshow-like).
   */
  function encoreRunExit(slide, style, exitSec, gen, isLastInSegment, done) {
    const stage = els.familyPortrait;
    const opSec = Math.min(0.45, exitSec > 0 ? exitSec : 0.45);
    const rig = stage ? stage.querySelector(".family-portrait-rig") : null;

    // Veil *out* keeps full exit duration (multiplier is fade-in only)
    if (stage) {
      stage.style.setProperty("--motion-veil", String(exitSec) + "s");
    }
    engineApplyCssDurations(style.punchIn, exitSec);
    encoreClearHighlight(exitSec);

    if (!stage || stage.hidden) {
      afterMs(exitSec * 1000, gen, done);
      return;
    }

    // Veil out + ease camera toward 1×
    // Hole stays pinched (ENCORE_HOLE_PINCH_OUT is off).
    stage.classList.remove("is-dimmed");
    stage.classList.add("is-zoom-out");
    if (rig) {
      rig.style.transition = encoreRigTransition(
        exitSec,
        "--ease-fade",
        "ease",
        !!ENCORE_HOLE_PINCH_OUT
      );
    }
    stage.style.setProperty("--encore-zoom", "1");
    if (ENCORE_HOLE_PINCH_OUT) setEncoreHolePinch(stage, 0);

    if (isLastInSegment) {
      // Wind-down: grid opacity out (inherit KB/Slideshow full exit)
      stage.style.transition =
        "opacity " + opSec + "s var(--ease-fade, ease)";
      stage.style.opacity = "0";
      afterMs(exitSec * 1000, gen, function () {
        if (rig) rig.style.transition = "";
        stage.style.transition = "";
        stage.classList.remove("visible", "is-zoom-out");
        finishHideFamilyPortrait();
        done();
      });
      return;
    }

    // Punch-out: grid stays visible
    stage.style.opacity = "1";
    afterMs(exitSec * 1000, gen, function () {
      if (rig) rig.style.transition = "";
      stage.classList.remove("is-zoom-out");
      done();
    });
  }

  /**
   * Entrance for Motion Style (Ken Burns / Slideshow / Encore).
   * @param {{ isFirstInSegment?: boolean, prevSlide?: object|null }} [flags]
   */
  function motionRunEntrance(slide, style, entranceSec, gen, done, flags) {
    flags = flags || {};
    // Family Portrait overview (any segment that includes FP)
    if (slide.type === "portrait") {
      familyPortraitRunEntrance(slide, style, entranceSec, gen, done, flags);
      return;
    }
    if (motionStyleIsEncore(style)) {
      encoreRunEntrance(
        slide,
        style,
        entranceSec,
        gen,
        !!flags.isFirstInSegment,
        done
      );
      return;
    }
    const plate = heroMotionEl();
    const item = resolvePresItem(slide.itemIndex, slide) || {
      image: slide.image,
      images: slide.images,
      isNew: !!slide.isNew,
    };
    const useZoom = motionStyleUsesZoom(style);
    const zMin = useZoom
      ? style.zoomMin != null
        ? style.zoomMin
        : 0.93
      : 1;
    const zMax = useZoom
      ? style.zoomMax != null
        ? style.zoomMax
        : 1
      : 1;
    engineApplyCssDurations(entranceSec, style.punchOut);

    const textOnly = !!slide.textOnly || !slide.image;
    if (textOnly) {
      hideHeroPlate({ clearSrc: true, instant: true });
      finishHideFamilyPortrait();
      engineArmHighlightIn(style.punchOut);
      if (slide.segment === "box") {
        staticSetBoxHighlight(
          slide.boxKey,
          slide.boxItemIndex != null ? slide.boxItemIndex : slide.itemIndex,
          !!slide.isNew
        );
      } else {
        staticSetListHighlight(slide.itemIndex, !!slide.isNew);
      }
      afterMs(entranceSec * 1000, gen, done);
      return;
    }

    engineLoadHeroImage(item, function (ok) {
      if (gen !== _motionEngineGen) return;
      if (!ok || !plate) {
        engineArmHighlightIn(style.punchOut);
        if (slide.segment === "box") {
          staticSetBoxHighlight(
            slide.boxKey,
            slide.boxItemIndex != null ? slide.boxItemIndex : slide.itemIndex,
            !!slide.isNew
          );
        } else {
          staticSetListHighlight(slide.itemIndex, !!slide.isNew);
        }
        afterMs(entranceSec * 1000, gen, done);
        return;
      }

      const anim = plate.querySelector
        ? plate.querySelector(".hero-anim")
        : null;
      // Park: Ken Burns at zoomMin; Slideshow stays at 1×
      plate.style.transition = "none";
      if (anim) anim.style.transition = "none";
      plate.style.setProperty("--hero-zoom", String(zMin));
      plate.style.opacity = "0";
      plate.classList.add("visible");
      plate.hidden = false;
      void plate.offsetWidth;

      // Highlight color ease = Punch-Out (same as fade-out), not full Punch-In
      engineArmHighlightIn(style.punchOut);
      if (slide.segment === "box") {
        staticSetBoxHighlight(
          slide.boxKey,
          slide.boxItemIndex != null ? slide.boxItemIndex : slide.itemIndex,
          !!slide.isNew
        );
      } else {
        staticSetListHighlight(slide.itemIndex, !!slide.isNew);
      }

      const opSec = Math.min(0.45, entranceSec > 0 ? entranceSec : 0.45);
      plate.style.transition =
        "opacity " + opSec + "s var(--ease-fade, ease)";
      if (useZoom && anim) {
        anim.style.transition =
          "transform " + entranceSec + "s var(--ease-out, ease-out)";
        plate.classList.add("is-kb-in");
        plate.style.setProperty("--hero-zoom", String(zMax));
        setFeatureActive("kenBurns", true, "engine punch-in");
      } else {
        plate.classList.remove("is-kb-in");
        plate.style.setProperty("--hero-zoom", "1");
        if (anim) anim.style.transition = "none";
        setFeatureActive("kenBurns", false, "slideshow opacity-only");
      }
      plate.style.opacity = "1";

      afterMs(entranceSec * 1000, gen, function () {
        if (anim) anim.style.transition = "";
        plate.style.transition = "";
        done();
      });
    });
  }

  function kenBurnsRunHold(holdSec, gen, done) {
    afterMs(holdSec * 1000, gen, done);
  }

  /**
   * Exit: Ken Burns / Slideshow hero; Encore grid+veil rules.
   * @param {{ isLastInSegment?: boolean }} [flags]
   */
  function motionRunExit(slide, style, exitSec, gen, done, flags) {
    flags = flags || {};
    if (slide.type === "portrait") {
      familyPortraitRunExit(
        slide,
        style,
        exitSec,
        gen,
        flags.nextSlide || null,
        done
      );
      return;
    }
    if (motionStyleIsEncore(style)) {
      encoreRunExit(
        slide,
        style,
        exitSec,
        gen,
        !!flags.isLastInSegment,
        done
      );
      return;
    }
    const plate = heroMotionEl();
    const useZoom = motionStyleUsesZoom(style);
    const zMin = useZoom
      ? style.zoomMin != null
        ? style.zoomMin
        : 0.93
      : 1;
    engineApplyCssDurations(style.punchIn, exitSec);

    // Highlight → secondary color on Punch-Out clock (same as image/veil exit)
    engineHighlightFadeOut(exitSec);

    if (!plate || plate.hidden) {
      afterMs(exitSec * 1000, gen, done);
      return;
    }

    const anim = plate.querySelector ? plate.querySelector(".hero-anim") : null;
    const opSec = Math.min(0.45, exitSec > 0 ? exitSec : 0.45);
    plate.classList.remove("is-kb-in");
    plate.style.transition =
      "opacity " + opSec + "s var(--ease-fade, ease)";
    if (useZoom && anim) {
      anim.style.transition =
        "transform " + exitSec + "s var(--ease-fade, ease)";
      plate.style.setProperty("--hero-zoom", String(zMin));
    } else {
      if (anim) anim.style.transition = "none";
      plate.style.setProperty("--hero-zoom", "1");
    }
    plate.style.opacity = "0";
    setFeatureActive("kenBurns", false, "engine punch-out");

    afterMs(exitSec * 1000, gen, function () {
      if (anim) anim.style.transition = "";
      plate.style.transition = "";
      plate.classList.remove("visible");
      done();
    });
  }

  /**
   * One Animation Block. Phases: entrance → Hold → exit → next.
   * Segment boundary (Alpha → Drinks box, etc.): last exit uses Wind-down
   * override (or Punch-out); first entrance uses Wind-up (or Punch-in).
   * Works when both segments are Slideshow, or Slideshow → Ken Burns, etc.
   */
  let _motionEngineColdStart = false;

  function motionEngineRunBlock(index, gen) {
    if (gen !== _motionEngineGen || !_motionEngineRunning) return;
    if (!slides.length) return;

    const i = ((index % slides.length) + slides.length) % slides.length;
    const slide = slides[i];
    if (!slide) return;

    activeIndex = i;

    const prevSlide =
      slides.length > 1
        ? slides[(i - 1 + slides.length) % slides.length]
        : null;
    const nextSlide =
      slides.length > 1 ? slides[(i + 1) % slides.length] : null;

    // Cold start: first block of the run gets segment-first entrance (Encore Wind-up / FP)
    const cold = _motionEngineColdStart;
    _motionEngineColdStart = false;

    // First of segment OR cold start. After FP overview, next Encore bow is NOT
    // first (prev is portrait, same segment) → Punch-In only (compose).
    const isFirstInSegment =
      cold || !prevSlide || isPresSegmentBoundary(prevSlide, slide);
    const isLastInSegment =
      !nextSlide || isPresSegmentBoundary(slide, nextSlide);

    const styleName = motionStyleNameForSlide(slide);
    const style = getMotionStyle(styleName);
    // FP overview uses same phase digits as the segment's motion style
    const entranceSec = engineEntranceSec(style, isFirstInSegment);
    // Encore (and FP attached to Encore): optional Hold scale; KB/Slideshow use sheet Hold as-is
    const holdSec = motionStyleIsEncore(style)
      ? encoreHoldSeconds(style.hold)
      : style.hold;
    const exitSec = engineExitSec(style, isLastInSegment);

    _prevBoardSlide = slide;
    _prevBoardSlideType = slide.type || "";
    {
      _activeSegmentMode =
        slide.segmentMode === "encore" ? "encore" : "slideshow";
      syncEncoreWallpaperPark();
    }

    tokiInfo(
      "motion block",
      i + 1 + "/" + slides.length,
      "type=",
      slide.type,
      "seg=",
      slide.segment + (slide.boxKey ? ":" + slide.boxKey : ""),
      "motionStyle=",
      styleName,
      "fp=",
      slide.type === "portrait" ? "yes" : "no",
      "encore=",
      motionStyleIsEncore(style) ? "yes" : "no",
      "first=",
      isFirstInSegment,
      "last=",
      isLastInSegment,
      "in=",
      entranceSec,
      "hold=",
      holdSec,
      "out=",
      exitSec
    );

    motionRunEntrance(
      slide,
      style,
      entranceSec,
      gen,
      function () {
        if (gen !== _motionEngineGen) return;
        kenBurnsRunHold(holdSec, gen, function () {
          if (gen !== _motionEngineGen) return;
          motionRunExit(
            slide,
            style,
            exitSec,
            gen,
            function () {
              if (gen !== _motionEngineGen || !_motionEngineRunning) return;
              motionEngineRunBlock(i + 1, gen);
            },
            {
              isLastInSegment: isLastInSegment,
              nextSlide: nextSlide,
            }
          );
        });
      },
      { isFirstInSegment: isFirstInSegment, prevSlide: prevSlide }
    );
  }

  function startMotionEngineAt(index) {
    stopMotionEngine();
    if (!usesBoardSlides() || !slides.length) return;
    // Board 4 (left-hero box presentation) uses the same engine as boards 1–3
    _motionEngineRunning = true;
    _motionEngineColdStart = true;
    const gen = ++_motionEngineGen;
    const i = ((index % slides.length) + slides.length) % slides.length;
    tokiInfo(
      "motion engine START at",
      i,
      "blocks=",
      slides.length,
      isDrinks ? "(Board 4)" : ""
    );
    motionEngineRunBlock(i, gen);
  }

  /**
   * After a step's Presentation Speed elapses: finish leaving the current
   * slide (serialized Wind-down), then advance. Next step clock starts only
   * after the next slide is painted (setActiveBoardSlides → note…).
   */
  function leaveCurrentSlideThen(done) {
    if (typeof done !== "function") return;
    // Static quarantine: no between-step Wind-down delays
    if (isPresentationStatic()) {
      done();
      return;
    }
    if (!usesBoardSlides() || !slides.length) {
      done();
      return;
    }
    const cur = slides[activeIndex];
    const next = slides[(activeIndex + 1) % slides.length];
    if (!cur || !next) {
      done();
      return;
    }

    // Collage→collage different blocks: setActiveBoardSlides runs handoff
    if (needsSameStageBlockHandoff(cur, next)) {
      done();
      return;
    }

    // Same collage surface continues (FP lineup → first Encore bow, bow→bow)
    if (
      isCollageBlockSlide(cur) &&
      isCollageBlockSlide(next) &&
      animationBlockId(cur) === animationBlockId(next)
    ) {
      done();
      return;
    }

    // Collage → hero/item (or anything non-collage): Wind-down BETWEEN steps
    if (isCollageBlockSlide(cur) && !isCollageBlockSlide(next)) {
      _presHandoffBusy = true;
      cancelPresentationAdvance();
      const prevType = cur.type === "encore" ? "encore" : "portrait";
      const wait = collageWindDownMs(prevType, els.familyPortrait);
      windDownCollageStage(prevType, false);
      _skipNextCollageWindDown = true;
      window.setTimeout(function () {
        _presHandoffBusy = false;
        done();
      }, wait + 40);
      return;
    }

    done();
  }

  function armPresentationStepDeadline(gen) {
    cancelPresentationAdvance();
    if (!_presentationRunning) return;
    const step = presentationStepMs();
    if (step <= 0) return;

    function fire() {
      slideshowTimer = null;
      if (gen !== _presentationStepGen) return;
      if (!_presentationRunning) return;
      if (_presHandoffBusy) {
        slideshowTimer = window.setTimeout(fire, 50);
        return;
      }
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const left = step - (now - _presentationStepStartedAt);
      if (left > 16) {
        slideshowTimer = window.setTimeout(fire, left);
        return;
      }
      // Step fully elapsed — leave current (Wind-down between steps), then advance
      leaveCurrentSlideThen(function () {
        if (gen !== _presentationStepGen) return;
        if (!_presentationRunning) return;
        setActive(activeIndex + 1, false);
      });
    }

    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const remaining = Math.max(0, step - (now - _presentationStepStartedAt));
    slideshowTimer = window.setTimeout(fire, remaining);
  }

  function itemHasMultiImages(item) {
    return itemImagePaths(item).length > 1;
  }

  /**
   * Present a menu item's photo(s) on the hero plate.
   * Multi-image uses the same lattice as Family Portrait (fillPortraitPlates)
   * but always rides hero fade + Ken Burns (via .hero-anim) — the New sticker
   * (plate child) does not get the scale.
   * See docs/FAMILY_PORTRAIT_LATTICE.md.
   */
  function presentItemVisual(item, instant, opts) {
    opts = opts || {};
    const prevType = opts.prevType || "";

    // Leaving collage (FP overview OR Encore bows) → hero path.
    // Critical: prevType === "encore" was previously ignored, so Alpha/Box
    // Encore never Wind-down'd and the last Punch-in frame stayed on top.
    windDownCollageStage(prevType, !!instant);

    if (cfg.showHero !== false && item && (item.image || itemHasMultiImages(item))) {
      updateHero(item, instant);
    } else {
      hideHeroPlate({ clearSrc: true });
    }
  }

  /**
   * True when slides are engine-shaped (segment / motionStyle / FP / Encore).
   * Board 4 uses the same path when Include in Presentation? built those slides.
   */
  function usesBoardSlides() {
    if (!slides.length) return false;
    if (!isDrinks) return true;
    const s0 = slides[0];
    return !!(
      s0 &&
      (s0.segment ||
        s0.motionStyle ||
        s0.type === "portrait" ||
        s0.type === "encore" ||
        s0.animationBlockId)
    );
  }

  function setActive(index, instant) {
    if (usesBoardSlides()) {
      setActiveBoardSlides(index, instant);
      return;
    }
    if (isDrinks) {
      setActiveDrinks(index, instant);
      if (_presentationRunning && !instant) notePresentationStepStart();
      return;
    }
    hideFamilyPortrait();
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
    } else {
      hideHeroPlate();
    }

    if (cfg.showSticker !== false) {
      updateSticker(item, instant);
    } else if (els.sticker) {
      els.sticker.classList.remove("visible");
      els.sticker.hidden = true;
    }
    if (_presentationRunning && !instant) notePresentationStepStart();
  }

  /**
   * Animation Block id for Wind-up / Wind-down barriers.
   * Same id → Punch-in/out only; different id → Wind-down then Wind-up.
   */
  function animationBlockId(slide) {
    if (!slide) return "";
    if (slide.animationBlockId) return slide.animationBlockId;
    const seg = (slide.segment || "alpha") + ":" + (slide.boxKey || "alpha");
    if (slide.segmentMode === "encore") return seg + ":encore";
    if (slide.type === "portrait") return seg + ":fp";
    return seg + ":slideshow";
  }

  /** Collage-based block (FP overview or Encore bows on the portrait stage). */
  function isCollageBlockSlide(slide) {
    if (!slide) return false;
    if (slide.type === "portrait") return true;
    if (
      slide.type === "encore" &&
      slide.withPortrait !== false &&
      slide.items &&
      slide.items.length
    ) {
      return true;
    }
    return false;
  }

  /**
   * Presentation Punch-out / Wind-down clock — same as Slideshow item→item
   * (updateHero outgoing gap). Application-wide: every Animation Block handoff
   * uses this duration so Wind-down→Wind-up feels identical to Punch-out→Punch-in.
   */
  function presentationPunchGapMs(el) {
    const node = el || heroMotionEl() || els.familyPortrait || document.documentElement;
    return readCssDurationMs(node, "--dur-mid", 450);
  }

  /**
   * Only when both sides need the portrait stage (collage→collage, different
   * Animation Blocks). Hero↔collage handoffs apply immediately so Wind-down
   * and Wind-up overlap on the Punch gap — same as Slideshow.
   */
  function needsSameStageBlockHandoff(prev, next) {
    if (!prev || !next) return false;
    if (animationBlockId(prev) === animationBlockId(next)) return false;
    return isCollageBlockSlide(prev) && isCollageBlockSlide(next);
  }

  /**
   * Wind-down of outgoing collage on the portrait stage, then callback.
   *
   * Encore exit: wait through Phase 1 (zoom last bow → full spread, opaque)
   * so the next Wind-up only overlaps the opacity fade — not the zoom-out.
   * FP overview exit: Punch-gap wait (fade + reverse Zoom Reveal).
   */
  function beginCollageBlockHandoff(prevSlide, done) {
    if (_presHandoffTimer) {
      clearTimeout(_presHandoffTimer);
      _presHandoffTimer = null;
    }
    _presHandoffBusy = true;

    const stage = els.familyPortrait;
    const prevType = (prevSlide && prevSlide.type) || "";
    // Encore: hold until full-spread zoom-out lands; next intro may overlap fade.
    // FP / other: classic Punch gap.
    // Full Wind-down between blocks (not stolen from either step's Hold)
    const gap =
      prevType === "encore" || prevType === "portrait"
        ? collageWindDownMs(prevType, stage)
        : presentationPunchGapMs(stage);

    // Keep last bow veil color through Encore undim (then wind-down clears dim)
    if (prevType === "encore" && _lastEncoreBowItem) {
      applyEncoreSpotlightChrome(_lastEncoreBowItem);
    } else if (prevType === "encore") {
      applyEncoreSpotlightChrome(null);
    }

    clearAllPresentationHighlights();
    if (stage && !stage.hidden) {
      windDownCollageStage(prevType || "portrait", false);
    }

    _presHandoffTimer = window.setTimeout(function () {
      _presHandoffTimer = null;
      _presHandoffBusy = false;
      _lastEncoreBowItem = null;
      if (typeof done === "function") done();
    }, gap + 40);
  }

  function setActiveBoardSlides(index, instant) {
    if (!slides.length) return;

    const nextIndex =
      ((index % slides.length) + slides.length) % slides.length;
    const slide = slides[nextIndex];
    if (!slide) return;

    // Beta Motion engine owns sequencing when running (Ken Burns phases)
    if (isPresentationEngine()) {
      activeIndex = nextIndex;
      _prevBoardSlide = slide;
      _prevBoardSlideType = slide.type || "";
      _activeSegmentMode =
        slide.segmentMode === "encore" ? "encore" : "slideshow";
      syncEncoreWallpaperPark({ instant: !!instant });
      if (instant || !_presentationRunning) {
        // Soft reload / pause: one static frame; engine restarts on startSlideshow
        applyStaticPresentationSlide(slide);
        return;
      }
      startMotionEngineAt(nextIndex);
      return;
    }

    // motionInstant: static quarantine snaps visuals; `instant` still controls step clock
    const motionInstant = !!instant || isPresentationStatic();
    // During same-stage collage handoff, ignore timer ticks
    if (_presHandoffBusy && !motionInstant) return;

    const prevSlide = _prevBoardSlide;

    // Same portrait stage, different Animation Block: Punch-gap handoff only
    // (Encore→Encore, FP→Encore of another segment, etc.). Skipped in static mode.
    if (
      !motionInstant &&
      needsSameStageBlockHandoff(prevSlide, slide)
    ) {
      activeIndex = nextIndex;
      // Step clock paused until paint — do not arm a short step from handoff start
      cancelPresentationAdvance();
      _activeSegmentMode =
        prevSlide && prevSlide.segmentMode === "encore"
          ? "encore"
          : "slideshow";
      beginCollageBlockHandoff(prevSlide, function () {
        _activeSegmentMode =
          slide.segmentMode === "encore" ? "encore" : "slideshow";
        applyBoardSlideContent(slide, false, prevSlide, {
          isBlockEntry: true,
        });
        _prevBoardSlideType = slide.type || "";
        _prevBoardSlide = slide;
        // Full Presentation Speed for the slide that just painted
        if (_presentationRunning && !instant) notePresentationStepStart();
      });
      return;
    }

    if (_presHandoffTimer) {
      clearTimeout(_presHandoffTimer);
      _presHandoffTimer = null;
    }
    _presHandoffBusy = false;

    activeIndex = nextIndex;
    const isBlockEntry =
      !prevSlide ||
      animationBlockId(prevSlide) !== animationBlockId(slide);
    applyBoardSlideContent(slide, motionInstant, prevSlide, {
      isBlockEntry: isBlockEntry && !motionInstant,
    });
    _prevBoardSlideType = slide.type || "";
    _prevBoardSlide = slide;
    // One Presentation Speed from this paint (Encore = Slideshow = FP)
    if (_presentationRunning && !instant) notePresentationStepStart();
  }

  /**
   * STATIC presentation paint — single path for image + highlight (no legacy motion).
   * Image swap and highlight change happen in the same commit after the asset is ready.
   * Highlights only use opacity fade (CSS .hl-on).
   */
  let _staticPaintGen = 0;

  function staticHighlightColor(isNew) {
    return isNew
      ? config.highlightSpecial || config.highlight || "#fff900"
      : config.highlight || "#26bbcb";
  }

  /** Clear all list/box/title active rows (snap — use engineHighlightFadeOut for timed color out). */
  function staticClearHighlights() {
    const fadeMs = 350;
    if (els.list) {
      els.list.querySelectorAll(".menu-item.hl-on, .menu-item.active").forEach(
        function (node) {
          node.classList.remove("hl-on", "active");
          node.style.removeProperty("--item-highlight");
          node.style.transition = "";
        }
      );
    }
    ["protein", "sauces", "drinks", "veggies"].forEach(function (key) {
      const body = boxBodyElByKey(key);
      if (!body) return;
      body
        .querySelectorAll(
          "[data-box-item-index].hl-on, [data-box-item-index].active"
        )
        .forEach(function (node) {
          node.classList.remove("hl-on", "active");
          node.style.removeProperty("--item-highlight");
          node.style.transition = "";
        });
    });
    if (els.title) {
      els.title.classList.remove("hl-on", "active");
      els.title.style.removeProperty("--item-highlight");
      els.title.style.transition = "";
    }
    clearFpAlphaHeaderHighlightSnap();
    clearFpBoxShellHighlightsSnap();
    return fadeMs;
  }

  /**
   * Set highlight color ease duration. Pass style.punchOut (same as fade-out).
   * Do NOT pass entranceSec / Punch-In — that was the too-slow bug.
   */
  function engineArmHighlightIn(sec) {
    const s =
      Number.isFinite(Number(sec)) && Number(sec) > 0 ? Number(sec) : 0.45;
    _highlightColorSec = s;
    const root = document.documentElement;
    if (root && root.style) {
      root.style.setProperty("--motion-highlight", String(s) + "s");
    }
  }

  /**
   * Snap-clear Alpha header FP chrome (body.fp-alpha-header-hl).
   * Drives header fill + title + logo together via CSS.
   */
  function clearFpAlphaHeaderHighlightSnap() {
    if (!document.body) return;
    document.body.classList.remove("fp-alpha-header-hl");
    document.body.style.removeProperty("--item-highlight");
  }

  /**
   * Timed clear of Alpha header FP chrome (header/title/logo reverse ease).
   * Same Punch-Out clock as item highlights — one class drop, simultaneous.
   */
  function fadeFpAlphaHeaderHighlight(sec) {
    if (!document.body || !document.body.classList.contains("fp-alpha-header-hl")) {
      return;
    }
    const s =
      Number.isFinite(Number(sec)) && Number(sec) > 0 ? Number(sec) : 0.45;
    const ms = Math.round(s * 1000) + 40;
    void document.body.offsetWidth;
    document.body.classList.remove("fp-alpha-header-hl");
    window.setTimeout(function () {
      if (document.body) {
        document.body.style.removeProperty("--item-highlight");
      }
    }, ms);
  }

  /**
   * Alpha Family Portrait (header mode): simultaneous Punch-Out ease —
   *   frame-header fill → Highlight
   *   #menu-title + #logo → Secondary
   * One body class; never Special. See FP_ALPHA_OVERVIEW_HL.
   */
  function armAlphaHeaderHighlight() {
    if (!document.body) return;
    const color = config.highlight || "#26bbcb";
    // Title-mode classes off (header mode paints title via body class → Secondary)
    if (els.title) {
      els.title.classList.remove("hl-on", "active");
      els.title.style.removeProperty("--item-highlight");
      els.title.style.transition = "";
    }
    clearFpAlphaHeaderHighlightSnap();
    document.body.style.setProperty("--item-highlight", color);
    void document.body.offsetWidth;
    document.body.classList.add("fp-alpha-header-hl");
  }

  /** Snap-clear box shell FP chrome (no transition). */
  function clearFpBoxShellHighlightsSnap() {
    // Boards 1–3: .info-box; Board 4: .drinks-box / #drink-options-box
    const boxes = document.querySelectorAll(
      ".info-box.fp-shell-hl, .drinks-box.fp-shell-hl, #drink-options-box.fp-shell-hl"
    );
    for (let i = 0; i < boxes.length; i++) {
      boxes[i].classList.remove("fp-shell-hl");
      boxes[i].style.removeProperty("--item-highlight");
    }
  }

  /**
   * Timed clear of box shell FP chrome (fill eases Highlight → secondary via CSS).
   * Same Punch-Out clock as text highlight fade-out.
   */
  function fadeFpBoxShellHighlights(sec) {
    const s =
      Number.isFinite(Number(sec)) && Number(sec) > 0 ? Number(sec) : 0.45;
    const ms = Math.round(s * 1000) + 40;
    const boxes = document.querySelectorAll(
      ".info-box.fp-shell-hl, .drinks-box.fp-shell-hl, #drink-options-box.fp-shell-hl"
    );
    for (let i = 0; i < boxes.length; i++) {
      const el = boxes[i];
      void el.offsetWidth;
      el.classList.remove("fp-shell-hl");
      window.setTimeout(
        (function (node) {
          return function () {
            node.style.removeProperty("--item-highlight");
          };
        })(el),
        ms
      );
    }
  }

  /**
   * Box-segment Family Portrait: ease shell-outer shape → Highlight color.
   * Leaves box titles / body text alone. Never Special.
   */
  function armBoxShellHighlight(boxKey) {
    const boxEl = boxRootElByKey(boxKey);
    if (!boxEl) return;
    const color = config.highlight || "#26bbcb";
    clearFpBoxShellHighlightsSnap();
    boxEl.style.setProperty("--item-highlight", color);
    // Start at base fill (secondary), then add class so fill transitions
    void boxEl.offsetWidth;
    boxEl.classList.add("fp-shell-hl");
  }

  /**
   * Family Portrait overview chrome (adaptive):
   *   Alpha → FP_ALPHA_OVERVIEW_HL:
   *             "header" = fill→Highlight + title/logo→Secondary (simultaneous)
   *             "title"  = menu title text→Highlight only
   *   Box   → that box's shell shape → Highlight (title text untouched)
   * Timing: Punch-Out color ease (same as item highlights). Never Special.
   */
  function armFpOverviewHighlight(slide) {
    // Master switch — flip FP_OVERVIEW_HIGHLIGHT to restore overview chrome
    if (!FP_OVERVIEW_HIGHLIGHT) return;
    if (slide && slide.segment === "box" && slide.boxKey) {
      clearFpAlphaHeaderHighlightSnap();
      armBoxShellHighlight(slide.boxKey);
      return;
    }
    if (fpAlphaOverviewIsHeader()) {
      armAlphaHeaderHighlight();
    } else {
      clearFpAlphaHeaderHighlightSnap();
      armMenuTitleHighlight();
    }
  }

  /**
   * Alpha Family Portrait (title mode): #menu-title → Highlight color.
   * Same color ease + Punch-Out duration as list/box item highlights.
   */
  function armMenuTitleHighlight() {
    if (!els.title) return;
    const color = config.highlight || "#26bbcb";
    staticArmHighlightNode(els.title, color);
  }

  function staticArmHighlightNode(node, color) {
    if (isPresentationStatic()) return; // static FP hold = NEVER HIGHLIGHT ITEMS
    if (!node) return;
    const sec =
      Number.isFinite(_highlightColorSec) && _highlightColorSec > 0
        ? _highlightColorSec
        : 0.45;
    // COLOR only — reverse of engineHighlightFadeOut (never opacity)
    node.style.opacity = "";
    node.style.setProperty("--item-highlight", color);
    node.classList.remove("hl-on", "active");
    node.style.transition = "none";
    void node.offsetWidth;
    node.style.transition =
      "color " + sec + "s var(--ease-fade, cubic-bezier(0.4, 0, 0.2, 1))";
    void node.offsetWidth;
    node.classList.add("active", "hl-on");
    window.setTimeout(function () {
      if (node.classList.contains("active")) {
        node.style.transition = "";
      }
    }, Math.round(sec * 1000) + 40);
  }

  function staticSetListHighlight(itemIndex, isNew) {
    if (!els.list || itemIndex == null || itemIndex < 0) return;
    // Item highlight replaces FP alpha chrome / box-shell chrome
    if (els.title) {
      els.title.classList.remove("hl-on", "active");
      els.title.style.removeProperty("--item-highlight");
      els.title.style.transition = "";
    }
    clearFpAlphaHeaderHighlightSnap();
    clearFpBoxShellHighlightsSnap();
    const color = staticHighlightColor(isNew);
    els.list.querySelectorAll(".menu-item").forEach(function (node, i) {
      const on = i === itemIndex;
      if (on) {
        staticArmHighlightNode(node, color);
      } else {
        node.classList.remove("hl-on", "active");
        node.style.removeProperty("--item-highlight");
      }
    });
  }

  function staticSetBoxHighlight(boxKey, itemIndex, isNew) {
    staticClearHighlights();
    if (!boxKey || itemIndex == null || itemIndex < 0) return;
    const body = boxBodyElByKey(boxKey);
    if (!body) return;
    const color = staticHighlightColor(isNew);
    body.querySelectorAll("[data-box-item-index]").forEach(function (node) {
      const on = Number(node.dataset.boxItemIndex) === itemIndex;
      if (on) {
        staticArmHighlightNode(node, color);
      } else {
        node.classList.remove("hl-on", "active");
        node.style.removeProperty("--item-highlight");
      }
    });
  }

  /** Snap hero image to item (no motion). Calls done() when visible (or no image). */
  function staticPaintHero(item, done) {
    const plate = els.heroPlate;
    const img = els.hero;
    finishHideFamilyPortrait();
    applyEncoreSpotlightChrome(null, { forceClear: true });

    if (!plate || !img || cfg.showHero === false) {
      if (typeof done === "function") done();
      return;
    }

    if (!item || !(item.image || itemHasMultiImages(item))) {
      hideHeroPlate({ clearSrc: true, instant: true });
      if (typeof done === "function") done();
      return;
    }

    clearHeroMultiLattice(plate);
    setHeroZoom(1, "snap");
    plate.style.transition = "none";
    plate.style.opacity = "1";
    plate.hidden = false;
    plate.classList.add("visible");
    img.style.visibility = "";

    const wantSticker = !!(item.isNew && config && config.showSticker !== false);
    applyPlateSticker(wantSticker);

    if (itemHasMultiImages(item)) {
      applyHeroMultiLattice(item, plate);
      if (typeof done === "function") done();
      return;
    }

    loadHeroRaster(
      img,
      item.image,
      function () {
        if (typeof done === "function") done();
      },
      function () {
        hideHeroPlate({ clearSrc: true, instant: true });
        if (typeof done === "function") done();
      }
    );
  }

  /**
   * Static presentation: one atomic paint for the step.
   * Highlight is applied only when the visual for this step is ready (same frame).
   */
  function applyStaticPresentationSlide(slide) {
    const gen = ++_staticPaintGen;
    _activeSegmentMode =
      slide.segmentMode === "encore" ? "encore" : "slideshow";
    syncEncoreWallpaperPark({ instant: true });
    applyEncoreSpotlightChrome(null, { forceClear: true });

    const isBoxSeg = slide.segment === "box";
    const textOnly =
      (slide.type === "item" || slide.type === "encore") &&
      (!!slide.textOnly || !slide.image);

    // --- Portrait overview: Alpha title | Box shell chrome (Highlight color) ---
    if (slide.type === "portrait") {
      staticClearHighlights();
      engineArmHighlightIn(0.45);
      armFpOverviewHighlight(slide);
      hideHeroPlate({ clearSrc: true, instant: true });
      showFamilyPortrait(slide.items || [], true, {});
      if (cfg.showSticker !== false) updateSticker({ isNew: false }, true);
      return;
    }

    // --- Item / encore: one hero (or collage cast without motion) + highlight together ---
    const item = resolvePresItem(slide.itemIndex, slide) || {
      image: slide.image,
      images: slide.images || (slide.image ? [slide.image] : null),
      isNew: !!slide.isNew,
    };

    // Encore-with-cast in static: still show collage snap + highlight (no bows)
    const useCollage =
      slide.type === "encore" &&
      slide.withPortrait !== false &&
      slide.items &&
      slide.items.length > 0 &&
      !textOnly;

    const applyHighlight = function () {
      if (gen !== _staticPaintGen) return;
      if (isBoxSeg) {
        staticSetBoxHighlight(
          slide.boxKey,
          slide.boxItemIndex != null ? slide.boxItemIndex : slide.itemIndex,
          !!slide.isNew
        );
      } else if (slide.itemIndex != null && slide.itemIndex >= 0) {
        staticSetListHighlight(slide.itemIndex, !!slide.isNew);
      } else {
        staticClearHighlights();
      }
    };

    if (useCollage) {
      hideHeroPlate({ clearSrc: true, instant: true });
      showFamilyPortrait(slide.items, true, {});
      // Collage is sync; highlight same turn
      applyHighlight();
      if (cfg.showSticker !== false) updateSticker({ isNew: false }, true);
      return;
    }

    if (textOnly || !item.image) {
      hideHeroPlate({ clearSrc: true, instant: true });
      finishHideFamilyPortrait();
      applyHighlight();
      if (cfg.showSticker !== false) updateSticker(item, true);
      return;
    }

    // Wait for image, then highlight in the same done() — keeps them in lockstep
    staticPaintHero(item, function () {
      if (gen !== _staticPaintGen) return;
      applyHighlight();
      if (cfg.showSticker !== false) updateSticker(item, true);
    });
  }

  /**
   * Paint one board presentation slide (Alpha or Box segment).
   * @param {object} slide
   * @param {boolean} instant
   * @param {object|null} prevSlide
   * @param {{ isBlockEntry?: boolean }} [opts]
   */
  function applyBoardSlideContent(slide, instant, prevSlide, opts) {
    opts = opts || {};

    // Real static architecture path — not a thin gate over legacy motion
    if (isPresentationStatic()) {
      applyStaticPresentationSlide(slide);
      return;
    }

    const prevType = (prevSlide && prevSlide.type) || _prevBoardSlideType || "";
    const isBoxSeg = slide.segment === "box";
    const segMode =
      slide.segmentMode === "encore" ? "encore" : "slideshow";
    const textOnly =
      (slide.type === "item" || slide.type === "encore") &&
      (!!slide.textOnly || !slide.image);
    const isBlockEntry = !!opts.isBlockEntry || !!slide.isBlockWindUp;
    const nextIsCollage =
      slide.type === "portrait" ||
      (slide.type === "encore" &&
        slide.withPortrait !== false &&
        slide.items &&
        slide.items.length > 0 &&
        !textOnly);
    const prevIsCollage =
      prevType === "portrait" || prevType === "encore";

    // Collage Wind-down: usually already ran between steps (leaveCurrentSlideThen).
    // Only run here if something advanced without that path (instant / cold).
    if (prevIsCollage && !nextIsCollage) {
      if (_skipNextCollageWindDown) {
        _skipNextCollageWindDown = false;
      } else if (!instant) {
        windDownCollageStage(prevType, false);
      } else {
        windDownCollageStage(prevType, true);
      }
    }

    {
      _activeSegmentMode = segMode;
      syncEncoreWallpaperPark({ instant: !!instant });
    }

    // Veil only on Encore *bows* (and never in static quarantine).
    if (
      !isPresentationStatic() &&
      slide.type === "encore" &&
      !textOnly
    ) {
      applyEncoreSpotlightChrome(null);
    } else {
      applyEncoreSpotlightChrome(null, { forceClear: true });
    }

    // —— Highlights ——
    const deferEncoreListHighlight =
      segMode === "encore" &&
      slide.type === "encore" &&
      slide.withPortrait !== false &&
      slide.items &&
      slide.items.length > 0;

    if (isBoxSeg) {
      clearEncoreListHighlight();
      if (
        !deferEncoreListHighlight &&
        (slide.type === "item" || slide.type === "encore")
      ) {
        setBoxPresentationHighlight(
          slide.boxKey,
          slide.boxItemIndex != null ? slide.boxItemIndex : slide.itemIndex,
          !!slide.isNew
        );
      } else if (slide.type === "portrait") {
        clearBoxPresentationHighlights();
      }
    } else {
      clearBoxPresentationHighlights();
      const nodes = els.list
        ? els.list.querySelectorAll(".menu-item")
        : [];
      nodes.forEach(function (node, i) {
        const on =
          !deferEncoreListHighlight &&
          (slide.type === "item" || slide.type === "encore") &&
          i === slide.itemIndex;
        if (isPresentationStatic()) {
          if (on) {
            node.style.opacity = "0.35";
            node.classList.add("active");
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                node.style.opacity = "1";
              });
            });
          } else {
            node.classList.remove("active");
            node.style.opacity = "";
          }
        } else {
          node.classList.toggle("active", on);
        }
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

    // Family Portrait overview (Slideshow FP block Wind-up, or Encore lineup Wind-up)
    if (slide.type === "portrait") {
      if (segMode === "encore") {
        clearAllPresentationHighlights();
      }
      if (cfg.showHero !== false) {
        // Wind-up rules:
        //  - From slideshow item → two-phase hero→portrait handoff
        //  - Animation Block entry (every segment FP, including after Encore) →
        //    Zoom Reveal (forceIntro). Never settle/snap — that only looked
        //    right for the cold-open Wind-up.
        //  - Same-block encore→lineup (rare; not how slides are built today) → settle
        if (prevType === "item" && !instant) {
          handoffHeroToPortrait(slide.items, instant);
        } else if (
          prevType === "encore" &&
          !isBlockEntry &&
          !instant
        ) {
          showFamilyPortrait(slide.items, instant, { fromEncore: true });
        } else {
          showFamilyPortrait(slide.items, instant, {
            forceIntro: !instant,
          });
        }
      }
      if (cfg.showSticker !== false) {
        updateSticker({ isNew: false }, instant);
      } else if (els.sticker) {
        els.sticker.classList.remove("visible");
        els.sticker.hidden = true;
      }
      return;
    }

    // Encore bow
    if (slide.type === "encore") {
      const usePortrait =
        slide.withPortrait !== false &&
        slide.items &&
        slide.items.length > 0 &&
        !textOnly;

      if (usePortrait) {
        if (cfg.showHero !== false) {
          // Encore Wind-up without FP lineup: Zoom Reveal into collage, then first Punch-in
          const needsEncoreWindUp =
            !instant &&
            isBlockEntry &&
            prevType !== "portrait" &&
            prevType !== "encore";

          if (needsEncoreWindUp) {
            showFamilyPortrait(slide.items, false, { forceIntro: true });
            // After Zoom Reveal fade-in, Punch-in the first bow (not instant)
            const stage = els.familyPortrait;
            const introMs = stage
              ? readCssDurationMs(stage, "--dur-mid", 450) + 120
              : 500;
            if (_encoreSpotTimer) {
              clearTimeout(_encoreSpotTimer);
              _encoreSpotTimer = null;
            }
            window.setTimeout(function () {
              // Abort if user/timer advanced away from this bow
              const cur = activePresSlide();
              if (
                !cur ||
                cur.type !== "encore" ||
                cur.itemIndex !== slide.itemIndex ||
                animationBlockId(cur) !== animationBlockId(slide)
              ) {
                return;
              }
              setPortraitSpotlight(slide.itemIndex, { instant: false });
            }, introMs);
          } else {
            showFamilyPortrait(slide.items, instant, { settle: true });
            // Same Punch gap every bow (incl. first after FP). Only hard instant
            // paint skips the blackout — never a special “first item longer” path.
            setPortraitSpotlight(slide.itemIndex, {
              instant: !!instant,
            });
          }
        }
        if (cfg.showSticker !== false) {
          updateSticker({ isNew: false }, instant);
        } else if (els.sticker) {
          els.sticker.classList.remove("visible");
          els.sticker.hidden = true;
        }
        return;
      }

      clearPortraitSpotlight();
      if (textOnly) {
        presentTextOnlyBeat(slide, instant, prevType);
      } else {
        const item = resolvePresItem(slide.itemIndex, slide) || {
          image: slide.image,
          images: slide.images || (slide.image ? [slide.image] : null),
          isNew: !!slide.isNew,
        };
        presentItemVisual(item, instant, { prevType: prevType });
        if (cfg.showSticker !== false) {
          updateSticker(item, instant);
        } else if (els.sticker) {
          els.sticker.classList.remove("visible");
          els.sticker.hidden = true;
        }
      }
      return;
    }

    // Slideshow item
    if (textOnly) {
      presentTextOnlyBeat(slide, instant, prevType);
      return;
    }
    const item = resolvePresItem(slide.itemIndex, slide) || {
      image: slide.image,
      images: slide.images || (slide.image ? [slide.image] : null),
      isNew: !!slide.isNew,
    };
    presentItemVisual(item, instant, { prevType: prevType });
    if (cfg.showSticker !== false) {
      updateSticker(item, instant);
    } else if (els.sticker) {
      els.sticker.classList.remove("visible");
      els.sticker.hidden = true;
    }
  }

  /**
   * Text-only beat: no hero image. Keep plate only if New sticker is needed.
   */
  function presentTextOnlyBeat(slide, instant, prevType) {
    // Encore must Punch-out+fade (not reverseZoom veil-to-center)
    windDownCollageStage(prevType, !!instant);
    const wantNew =
      !!slide.isNew && config && config.showSticker !== false;
    if (wantNew) {
      // Empty plate so #new-sticker (plate child) can fade in
      const plate = els.heroPlate;
      const img = els.hero;
      if (plate) {
        clearHeroMultiLattice(plate);
        if (img) {
          img.removeAttribute("src");
          img.dataset.downsampled = "";
        }
        plate.hidden = false;
        applyPlateSticker(true);
        requestAnimationFrame(function () {
          plate.classList.add("visible");
        });
      } else {
        applyPlateSticker(true);
      }
    } else {
      hideHeroPlate({ clearSrc: true });
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
      images: slide.images || (slide.image ? [slide.image] : null),
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

  function heroKenBurnsOn() {
    // Static quarantine: no Ken Burns until Beta motion engine
    if (isPresentationStatic()) return false;
    // Engine path owns Ken Burns for boards 1–4; legacy flag for non-engine only
    if (isPresentationEngine()) return false;
    return config.slideshowKenBurns !== false;
  }

  /** Motion target for the slideshow plate (falls back to img if plate missing). */
  function heroMotionEl() {
    return els.heroPlate || els.hero;
  }

  /**
   * Hide the plate unit (opacity/scale classes + optional src clear).
   * Also hides the fixed stage-corner New badge when hideSticker is not false.
   */
  function hideHeroPlate(opts) {
    opts = opts || {};
    const plate = els.heroPlate;
    const img = els.hero;
    if (plate) {
      plate.classList.remove("visible", "is-kb-in");
      plate.hidden = true;
      if (opts.clearSrc) clearHeroMultiLattice(plate);
    } else if (img) {
      img.classList.remove("visible", "is-kb-in");
      img.hidden = true;
    }
    if (opts.clearSrc && img) {
      img.removeAttribute("src");
      stampRasterMaster(img, "");
    }
    if (opts.hideSticker !== false && els.sticker) {
      els.sticker.classList.remove("visible");
      els.sticker.hidden = true;
    }
  }

  /**
   * Show/hide New badge (plate child). Opacity fade is owned by #hero-plate;
   * only toggle presence here so isNew items carry the badge through the fade.
   */
  function applyPlateSticker(wantNew) {
    if (!els.sticker) return;
    if (wantNew && config && config.showSticker !== false) {
      els.sticker.hidden = false;
      els.sticker.classList.add("visible");
    } else {
      els.sticker.classList.remove("visible");
      els.sticker.hidden = true;
    }
  }

  function setHeroZoom(scale, mode) {
    const el = heroMotionEl();
    if (!el) return;
    // Zoom only affects .hero-anim (photo). Sticker is outside that subtree.
    const anim = el.querySelector ? el.querySelector(".hero-anim") : null;
    if (mode === "snap") {
      el.style.transition = "none";
      if (anim) anim.style.transition = "none";
      el.style.setProperty("--hero-zoom", String(scale));
      if (anim) void anim.offsetWidth;
      void el.offsetWidth;
      el.style.transition = "";
      if (anim) anim.style.transition = "";
      el.classList.remove("is-kb-in");
      setFeatureActive("kenBurns", false, "snap");
      return;
    }
    if (mode === "in") {
      el.classList.add("is-kb-in");
      setFeatureActive("kenBurns", true, "zoom-in start");
    } else {
      el.classList.remove("is-kb-in");
      setFeatureActive("kenBurns", false, "zoom end");
    }
    el.style.setProperty("--hero-zoom", String(scale));
  }

  function updateHero(item, instant) {
    const img = els.hero;
    const plate = heroMotionEl();
    if (!img || !plate) return;
    // Static quarantine: snap image only (no fade/zoom choreography)
    if (isPresentationStatic()) instant = true;
    const multi = itemHasMultiImages(item);
    if (!item || (!item.image && !multi)) {
      hideHeroPlate({ clearSrc: true });
      return;
    }

    const kb = heroKenBurnsOn() && !instant;
    let zoomMin = 0.93;
    let zoomMax = 1;
    try {
      const cs = getComputedStyle(plate);
      const mn = parseFloat(cs.getPropertyValue("--hero-zoom-min").trim());
      const mx = parseFloat(cs.getPropertyValue("--hero-zoom-max").trim());
      if (Number.isFinite(mn) && mn > 0 && mn < 1) zoomMin = mn;
      if (Number.isFinite(mx) && mx >= 1) zoomMax = mx;
    } catch (e) {
      /* defaults */
    }

    const wantSticker = !!(item.isNew && config && config.showSticker !== false);

    const show = function () {
      plate.hidden = false;
      // Sticker presence while plate is at opacity 0; then plate fade carries it
      applyPlateSticker(wantSticker);
      // Do not reset scale here — stay at min until push-in
      requestAnimationFrame(function () {
        plate.classList.add("visible");
        if (kb) {
          setHeroZoom(zoomMax, "in");
        } else {
          setHeroZoom(zoomMax, "snap");
        }
      });
    };

    /**
     * Content swap while plate is faded out — identical clock for single & multi.
     * Multi: FP lattice inside .hero-anim (gets the scale).
     * Single: #hero src (inside .hero-anim).
     * #new-sticker is a plate child outside .hero-anim: fades with plate, no zoom.
     */
    const applyContent = function () {
      if (multi) {
        applyHeroMultiLattice(item, plate);
        // Lattice imgs load async; show on next frame so DOM is painted
        // (same visual timing class as a cached single-image hit)
        requestAnimationFrame(function () {
          show();
        });
        return;
      }

      // Single image — clear any prior multi lattice first
      clearHeroMultiLattice(plate);

      loadHeroRaster(
        img,
        item.image,
        show,
        function () {
          hideHeroPlate({ clearSrc: true, hideSticker: !wantSticker });
          if (wantSticker) {
            plate.hidden = false;
            applyPlateSticker(true);
            requestAnimationFrame(function () {
              plate.classList.add("visible");
            });
          }
        }
      );
    };

    if (instant) {
      plate.classList.remove("visible");
      setHeroZoom(zoomMax, "snap");
      applyContent();
      return;
    }

    // Fade out plate (+ decorations) + optional zoom to min — same for single & multi
    plate.classList.remove("visible");
    if (kb) {
      setHeroZoom(zoomMin, "out");
    }
    // Align swap with fade (~dur-mid); KB zoom-out shares that clock
    const gap = kb ? readCssDurationMs(plate, "--dur-mid", 450) : 200;
    window.setTimeout(applyContent, gap);
  }

  /**
   * New badge is a #hero-plate child — non-instant paths leave show/hide to
   * updateHero.show() so the badge rides the plate opacity fade (not Ken Burns).
   * Works for Alpha and Box Menu presentation segments.
   */
  function updateSticker(item, instant) {
    if (!els.sticker) return;
    const wantNew = !!(item && item.isNew);

    function stillWantsHidden() {
      if (isDrinks || usesBoardSlides()) {
        const slide = slides[activeIndex];
        return (
          !slide ||
          !slide.isNew ||
          slide.type === "portrait"
        );
      }
      return !items[activeIndex]?.isNew;
    }

    if (instant || !els.heroPlate) {
      applyPlateSticker(wantNew);
      return;
    }
    // Animated hero: show() applies sticker while plate is faded out, then
    // plate .visible fade-in/out carries the badge. Leave New→not-New until then
    // so the outgoing badge fades with the plate instead of snapping off.
    if (!wantNew && stillWantsHidden()) {
      if (els.heroPlate.hidden) applyPlateSticker(false);
    }
  }

  /**
   * Style "Presentation Speed" (seconds; column M). 0 / blank handling:
   *   0 or negative → pause auto-advance (still show current slide)
   *   blank / invalid → fallback
   * Do not use `n || fallback` — that treats 0 as missing.
   */
  function parseSlideshowSpeed(raw, fallback) {
    const fb =
      fallback != null && Number.isFinite(Number(fallback))
        ? Math.max(0, Number(fallback))
        : 3;
    if (raw === undefined || raw === null || raw === "") return fb;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fb;
    return Math.max(0, n);
  }

  /**
   * Style "BG Scroll Speed" (multiplier; column L). Same zero-safe rule:
   *   0 or negative → freeze galaxy pan + stripe scroll
   *   blank / invalid → fallback (usually 1)
   * Do not use `n || fallback` — that treats 0 as missing.
   */
  function parseBgScrollSpeed(raw, fallback) {
    const fb =
      fallback != null && Number.isFinite(Number(fallback))
        ? Math.max(0, Number(fallback))
        : 1;
    if (raw === undefined || raw === null || raw === "") return fb;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fb;
    return Math.max(0, n);
  }

  /** Board "Presentation Mode" dropdown: Slideshow | Encore */
  /**
   * Presentation Mode from Settings: slideshow | encore | kenburns
   * Maps to Motion Style via presentationModeToStructureAndMotion().
   */
  function parsePresentationMode(raw, fallback) {
    const fb =
      fallback === "encore"
        ? "encore"
        : fallback === "kenburns"
          ? "kenburns"
          : fallback === "static"
            ? "static"
            : "slideshow";
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return fb;
    }
    const s = String(raw).trim().toLowerCase();
    if (s.indexOf("encore") !== -1) return "encore";
    if (s.indexOf("ken") !== -1 && s.indexOf("burn") !== -1) return "kenburns";
    if (s.indexOf("static") !== -1) return "static";
    if (s.indexOf("slide") !== -1) return "slideshow";
    return fb;
  }

  /** Style "Encore Spotlight Type": Hard | Hard_Shadow | Soft */
  function parseEncoreSpotlightType(raw, fallback) {
    const fb =
      fallback === "soft" || fallback === "hard_shadow" ? fallback : "hard";
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return fb;
    }
    const s = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (s.indexOf("soft") !== -1) return "soft";
    if (s.indexOf("hard_shadow") !== -1 || s === "hardshadow") {
      return "hard_shadow";
    }
    if (s.indexOf("hard") !== -1) return "hard";
    return fb;
  }

  function normalizedEncoreSpotlightType(raw) {
    if (raw === "soft" || raw === "hard_shadow" || raw === "hard") return raw;
    return parseEncoreSpotlightType(raw, "hard");
  }

  /** Style "Encore Spotlight Color": Black | Highlight */
  function parseEncoreSpotlightColor(raw, fallback) {
    const fb = fallback === "highlight" ? "highlight" : "black";
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return fb;
    }
    const s = String(raw).trim().toLowerCase();
    if (s.indexOf("highlight") !== -1 || s.indexOf("special") !== -1) {
      return "highlight";
    }
    if (s.indexOf("black") !== -1) return "black";
    return fb;
  }

  function collectRasterBakeJobs() {
    const seen = {};
    const jobs = [];
    function add(path, gridN) {
      if (!path) return;
      const n = gridN == null ? 1 : gridN;
      const id = path + "|n" + n;
      if (seen[id]) return;
      seen[id] = true;
      jobs.push({ path: path, gridN: n });
    }
    const list = items || [];
    for (let i = 0; i < list.length; i++) {
      const paths = itemImagePaths(list[i]);
      if (paths.length > 1) {
        for (let j = 0; j < paths.length; j++) add(paths[j], paths.length);
      } else if (paths.length === 1) {
        add(paths[0], 1);
      }
    }
    return jobs;
  }

  function bakeRasterJob(job) {
    return new Promise(function (resolve) {
      const target = bakeTargetPx(job.gridN);
      const key = rasterBakeKey(job.path, target.w, target.h);
      if (_rasterBakeCache[key]) {
        resolve();
        return;
      }
      const img = new Image();
      let done = false;
      const finish = function () {
        if (done) return;
        done = true;
        resolve();
      };
      const t = window.setTimeout(finish, 7000);
      img.onload = function () {
        window.clearTimeout(t);
        const nw = img.naturalWidth || 0;
        const nh = img.naturalHeight || 0;
        if (nw < 2 || nh < 2) {
          finish();
          return;
        }
        if (nw <= target.w * 1.05 && nh <= target.h * 1.05) {
          _rasterBakeCache[key] = {
            url: job.path,
            from: nw + "x" + nh,
            px: nw + "x" + nh,
            skipped: true,
          };
          finish();
          return;
        }
        try {
          const sc = Math.min(target.w / nw, target.h / nh, 1);
          const cw = Math.max(1, Math.round(nw * sc));
          const ch = Math.max(1, Math.round(nh * sc));
          const c = document.createElement("canvas");
          c.width = cw;
          c.height = ch;
          const ctx = c.getContext("2d");
          if (!ctx) {
            finish();
            return;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, 0, 0, cw, ch);
          let url;
          try {
            url = c.toDataURL("image/webp", 0.82);
            if (!url || url.indexOf("image/webp") === -1) {
              url = c.toDataURL("image/png");
            }
          } catch (e1) {
            url = c.toDataURL("image/png");
          }
          _rasterBakeCache[key] = {
            url: url,
            from: nw + "x" + nh,
            px: cw + "x" + ch,
          };
        } catch (e) {
          tokiWarn("raster bake fail", job.path, e);
        }
        finish();
      };
      img.onerror = function () {
        window.clearTimeout(t);
        finish();
      };
      img.src = job.path;
    });
  }

  function bakeRastersForPlay() {
    const jobs = collectRasterBakeJobs();
    tokiInfo("raster bake start", jobs.length);
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const limit = 4;
    return new Promise(function (resolve) {
      let i = 0;
      let live = 0;
      function next() {
        if (i >= jobs.length && live === 0) {
          const ms =
            (typeof performance !== "undefined" ? performance.now() : Date.now()) -
            t0;
          tokiInfo(
            "raster bake done",
            jobs.length,
            "in",
            Math.round(ms) + "ms"
          );
          resolve();
          return;
        }
        while (live < limit && i < jobs.length) {
          live++;
          bakeRasterJob(jobs[i++]).then(
            function () {
              live--;
              next();
            },
            function () {
              live--;
              next();
            }
          );
        }
      }
      next();
    });
  }

  /**
   * Wait until the board surface is visible enough for the first Wind-up
   * (fonts, layout paint, stage scaled). Avoids Animation Blocks running off-screen.
   */
  function whenPresentationSurfaceReady(done) {
    const run = function () {
      // Stage must have non-zero size (scaleStageToWindow has run)
      const stage = document.getElementById("stage");
      const readySize =
        stage &&
        stage.offsetWidth > 8 &&
        stage.offsetHeight > 8;
      if (!readySize) {
        window.setTimeout(run, 50);
        return;
      }
      // Double rAF: styles + first paint committed
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (typeof done === "function") done();
        });
      });
    };
    const fontsReady =
      document.fonts && document.fonts.ready
        ? document.fonts.ready
        : Promise.resolve();
    fontsReady.then(run).catch(run);
  }

  /**
   * First Wind-up after load: re-apply current slide with motion (not instant).
   */
  function playOpeningWindUp() {
    _presSurfaceReady = true;
    if (!usesBoardSlides() || !slides.length) {
      // Simple item path: re-trigger with motion
      if (items.length) setActive(activeIndex, false);
      return;
    }
    // Ken Burns engine starts in startSlideshow — no legacy opening paint
    if (isPresentationEngine()) {
      tokiInfo("Ken Burns engine will open from startSlideshow");
      return;
    }
    const slide = slides[activeIndex] || slides[0];
    if (!slide) return;
    // Treat as block entry with no previous block so Wind-up treatments run
    _prevBoardSlide = null;
    _prevBoardSlideType = "";
    applyBoardSlideContent(slide, false, null, { isBlockEntry: true });
    _prevBoardSlideType = slide.type || "";
    _prevBoardSlide = slide;
    tokiInfo("presentation opening Wind-up", animationBlockId(slide));
  }

  function startSlideshow() {
    cancelPresentationAdvance();
    stopMotionEngine();
    // One rule for all boards: engine slides use slides[]; else alpha items
    const count = usesBoardSlides()
      ? slides.length
      : isDrinks
        ? slides.length
        : items.length;
    if (count <= 1) {
      _presentationRunning = false;
      updateDebugVisuals();
      return;
    }

    // Motion engine ONLY — Beta Motion Punch/Hold/Out. No Board-4-only clocks.
    if (isPresentationEngine() && usesBoardSlides()) {
      const sample = getMotionStyle(
        motionStyleNameForSlide(slides[activeIndex] || slides[0])
      );
      if (!(sample.hold > 0) && !(sample.punchIn > 0)) {
        _presentationRunning = false;
        tokiInfo("motion engine paused (Hold and Punch-In are 0)");
        updateDebugVisuals();
        return;
      }
      _presentationRunning = true;
      startMotionEngineAt(activeIndex);
      tokiInfo(
        "motion engine START",
        isDrinks ? "Board4" : "board",
        "blocks=",
        count,
        "sampleStyle=",
        sample.name,
        "punchIn=",
        sample.punchIn,
        "hold=",
        sample.hold,
        "punchOut=",
        sample.punchOut,
        "zoom=",
        motionStyleUsesZoom(sample) ? "yes" : "no",
        "| digits from Beta Motion (not Presentation Speed)"
      );
      updateDebugVisuals();
      return;
    }

    const sec = parseSlideshowSpeed(config.slideshowSpeed, 3);
    // 0 = hold on current slide (Style → Presentation Speed) — non-engine only
    if (sec <= 0) {
      _presentationRunning = false;
      tokiInfo("presentation paused (Presentation Speed =", sec, ")");
      updateDebugVisuals();
      return;
    }
    _presentationRunning = true;
    notePresentationStepStart();
    tokiInfo(
      "presentation step=",
      sec,
      "s (static/legacy; ",
      count,
      "steps)"
    );
    updateDebugVisuals();
  }

  function stopSlideshow() {
    _presentationRunning = false;
    stopMotionEngine();
    cancelPresentationAdvance();
    updateDebugVisuals();
  }

  // ---------- galaxy ----------

  // Module-level so we never stack multiple rAF loops (load race used to).
  let galaxyRaf = 0;
  let galaxyStarted = false;
  let galaxyPaused = false;
  let galaxyTick = null;
  let galaxyResetClock = false;

  function pauseGalaxyScroll() {
    galaxyPaused = true;
    galaxyResetClock = true;
    if (galaxyRaf) {
      cancelAnimationFrame(galaxyRaf);
      galaxyRaf = 0;
    }
  }

  function resumeGalaxyScroll() {
    if (!galaxyStarted || !config.bgImage || !galaxyTick) return;
    galaxyPaused = false;
    galaxyResetClock = true;
    if (!galaxyRaf) galaxyRaf = requestAnimationFrame(galaxyTick);
  }

  function startGalaxyScroll() {
    applyStageBackground();
    applyBgPattern();
    // Color-only (no image): no pan/crossfade loop
    if (!config.bgImage) return;
    if (!els.galaxyA) return;
    if (galaxyStarted) return; // idempotent — softReload must not re-enter
    galaxyStarted = true;

    // Wall, or scroll=0: one layer. Dual only when the wallpaper actually pans.
    const scrollOn = parseBgScrollSpeed(config.bgScrollSpeed, 1) > 0;
    const singleLayer =
      isPreviewWall() ||
      !scrollOn ||
      !els.galaxyB ||
      els.galaxyB.hidden;

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
        const speed =
          BASE_SCROLL_PX_PER_SEC * parseBgScrollSpeed(config.bgScrollSpeed, 1);
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
        // Match CSS --ease-fade / galaxy-layer crossfade
        el.style.transition =
          "opacity " + FADE_DURATION_MS + "ms cubic-bezier(0.4, 0, 0.2, 1)";
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
      galaxyTick = tick;
      if (galaxyPaused) {
        galaxyRaf = 0;
      } else {
        galaxyRaf = requestAnimationFrame(tick);
      }

      setFeatureActive('bgDualPan', true, 'pan started');
      updateDebugVisuals();
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
      if (galaxyPaused) {
        galaxyRaf = 0;
        return;
      }
      galaxyRaf = requestAnimationFrame(tick);
      galaxyTick = tick;

      if (galaxyResetClock || lastTs == null) {
        galaxyResetClock = false;
        lastTs = ts;
        return;
      }

      // Cap dt so background tabs / debugger pauses can't teleport the BG
      const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
      lastTs = ts;
      if (dt === 0) return;

      // Encore or scaffold-owned BG: freeze free galaxy pan
      const speed = bgScrollFrozen()
        ? 0
        : BASE_SCROLL_PX_PER_SEC * parseBgScrollSpeed(config.bgScrollSpeed, 1);
      // 0 = don't scroll (Style speed, Encore, or collage scaffold pin)
      if (speed <= 0) {
        // Still finish an in-flight crossfade so opacity doesn't stick mid-blend
        if (fading && !singleLayer && layers.length > 1 && ts >= fadeUntil) {
          finishCrossfade();
        }
        return;
      }
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

    galaxyTick = tick;
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
      bgPattern: config.bgPattern,
      pat1: config.patternColor1,
      pat2: config.patternColor2,
      patBake: !!config.patternBake,
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
      familyPortrait: !!config.familyPortrait,
      presentationMode: config.presentationMode || "slideshow",
      items: items.map((it) => [
        it.name,
        it.price,
        it.description,
        it.subtitle,
        it.isNew,
        it.image,
        it.include,
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
    refreshInProgress = true;
    setFeatureActive('softRefresh', true, 'refresh work starting');
    try {
      await fetchLiveSettings();
      if (liveSettings.requireRestart) {
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
        tokiInfo("refresh: Require restart enabled — auto-refresh stopped");
        setFeatureActive("softRefresh", false, "require restart");
        return;
      }
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
      applyBgPattern();
      // Image may be enabled after a color-only load — start pan if needed
      if (config.bgImage) startGalaxyScroll();
      const maxIdx =
        isDrinks || usesBoardSlides()
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
    } finally {
      refreshInProgress = false;
      setFeatureActive('softRefresh', false, 'refresh work done');
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
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (liveSettings.requireRestart) {
      tokiInfo(
        "auto-refresh OFF (Require restart to update) —",
        liveSettings.dataSource || "sheet"
      );
      setFeatureActive("softRefresh", false, "require restart");
      return;
    }
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

  // ---------- Debug console flag registry (PERFORMANCE.md §7 + sheet gating) ----------
  // Automatic emission of flag state only happens when the Debug Menu has BOTH
  // Debug Mode = TRUE and Performance Console = TRUE.
  // Manual calls to TokiMenuDebug.list() always work for ad-hoc inspection.

  (function setupTokiDebugAPI() {
    const FEATURE_DEFS = [
      { id: "displayRes", label: "Display", impact: "Info" },
      { id: "dataSource", label: "Data Source", impact: "Info" },
      { id: "encore", label: "Encore", impact: "Very High" },
      { id: "familyPortrait", label: "Family Portrait", impact: "Very High" },
      { id: "kenBurns", label: "Ken Burns zoom", impact: "High" },
      { id: "spotlightVeil", label: "Spotlight Veil", impact: "High" },
      { id: "scaffoldBg", label: "Scaffold BG", impact: "High" },
      { id: "bgWallpaper", label: "BG Wallpaper", impact: "High" },
      { id: "bgDualPan", label: "BG Dual Pan", impact: "High" },
      { id: "bgBlur", label: "BG Blur", impact: "High" },
      { id: "bgBlend", label: "BG Blend", impact: "Medium-High" },
      { id: "bgPattern", label: "Pattern", impact: "Medium" },
      { id: "heroPlate", label: "Hero Plate", impact: "Medium" },
      { id: "heroMulti", label: "Hero Multi", impact: "High" },
      { id: "softRefresh", label: "Soft Refresh", impact: "Medium" },
      { id: "requireRestart", label: "Require Restart", impact: "Info" },
    ];

    const overrides = {}; // id -> boolean forced via console API

    function computeActive(id) {
      // Wall lean path forces many things off
      const wall = isPreviewWall();

      try {
        switch (id) {
          case "encore":
            return !wall &&
              config.presentationMode === "encore" &&
              !!els.familyPortrait &&
              !els.familyPortrait.hidden &&
              els.familyPortrait.children.length > 0;

          case "familyPortrait":
            return !wall &&
              !!els.familyPortrait &&
              !els.familyPortrait.hidden &&
              els.familyPortrait.children.length > 0;

          case "kenBurns":
            // True only while a Ken Burns zoom cycle is actually running (transient)
            if (kbZoomActive) return true;
            const motion = heroMotionEl();
            if (motion && motion.classList.contains("is-kb-in")) return true;
            // For encore the zoom is more sustained during the presentation, but we keep it narrow
            return false;

          case "spotlightVeil":
            // Spotlight Veil should ONLY be active when Encore presentation is enabled
            // and the veil classes are present on the active Encore stage.
            return !wall &&
              config.presentationMode === "encore" &&
              !!els.familyPortrait &&
              !els.familyPortrait.hidden &&
              (els.familyPortrait.classList.contains("encore-spot-hard") ||
                els.familyPortrait.classList.contains("encore-spot-soft"));

          case "scaffoldBg":
            const gal = document.getElementById("galaxy");
            return !!(gal && gal.classList.contains("encore-scaffold-bg"));

          case "heroPlate": {
            const plate = heroMotionEl();
            if (heroMultiRoot()) return false;
            return !!(
              plate &&
              !plate.hidden &&
              els.hero &&
              els.hero.src
            );
          }

          case "heroMulti":
            return !!heroMultiRoot();

          case "newSticker":
            const sticker = document.getElementById("new-sticker");
            return !!(sticker && !sticker.hidden);

          case "listHighlight":
            // Any .highlight or active row in the list
            const list = els.list;
            if (!list) return false;
            return !!list.querySelector(".highlight, [data-active='true']");

          case "slideshowTimer":
            return !!slideshowTimer;

          case "bgBlur": {
            const g = document.getElementById("galaxy");
            return !!(g && g.classList.contains("has-blur"));
          }

          case "bgDualPan": {
            const scrollOn = parseBgScrollSpeed(config.bgScrollSpeed, 1) > 0;
            const b = els.galaxyB;
            const bLive = !!(
              b &&
              !b.hidden &&
              b.getAttribute("src")
            );
            return !!(scrollOn && bLive && config.bgImage);
          }

          case "bgBlend": {
            const g = document.getElementById("galaxy");
            if (!g || !config.bgImage) return false;
            const mode =
              g.style.getPropertyValue("--bg-image-blend") ||
              g.style.mixBlendMode ||
              "";
            return mode && mode !== "normal";
          }

          case "bgWallpaper": {
            const a = els.galaxyA;
            return !!(
              config.bgImage &&
              a &&
              !a.hidden &&
              a.getAttribute("src")
            );
          }

          case "bgPattern": {
            if (config.bgPattern && isStripesPatternToken(config.bgPattern)) {
              return true;
            }
            const st = document.getElementById("stripes");
            return !!(st && !st.hidden);
          }

          case "displayRes":
            return true;

          case "dataSource":
            return !!(liveSettings && (liveSettings.dataSource || liveSettings.sheetId));

          case "requireRestart":
            return !!(liveSettings && liveSettings.requireRestart);

          case "softRefresh":
            // Require Restart = Settings hard-off: no poll, no "active".
            if (liveSettings && liveSettings.requireRestart) return false;
            // Prefer transient "work in progress" (the actual network/parse cost spike).
            // Falls back to timer armed if no transient tracked.
            return refreshInProgress || !!refreshTimer;

          case "xlsxStyles":
            // Hard-off: Drive xlsx / fills / rich text are quarantined.
            return false;

          case "footerBoxes":
            const pb = document.getElementById("protein-box");
            const sb = document.getElementById("sauces-box");
            return !!(pb && !pb.hidden) || !!(sb && !sb.hidden);

          case "stripes":
            const st = document.getElementById("stripes");
            return !!(st && !st.hidden);

          case "versionStamp":
            // Version stamp is appended to the Toki Debug HUD header (when shown)
            return !!config.showVersion;

          default:
            return false;
        }
      } catch (e) {
        return false;
      }
    }

    function fileNameFromPath(path) {
      if (!path) return "";
      const s = String(path).split("?")[0];
      const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
      return i >= 0 ? s.slice(i + 1) : s;
    }

    function rasterDebugLabel(img, fallbackPath) {
      let master = fallbackPath || "";
      if (img) {
        const liveSrc = img.getAttribute("src") || "";
        if (liveSrc && liveSrc.indexOf("data:") !== 0) {
          master = liveSrc;
        } else if (img.dataset && img.dataset.tokiMaster) {
          master = img.dataset.tokiMaster;
        }
      }
      const file = fileNameFromPath(master);
      if (img && img.dataset && img.dataset.tokiFrom && img.dataset.tokiPx) {
        return (
          (file || "bitmap") +
          " " +
          img.dataset.tokiFrom +
          "→" +
          img.dataset.tokiPx
        );
      }
      if (img && img.naturalWidth) {
        return (
          (file || "bitmap") +
          " " +
          img.naturalWidth +
          "×" +
          img.naturalHeight
        );
      }
      return file || "none";
    }

    function latticeDebugLabel(root) {
      if (!root) return "none";
      const imgs = root.querySelectorAll(".family-portrait-item");
      if (!imgs.length) return "empty";
      const bits = [];
      for (let i = 0; i < imgs.length; i++) {
        bits.push(rasterDebugLabel(imgs[i], imgs[i].dataset.tokiMaster));
      }
      return bits.join(", ");
    }

    function flagDetail(id) {
      try {
        switch (id) {
          case "displayRes": {
            const b = displayPixelBudget();
            return (
              Math.round(b.w) +
              "×" +
              Math.round(b.h) +
              " dpr" +
              (Math.round(b.dpr * 100) / 100)
            );
          }
          case "dataSource": {
            const name = (liveSettings && liveSettings.dataSource) || "config.js";
            const sid = (liveSettings && liveSettings.sheetId) || "";
            return sid ? name + " · " + sid.slice(0, 8) : name;
          }
          case "requireRestart":
            return liveSettings && liveSettings.requireRestart
              ? "settings ON"
              : "settings OFF";
          case "bgWallpaper": {
            if (!config.bgImage) {
              if (config.bgPattern && isStripesPatternToken(config.bgPattern)) {
                return "none (pattern owns BG)";
              }
              return "none";
            }
            return rasterDebugLabel(els.galaxyA, config.bgImage);
          }
          case "bgPattern": {
            if (config.bgPattern && String(config.bgPattern).trim()) {
              return String(config.bgPattern).trim();
            }
            const st = document.getElementById("stripes");
            if (st && !st.hidden) return "stripes (announcements)";
            return "none";
          }
          case "bgBlur": {
            const v = parseUnit01(config.bgBlur, 0);
            return v <= 0 ? "0%" : Math.round(v * 100) + "%";
          }
          case "bgBlend":
            return parseBgBlendMode(config.bgBlendMode) || "normal";
          case "bgDualPan":
            return parseBgScrollSpeed(config.bgScrollSpeed, 1) > 0
              ? "scroll on"
              : "scroll 0";
          case "heroPlate":
            return rasterDebugLabel(els.hero, els.hero && els.hero.getAttribute("src"));
          case "heroMulti":
            return latticeDebugLabel(heroMultiRoot());
          case "familyPortrait": {
            if (!computeActive("familyPortrait")) return "";
            const stage = els.familyPortrait;
            if (!stage) return "none";
            const plates = stage.querySelector(".family-portrait-plates");
            return latticeDebugLabel(plates || stage);
          }
          case "softRefresh":
            if (liveSettings && liveSettings.requireRestart) return "settings";
            if (refreshInProgress) return "fetching";
            if (refreshTimer) return "timer " + (Number(cfg.refreshSeconds) || 30) + "s";
            return "off";
          default:
            return "";
        }
      } catch (e) {
        return "";
      }
    }

    function getSource(id, active) {
      if (overrides.hasOwnProperty(id)) return "console";
      if (isPreviewWall()) return "wall-lean";
      if (!active && config.presentationMode !== "encore" && (id === "encore" || id === "familyPortrait" || id === "spotlightVeil" || id === "scaffoldBg" || id === "kenBurns")) {
        return "config";
      }
      return "config";
    }

    function buildFlags() {
      const flags = {};
      FEATURE_DEFS.forEach(function (def) {
        const forced = overrides.hasOwnProperty(def.id) ? overrides[def.id] : null;
        const live = liveDebugState[def.id];
        const computed = computeActive(def.id);
        const liveActive =
          live && !(def.id === "softRefresh" && !computed)
            ? live.active
            : computed;
        const active = forced != null ? !!forced : liveActive;
        const reason =
          def.id === "softRefresh" && liveSettings.requireRestart
            ? "require restart"
            : live
              ? live.reason
              : "";
        const detail = flagDetail(def.id);
        flags[def.id] = {
          id: def.id,
          label: def.label,
          impact: def.impact,
          active: active,
          source:
            forced != null
              ? "console"
              : detail ||
                (liveSettings.requireRestart && def.id === "softRefresh"
                  ? "settings"
                  : live
                    ? "live"
                    : getSource(def.id, liveActive)),
          forced: forced != null,
          reason: reason,
        };
      });
      return flags;
    }

    function logFlagChange(id, on) {
      const state = on ? "ACTIVE" : "INACTIVE";
      tokiInfo("DEBUG flag", id, state, "(source=console)");
    }

    const api = {
      flags: {},

      list() {
        const flags = buildFlags();
        const lines = [];
        lines.push("TokiMenuDebug — feature flags (active = actually doing work)");
        lines.push("id                  active  impact         source");
        lines.push("-----------------------------------------------------------");
        Object.keys(flags).forEach(function (k) {
          const f = flags[k];
          const act = f.active ? "YES" : "no ";
          lines.push(
            (f.id + "                ").slice(0, 18) +
              " " +
              act +
              "  " +
              (f.impact + "            ").slice(0, 13) +
              " " +
              f.source +
              (f.forced ? " (forced)" : "")
          );
        });
        // Always allow manual list() from console for inspection
        console.info(lines.join("\n"));
        api.flags = flags; // keep last snapshot
        return flags;
      },

      get(id) {
        const flags = buildFlags();
        return flags[id] || null;
      },

      set(id, on) {
        const def = FEATURE_DEFS.find(function (d) { return d.id === id; });
        if (!def) {
          tokiWarn("DEBUG unknown flag", id);
          return false;
        }
        overrides[id] = !!on;
        logFlagChange(id, !!on);

        // Best-effort hard kill / re-enable for expensive continuous effects
        try {
          if (id === "bgBlur") {
            const g = document.getElementById("galaxy");
            if (g) {
              if (!on) {
                g.style.setProperty("--bg-image-blur", "none");
                g.classList.remove("has-blur");
              } else {
                // Let normal apply path restore on next background apply if wanted
                applyStageBackground();
              }
            }
          }
          if (id === "bgDualPan" && !on) {
            if (typeof galaxyRaf !== "undefined" && galaxyRaf) {
              cancelAnimationFrame(galaxyRaf);
              galaxyRaf = 0;
            }
            // Leave layers as-is; next full re-apply will respect
          }
          if ((id === "encore" || id === "familyPortrait") && !on) {
            const stage = els.familyPortrait;
            if (stage) {
              stage.hidden = true;
              stage.classList.remove("visible");
              // Do not fully destroy; expensive to rebuild
            }
          }
          if (id === "softRefresh" && !on) {
            if (refreshTimer) {
              clearInterval(refreshTimer);
              refreshTimer = null;
            }
          }
        } catch (e) { /* non-fatal */ }

        updateDebugVisuals();
        // Re-list if we are allowed to emit
        if (shouldSendPerformanceConsole()) {
          api.list();
        }
        return true;
      },

      enable(id) { return api.set(id, true); },
      disable(id) { return api.set(id, false); },

      reset() {
        Object.keys(overrides).forEach(function (k) { delete overrides[k]; });
        tokiInfo("DEBUG flags reset to sheet/config");
        updateDebugVisuals();
        if (shouldSendPerformanceConsole()) api.list();
      },

      snapshot() {
        return buildFlags();
      },

      // For the cheaper model / future: cheap change-only heartbeat can be added later
      watch(ms) {
        const interval = Number(ms) || 2000;
        if (window._tokiDebugWatch) clearInterval(window._tokiDebugWatch);
        let last = JSON.stringify(api.snapshot());
        window._tokiDebugWatch = setInterval(function () {
          const cur = JSON.stringify(api.snapshot());
          if (cur !== last) {
            last = cur;
            if (shouldSendPerformanceConsole()) {
              tokiInfo("DEBUG flags changed");
              api.list();
            }
          }
        }, interval);
        tokiInfo("DEBUG watch started every", interval, "ms (emits only when Performance Console enabled)");
      },
    };

    // Expose
    window.TokiMenuDebug = api;
    window.TOKI_DEBUG = api; // alias

    // If URL requests debug, give one list after init (even if sheet not yet allowing auto)
    try {
      const q = new URLSearchParams(location.search || "");
      if (q.get("tokiDebug") === "1" || q.get("debug") === "1") {
        // Will list after init completes
        setTimeout(function () {
          if (window.TokiMenuDebug) {
            window.TokiMenuDebug.list();
            updateDebugVisuals();
          }
        }, 800);
      }
    } catch (e) {}
  })();

  // ---------- Hybrid debug visuals (Computed + floating HUD) ----------
  // Primary live view: CSS custom properties on <html> — inspect <html> in Elements → Computed
  // Secondary: small floating HUD (collapsible)
  // Both respect the same gate as console: Debug Mode + Performance Console in sheet.

  let _debugHudEl = null;

  function shouldShowDebugVisuals() {
    // Show visuals if the official gate is open, or if there are active console overrides
    // (so you can still use it manually even if sheet gate is off)
    if (shouldSendPerformanceConsole()) return true;
    // Check if any overrides are present
    try {
      const snap = window.TokiMenuDebug && window.TokiMenuDebug.snapshot && window.TokiMenuDebug.snapshot();
      if (snap) {
        return Object.keys(snap).some(function (k) { return snap[k] && snap[k].forced; });
      }
    } catch (e) {}
    return false;
  }

  // CSS custom properties removed per request (no more debug noise in Elements → Computed)
  // We now only use the floating debug HUD.

  function ensureDebugHUD() {
    if (_debugHudEl && document.body.contains(_debugHudEl)) return _debugHudEl;

    _debugHudEl = document.createElement("div");
    _debugHudEl.id = "toki-debug-hud";
    _debugHudEl.innerHTML = `
      <div class="hud-header">
        <span class="title">Toki Debug</span>
        <span class="hud-actions">
          <span class="hud-toggle" title="collapse/expand">−</span>
          <span class="hud-close" title="hide (until reload)">×</span>
        </span>
      </div>
      <div class="hud-body">
        <table>
          <thead>
            <tr><th>feature</th><th>state</th><th>source</th><th>impact</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;

    // Click header to toggle collapse
    const header = _debugHudEl.querySelector(".hud-header");
    header.addEventListener("click", function (e) {
      if (e.target.classList.contains("hud-close")) {
        _debugHudEl.style.display = "none";
        return;
      }
      _debugHudEl.classList.toggle("hud-collapsed");
      const toggle = header.querySelector(".hud-toggle");
      if (toggle) toggle.textContent = _debugHudEl.classList.contains("hud-collapsed") ? "+" : "−";
    });

    document.body.appendChild(_debugHudEl);

    // Always enrich the Toki Debug header with build info (hash + commit subject)
    // when the HUD is shown. (The "Show Version" Style setting still controls the
    // versionStamp feature flag; the header stamp was relocated here.)
    const titleEl = _debugHudEl.querySelector(".title");
    if (titleEl) {
      fetchBuildInfo().then(function (info) {
        if (!titleEl) {
          return;
        }
        const hash = info.hash || "unknown";
        const date = info.date || "";
        const subj = (info.subject || "").trim();
        const parts = ["Toki Debug"];
        if (hash) parts.push(hash);
        if (subj) {
          const short = subj.length > 32 ? subj.slice(0, 29) + "…" : subj;
          parts.push(short);
        } else if (date) {
          parts.push(date);
        }
        titleEl.textContent = parts.join(" · ");
        titleEl.title = [
          info.hashFull || hash,
          info.subject || "",
          date || "",
          "source: " + (info.source || ""),
        ]
          .filter(Boolean)
          .join("\n");
      });
    }

    return _debugHudEl;
  }

  function updateDebugHUDContent(flagsObj) {
    if (!_debugHudEl) return;

    const tbody = _debugHudEl.querySelector("tbody");
    if (!tbody) return;

    const impactOrder = {
      Info: 0,
      "Very High": 1,
      High: 2,
      "Medium-High": 3,
      Medium: 4,
      "Low-Medium": 5,
      Low: 6,
      "Very Low": 7,
    };

    const sorted = Object.keys(flagsObj || {}).map(id => flagsObj[id]).sort((a, b) => {
      const prioA = impactOrder[a.impact] || 99;
      const prioB = impactOrder[b.impact] || 99;
      return prioA - prioB;
    });

    const rows = sorted.map(function (f) {
      const stateClass = f.active ? "active" : "inactive";
      const stateText = f.active ? "active" : "inactive";
      const src = f.source + (f.forced ? " (forced)" : "") + (f.reason ? " · " + f.reason : "");
      return `
        <tr>
          <td class="flag-id">${f.label || f.id}</td>
          <td class="flag-state ${stateClass}">${stateText}</td>
          <td class="flag-source">${src}</td>
          <td class="flag-impact">${f.impact || ""}</td>
        </tr>
      `;
    }).join("");

    const baseRows = rows || "<tr><td colspan='4' style='color:#666'>no flags</td></tr>";
    tbody.innerHTML = baseRows;
  }

  function updateDebugVisuals() {
    if (!window.TokiMenuDebug || !window.TokiMenuDebug.snapshot) return;

    const show = shouldShowDebugVisuals();
    const root = document.documentElement;

    if (!show) {
      // Clean up if gate closed
      root.style.removeProperty("--debug-encore"); // representative cleanup
      if (_debugHudEl) _debugHudEl.style.display = "none";
      stopVisualsTicker();
      return;
    }

    const flags = window.TokiMenuDebug.snapshot();

    // Only the floating debug HUD (no CSS vars on <html>)
    ensureDebugHUD();
    if (_debugHudEl) {
      _debugHudEl.style.display = "block";
      // Full View (sheet column): expand body, no scroll — for Fire Stick
      _debugHudEl.classList.toggle("hud-full-view", isDebugFullView());
    }
    updateDebugHUDContent(flags);

    // Start a light ticker so we catch brief transient states (KB zoom, refresh work) in real time
    startVisualsTicker();
  }

  let _visualsTicker = null;
  function startVisualsTicker() {
    if (_visualsTicker) return;
    _visualsTicker = setInterval(function () {
      if (shouldShowDebugVisuals()) {
        // Re-compute and sync without console spam
        try {
          if (window.TokiMenuDebug) {
            const f = window.TokiMenuDebug.snapshot();
            if (_debugHudEl) updateDebugHUDContent(f);
          }
        } catch (e) {}
      } else {
        stopVisualsTicker();
      }
    }, 300); // ~3x per second — cheap, only runs while debug visuals gate is open
  }
  function stopVisualsTicker() {
    if (_visualsTicker) {
      clearInterval(_visualsTicker);
      _visualsTicker = null;
    }
  }

  // Hook the watch to also drive visuals (real-time diff without console spam)
  const _origWatch = window.TokiMenuDebug && window.TokiMenuDebug.watch;
  if (typeof _origWatch === "function") {
    // We already have the impl inside the closure; instead we enhance the watch body below if needed.
    // For now we'll call update in the interval logic by re-wrapping the exposed watch.
  }

  // Replace the watch implementation on the api to also update visuals (no console unless gate wants it)
  if (window.TokiMenuDebug) {
    const api = window.TokiMenuDebug;
    const oldWatch = api.watch;
    api.watch = function (ms) {
      const interval = Number(ms) || 2000;
      if (window._tokiDebugWatch) clearInterval(window._tokiDebugWatch);
      let last = JSON.stringify(api.snapshot());
      window._tokiDebugWatch = setInterval(function () {
        const curSnap = api.snapshot();
        const cur = JSON.stringify(curSnap);
        if (cur !== last) {
          last = cur;
          updateDebugVisuals(); // live update visuals on change
          if (shouldSendPerformanceConsole()) {
            tokiInfo("DEBUG flags changed");
            api.list();
          }
        }
      }, interval);
      tokiInfo("DEBUG watch started every", interval, "ms (visuals + console when Performance Console enabled)");
    };
  }

  // ---------- boot ----------

  async function init() {
    if (isPresentationStatic()) {
      document.body.classList.add("presentation-static");
      _presHandoffBusy = true; // block all further handoff/advance
      if (slideshowTimer) {
        clearTimeout(slideshowTimer);
        slideshowTimer = null;
      }
      _presentationRunning = false;
      tokiInfo(
        "presentation motion: STATIC FP hold forever (never advances, no highlights)",
        "docs/MOTION_QUARANTINE.md"
      );
    } else if (isPresentationEngine()) {
      document.body.classList.add("presentation-engine");
      document.body.classList.remove("presentation-static");
      // Defaults until Beta Motion row loads
      applyMotionStylesConfig({});
      applyVeilShadowConfig(VEIL_SHADOW_DEFAULTS);
      tokiInfo(
        "presentation motion: ENGINE (Ken Burns from Beta Motion table)"
      );
    }
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
      document.body.classList.add("board-drinks", "stripes-off");
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

    startGalaxyScroll();

    whenPresentationSurfaceReady(function () {
      freezeDisplayBudget();
      if (startRaw != null) {
        const idx = parseInt(startRaw, 10);
        if (Number.isFinite(idx)) setActive(idx, true);
        else setActive(0, true);
      } else {
        setActive(0, true);
      }
      playOpeningWindUp();
      if (params.get("pause") !== "1") {
        startSlideshow();
        if (isDrinks) startAnnouncementSlideshow();
      } else if (isDrinks) {
        setAnnouncementMessage(announcementIndex, { instant: true });
      }
      startAutoRefresh();
    });

    // Update hybrid debug visuals (CSS vars in Computed + HUD) when gate is satisfied.
    // This gives real-time on/off view without console spam.
    updateDebugVisuals();

    // Legacy console snapshot still available under the same gate
    if (shouldSendPerformanceConsole()) {
      try {
        if (window.TokiMenuDebug && window.TokiMenuDebug.list) {
          // list() gives the full table in console when wanted
        }
      } catch (e) {}
    }

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

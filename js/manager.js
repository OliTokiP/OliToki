/**
 * OliToki Menu Manager — layout + sheet read.
 * Draft theme tokens restyle the app immediately. Confirm-on-back Yes writes
 * Theme Selector, Background (BG Color / Pattern / Wallpaper), Pattern
 * Color 1 / 2 (selected Themes Database row K/L), and the
 * speed pills (scroll + presentation) on the selected catalog
 * (via TOKI_MANAGER_SHEET.writeStyle), including Presentation Speed.
 * Encore spotlight/background (global Style K/L/M) are edited on board
 * editors 1–3 when Presentation Style is Encore. Board Yes writes Menu Title,
 * Family Portrait, Presentation Mode, and Include Descriptions?
 * (via TOKI_MANAGER_SHEET.writeBoard) and also persists dirty Style fields.
 * Beta item editor writes Inventory via TOKI_MANAGER_SHEET.writeItem.
 * Edit Item / Create Item always Confirm-on-back (Confirm save? does not skip
 * that prompt). Confirm save? Yes keeps item edits in the app until Board Back
 * Yes writes the sheet; Board No reverts them. Confirm save? No writes the
 * item after the prompt. System Settings persist via writeSystem + fallback.
 * Confirm save? No skips the confirm dialog and writes System, Style, and
 * Board immediately. Menu-item reorder waits 3s of idle before writing, as a
 * background Inventory save that must not hijack Edit Item / Create Item.
 * Encore extras and item order get bespoke save cards in the tooltip stack
 * (Board Saved on top).
 */
(function () {
  "use strict";

  var D = window.TOKI_MANAGER_DATA;
  if (!D) {
    console.error("TOKI_MANAGER_DATA missing");
    return;
  }

  var CHECK_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.4 8.2l3.6 3.6 7.6-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* Mini preview uses the -sm asset variants (lower memory / bandwidth in
     manager UI; matches the -sm food images already in PREVIEW_ITEMS). */
  var PREVIEW_STICKER = {
    body: "assets/stickers/Sticker-Body-sm.webp",
    shadow: "assets/stickers/Sticker-Shadow-sm.webp",
  };

  var IMAGE_TUTORIAL_VIDEO = "assets/tutorials/iphone_longpress_tutorial.mp4";
  var PHOTO_ACCEPT_MOBILE =
    "image/png,image/webp,image/heic,image/heif,.png,.webp,.heic,.heif";
  var PHOTO_ACCEPT_DESKTOP =
    "image/png,image/jpeg,image/webp,image/heic,image/heif,.png,.jpg,.jpeg,.webp,.heic,.heif";
  var IMAGE_TUTORIAL_SLIDES = [
    {
      title: "How to remove background on iOS",
      lines: [
        "Navigate to your photo in the Photos app",
        "Long-press on the subject",
        "Tap Share... > Save Image",
        "Upload the new image",
      ],
    },
    {
      title: "Tips for getting the perfect shot",
      lines: [
        "Take photo in a well lit area",
        "Use a neutral background",
        "Capture entire plate in frame",
      ],
    },
    {
      title: "Tips for multiple Subjects",
      lines: [
        "iOS can only isolate one subject at a time",
        "Create multiple isolated images",
        "They can be combined later in the editor",
      ],
    },
  ];

  var state = {
    screen: "home",
    boardId: null,
    picker: null,
    dialog: null,
    draft: clone(D.defaultDraft),
    committed: clone(D.defaultDraft),
    previewIndex: 0,
    holdGrid: false,
    previewTimer: null,
    toastTimer: null,
    tooltipItems: [],
    tooltipSeq: 0,
    tooltipRootTimer: null,
    tooltipShroudOn: false,
    tooltipRect: null,
    pendingTip: null,
    tipQueryApplied: false,
    styleScroll: 0,
    boardScroll: 0,
    systemScroll: 0,
    menuScroll: 0,
    pillScroll: {},
    pendingLeave: null,
    sheetDirty: false,
    sheetSource: "loading",
    lastSheet: null,
    boardDraft: null,
    boardCommitted: null,
    lastBoardSnap: {},
    itemKey: null,
    itemDraft: null,
    itemCommitted: null,
    itemScroll: 0,
    itemMissing: null,
    imageDraft: null,
    imageCommitted: null,
    imageScroll: 0,
    pendingImageDraft: null,
    pendingImageOpts: null,
    imagePickFrom: "item",
    imageTutorialPage: 0,
    itemDragging: false,
    confirmLeave: false,
    persistInFlight: false,
    itemOrderTimer: null,
    pendingItemOrderSave: false,
    itemOrderPersist: Promise.resolve(),
    pendingDeleteIndex: null,
    catalogSettings: [],
  };
  state.draft.confirmSave = state.draft.confirmSave || "yes";
  state.committed.confirmSave = state.committed.confirmSave || "yes";
  state.draft.debugMode = state.draft.debugMode || "no";
  state.committed.debugMode = state.committed.debugMode || "no";

  /* Track web font load success via promise (more reliable cross-browser
     than document.fonts.forEach status alone). Ensures Safari and other
     mobile browsers apply the same .is-font-ready + Poppins 0.96 scale. */
  var loadedWebFonts = {};

  var previewCtl = {
    gen: 0,
    timers: [],
    raf: 0,
    phase: null,
    phaseT0: 0,
    phaseDur: 0,
    itemIndex: 0,
    stripeY: 0,
    wp: null,
    lattice: null,
    encoreFirst: true,
  };

  var els = {};

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function eq(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // last-paint: colors + themeName persisted to localStorage (different origin from boards).
  // Boot: CSS defaults + immediate overlay (no write). Live sheet or user theme change → paint + write.
  // Never from boot defaultDraft. Used only for instant visual; state always starts default until sheet.
  var LAST_PAINT_KEY = "tokiLastPaint";
  function readLastPaint() {
    try {
      var raw = localStorage.getItem(LAST_PAINT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function writeLastPaint(p) {
    if (!p || !p.main) return;
    try {
      localStorage.setItem(LAST_PAINT_KEY, JSON.stringify(p));
    } catch (e) {}
  }
  function applyLastPaintOverlay() {
    var lp = readLastPaint();
    if (!lp || !lp.main) return false;
    var root = document.documentElement;
    root.style.setProperty("--main", lp.main);
    root.style.setProperty("--secondary", lp.secondary);
    root.style.setProperty("--highlight", lp.highlight);
    root.style.setProperty("--special", lp.special);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && lp.highlight) meta.setAttribute("content", lp.highlight);
    return true;
  }
  function captureLastPaint() {
    var t = currentTheme();
    var name = state.draft && state.draft.themeName ? state.draft.themeName : (t.name || "");
    var p = {
      themeName: name,
      main: t.main,
      secondary: t.secondary,
      highlight: t.highlight,
      special: t.special
    };
    writeLastPaint(p);
  }

  function find(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id || list[i].name === id) return list[i];
    }
    return list[0];
  }

  function labelOf(list, id) {
    var item = find(list, id);
    return item ? item.label || item.name : id;
  }

  function hexToRgb(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    var n = parseInt(h, 16);
    if (isNaN(n)) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(c) {
    function p(n) {
      var s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return s.length === 1 ? "0" + s : s;
    }
    return "#" + p(c.r) + p(c.g) + p(c.b);
  }

  function mixHex(a, b, t) {
    var A = hexToRgb(a);
    var B = hexToRgb(b);
    return rgbToHex({
      r: A.r + (B.r - A.r) * t,
      g: A.g + (B.g - A.g) * t,
      b: A.b + (B.b - A.b) * t,
    });
  }

  /* Live Pattern Bake: stripe×0.35 + Secondary×0.65 (desat / opacity sim). */
  function bakePatternHex(fg) {
    return mixHex(fg, roleHex("secondary"), 0.65);
  }

  function luminance(hex) {
    var c = hexToRgb(hex);
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }

  function currentTheme() {
    var name = state.draft.themeName;
    for (var i = 0; i < D.themes.length; i++) {
      if (D.themes[i].name === name) return D.themes[i];
    }
    return D.themes[0];
  }

  function roleHex(role) {
    var t = currentTheme();
    if (role === "main") return t.main;
    if (role === "secondary") return t.secondary;
    if (role === "highlight") return t.highlight;
    if (role === "special") return t.special;
    return t.main;
  }

  function dataSource() {
    var id = state.draft.dataSource;
    var i;
    var list = D.dataSources || [];
    for (i = 0; i < list.length; i++) {
      if (list[i].id === id || list[i].name === id) return list[i];
    }
    return list[0] || { id: "restaurant", name: "Restaurant Copy", sheetId: "" };
  }

  var CATALOG_STORAGE_KEY = "tokiManagerCatalog";

  function urlHasBetaFlag() {
    try {
      if (new URLSearchParams(location.search || "").has("beta")) return true;
    } catch (e) {}
    var raw = (location.hash || "").replace(/^#/, "");
    var qi = raw.indexOf("?");
    if (qi >= 0) {
      try {
        if (new URLSearchParams(raw.slice(qi + 1)).has("beta")) return true;
      } catch (e2) {}
    }
    return false;
  }

  function isBetaCatalog() {
    var src = dataSource();
    return !!(src && src.id === "beta");
  }

  function managerBetaFeatures() {
    return urlHasBetaFlag() || isBetaCatalog();
  }

  function showManagerBetaBadge() {
    const badge = document.getElementById("beta-badge");
    if (!badge) return;
    const show = managerBetaFeatures();
    badge.hidden = !show;
    if (show) {
      console.log("%cManager beta indicator badge shown", "color:#e74c3c;font-weight:700");
    }
  }

  function withBetaFlag(href) {
    var s = String(href || "").trim();
    if (!s) return s;
    if (/(?:\?|&)beta(?:&|=|$)/i.test(s)) return s;
    return s + (s.indexOf("?") >= 0 ? "&" : "?") + "beta";
  }

  function displayPermalink(raw) {
    var href = String(raw || "").trim();
    if (!href) return "";
    if (isBetaCatalog()) return withBetaFlag(href);
    return href;
  }

  function setBetaQuery(on) {
    try {
      var u = new URL(location.href);
      if (on) u.searchParams.set("beta", "");
      else u.searchParams.delete("beta");
      var search = u.search.replace(/\?beta=&/, "?beta&").replace(/&beta=&/g, "&beta&");
      if (search === "?beta=") search = "?beta";
      if (search.slice(-6) === "&beta=") search = search.slice(0, -1);
      var href = u.pathname + search + (location.hash || "");
      if (href !== location.pathname + location.search + location.hash) {
        history.replaceState(null, "", href);
      }
    } catch (e) {}
  }

  function persistCatalogChoice(id) {
    try {
      sessionStorage.setItem(CATALOG_STORAGE_KEY, id || "");
    } catch (e) {}
    setBetaQuery(id === "beta");
    showManagerBetaBadge();
  }

  function editorSourceId() {
    if (urlHasBetaFlag()) return "beta";
    try {
      var stored = sessionStorage.getItem(CATALOG_STORAGE_KEY);
      if (stored) return stored;
    } catch (e) {}
    if (state.draft && state.draft.dataSource) return state.draft.dataSource;
    return "restaurant";
  }

  function catalogIdOf(name) {
    var n = String(name || "").trim().toLowerCase();
    if (n.indexOf("beta") !== -1) return "beta";
    if (n.indexOf("restaurant") !== -1) return "restaurant";
    if (n.indexOf("alpha") !== -1) return "alpha";
    return n.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "";
  }

  function asYesNo(raw, fallbackYes) {
    var s = String(raw == null ? "" : raw).trim().toLowerCase();
    if (!s) return fallbackYes ? "yes" : "no";
    if (s === "1" || s === "yes" || s === "y" || s === "true" || s === "on") {
      return "yes";
    }
    if (s === "0" || s === "no" || s === "n" || s === "false" || s === "off") {
      return "no";
    }
    return fallbackYes ? "yes" : "no";
  }

  function chromeSnapFrom(row) {
    if (!row) return null;
    var font = String(row.systemFont || "").trim().toLowerCase();
    return {
      requireRestart: asYesNo(row.requireRestart, false),
      systemFont: font.indexOf("poppin") !== -1 ? "poppins" : font ? "roboto" : "",
      limitHeavyFilters: asYesNo(row.limitHeavyFilters, true),
      confirmSave: asYesNo(row.confirmSave, true),
      refreshTimer: String(row.refreshTimer || "").trim(),
      debugMode: asYesNo(row.debugMode, false),
    };
  }

  function findCatalogChrome(id) {
    var want = catalogIdOf(id) || String(id || "").trim();
    var rows = state.catalogSettings || [];
    var i;
    var row;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (!row) continue;
      if (row.id === want || row.name === id) return row;
      if (catalogIdOf(row.id) === want || catalogIdOf(row.name) === want) {
        return row;
      }
    }
    return null;
  }

  function applyChromeToState(chrome, toCommitted) {
    if (!chrome) return;
    var snap = chromeSnapFrom(chrome);
    if (!snap) return;
    var keys = [
      "requireRestart",
      "systemFont",
      "limitHeavyFilters",
      "confirmSave",
      "refreshTimer",
      "debugMode",
    ];
    var i;
    var k;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (snap[k] == null || snap[k] === "") continue;
      state.draft[k] = snap[k];
      if (toCommitted && state.committed) state.committed[k] = snap[k];
    }
  }

  function upsertCatalogChrome(id, chrome) {
    if (!id || !chrome) return;
    var rows = (state.catalogSettings || []).slice();
    var i;
    var found = false;
    for (i = 0; i < rows.length; i++) {
      if (!rows[i]) continue;
      if (rows[i].id === id || rows[i].name === id) {
        rows[i] = Object.assign({}, rows[i], chrome, { id: rows[i].id || id });
        found = true;
        break;
      }
    }
    if (!found) {
      rows.push(
        Object.assign({ id: id, name: (dataSource() && dataSource().name) || id }, chrome)
      );
    }
    state.catalogSettings = rows;
  }

  function adoptCatalog(id) {
    var src = null;
    var i;
    var list = D.dataSources || [];
    for (i = 0; i < list.length; i++) {
      if (list[i].id === id || list[i].name === id) {
        src = list[i];
        break;
      }
    }
    var want = src ? src.id : id;
    state.draft.dataSource = want;
    if (state.committed) state.committed.dataSource = want;
    persistCatalogChoice(want);
    applyChromeToState(findCatalogChrome(want), true);
    applyTheme();
    loadSheet({ force: true, sourceId: want });
  }

  function themeStatusName() {
    return state.draft.themeName === "Toki Default"
      ? "OliToki Default"
      : state.draft.themeName;
  }

  function systemFontFace() {
    return state.draft.systemFont === "roboto" ? "Roboto" : "Poppins";
  }

  function fontsAreReady() {
    var want = systemFontFace().toLowerCase();
    if (loadedWebFonts[want]) return true;
    if (!document.fonts || !document.fonts.forEach) {
      return !(document.fonts && document.fonts.status === "loading");
    }
    var seen = false;
    var loaded = false;
    document.fonts.forEach(function (face) {
      var name = String(face.family || "").replace(/['"]/g, "").toLowerCase();
      if (name !== want) return;
      seen = true;
      if (face.status === "loaded") loaded = true;
    });
    if (seen && loaded) {
      loadedWebFonts[want] = true;
      return true;
    }
    return false;
  }

  function syncFontReadyClass() {
    document.documentElement.classList.toggle("is-font-ready", fontsAreReady());
  }

  function preloadFonts() {
    if (!document.fonts || typeof document.fonts.load !== "function") return;
    // Preload both at boot. This ensures:
    // - Picker previews (which render inline font-family for Poppins/Roboto)
    //   do not cause first-use of the family name.
    // - fontsAreReady + .is-font-ready (and the 0.96 scale for poppins) are
    //   driven by actual load timing from page start, not by first tap on the
    //   System Font selector (which was previously injecting the name and
    //   flipping the scale as a side-effect of renderPicker + applyTheme).
    // Use resolved promise to mark loaded (more reliable than face.status
    // across Safari vs Chrome/others on mobile).
    ["Poppins", "Roboto"].forEach(function (fam) {
      try {
        var p = document.fonts.load('16px "' + fam + '"');
        p.then(function () {
          loadedWebFonts[fam.toLowerCase()] = true;
          syncFontReadyClass();
        }).catch(syncFontReadyClass);
      } catch (e) {}
    });
  }

  function watchFonts() {
    preloadFonts();
    syncFontReadyClass();
    if (!document.fonts) return;
    if (document.fonts.ready) {
      document.fonts.ready.then(syncFontReadyClass).catch(syncFontReadyClass);
    }
    if (document.fonts.addEventListener) {
      document.fonts.addEventListener("loadingdone", syncFontReadyClass);
    }
  }

  function applyTheme() {
    var t = currentTheme();
    var root = document.documentElement;
    var line = mixHex(t.highlight, "#000000", 0.22);
    var child = mixHex(t.highlight, "#ffffff", 0.32);
    var onHi = luminance(t.highlight) > 0.72 ? t.main : t.secondary;
    root.style.setProperty("--main", t.main);
    root.style.setProperty("--secondary", t.secondary);
    root.style.setProperty("--highlight", t.highlight);
    root.style.setProperty("--special", t.special);
    root.style.setProperty("--highlight-line", line);
    root.style.setProperty("--highlight-child", child);
    root.style.setProperty("--on-highlight", onHi);
    root.setAttribute("data-system-font", state.draft.systemFont);
    syncFontReadyClass();
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t.highlight);
  }

  function pageVersion() {
    if (typeof window.tokiPageVersion === "function") return window.tokiPageVersion();
    var live = window.TOKI_LIVE_STAMP;
    var b = window.TOKI_BUILD;
    var src = live && (live.hash || live.hashFull) ? live : b || {};
    var hash = String(src.hash || src.hashFull || "").slice(0, 7);
    return { hash: hash, subject: src.subject || "" };
  }

  function buildVersionLabel() {
    var v = pageVersion();
    return v.hash ? "Version " + v.hash : "Version " + D.version;
  }

  function backBtn() {
    return (
      '<button class="back" type="button" data-act="back" aria-label="Back">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5L8 12l7 7"/></svg>' +
      "</button>"
    );
  }

  function header(title) {
    return (
      '<header class="header">' +
      backBtn() +
      "<h1>" +
      escapeHtml(title) +
      "</h1></header>"
    );
  }

  function statusVersion() {
    var v = pageVersion();
    var h = v.hash || D.version;
    if (v.subject) return h + " — " + v.subject;
    return h;
  }

  function formatHex(hex) {
    var s = String(hex || "").trim();
    if (!s) return "";
    if (s.charAt(0) !== "#") s = "#" + s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      s = "#" + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
    }
    return s.toUpperCase();
  }

  function statusColorLine(label, hex) {
    var h = formatHex(hex) || "#000000";
    var pale = luminance(h) > 0.72;
    return (
      '<button type="button" class="status-color' +
      (pale ? " is-pale" : "") +
      '" data-act="copy-hex" data-hex="' +
      escapeHtml(h) +
      '" aria-label="Copy ' +
      escapeHtml(label) +
      " " +
      escapeHtml(h) +
      '"><span class="status-dot" style="background:' +
      escapeHtml(h) +
      '"></span>' +
      escapeHtml(label) +
      ' <span class="status-hex" style="color:' +
      escapeHtml(h) +
      '">' +
      escapeHtml(h) +
      "</span></button>"
    );
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.setAttribute("aria-hidden", "true");
      ta.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;font-size:16px;border:0;padding:0;margin:0;";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return fallback();
        }
      );
    }
    return Promise.resolve(fallback());
  }

  function copyHex(hex) {
    var h = formatHex(hex);
    if (!h) return;
    copyText(h).then(function (ok) {
      toast(ok ? "Copied " + h : "Could not copy " + h);
    });
  }

  function copyPermalink() {
    var b = state.boardDraft || ensureBoardDraft();
    var href = displayPermalink(b && b.permalink);
    if (!href) {
      toast("No permalink on this board");
      return;
    }
    copyText(href).then(function (ok) {
      toast(ok ? "Copied permalink" : "Could not copy permalink");
    });
  }

  function codeEnv() {
    return String(window.TOKI_ENV || "local").trim().toLowerCase() || "local";
  }

  function sourceSiteUrl(src) {
    if (!src) return "";
    if (src.siteUrl) return String(src.siteUrl).replace(/\/$/, "");
    if (src.env === "restaurant") {
      return String(window.TOKI_RESTAURANT_SITE || "https://olitokip.github.io/OliToki").replace(/\/$/, "");
    }
    if (src.env === "testing") {
      return String(window.TOKI_TESTING_SITE || "").replace(/\/$/, "");
    }
    return "";
  }

  function statusBlock() {
    var t = currentTheme();
    var env = codeEnv();
    var src = dataSource();
    var srcName = (src && src.name) || "Restaurant Copy";
    var envLine =
      env === "local"
        ? "Code: local · editing " + srcName
        : env === "testing"
          ? "Code: testing · editing " + srcName
          : "Code: restaurant · editing " + srcName;
    return (
      '<div class="status">' +
      "<p>" +
      escapeHtml(envLine) +
      "</p>" +
      "<p>Data Source: " +
      escapeHtml(dataSource().name) +
      "</p>" +
      (managerBetaFeatures()
        ? "<p>Manager beta features: on</p>"
        : "") +
      "<p>Current Theme: " +
      escapeHtml(themeStatusName()) +
      "</p>" +
      statusColorLine("Main", t.main) +
      statusColorLine("Secondary", t.secondary) +
      statusColorLine("Highlight", t.highlight) +
      statusColorLine("Special", t.special) +
      "<p>Require restart: " +
      escapeHtml(labelOf(D.yesNo, state.draft.requireRestart)) +
      "</p>" +
      (state.draft.requireRestart === "no"
        ? "<p>Refresh Timer: " +
          escapeHtml(
            labelOf((D && D.refreshTimers) || [], state.draft.refreshTimer)
          ) +
          "</p>"
        : "") +
      "<p>Version: " +
      escapeHtml(statusVersion()) +
      "</p>" +
      "</div>"
    );
  }

  function linksBlock() {
    return (
      '<div class="row links-block">' +
      '<span class="row-label">Links</span>' +
      '<div class="links-cells">' +
      '<button class="link-cell" type="button" data-act="open-sheet">Google Sheet</button>' +
      '<button class="link-cell" type="button" data-act="open-settings-sheet">Settings</button>' +
      '<button class="link-cell" type="button" data-act="reload-sheet">Reload sheet</button>' +
      "</div></div>"
    );
  }

  function row(opts) {
    var cls = "row" + (opts.child ? " is-child" : "") + (opts.optional ? " is-optional" : "");
    if (opts.control === "zeroOne") {
      var on = !!opts.on;
      return (
        '<button class="' +
        cls +
        ' row-check" type="button" data-act="toggle" data-key="' +
        opts.key +
        '">' +
        '<span class="row-label">' +
        escapeHtml(opts.label) +
        '</span><span class="row-check-box' +
        (on ? " is-on" : "") +
        '" role="checkbox" aria-checked="' +
        (on ? "true" : "false") +
        '"></span></button>'
      );
    }
    return (
      '<button class="' +
      cls +
      '" type="button" data-act="pick" data-key="' +
      opts.key +
      '">' +
      '<span class="row-label">' +
      escapeHtml(opts.label) +
      "</span>" +
      '<span class="row-value' +
      (opts.clip ? " is-clip" : "") +
      (opts.placeholder && !opts.value ? " is-placeholder" : "") +
      '">' +
      escapeHtml(opts.value || opts.placeholder || "") +
      "</span>" +
      "</button>"
    );
  }

  function speedTileSpec(kind) {
    var st = (D.speedTiles && D.speedTiles[kind]) || {};
    var min = st.min != null && isFinite(st.min) ? Number(st.min) : 0;
    var max = st.max != null && isFinite(st.max) ? Number(st.max) : min;
    var values = null;
    if (st.values && st.values.length) {
      values = st.values.slice();
    } else {
      values = [];
      for (var i = min; i <= max; i++) values.push(i);
    }
    return { min: min, max: max, values: values };
  }

  function speedRow(label, key, value, kind) {
    var spec = speedTileSpec(kind || "scroll");
    var vals = spec.values;
    var html =
      '<div class="row' +
      (key === "scrollSpeed" ? " is-child" : "") +
      '">' +
      '<span class="row-label">' +
      escapeHtml(label) +
      "</span>" +
      '<div class="pills" data-pills="' +
      key +
      '" data-range-min="' +
      spec.min +
      '" data-range-max="' +
      spec.max +
      '">';
    for (var i = 0; i < vals.length; i++) {
      var n = vals[i];
      html +=
        '<button class="pill' +
        (n === value ? " is-on" : "") +
        '" type="button" data-act="pill" data-key="' +
        key +
        '" data-val="' +
        n +
        '">' +
        n +
        "</button>";
    }
    return html + "</div></div>";
  }

  function footerBar(label, act, kind) {
    var labelHtml =
      '<span class="footer-label' +
      (kind === "add-item" ? " footer-label-add" : "") +
      '">' +
      escapeHtml(label) +
      "</span>";
    if (!act) {
      return '<div class="footer-bar footer-soon">' + labelHtml + "</div>";
    }
    var trash =
      kind === "add-item"
        ? '<span class="trash-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<g class="trash-lid"><path d="M4 7h16"/><path d="M9 7V5h6v2"/></g>' +
          '<g class="trash-body"><path d="M6 7l1.15 12.15A2 2 0 0 0 9.14 21h5.72a2 2 0 0 0 1.99-1.85L18 7"/><path d="M10 11v6M14 11v6"/></g>' +
          "</svg></span>" +
          '<span class="footer-label footer-label-delete">Delete Item</span>'
        : "";
    return (
      '<button class="footer-bar' +
      (kind === "add-item" ? " footer-add-item" : "") +
      '" type="button" data-act="' +
      act +
      '">' +
      '<span class="plus-circle" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
      "</span>" +
      trash +
      labelHtml +
      "</button>"
    );
  }

  function attachPeak() {
    var host = document.querySelector(".home-peak");
    if (!host || host.getAttribute("data-ready")) return;
    fetch("assets/TokiPeak.svg?v=20260815peak")
      .then(function (r) {
        if (!r.ok) throw new Error("peak svg");
        return r.text();
      })
      .then(function (txt) {
        var el = document.querySelector(".home-peak");
        if (!el) return;
        el.innerHTML = txt;
        var svg = el.querySelector("svg");
        if (svg) {
          svg.setAttribute("preserveAspectRatio", "xMinYMax slice");
          svg.removeAttribute("width");
          svg.removeAttribute("height");
          svg.setAttribute("aria-hidden", "true");
        }
        el.setAttribute("data-ready", "1");
      })
      .catch(function () {});
  }

  function screenHome() {
    return (
      '<section class="screen screen-home">' +
      '<div class="home-hero">' +
      '<div class="home-peak" aria-hidden="true"></div>' +
      '<div class="home-cluster">' +
      '<div class="home-logo" aria-hidden="true"></div>' +
      '<div class="home-copy">' +
      '<p class="home-brand">OliToki</p>' +
      '<p class="home-kicker">MENU MANAGER</p>' +
      '<p class="home-tag">' +
      '<span class="home-tag-line">Edit the look, feel and behavior of the</span>' +
      '<span class="home-tag-line">OliToki Menu System.</span></p>' +
      '<p class="home-ver">' +
      escapeHtml(buildVersionLabel()) +
      "</p>" +
      "</div></div></div>" +
      '<div class="home-body">' +
      '<div class="home-actions">' +
      '<button class="btn-primary" type="button" data-act="go" data-to="system">System Settings</button>' +
      '<button class="btn-primary" type="button" data-act="go" data-to="menu">Menu Settings</button>' +
      "</div></div></section>"
    );
  }

  function screenSystem() {
    var sysRows =
      row({
        key: "dataSource",
        label: "Data Source",
        value: dataSource().name,
      }) +
      row({
        key: "requireRestart",
        label: "Require restart to update?",
        value: labelOf(D.yesNo, state.draft.requireRestart),
      });
    if (state.draft.requireRestart === "no") {
      var timerList = (D && D.refreshTimers) || [];
      var timerVal = labelOf(timerList, state.draft.refreshTimer);
      sysRows +=
        row({
          key: "refreshTimer",
          label: "Refresh Timer",
          value: timerVal || state.draft.refreshTimer || "",
          child: true,
        });
    }
    sysRows +=
      row({
        key: "systemFont",
        label: "System Font",
        value: labelOf(D.fonts, state.draft.systemFont),
      }) +
      row({
        key: "limitHeavyFilters",
        label: "Limit Heavy Filters to 30FPS",
        value: labelOf(D.yesNo, state.draft.limitHeavyFilters),
      }) +
      row({
        key: "confirmSave",
        label: "Confirm save?",
        value: labelOf(D.yesNo, state.draft.confirmSave),
      }) +
      row({
        key: "debugMode",
        label: "Debug Mode",
        value: labelOf(D.yesNo, state.draft.debugMode),
      });
    return (
      '<section class="screen">' +
      header("System Settings") +
      statusBlock() +
      '<div class="rows" id="system-scroll"><div class="bounce-inner">' +
      sysRows +
      linksBlock() +
      "</div></div></section>"
    );
  }

  function screenMenu() {
    var items = '<div class="nav-wrap"><div class="nav-list bounce-inner">';
    items +=
      '<button class="nav-item" type="button" data-act="go" data-to="style">Style and Theme</button>';
    D.boards.forEach(function (b) {
      var label =
        (b.number ? b.number + ". " : "") + (b.menuTitle || b.title);
      items +=
        '<button class="nav-item" type="button" data-act="go" data-to="board" data-board="' +
        escapeHtml(b.id) +
        '">' +
        escapeHtml(label) +
        "</button>";
    });
    items += "</div></div>";
    return (
      '<section class="screen">' +
      header("Menu Settings") +
      statusBlock() +
      items +
      "</section>"
    );
  }

  function findBoard(id) {
    var list = D.boards || [];
    var i;
    var want = String(id || "");
    for (i = 0; i < list.length; i++) {
      if (String(list[i].id) === want || String(list[i].number || "") === want) {
        return list[i];
      }
    }
    return null;
  }

  function ensureBoardDraft() {
    var id = resolveBoardId(state.boardId);
    state.boardId = id;
    var src = findBoard(id);
    if (!src) return null;
    if (!state.boardDraft || state.boardDraft.id !== src.id) {
      state.boardDraft = clone(src);
      state.boardCommitted = clone(src);
      if (!state.lastBoardSnap[src.id]) rememberBoardSnap(src);
    }
    return state.boardDraft;
  }

  function resolveBoardId(id) {
    if (id === "announcements") {
      var four = findBoard("4");
      if (four) return "4";
    }
    return id;
  }

  function boardDirty() {
    return !!(
      state.boardDraft &&
      state.boardCommitted &&
      !eq(state.boardDraft, state.boardCommitted)
    );
  }

  function itemsSnap(b) {
    return ((b && b.items) || []).map(function (it) {
      return inventorySnap(it);
    });
  }

  function inventorySnap(it) {
    it = it || {};
    return {
      name: String(it.name || ""),
      row: it.row ? it.row : 0,
      price1: String(it.price1 || ""),
      price2: String(it.price2 || ""),
      price3: String(it.price3 || ""),
      subtitle: String(it.subtitle || ""),
      description: String(it.description || ""),
      isNew: it.isNew === "yes" ? "yes" : "no",
      include: it.include === "no" ? "no" : "yes",
      image: String(it.image || ""),
    };
  }

  function boardSettingsSnap(b) {
    b = b || {};
    return {
      menuTitle: String(b.menuTitle || b.title || ""),
      familyPortrait: b.familyPortrait === "yes" ? "yes" : "no",
      presentation: b.presentation || "kenburns",
      includeDescriptions: b.includeDescriptions === "yes" ? "yes" : "no",
      items: itemsSnap(b),
    };
  }

  function rememberBoardSnap(b) {
    if (!b || !b.id) return;
    state.lastBoardSnap[b.id] = boardSettingsSnap(b);
  }

  function applyBoardToCatalog(b) {
    if (!b || !b.id) return;
    var i;
    for (i = 0; i < D.boards.length; i++) {
      if (D.boards[i].id !== b.id) continue;
      D.boards[i].menuTitle = b.menuTitle || b.title;
      D.boards[i].title = b.menuTitle || b.title;
      D.boards[i].familyPortrait = b.familyPortrait;
      D.boards[i].presentation = b.presentation;
      D.boards[i].includeDescriptions = b.includeDescriptions;
      if (b.items) D.boards[i].items = clone(b.items);
      return;
    }
  }

  function boardRows() {
    var b = state.boardDraft || ensureBoardDraft();
    if (!b) return "";
    var html = "";
    html += row({
      key: "boardTitle",
      label: "Menu Title",
      value: b.menuTitle || b.title || "",
    });
    if (b.kind !== "announcements") {
      html += row({
        key: "boardFamily",
        label: "Family Portrait",
        value: labelOf(D.yesNo, b.familyPortrait),
      });
      html += row({
        key: "boardPresentation",
        label: "Presentation Style",
        value: labelOf(D.presentationStyles, b.presentation),
      });
      if (b.presentation === "encore") {
        html += row({
          key: "encoreStyle",
          label: "Encore Spotlight Style",
          value: labelOf(D.encoreStyles, state.draft.encoreStyle),
          child: true,
        });
        html += row({
          key: "encoreSpot",
          label: "Encore Spotlight Color",
          value: labelOf(D.encoreSpotColors, state.draft.encoreSpot),
          child: true,
        });
        html += row({
          key: "encoreBg",
          label: "Encore Background",
          value: labelOf(D.colorRoles, state.draft.encoreBg),
          child: true,
        });
      }
      html += row({
        key: "boardDesc",
        label: "Include Item Descriptions",
        value: labelOf(D.yesNo, b.includeDescriptions),
      });
    }
    html +=
      '<button class="row" type="button" data-act="copy-permalink">' +
      '<span class="row-label">Permalink</span>' +
      '<span class="row-value row-value-url">' +
      escapeHtml(displayPermalink(b.permalink) || "—") +
      "</span></button>";
    html += '<div class="row-subheader">Menu Items</div>';
    html +=
      '<div class="item-list" id="board-item-list">' +
      itemListHtml(b.items || []) +
      "</div>";
    return html;
  }

  function itemListHtml(items) {
    var html = "";
    var i;
    var drag = !isAnnouncementsBoard(state.boardDraft);
    var canEdit = managerBetaFeatures() && drag;
    for (i = 0; i < items.length; i++) {
      var excluded = items[i] && items[i].include === "no";
      html +=
        '<div class="item-row' +
        (excluded ? " is-excluded" : "") +
        '" data-item="' +
        i +
        '">' +
        (drag
          ? '<button class="item-handle" type="button" aria-label="Reorder ' +
            escapeHtml(items[i].name) +
            '"></button>'
          : "");
      if (canEdit) {
        html +=
          '<button class="item-name" type="button" data-act="edit-item" data-item="' +
          i +
          '">' +
          escapeHtml(items[i].name) +
          (excluded ? '<span class="item-name-bang"> (!)</span>' : "") +
          "</button>";
      } else {
        html +=
          '<span class="item-name">' +
          escapeHtml(items[i].name) +
          (excluded ? '<span class="item-name-bang"> (!)</span>' : "") +
          "</span>";
      }
      html += "</div>";
    }
    return html;
  }

  function isAnnouncementsBoard(b) {
    return !!(
      b &&
      (b.kind === "announcements" || b.id === "4" || b.id === "announcements")
    );
  }

  function screenBoard() {
    var b = ensureBoardDraft();
    if (!b) {
      return (
        '<section class="screen screen-soon">' +
        header("Board") +
        '<div class="soon-body"><h2 class="soon-title">Unknown board</h2></div></section>'
      );
    }
    if (isAnnouncementsBoard(b) && !managerBetaFeatures()) {
      var soonTitle =
        (b.number ? b.number + ". " : "") + (b.menuTitle || b.title || "Announcements");
      return (
        '<section class="screen screen-soon">' +
        header(soonTitle) +
        '<div class="soon-body">' +
        '<h2 class="soon-title">Coming Soon</h2>' +
        '<p class="soon-sub">Announcements editor is out of scope this pass.</p>' +
        "</div></section>"
      );
    }
    var title =
      (b.number ? b.number + ". " : "") + (b.menuTitle || b.title);
    var preview = isAnnouncementsBoard(b) ? "" : previewHtml();
    var foot = isAnnouncementsBoard(b)
      ? ""
      : managerBetaFeatures()
        ? footerBar("Add Item", "item-add", "add-item")
        : footerBar("Add Item From Toast", "toast-add");
    return (
      '<section class="screen screen-board" data-board-id="' +
      escapeHtml(String(b.id || "")) +
      '">' +
      header(title) +
      preview +
      '<div class="style-scroll" id="board-scroll">' +
      '<div class="rows bounce-inner">' +
      boardRows() +
      "</div></div>" +
      foot +
      "</section>"
    );
  }

  var LTP_DEFAULTS = ["S", "M", "L"];
  var MAX_TIERS = 3;
  var ITEM_USD = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    useGrouping: false,
  });
  var MSG_ITEM_SAVED = "Item Saved to Menu";

  function boardMenuId(b) {
    var n = String((b && (b.number || b.id)) || "");
    if (n === "1" || n === "2" || n === "3") return "board" + n;
    return "";
  }

  function boardImageFolder(b) {
    var n = String((b && (b.number || b.id)) || "");
    if (n === "1") return "food-pics/bowls";
    if (n === "2") return "food-pics/handhelds";
    if (n === "3") return "food-pics/munchies";
    return "food-pics";
  }

  function parseMoney(raw) {
    var s = String(raw || "").replace(/[^0-9.]/g, "");
    if (!s) return null;
    var first = s.indexOf(".");
    if (first >= 0) {
      s = s.slice(0, first + 1) + s.slice(first + 1).replace(/\./g, "");
    }
    var n = Number(s);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  /* ATM / banking cents: 1 → 0.01, 10 → 0.10, 100 → 1.00. Digits only. */
  function formatMoneyTyping(raw) {
    var digits = String(raw || "").replace(/\D/g, "");
    if (!digits) return "";
    digits = digits.replace(/^0+/, "") || "0";
    if (digits === "0") return "";
    if (digits.length > 6) digits = digits.slice(0, 6);
    var cents = parseInt(digits, 10);
    if (!Number.isFinite(cents) || cents <= 0) return "";
    return (cents / 100).toFixed(2);
  }

  function bindMoneyInput(el) {
    if (!el || el._tokiMoney) return;
    el._tokiMoney = true;
    el.setAttribute("inputmode", "numeric");
    el.addEventListener("focus", function () {
      try {
        el.select();
      } catch (err) {}
    });
    el.addEventListener("input", function () {
      var next = formatMoneyTyping(el.value);
      if (next !== el.value) el.value = next;
      try {
        var n = el.value.length;
        el.setSelectionRange(n, n);
      } catch (err) {}
    });
    el.addEventListener("blur", function () {
      var next = formatMoneyTyping(el.value);
      if (next !== el.value) el.value = next;
    });
  }

  function parsePriceToken(raw) {
    var s = String(raw || "").trim();
    if (!s) return { tier: "", price: "" };
    var vb = s.match(/^(\d{1,3})\s*\/\s*\$?\s*([0-9]+(?:\.[0-9]+)?)/);
    if (vb) return { tier: vb[1], price: Number(vb[2]).toFixed(2) };
    var ltp = s.match(/^(.+?)\s+\$?\s*([0-9]+(?:\.[0-9]+)?)\s*$/);
    if (ltp && /[A-Za-z]/.test(ltp[1])) {
      return { tier: ltp[1].trim(), price: Number(ltp[2]).toFixed(2) };
    }
    var n = parseMoney(s);
    return { tier: "", price: n == null ? "" : n.toFixed(2) };
  }

  function detectPriceModel(it) {
    var p = [it && it.price1, it && it.price2, it && it.price3].filter(function (s) {
      return String(s || "").trim();
    });
    if (!p.length) return "fixed";
    if (
      p.some(function (s) {
        return /^\d{1,3}\s*\//.test(String(s));
      })
    ) {
      return "vb";
    }
    if (p.length > 1) return "ltp";
    if (/[A-Za-z]/.test(p[0]) && !/^\$/.test(String(p[0]).trim())) return "ltp";
    return "fixed";
  }

  function blankItemDraft(key) {
    var b = state.boardDraft || {};
    return {
      key: String(key || "new"),
      boardId: String(b.id || state.boardId || ""),
      row: 0,
      name: "",
      subtitle: "",
      description: "",
      priceModel: "fixed",
      price1: "",
      tiers: [{ tier: "S", price: "" }],
      isNew: "yes",
      include: "no",
      image: "",
      imageName: "",
      imageData: "",
      imagePreview: "",
      menuimg: null,
    };
  }

  function itemFromBoard(it, key) {
    var d = blankItemDraft(key);
    if (!it) return d;
    d.row = it.row || 0;
    d.name = it.name || "";
    d.subtitle = it.subtitle || "";
    d.description = it.description || "";
    d.isNew = it.isNew === "yes" ? "yes" : "no";
    d.include = it.include === "no" ? "no" : "yes";
    d.image = it.image || "";
    d.imageName = it.imageName || "";
    d.imageData = it.imageData || "";
    d.imagePreview = it.imagePreview || "";
    d.menuimg = it.menuimg ? clone(it.menuimg) : null;
    d.priceModel = detectPriceModel(it);
    var tokens = [it.price1, it.price2, it.price3];
    if (d.priceModel === "fixed") {
      var tok = parsePriceToken(tokens[0] || "");
      d.price1 = tok.price;
      d.tiers = [{ tier: "S", price: tok.price }];
    } else {
      d.tiers = [];
      var i;
      for (i = 0; i < tokens.length; i++) {
        if (!String(tokens[i] || "").trim()) continue;
        var t = parsePriceToken(tokens[i]);
        if (d.priceModel === "ltp" && !t.tier) t.tier = LTP_DEFAULTS[d.tiers.length] || "";
        d.tiers.push(t);
      }
      if (!d.tiers.length) {
        d.tiers = [{ tier: d.priceModel === "ltp" ? "S" : "", price: "" }];
      }
      d.price1 = d.tiers[0].price;
    }
    return d;
  }

  function buildItemDraft(key) {
    ensureBoardDraft();
    var k = String(key || state.itemKey || "new");
    if (k === "new") return blankItemDraft("new");
    var idx = parseInt(k, 10);
    var items = (state.boardDraft && state.boardDraft.items) || [];
    if (!isFinite(idx) || idx < 0 || idx >= items.length) return blankItemDraft("new");
    return itemFromBoard(items[idx], String(idx));
  }

  function ensureItemDraft() {
    ensureBoardDraft();
    var key = String(state.itemKey || "new");
    if (
      state.itemDraft &&
      String(state.itemDraft.key) === key &&
      String(state.itemDraft.boardId) === String(state.boardId || (state.boardDraft && state.boardDraft.id) || "")
    ) {
      return state.itemDraft;
    }
    state.itemDraft = buildItemDraft(key);
    state.itemCommitted = clone(state.itemDraft);
    return state.itemDraft;
  }

  function itemSnap(d) {
    d = d || {};
    return {
      name: String(d.name || ""),
      subtitle: String(d.subtitle || ""),
      description: String(d.description || ""),
      priceModel: d.priceModel || "fixed",
      price1: String(d.price1 || ""),
      tiers: (d.tiers || []).map(function (t) {
        return { tier: String((t && t.tier) || ""), price: String((t && t.price) || "") };
      }),
      isNew: d.isNew === "yes" ? "yes" : "no",
      include: d.include === "yes" ? "yes" : "no",
      image: String(d.image || ""),
      imageName: String(d.imageName || ""),
      imageData: d.imageData ? "1" : "",
      menuimg: menuimgSnap(d.menuimg),
    };
  }

  function menuimgSnap(m) {
    if (!m) return "";
    return [
      String(m.fileName || m.filename_1 || ""),
      String(m.scale != null ? m.scale : m.scale_1 || 100),
      String(m.x != null ? m.x : m.x_1 || 0),
      String(m.y != null ? m.y : m.y_1 || 0),
      m.sourceData ? "1" : "",
    ].join("|");
  }

  function itemDirty() {
    return !!(
      state.itemDraft &&
      state.itemCommitted &&
      !eq(itemSnap(state.itemDraft), itemSnap(state.itemCommitted))
    );
  }

  function collectItemPrices(d) {
    var out = ["", "", ""];
    if (!d) return out;
    if (d.priceModel === "fixed") {
      var n = parseMoney(d.price1);
      if (n != null) out[0] = ITEM_USD.format(n);
      return out;
    }
    var tiers = d.tiers || [];
    var i;
    var k = 0;
    for (i = 0; i < tiers.length && k < 3; i++) {
      var n = parseMoney(tiers[i].price);
      var tier = String(tiers[i].tier || "").trim();
      if (n == null) continue;
      if (d.priceModel === "vb") {
        var qty = tier.replace(/\D/g, "").slice(0, 3);
        if (!qty) continue;
        out[k++] = qty + "/" + ITEM_USD.format(n);
      } else if (tier) {
        out[k++] = tier + " " + ITEM_USD.format(n);
      }
    }
    return out;
  }

  function itemHasPrice(d) {
    var prices = collectItemPrices(d);
    var i;
    for (i = 0; i < prices.length; i++) {
      if (String(prices[i] || "").trim()) return true;
    }
    return false;
  }

  function itemRequiredOk(d) {
    return !!(d && String(d.name || "").trim() && itemHasPrice(d));
  }

  function itemMissingSoft(d) {
    var missing = [];
    if (!String((d && d.description) || "").trim()) missing.push("Description");
    if (!itemHasImage(d)) missing.push("Image");
    return missing;
  }

  function itemImageSrc(item, board) {
    if (item && item.imagePreview) return item.imagePreview;
    var img = String((item && item.image) || "").trim();
    if (!img) return "";
    if (/^https?:/i.test(img) || img.indexOf("data:") === 0 || img.indexOf("/api/") === 0) {
      return img;
    }
    var folder = boardImageFolder(board);
    var M = window.TOKI_MENUIMG;
    if (M && M.isMenuimgName(img)) {
      var disp = M.resolveDisplayPath(img, folder);
      return disp.replace(/display\.webp$/i, "display-sm.webp");
    }
    var file = img.replace(/^.*\//, "");
    var base = file.replace(/\.[^.]+$/, "");
    if (/-sm$/i.test(base)) return folder + "/" + base + ".webp";
    return folder + "/" + base + "-sm.webp";
  }

  function itemImageLabel(d) {
    if (d && d.menuimg && (d.menuimg.fileName || d.menuimg.filename_1)) {
      return String(d.menuimg.fileName || d.menuimg.filename_1).replace(/^.*\//, "");
    }
    if (d && d.imageName) return d.imageName;
    var img = String((d && d.image) || "").trim();
    if (!img) return "";
    if (/^https?:/i.test(img)) return "Photo on Drive";
    return img.replace(/^.*\//, "");
  }

  function itemHasImage(d) {
    return !!(
      d &&
      (d.imageData ||
        d.imagePreview ||
        String(d.image || "").trim() ||
        (d.menuimg && (d.menuimg.sourceData || d.menuimg.fileName)))
    );
  }

  function nextLtpLabel(tiers) {
    var used = {};
    (tiers || []).forEach(function (t) {
      used[String((t && t.tier) || "").trim().toUpperCase()] = true;
    });
    var i;
    for (i = 0; i < LTP_DEFAULTS.length; i++) {
      if (!used[LTP_DEFAULTS[i]]) return LTP_DEFAULTS[i];
    }
    return "";
  }

  function formatItemPriceDisplay(d) {
    return collectItemPrices(d)
      .filter(function (s) {
        return String(s || "").trim();
      })
      .join(" | ");
  }

  function itemMiniLineHtml(d) {
    var name = String((d && d.name) || "").trim() || "Item name";
    var sub = String((d && d.subtitle) || "").trim();
    var prices = formatItemPriceDisplay(d);
    var html = '<span class="item-mini-name">' + escapeHtml(name) + "</span>";
    if (sub) {
      html += '<span class="item-mini-sub"> (' + escapeHtml(sub) + ")</span>";
    }
    if (prices) {
      html += '<span class="item-mini-prices"> - ' + escapeHtml(prices) + "</span>";
    }
    return html;
  }

  function itemMiniStickerHtml() {
    return (
      '<div class="item-mini-sticker" aria-hidden="true">' +
      '<img class="preview-sticker-shadow" alt="" src="' +
      PREVIEW_STICKER.shadow +
      '">' +
      '<div class="preview-sticker-body">' +
      '<img class="preview-sticker-body-img" alt="" src="' +
      PREVIEW_STICKER.body +
      '">' +
      '<span class="preview-sticker-tint"></span></div>' +
      '<span class="preview-sticker-label">New!</span></div>'
    );
  }

  function itemMiniHtml() {
    var d = state.itemDraft || ensureItemDraft();
    var b = state.boardDraft || {};
    var draft = state.draft;
    var fill =
      draft.background === "pattern" || draft.background === "wallpaper"
        ? roleHex(draft.bgColor || "main")
        : roleHex(draft.background);
    var src = itemImageSrc(d, b);
    var showDesc = b.includeDescriptions === "yes";
    var isNew = d.isNew === "yes";
    var wp = wallpaperSrc();
    var wpFb = wallpaperFallback();
    var desc = String(d.description || "").trim();
    return (
      '<div class="item-mini" style="--preview-fill:' +
      fill +
      ";--pattern-a:" +
      bakePatternHex(roleHex(draft.patternColor1)) +
      ";--pattern-b:" +
      bakePatternHex(roleHex(draft.patternColor2)) +
      '">' +
      '<div class="item-mini-stage">' +
      '<div class="item-mini-layer item-mini-solid"></div>' +
      '<div class="item-mini-layer preview-pattern"' +
      (draft.background !== "pattern" ? " hidden" : "") +
      '><div class="preview-pattern-track" style="transform:rotate(-51.5deg) translate3d(0,0px,0);"></div></div>' +
      '<div class="item-mini-layer preview-wallpaper"' +
      (draft.background !== "wallpaper" ? " hidden" : "") +
      ">" +
      '<div class="preview-wp preview-wp-a is-on"><img class="preview-wp-img" alt="" src="' +
      escapeHtml(wp) +
      '"' +
      (wpFb ? ' data-fallback="' + escapeHtml(wpFb) + '"' : "") +
      "></div>" +
      '<div class="preview-wp preview-wp-b"><img class="preview-wp-img" alt="" src="' +
      escapeHtml(wp) +
      '"' +
      (wpFb ? ' data-fallback="' + escapeHtml(wpFb) + '"' : "") +
      "></div></div></div>" +
      (d.include !== "yes" ? '<div class="item-mini-off">Not on board</div>' : "") +
      '<div class="item-mini-photo">' +
      '<div class="item-mini-photo-wrap' +
      (d.menuimg && src ? " is-plate" : "") +
      '">' +
      (src
        ? '<img alt="" src="' + escapeHtml(src) + '" data-act="item-img-fallback">'
        : '<span class="item-mini-empty">No image</span>') +
      "</div>" +
      (isNew && src ? itemMiniStickerHtml() : "") +
      "</div>" +
      '<div class="item-mini-footer">' +
      '<p class="item-mini-line' +
      (isNew ? " is-new" : "") +
      '">' +
      itemMiniLineHtml(d) +
      "</p>" +
      (showDesc && desc
        ? '<p class="item-mini-desc">' + escapeHtml(desc) + "</p>"
        : "") +
      "</div></div>"
    );
  }

  function itemPriceRowsHtml(d) {
    var html = "";
    if (d.priceModel === "fixed") {
      html +=
        '<div class="row">' +
        '<span class="row-label">Price</span>' +
        '<div class="price-field">' +
        '<span class="price-sign">$</span>' +
        '<input class="price-input" type="text" inputmode="numeric" autocomplete="off" data-price="fixed" aria-label="Price" value="' +
        escapeHtml(d.price1 || "") +
        '">' +
        "</div></div>";
      return html;
    }
    var i;
    var tiers = d.tiers || [];
    for (i = 0; i < tiers.length; i++) {
      html +=
        '<div class="row row-price">' +
        '<button class="tier-chip" type="button" data-act="item-tier" data-tier="' +
        i +
        '">' +
        escapeHtml(tiers[i].tier || (d.priceModel === "vb" ? "#" : LTP_DEFAULTS[i] || "")) +
        "</button>" +
        '<div class="price-field">' +
        '<span class="price-sign">$</span>' +
        '<input class="price-input" type="text" inputmode="numeric" autocomplete="off" data-price="tier" data-tier="' +
        i +
        '" aria-label="Price" value="' +
        escapeHtml(tiers[i].price || "") +
        '">' +
        "</div></div>";
    }
    if (tiers.length < MAX_TIERS) {
      html +=
        '<button class="row is-add" type="button" data-act="item-add-tier">' +
        '<span class="plus-circle" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
        "</span>" +
        '<span class="footer-label">Add Tier</span></button>';
    }
    return html;
  }

  function itemRows() {
    var d = state.itemDraft || ensureItemDraft();
    var html = "";
    html += row({
      key: "itemName",
      label: "Item Name",
      value: d.name,
      placeholder: "Required",
    });
    html += row({
      key: "itemSubtitle",
      label: "Subtitle",
      value: d.subtitle,
      optional: true,
      placeholder: "Optional",
    });
    html += row({
      key: "itemDescription",
      label: "Description",
      value: d.description,
      clip: true,
      placeholder: "Tap to edit",
    });
    html += row({
      key: "itemPriceModel",
      label: "Pricing Model",
      value: labelOf(D.priceModels || [], d.priceModel),
    });
    html += itemPriceRowsHtml(d);
    html += row({
      key: "itemNew",
      label: "Mark as new?",
      value: labelOf(D.yesNo, d.isNew),
    });
    html += row({
      key: "itemInclude",
      label: "Include in board?",
      value: labelOf(D.yesNo, d.include),
    });
    html += row({
      key: "itemImage",
      label: "Image",
      value: itemHasImage(d) ? "Edit" : "",
      placeholder: "Add",
    });
    html +=
      '<input id="item-photo" type="file" accept="' +
      PHOTO_ACCEPT_DESKTOP +
      '" hidden>';
    return html;
  }

  function screenItem() {
    if (!managerBetaFeatures()) {
      return (
        '<section class="screen screen-soon">' +
        header("Edit Item") +
        '<div class="soon-body"><h2 class="soon-title">Beta only</h2>' +
        '<p class="soon-sub">Item editor is on the Beta catalog (or ?beta).</p></div></section>'
      );
    }
    var d = ensureItemDraft();
    var creating = String(d.key) === "new";
    return (
      '<section class="screen screen-item" data-item-key="' +
      escapeHtml(String(d.key || "new")) +
      '">' +
      header(creating ? "Create Item" : "Edit Item") +
      itemMiniHtml() +
      '<div class="style-scroll" id="item-scroll">' +
      '<div class="rows bounce-inner">' +
      itemRows() +
      "</div></div>" +
      footerBar("Fill from Toast", "toast-fill") +
      "</section>"
    );
  }

  function refreshItemMiniCopy() {
    var d = state.itemDraft;
    if (!d) return;
    var line = els.app.querySelector(".item-mini-line");
    if (line) {
      line.classList.toggle("is-new", d.isNew === "yes");
      line.innerHTML = itemMiniLineHtml(d);
    }
  }

  function remountItemMini() {
    var existing = els.app.querySelector(".item-mini");
    if (!existing) return;
    existing.outerHTML = itemMiniHtml();
    previewCtl.wp = null;
    bindWpFallback();
  }

  function refreshItemScreen() {
    var existing = els.app.querySelector(".screen-item");
    if (!existing) return false;
    remountItemMini();
    var wrap = existing.querySelector(".rows");
    if (wrap) wrap.innerHTML = itemRows();
    bindItemEditor();
    bindWpFallback();
    startItemMiniMotion();
    return true;
  }

  function bindItemEditor() {
    var root = els.app && els.app.querySelector(".screen-item");
    if (!root) return;
    var inputs = root.querySelectorAll(".price-input");
    var i;
    for (i = 0; i < inputs.length; i++) {
      bindMoneyInput(inputs[i]);
      if (inputs[i]._tokiItemPrice) continue;
      inputs[i]._tokiItemPrice = true;
      inputs[i].addEventListener("input", onItemPriceInput);
      inputs[i].addEventListener("blur", onItemPriceBlur);
    }
    var file = document.getElementById("item-photo");
    if (file) {
      configurePhotoInput(file);
      if (!file._tokiBound) {
        file._tokiBound = true;
        file.addEventListener("change", onItemPhoto);
      }
    }
    var photos = root.querySelectorAll(".item-mini-photo img");
    var p;
    for (p = 0; p < photos.length; p++) {
      (function (img) {
        if (img.getAttribute("data-fb")) return;
        img.setAttribute("data-fb", "1");
        img.addEventListener("error", function () {
          var s = img.getAttribute("src") || "";
          if (/-sm\./i.test(s)) {
            img.src = s.replace(/-sm\./i, ".");
            return;
          }
          img.removeAttribute("src");
        });
      })(photos[p]);
    }
  }

  function onItemPriceInput(e) {
    var el = e.target;
    var d = state.itemDraft;
    if (!d || !el) return;
    var next = formatMoneyTyping(el.value);
    var kind = el.getAttribute("data-price");
    if (kind === "fixed") d.price1 = next;
    else {
      var idx = parseInt(el.getAttribute("data-tier"), 10);
      if (!d.tiers[idx]) d.tiers[idx] = { tier: "", price: "" };
      d.tiers[idx].price = next;
    }
    refreshItemMiniCopy();
  }

  function onItemPriceBlur(e) {
    var el = e.target;
    var d = state.itemDraft;
    if (!d || !el) return;
    var next = formatMoneyTyping(el.value);
    if (next !== el.value) el.value = next;
    var kind = el.getAttribute("data-price");
    if (kind === "fixed") d.price1 = next;
    else {
      var idx = parseInt(el.getAttribute("data-tier"), 10);
      if (d.tiers[idx]) d.tiers[idx].price = next;
    }
    refreshItemMiniCopy();
  }

  function revokePreview(url) {
    if (url && String(url).indexOf("blob:") === 0) {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {}
    }
  }

  function menuimgPayload(d) {
    var m = d && d.menuimg;
    if (!m) return null;
    var out = {
      fileName: String(m.fileName || m.filename_1 || ""),
      scale: m.scale != null ? m.scale : m.scale_1,
      x: m.x != null ? m.x : m.x_1,
      y: m.y != null ? m.y : m.y_1,
      sourceData: m.sourceData || "",
      displayData: m.displayData || (d && d.imageData) || "",
    };
    if (!out.fileName && !out.sourceData && !out.displayData) return null;
    return out;
  }

  function imageDraftSnap(d) {
    d = d || {};
    return {
      fileName: String(d.fileName || ""),
      scale: Number(d.scale) || 100,
      x: Number(d.x) || 0,
      y: Number(d.y) || 0,
      source: d.sourceData ? "1" : "",
    };
  }

  function imageDirty() {
    if (!state.imageDraft) return false;
    if (!state.imageCommitted) return true;
    return !eq(imageDraftSnap(state.imageDraft), imageDraftSnap(state.imageCommitted));
  }

  function blankImageDraft() {
    var d = state.itemDraft || ensureItemDraft();
    return {
      boardId: String((d && d.boardId) || state.boardId || ""),
      itemKey: String((d && d.key) || state.itemKey || "new"),
      fileName: "",
      sourceData: "",
      sourcePreview: "",
      displayData: "",
      analysis: null,
      scale: 100,
      x: 0,
      y: 0,
      hasTransparency: true,
    };
  }

  function applyImageLayout() {
    var root = els.app && els.app.querySelector(".screen-image");
    if (!root) return;
    var img = root.querySelector(".image-mini-src");
    var d = state.imageDraft;
    var M = window.TOKI_MENUIMG;
    if (!img || !d || !d.analysis || !M) return;
    var css = M.layoutCss(d.analysis, d.scale, d.x, d.y);
    img.style.left = css.left;
    img.style.top = css.top;
    img.style.width = css.width;
    img.style.height = css.height;
  }

  function imageMiniHtml() {
    var d = state.imageDraft || blankImageDraft();
    var src = d.sourcePreview || d.sourceData || "";
    var M = window.TOKI_MENUIMG;
    var css =
      src && d.analysis && M
        ? M.layoutCss(d.analysis, d.scale, d.x, d.y)
        : { left: "0%", top: "0%", width: "100%", height: "100%" };
    return (
      '<div class="image-mini" aria-hidden="true">' +
      '<div class="image-mini-frame">' +
      '<div class="image-mini-canvas">' +
      (src
        ? '<img class="image-mini-src" alt="" src="' +
          escapeHtml(src) +
          '" style="left:' +
          css.left +
          ";top:" +
          css.top +
          ";width:" +
          css.width +
          ";height:" +
          css.height +
          '">'
        : '<span class="image-mini-empty">No image</span>') +
      '<div class="image-mini-guide"></div>' +
      "</div></div></div>"
    );
  }

  function imageRows() {
    var d = state.imageDraft || blankImageDraft();
    var M = window.TOKI_MENUIMG || {};
    var name = String(d.fileName || "").replace(/^.*\//, "") || "My-Image";
    return (
      '<div class="row row-image-file">' +
      '<div class="row-label-line">' +
      '<span class="row-label">Image File</span>' +
      '<span class="row-hint">(Remove background before uploading. ' +
      '<button class="row-how" type="button" data-act="image-how">How?</button>)</span>' +
      "</div>" +
      '<button class="row-value" type="button" data-act="image-replace">' +
      escapeHtml(name) +
      "</button></div>" +
      '<div class="row row-slider">' +
      '<span class="row-label">Image Size</span>' +
      '<div class="image-slider-hit">' +
      '<input class="image-slider" type="range" min="' +
      (M.SIZE_MIN || 70) +
      '" max="' +
      (M.SIZE_MAX || 130) +
      '" step="1" value="' +
      escapeHtml(String(d.scale)) +
      '" data-image-field="scale" aria-label="Image Size">' +
      "</div></div>" +
      '<div class="row row-slider">' +
      '<span class="row-label">X Position</span>' +
      '<div class="image-slider-hit">' +
      '<input class="image-slider" type="range" min="' +
      (M.X_MIN || -240) +
      '" max="' +
      (M.X_MAX || 240) +
      '" step="2" value="' +
      escapeHtml(String(d.x)) +
      '" data-image-field="x" aria-label="X Position">' +
      "</div></div>" +
      '<div class="row row-slider">' +
      '<span class="row-label">Y Position</span>' +
      '<div class="image-slider-hit">' +
      '<input class="image-slider" type="range" min="' +
      (M.Y_MIN || -160) +
      '" max="' +
      (M.Y_MAX || 160) +
      '" step="2" value="' +
      escapeHtml(String(d.y)) +
      '" data-image-field="y" aria-label="Y Position">' +
      "</div></div>" +
      '<div class="row row-image-help">' +
      '<span class="row-label">Instructions</span>' +
      '<p class="row-help">Use the sliders to adjust the size and position of the item. The item should be centered and extend just beyond the boundaries of the red shape.</p>' +
      "</div>" +
      '<input id="image-photo" type="file" accept="' +
      PHOTO_ACCEPT_DESKTOP +
      '" hidden>'
    );
  }

  function screenImage() {
    if (!managerBetaFeatures()) {
      return (
        '<section class="screen screen-soon">' +
        header("Edit Image") +
        '<div class="soon-body"><h2 class="soon-title">Beta only</h2>' +
        '<p class="soon-sub">Item editor is on the Beta catalog (or ?beta).</p></div></section>'
      );
    }
    ensureItemDraft();
    if (!state.imageDraft) state.imageDraft = blankImageDraft();
    return (
      '<section class="screen screen-image">' +
      header("Edit Image") +
      imageMiniHtml() +
      '<div class="style-scroll" id="image-scroll">' +
      '<div class="rows bounce-inner">' +
      imageRows() +
      "</div></div></section>"
    );
  }

  function bindImageEditor() {
    var root = els.app && els.app.querySelector(".screen-image");
    if (!root) return;
    var sliders = root.querySelectorAll(".image-slider");
    var i;
    for (i = 0; i < sliders.length; i++) {
      if (sliders[i]._tokiBound) continue;
      sliders[i]._tokiBound = true;
      sliders[i].addEventListener("input", onImageSlider);
    }
    var file = document.getElementById("image-photo");
    if (file) {
      configurePhotoInput(file);
      if (!file._tokiBound) {
        file._tokiBound = true;
        file.addEventListener("change", onImagePhoto);
      }
    }
    var img = root.querySelector(".image-mini-src");
    if (img && !img.getAttribute("data-fb")) {
      img.setAttribute("data-fb", "1");
      img.addEventListener("error", function () {
        img.removeAttribute("src");
      });
    }
  }

  function onImageSlider(e) {
    var el = e.target;
    var d = state.imageDraft;
    if (!d || !el) return;
    var field = el.getAttribute("data-image-field");
    var n = parseInt(el.value, 10);
    if (!isFinite(n)) return;
    if (field === "scale") d.scale = n;
    else if (field === "x") d.x = n;
    else if (field === "y") d.y = n;
    applyImageLayout();
  }

  function onImagePhoto(e) {
    var file = (e.target && e.target.files && e.target.files[0]) || null;
    if (e.target) e.target.value = "";
    if (!file) return;
    beginImageFromFile(file, { replace: true });
  }

  function onItemPhoto(e) {
    var file = (e.target && e.target.files && e.target.files[0]) || null;
    if (e.target) e.target.value = "";
    if (!file) return;
    beginImageFromFile(file, { fromItem: true });
  }

  function isJpegFile(file) {
    if (!file) return false;
    var type = String(file.type || "").toLowerCase();
    if (type === "image/jpeg" || type === "image/jpg") return true;
    return /\.jpe?g$/i.test(String(file.name || ""));
  }

  function beginImageFromFile(file, opts) {
    opts = opts || {};
    var M = window.TOKI_MENUIMG;
    if (!M) {
      toast("Image editor failed to load");
      return;
    }
    if (isMobileDevice() && isJpegFile(file)) {
      toast("Please upload the isolated image from Photos, not a camera shot.");
      return;
    }
    var preview = URL.createObjectURL(file);
    M.loadImage(preview)
      .then(function (img) {
        var analysis = M.analyzeImage(img);
        var draft = blankImageDraft();
        draft.fileName = file.name || "image.webp";
        draft.sourcePreview = preview;
        draft.analysis = analysis;
        draft.scale = 100;
        draft.x = 0;
        draft.y = 0;
        draft.hasTransparency = !!analysis.hasTransparency;
        var reader = new FileReader();
        reader.onload = function () {
          draft.sourceData = String(reader.result || "");
          afterImageAnalyzed(draft, opts);
        };
        reader.onerror = function () {
          afterImageAnalyzed(draft, opts);
        };
        reader.readAsDataURL(file);
      })
      .catch(function () {
        revokePreview(preview);
        toast("Could not read that image");
      });
  }

  function afterImageAnalyzed(draft, opts) {
    opts = opts || {};
    if (!draft.hasTransparency) {
      state.pendingImageDraft = draft;
      state.pendingImageOpts = opts;
      state.dialog = "image-opaque";
      renderDialog();
      return;
    }
    openImageEditor({ draft: draft, fromFile: true, replace: opts.replace });
  }

  function continueOpaqueImage() {
    var draft = state.pendingImageDraft;
    var opts = state.pendingImageOpts || {};
    state.pendingImageDraft = null;
    state.pendingImageOpts = null;
    state.dialog = null;
    renderDialog();
    if (!draft) return;
    openImageEditor({ draft: draft, fromFile: true, replace: opts.replace });
  }

  function cancelOpaqueImage() {
    var draft = state.pendingImageDraft;
    state.pendingImageDraft = null;
    state.pendingImageOpts = null;
    if (draft) revokePreview(draft.sourcePreview);
    state.dialog = null;
    renderDialog();
  }

  function fetchMenuimgPackage(d, board) {
    var M = window.TOKI_MENUIMG;
    var folder = boardImageFolder(board);
    var stem = M
      ? M.itemStem((d && d.name) || "", (d && (d.imageName || d.image)) || "")
      : "";
    var img = String((d && d.image) || "");
    if (M && M.isMenuimgName(img)) stem = M.packageStem(img) || stem;
    if (!stem) return Promise.resolve(null);
    return fetch(
      "/api/manager/menuimg?folder=" +
        encodeURIComponent(folder) +
        "&stem=" +
        encodeURIComponent(stem),
      { cache: "no-store" }
    )
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function fillImageDraftFromItem() {
    var d = ensureItemDraft();
    var b = state.boardDraft || {};
    var M = window.TOKI_MENUIMG;
    var draft = blankImageDraft();
    var m = d.menuimg || {};
    draft.fileName = m.fileName || m.filename_1 || d.imageName || itemImageLabel(d);
    draft.scale = m.scale != null ? Number(m.scale) : m.scale_1 != null ? Number(m.scale_1) : 100;
    draft.x = m.x != null ? Number(m.x) : m.x_1 != null ? Number(m.x_1) : 0;
    draft.y = m.y != null ? Number(m.y) : m.y_1 != null ? Number(m.y_1) : 0;
    draft.sourceData = m.sourceData || "";
    draft.sourcePreview = draft.sourceData || "";
    var src =
      draft.sourceData ||
      (M ? M.canvasSrcFor(itemImageSrc(d, b)) : itemImageSrc(d, b));
    if (!src) {
      state.imageDraft = draft;
      state.imageCommitted = clone(draft);
      return Promise.resolve(draft);
    }
    return M.loadImage(src)
      .then(function (img) {
        draft.analysis = M.analyzeImage(img);
        if (!m.sourceData && M.looksLikePlate(img)) draft.analysis.fit = "canvas";
        draft.hasTransparency = !!draft.analysis.hasTransparency;
        if (!draft.sourcePreview) draft.sourcePreview = src;
        if (!draft.sourceData && /^data:/i.test(src)) draft.sourceData = src;
        state.imageDraft = draft;
        state.imageCommitted = clone(draft);
        applyImageLayout();
        return draft;
      })
      .catch(function () {
        state.imageDraft = draft;
        state.imageCommitted = clone(draft);
        return draft;
      });
  }

  function openImageEditor(opts) {
    opts = opts || {};
    ensureItemDraft();
    if (opts.draft) {
      if (state.imageDraft && state.imageDraft.sourcePreview !== opts.draft.sourcePreview) {
        revokePreview(state.imageDraft.sourcePreview);
      }
      state.imageDraft = opts.draft;
      state.imageCommitted = opts.fromFile ? null : clone(opts.draft);
    }
    state.imageScroll = 0;
    go("image", state.boardId, state.itemKey);
    if (!opts.draft) {
      fillImageDraftFromItem().then(function () {
        var existing = els.app.querySelector(".screen-image");
        if (existing) {
          var mini = existing.querySelector(".image-mini");
          if (mini) mini.outerHTML = imageMiniHtml();
          var wrap = existing.querySelector(".rows");
          if (wrap) wrap.innerHTML = imageRows();
          bindImageEditor();
        }
      });
      fetchMenuimgPackage(state.itemDraft, state.boardDraft).then(function (pkg) {
        if (!pkg || !pkg.config || !state.imageDraft) return;
        if (state.imageDraft.sourceData) return;
        var cfg = pkg.config;
        state.imageDraft.scale = cfg.scale_1;
        state.imageDraft.x = cfg.x_1;
        state.imageDraft.y = cfg.y_1;
        if (cfg.filename_1) state.imageDraft.fileName = cfg.filename_1;
        var src = pkg.sourcePath || pkg.displayPath;
        if (!src) return;
        var M = window.TOKI_MENUIMG;
        M.loadImage(src)
          .then(function (img) {
            if (!state.imageDraft) return;
            state.imageDraft.sourcePreview = src;
            state.imageDraft.analysis = M.analyzeImage(img);
            if (src === pkg.displayPath && M.looksLikePlate(img)) {
              state.imageDraft.analysis.fit = "canvas";
            }
            state.imageDraft.hasTransparency = !!state.imageDraft.analysis.hasTransparency;
            state.imageCommitted = clone(state.imageDraft);
            var existing = els.app.querySelector(".screen-image");
            if (existing) {
              var mini = existing.querySelector(".image-mini");
              if (mini) mini.outerHTML = imageMiniHtml();
              var wrap = existing.querySelector(".rows");
              if (wrap) wrap.innerHTML = imageRows();
              bindImageEditor();
            }
          })
          .catch(function () {});
      });
    }
  }

  function commitImageToItem() {
    var draft = state.imageDraft;
    var item = state.itemDraft || ensureItemDraft();
    var M = window.TOKI_MENUIMG;
    if (!draft || !item || !M) return Promise.resolve();
    var src = draft.sourcePreview || draft.sourceData;
    if (!src) return Promise.resolve();
    return M.loadImage(src).then(function (img) {
      var analysis = draft.analysis || M.analyzeImage(img);
      var display = M.compositeDataURL(img, analysis, draft.scale, draft.x, draft.y);
      if (!display) throw new Error("Could not flatten image");
      revokePreview(item.imagePreview);
      var blob = M.blobFromDataURL(display);
      item.imagePreview = blob ? URL.createObjectURL(blob) : display;
      item.imageData = display;
      item.imageName = draft.fileName || item.imageName || "image.webp";
      item.menuimg = {
        fileName: draft.fileName,
        scale: draft.scale,
        x: draft.x,
        y: draft.y,
        sourceData: draft.sourceData || "",
        displayData: display,
        hasTransparency: !!draft.hasTransparency,
      };
      draft.displayData = display;
      state.imageDraft = draft;
      state.imageCommitted = clone(draft);
    });
  }

  function discardImageDraft() {
    if (state.imageDraft) revokePreview(state.imageDraft.sourcePreview);
    if (state.imageCommitted) state.imageDraft = clone(state.imageCommitted);
    else state.imageDraft = null;
  }

  function leaveImage(next) {
    if (!imageDirty()) {
      next();
      return;
    }
    state.pendingLeave = next;
    state.dialog = "confirm";
    renderDialog();
  }

  function isMobileDevice() {
    var ua = navigator.userAgent || "";
    if (/iPhone|iPod|Android.+Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
      return true;
    }
    if (/iPad/i.test(ua)) return true;
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  function configurePhotoInput(input) {
    if (!input) return;
    // HTML has no "hide camera" switch. capture=user|environment *opens*
    // the camera; omitting it is the most we can declare. iOS Safari hides
    // Take Photo when `multiple` is set (single-shot camera UI cannot
    // satisfy it). JPEG is omitted on phones so Camera is not an obvious
    // type match; JPEG files that still sneak through are rejected in
    // beginImageFromFile. Android still owns the intent sheet — some
    // WebViews keep a Camera tile and there is no web API to remove it.
    input.removeAttribute("capture");
    if (isMobileDevice()) {
      input.setAttribute("accept", PHOTO_ACCEPT_MOBILE);
      input.multiple = true;
    } else {
      input.setAttribute("accept", PHOTO_ACCEPT_DESKTOP);
      input.multiple = false;
    }
  }

  function imageTutorialHtml() {
    var pages = IMAGE_TUTORIAL_SLIDES.map(function (slide, i) {
      var lis = slide.lines
        .map(function (line) {
          return "<li>" + escapeHtml(line) + "</li>";
        })
        .join("");
      var actions =
        i === IMAGE_TUTORIAL_SLIDES.length - 1
          ? '<div class="tutorial-actions">' +
            '<button class="tutorial-btn" type="button" data-act="image-tutorial-cancel">Cancel</button>' +
            '<button class="tutorial-btn" type="button" data-act="image-tutorial-upload">Upload Image</button>' +
            "</div>"
          : "";
      return (
        '<div class="tutorial-page" data-page="' +
        i +
        '"><ul>' +
        lis +
        "</ul>" +
        actions +
        "</div>"
      );
    }).join("");
    var dots = IMAGE_TUTORIAL_SLIDES.map(function (_slide, i) {
      return (
        '<button class="tutorial-dot' +
        (i === 0 ? " is-on" : "") +
        '" type="button" data-act="image-tutorial-page" data-page="' +
        i +
        '" aria-label="Tutorial page ' +
        (i + 1) +
        '"></button>'
      );
    }).join("");
    return (
      '<div class="dialog-card tutorial-card" role="dialog" aria-labelledby="tutorial-title">' +
      '<h2 id="tutorial-title" class="tutorial-title">' +
      escapeHtml(IMAGE_TUTORIAL_SLIDES[0].title) +
      "</h2>" +
      '<div class="tutorial-video-wrap">' +
      "<video id=\"tutorial-video\" src=\"" +
      IMAGE_TUTORIAL_VIDEO +
      '" autoplay muted loop playsinline webkit-playsinline disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback noplaybackrate" tabindex="-1"></video>' +
      "</div>" +
      '<div class="tutorial-pages" id="tutorial-pages">' +
      pages +
      "</div>" +
      '<div class="tutorial-dots">' +
      dots +
      "</div></div>"
    );
  }

  function openImageTutorial(from) {
    state.imagePickFrom = from || (state.screen === "image" ? "image" : "item");
    state.imageTutorialPage = 0;
    state.dialog = "image-tutorial";
    renderDialog();
  }

  function closeImageTutorial() {
    var video = document.getElementById("tutorial-video");
    if (video) {
      try {
        video.pause();
      } catch (err) {}
    }
    state.dialog = null;
    state.imageTutorialPage = 0;
    renderDialog();
  }

  function scrollTutorialPage(page) {
    var scroller = document.getElementById("tutorial-pages");
    var n = IMAGE_TUTORIAL_SLIDES.length;
    if (!scroller || !n) return;
    if (page < 0) page = 0;
    if (page > n - 1) page = n - 1;
    scroller.scrollTo({
      left: page * scroller.clientWidth,
      behavior: "smooth",
    });
    syncTutorialPage(page);
  }

  function syncTutorialPage(page) {
    var n = IMAGE_TUTORIAL_SLIDES.length;
    if (page < 0) page = 0;
    if (page > n - 1) page = n - 1;
    state.imageTutorialPage = page;
    var title = document.getElementById("tutorial-title");
    if (title && IMAGE_TUTORIAL_SLIDES[page]) {
      title.textContent = IMAGE_TUTORIAL_SLIDES[page].title;
    }
    var dots = els.dialog ? els.dialog.querySelectorAll(".tutorial-dot") : [];
    var i;
    for (i = 0; i < dots.length; i++) {
      dots[i].classList.toggle("is-on", i === page);
    }
  }

  function bindImageTutorial() {
    var scroller = document.getElementById("tutorial-pages");
    var video = document.getElementById("tutorial-video");
    if (video) {
      video.controls = false;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.disablePictureInPicture = true;
      video.addEventListener("contextmenu", function (e) {
        e.preventDefault();
      });
      var play = video.play();
      if (play && play.catch) play.catch(function () {});
    }
    if (!scroller) return;
    scroller.addEventListener(
      "scroll",
      function () {
        var w = scroller.clientWidth || 1;
        syncTutorialPage(Math.round(scroller.scrollLeft / w));
      },
      { passive: true }
    );
    syncTutorialPage(0);
  }

  function pickImageAfterTutorial() {
    var from = state.imagePickFrom || (state.screen === "image" ? "image" : "item");
    closeImageTutorial();
    var id = from === "image" ? "image-photo" : "item-photo";
    var input = document.getElementById(id);
    if (input) input.click();
  }

  function addItemTier() {
    var d = state.itemDraft;
    if (!d || !d.tiers || d.tiers.length >= MAX_TIERS) return;
    if (d.priceModel === "ltp") d.tiers.push({ tier: nextLtpLabel(d.tiers), price: "" });
    else d.tiers.push({ tier: "", price: "" });
    refreshItemScreen();
  }

  function catalogSheetId() {
    var src = dataSource();
    return String((src && src.sheetId) || "").trim();
  }

  function applyItemToBoard(d, excelRow, opts) {
    if (!d || !state.boardDraft) return;
    opts = opts || {};
    var prices = collectItemPrices(d);
    var entry = {
      name: String(d.name || "").trim(),
      row: excelRow || d.row || 0,
      price1: prices[0] || "",
      price2: prices[1] || "",
      price3: prices[2] || "",
      subtitle: String(d.subtitle || "").trim(),
      description: String(d.description || "").trim(),
      isNew: d.isNew === "yes" ? "yes" : "no",
      image: d.image || "",
      include: d.include === "yes" ? "yes" : "no",
      imageName: d.imageName || "",
      imageData: d.imageData || "",
      imagePreview: d.imagePreview || "",
      menuimg: d.menuimg ? clone(d.menuimg) : null,
    };
    var items = state.boardDraft.items || [];
    if (String(d.key) === "new") {
      items.push(entry);
      state.boardDraft.items = items;
    } else {
      var idx = parseInt(d.key, 10);
      if (isFinite(idx) && items[idx]) items[idx] = entry;
    }
    applyBoardToCatalog(state.boardDraft);
    if (opts.commitBoard) {
      if (state.boardCommitted && state.boardCommitted.id === state.boardDraft.id) {
        state.boardCommitted = clone(state.boardDraft);
      }
      rememberBoardSnap(state.boardDraft);
    }
    state.itemDraft = itemFromBoard(entry, String(d.key) === "new" ? String(items.length - 1) : d.key);
    state.itemDraft.imagePreview = d.imagePreview || "";
    state.itemDraft.imageData = d.imageData || "";
    state.itemDraft.imageName = d.imageName || "";
    state.itemDraft.menuimg = d.menuimg ? clone(d.menuimg) : null;
    state.itemCommitted = clone(state.itemDraft);
  }

  function deleteBoardItem(idx) {
    if (!state.boardDraft || !state.boardDraft.items) return;
    idx = parseInt(idx, 10);
    if (!isFinite(idx) || idx < 0 || idx >= state.boardDraft.items.length) return;
    state.boardDraft.items.splice(idx, 1);
    applyBoardToCatalog(state.boardDraft);
    if (confirmSaveOff()) persistBoardOrderQuiet();
  }

  function persistItemWrite() {
    var d = state.itemDraft;
    var b = state.boardDraft || ensureBoardDraft();
    if (!d || !b) return;
    var sheet = window.TOKI_MANAGER_SHEET;
    if (!sheet || typeof sheet.writeItem !== "function") {
      toast("Item save needs the Menu Settings server");
      return;
    }
    var prices = collectItemPrices(d);
    var payload = {
      sheetId: catalogSheetId(),
      menu: boardMenuId(b),
      gid: b.gid || "",
      item: String(d.name || "").trim(),
      price1: prices[0] || "",
      price2: prices[1] || "",
      price3: prices[2] || "",
      subtitle: String(d.subtitle || "").trim(),
      description: String(d.description || "").trim(),
      isNew: d.isNew,
      include: d.include,
      image: d.image || "",
      imageName: d.imageName || "",
      imageData: d.imageData || "",
      menuimg: menuimgPayload(d),
    };
    if (d.row) payload.row = d.row;
    state.dialog = null;
    renderDialog();
    state.persistInFlight = true;
    toast("Saving item…");
    var writePromise = Promise.resolve(state.itemOrderPersist);
    if (d.row) {
      writePromise = writePromise.then(function () {
        return fetch("/api/health", { cache: "no-store" })
          .then(function (res) {
            return res.ok ? res.json() : {};
          })
          .then(function (h) {
            if (h && h.itemUpdate) return;
            throw new Error("Menu Settings needs a restart to update existing items (this build will not append a duplicate).");
          })
          .catch(function (err) {
            if (err && /restart/.test(String(err.message || ""))) throw err;
            throw new Error("Menu Settings needs a restart to update existing items (this build will not append a duplicate).");
          });
      });
    }
    writePromise
      .then(function () {
        if (state.itemDraft && state.itemDraft.row) payload.row = state.itemDraft.row;
        return sheet.writeItem(payload);
      })
      .then(function (wrote) {
        state.persistInFlight = false;
        if (!wrote || !wrote.ok) {
          throw new Error((wrote && wrote.error) || "write failed");
        }
        if (wrote.imageCell) d.image = wrote.imageCell;
        d.imageData = "";
        applyItemToBoard(d, wrote.row, { commitBoard: confirmSaveOff() });
        showSaveNotice(MSG_ITEM_SAVED);
        var next = state.pendingLeave;
        state.pendingLeave = null;
        state.confirmLeave = !!next;
        if (next) next();
        else performBackNav("board", state.boardId);
      })
      .catch(function (err) {
        state.persistInFlight = false;
        console.warn("Menu Manager item save failed", err);
        var msg = String((err && err.message) || err);
        if (/restart/.test(msg)) {
          state.pendingLeave = null;
          showSaveNotice(msg);
          return;
        }
        showSaveNotice("Could not write item to sheet — saved for this session");
        applyItemToBoard(d, d.row, { commitBoard: confirmSaveOff() });
        var next = state.pendingLeave;
        state.pendingLeave = null;
        state.confirmLeave = !!next;
        if (next) next();
        else performBackNav("board", state.boardId);
      });
  }

  function beginItemSave() {
    var d = state.itemDraft || ensureItemDraft();
    if (!itemRequiredOk(d)) {
      state.dialog = "item-required";
      renderDialog();
      return;
    }
    var missing = itemMissingSoft(d);
    if (missing.length) {
      state.itemMissing = missing;
      state.dialog = "item-missing";
      renderDialog();
      return;
    }
    continueItemSaveAfterMissing();
  }

  function continueItemSaveAfterMissing() {
    if (state.itemDraft && state.itemDraft.include !== "yes") {
      state.dialog = "item-include";
      renderDialog();
      return;
    }
    finishItemSave();
  }

  function finishItemSave() {
    if (confirmSaveOff()) persistItemWrite();
    else commitItemLocalAndLeave();
  }

  function commitItemLocalAndLeave() {
    var d = state.itemDraft;
    if (!d) return;
    state.dialog = null;
    renderDialog();
    applyItemToBoard(d, d.row, { commitBoard: false });
    showSaveNotice(MSG_ITEM_SAVED);
    var next = state.pendingLeave;
    state.pendingLeave = null;
    state.confirmLeave = !!next;
    if (next) next();
    else performBackNav("board", state.boardId);
  }

  function discardItemDraft() {
    if (state.itemCommitted) state.itemDraft = clone(state.itemCommitted);
    else state.itemDraft = null;
  }

  function leaveItem(next) {
    if (!itemDirty()) {
      next();
      return;
    }
    state.pendingLeave = next;
    state.dialog = "confirm";
    renderDialog();
  }

  function openItemEditor(itemKey) {
    ensureBoardDraft();
    if (confirmSaveOff() && (state.pendingItemOrderSave || boardDirty())) {
      persistBoardOrderQuiet();
    }
    state.itemKey = String(itemKey || "new");
    state.itemDraft = buildItemDraft(state.itemKey);
    state.itemCommitted = clone(state.itemDraft);
    state.itemScroll = 0;
    go("item", state.boardId, state.itemKey);
  }

  function refreshBoardRows() {
    if (state.itemDragging) return;
    var existing = els.app.querySelector(".screen-board");
    if (!existing) return;
    syncPreviewFromDraft(existing.querySelector(".preview"));
    var wrap = existing.querySelector(".rows");
    if (wrap) wrap.innerHTML = boardRows();
  }

  function styleRows() {
    var d = state.draft;
    var html = "";
    html += row({
      key: "theme",
      label: "Theme",
      value: d.themeName,
    });
    html += row({
      key: "background",
      label: "Background",
      value: labelOf(
        D.backgroundOptions,
        d.background === "pattern" || d.background === "wallpaper"
          ? d.background
          : d.bgColor || d.background
      ),
    });
    if (d.background === "pattern") {
      html += row({
        key: "patternType",
        label: "Pattern Type",
        value: labelOf(D.patternTypes, d.patternType),
        child: true,
      });
      html += row({
        key: "patternColor1",
        label: "Pattern Color 1",
        value: labelOf(D.colorRoles, d.patternColor1),
        child: true,
      });
      html += row({
        key: "patternColor2",
        label: "Pattern Color 2",
        value: labelOf(D.colorRoles, d.patternColor2),
        child: true,
      });
      html += speedRow(
        "Pattern Scroll Speed",
        "scrollSpeed",
        d.scrollSpeed,
        "scroll"
      );
    }
    if (d.background === "wallpaper") {
      html += row({
        key: "wallpaper",
        label: "Wallpaper Type",
        value: labelOf(D.wallpapers, d.wallpaper),
        child: true,
      });
      html += speedRow(
        "Wallpaper Scroll Speed",
        "scrollSpeed",
        d.scrollSpeed,
        "scroll"
      );
    }
    // Presentation Style + Encore extras (global K/L/M) live on board
    // editors 1–3 only. Style and Theme shows speed (see MENU_MANAGER).
    html += speedRow(
      "Presentation Speed",
      "presentationSpeed",
      d.presentationSpeed,
      "presentation"
    );
    return html;
  }

  function wallpaperPaper() {
    var paper = find(D.wallpapers, state.draft.wallpaper);
    if (!paper || !paper.src) paper = D.wallpapers[0];
    return paper;
  }

  function encoreVeilIsDetached() {
    return !!(
      window.TOKI_MOTION &&
      typeof TOKI_MOTION.encoreVeilDetached === "function" &&
      TOKI_MOTION.encoreVeilDetached()
    );
  }

  function encoreStageClass(d) {
    var type = d.encoreStyle === "soft" ? "soft" : "hard";
    var cls = "encore-spot-" + (d.encoreStyle === "hard_shadow" ? "hard-shadow" : type);
    if (d.encoreStyle === "hard_shadow") cls += " encore-spot-hard";
    if (d.encoreSpot === "highlight") cls += " encore-spot-color-highlight";
    else cls += " encore-spot-color-black";
    if (encoreVeilIsDetached()) cls += " encore-veil-detached";
    return cls;
  }

  function wallpaperSrc() {
    /* Always emit -sm for mini preview (see PREVIEW_STICKER). */
    var id = state.draft.wallpaper;
    if (id === "film") return "assets/bgs/Film/film-bg-sm.webp";
    if (id === "galaxy") return "assets/bgs/Galaxy/galaxy-bg-sm.webp";
    var paper = wallpaperPaper();
    var s = paper && paper.src ? paper.src : "";
    if (s && !/-sm\./i.test(s)) {
      s = s.replace(/(\.[^.]+)$/, "-sm$1");
    }
    return s;
  }

  function wallpaperFallback() {
    var id = state.draft.wallpaper;
    if (id === "film") return "assets/bgs/Film/film-bg-sm.jpg";
    if (id === "galaxy") return "assets/bgs/Galaxy/galaxy-bg-sm.jpg";
    var paper = wallpaperPaper();
    var f = (paper && paper.fallback) || "";
    if (f && !/-sm\./i.test(f)) {
      f = f.replace(/(\.[^.]+)$/, "-sm$1");
    }
    return f;
  }

  function previewHtml() {
    var d = state.draft;
    var encore = previewPresentation() === "encore";
    var fill = encore
      ? roleHex(d.encoreBg)
      : d.background === "pattern" || d.background === "wallpaper"
        ? roleHex(d.bgColor || "main")
        : roleHex(d.background);
    var wp = wallpaperSrc();
    var wpFb = wallpaperFallback();
    var first = D.previewItems[0] || { src: "", isNew: false };
    var veilDetached = encoreVeilIsDetached();
    var veilHtml = '<div class="family-portrait-veil" aria-hidden="true"></div>';
    var n;
    var nums = "";
    for (n = 0; n < D.previewItems.length; n++) {
      var on = n === (state.previewIndex || 0);
      var neu = !!(D.previewItems[n] && D.previewItems[n].isNew);
      var cls = (on ? " is-on" : "") + (on && neu ? " is-new" : "");
      nums +=
        '<span data-n="' +
        n +
        '"' +
        (cls ? ' class="' + cls.trim() + '"' : "") +
        ">" +
        (n + 1) +
        "</span>";
    }
    return (
      '<div class="preview' +
      (encore ? " is-encore" : "") +
      '" style="--preview-fill:' +
      fill +
      ";--pattern-a:" +
      bakePatternHex(roleHex(d.patternColor1)) +
      ";--pattern-b:" +
      bakePatternHex(roleHex(d.patternColor2)) +
      '">' +
      '<div class="preview-stage">' +
      '<div class="preview-layer preview-solid"></div>' +
      '<div class="preview-layer preview-pattern"' +
      (encore || d.background !== "pattern" ? " hidden" : "") +
      '><div class="preview-pattern-track" style="transform:rotate(-51.5deg) translate3d(0,0px,0);"></div></div>' +
      '<div class="preview-layer preview-wallpaper"' +
      (encore || d.background !== "wallpaper" ? " hidden" : "") +
      ">" +
      '<div class="preview-wp preview-wp-a is-on"><img class="preview-wp-img" alt="" src="' +
      escapeHtml(wp) +
      '"' +
      (wpFb ? ' data-fallback="' + escapeHtml(wpFb) + '"' : "") +
      "></div>" +
      '<div class="preview-wp preview-wp-b"><img class="preview-wp-img" alt="" src="' +
      escapeHtml(wp) +
      '"' +
      (wpFb ? ' data-fallback="' + escapeHtml(wpFb) + '"' : "") +
      "></div></div>" +
      '<div id="hero-plate">' +
      '<div class="hero-anim">' +
      '<img id="hero" class="preview-food" alt="" src="' +
      escapeHtml(first.src) +
      '"></div></div>' +
      '<div id="family-portrait-stage"' +
      (encore ? ' class="' + encoreStageClass(d) + '"' : " hidden") +
      ">" +
      '<div class="family-portrait-rig">' +
      '<div class="family-portrait-plates"></div>' +
      (veilDetached ? "" : veilHtml) +
      "</div>" +
      (veilDetached ? veilHtml : "") +
      "</div></div>" +
      '<div class="preview-sticker"' +
      (first.isNew ? "" : " hidden") +
      ">" +
      '<img class="preview-sticker-shadow" alt="" src="' +
      PREVIEW_STICKER.shadow +
      '">' +
      '<div class="preview-sticker-body">' +
      '<img class="preview-sticker-body-img" alt="" src="' +
      PREVIEW_STICKER.body +
      '">' +
      '<span class="preview-sticker-tint"></span></div>' +
      '<span class="preview-sticker-label">New!</span></div>' +
      '<div class="preview-frame" aria-hidden="true">' +
      '<div class="preview-frame-header"></div>' +
      '<div class="preview-frame-panel"></div></div>' +
      '<div class="preview-logo" aria-hidden="true">' +
      '<img src="assets/TokiLogoFix.svg?v=20260815qa4" alt=""></div>' +
      '<div class="preview-nums" aria-hidden="true">' +
      nums +
      "</div></div>"
    );
  }

  function screenStyle() {
    return (
      '<section class="screen screen-style">' +
      header("Style and Theme") +
      previewHtml() +
      '<div class="style-scroll" id="style-scroll">' +
      '<div class="rows bounce-inner">' +
      styleRows() +
      "</div></div>" +
      footerBar("New Theme", "create-theme") +
      "</section>"
    );
  }

  function renderScreen() {
    rememberStyleScroll();
    var html = "";
    if (state.screen === "home") html = screenHome();
    else if (state.screen === "system") html = screenSystem();
    else if (state.screen === "menu") html = screenMenu();
    else if (state.screen === "style") html = screenStyle();
    else if (state.screen === "board") html = screenBoard();
    else if (state.screen === "item") html = screenItem();
    else if (state.screen === "image") html = screenImage();

    if (state.screen === "board") {
      var existingBoard = els.app.querySelector(".screen-board");
      var draft = state.boardDraft;
      var wantSoon = isAnnouncementsBoard(draft) && !managerBetaFeatures();
      var shownId = existingBoard
        ? String(existingBoard.getAttribute("data-board-id") || "")
        : "";
      var sameBoard =
        !!(existingBoard && draft && shownId && shownId === String(draft.id));
      if (existingBoard && sameBoard && !wantSoon) {
        refreshBoardRows();
        applyTheme();
        bindItemReorder();
        if (encoreNeedsFill() || !previewCtl.phase) startPreviewCycle();
        return;
      }
    }

    if (state.screen === "style") {
      var existing = els.app.querySelector(".screen-style");
      if (existing) {
        // CRITICAL GUARD: #hero-plate / .hero-anim must never be destroyed by
        // innerHTML while the user is on Style and Theme. Any renderScreen while
        // already showing the style screen now only refreshes rows + preview CSS vars.
        // Plate animations (fade + KB zoom) survive theme/picker/conditional/sheet changes.
        // Full mount (and double-rAF start) only happens on first entry to the screen.
        // See MOTION_GLOSSARY §3/4. Hero motion is js/motion.js only.
        refreshStyleRows();
        applyTheme();
        if (encoreNeedsFill() || !previewCtl.phase) startPreviewCycle();
        return;
      }
    }

    els.app.innerHTML = html;
    applyTheme();
    if (state.screen === "home") attachPeak();
    if (
      state.screen === "style" ||
      state.screen === "board" ||
      state.screen === "system" ||
      state.screen === "menu" ||
      state.screen === "item" ||
      state.screen === "image"
    ) {
      var sc =
        state.screen === "menu"
          ? els.app.querySelector(".nav-wrap")
          : document.getElementById(
              state.screen === "board"
                ? "board-scroll"
                : state.screen === "style"
                ? "style-scroll"
                : state.screen === "item"
                ? "item-scroll"
                : state.screen === "image"
                ? "image-scroll"
                : "system-scroll"
            );
      if (sc) {
        if (state.screen === "style") sc.scrollTop = state.styleScroll;
        else if (state.screen === "board") sc.scrollTop = state.boardScroll;
        else if (state.screen === "item") sc.scrollTop = state.itemScroll;
        else if (state.screen === "image") sc.scrollTop = state.imageScroll;
        else if (state.screen === "system") sc.scrollTop = state.systemScroll;
        else if (state.screen === "menu") sc.scrollTop = state.menuScroll;
      }
      restorePillScroll();
      bindWpFallback();
      if (state.screen === "board") bindItemReorder();
      if (state.screen === "item") bindItemEditor();
      if (state.screen === "image") {
        bindImageEditor();
        if (
          state.imageDraft &&
          !state.imageDraft.analysis &&
          !state.imageDraft.sourcePreview
        ) {
          fillImageDraftFromItem().then(function () {
            var existing = els.app.querySelector(".screen-image");
            if (!existing || state.screen !== "image") return;
            var mini = existing.querySelector(".image-mini");
            if (mini) mini.outerHTML = imageMiniHtml();
            var wrap = existing.querySelector(".rows");
            if (wrap) wrap.innerHTML = imageRows();
            bindImageEditor();
          });
        }
      }
      if (state.screen === "item") startItemMiniMotion();
      else if (state.screen === "image") stopPreviewCycle();
      else startPreviewCycle();
    } else {
      stopPreviewCycle();
    }
    if (state.tooltipItems.length) {
      if (els.app) void els.app.offsetHeight;
      layoutTooltipOverlay(true);
    }
  }

  function pickerSpec(key) {
    if (key === "boardTitle" || key === "itemName" || key === "itemSubtitle" || key === "itemDescription" || key === "itemImage") {
      return { kind: "text" };
    }
    if (key === "itemPriceModel") {
      return {
        title: "Pricing Model",
        options: D.priceModels || [],
        get: function () {
          return (state.itemDraft || {}).priceModel || "fixed";
        },
        set: function (id) {
          var d = state.itemDraft;
          if (!d) return;
          var keep = "";
          if (d.priceModel === "fixed") keep = d.price1;
          else if (d.tiers && d.tiers[0]) keep = d.tiers[0].price;
          d.priceModel = id;
          if (id === "fixed") {
            d.price1 = keep || d.price1 || "";
          } else {
            d.tiers = [
              {
                tier: id === "ltp" ? LTP_DEFAULTS[0] : "",
                price: keep || "",
              },
            ];
          }
        },
      };
    }
    if (key === "itemNew") {
      return {
        title: "Mark as new?",
        options: D.yesNo,
        get: function () {
          return (state.itemDraft || {}).isNew || "no";
        },
        set: function (id) {
          if (state.itemDraft) state.itemDraft.isNew = id;
        },
      };
    }
    if (key === "itemInclude") {
      return {
        title: "Include in board?",
        options: D.yesNo,
        get: function () {
          return (state.itemDraft || {}).include || "no";
        },
        set: function (id) {
          if (state.itemDraft) state.itemDraft.include = id;
        },
      };
    }
    if (key === "boardFamily") {
      return {
        title: "Family Portrait",
        options: D.yesNo,
        get: function () {
          return (state.boardDraft || {}).familyPortrait;
        },
        set: function (id) {
          if (state.boardDraft) state.boardDraft.familyPortrait = id;
        },
      };
    }
    if (key === "boardDesc") {
      return {
        title: "Include Item Descriptions",
        options: D.yesNo,
        get: function () {
          return (state.boardDraft || {}).includeDescriptions;
        },
        set: function (id) {
          if (state.boardDraft) state.boardDraft.includeDescriptions = id;
        },
      };
    }
    if (key === "boardPresentation") {
      return {
        title: "Presentation Style",
        options: D.presentationStyles,
        get: function () {
          return (state.boardDraft || {}).presentation;
        },
        set: function (id) {
          if (state.boardDraft) state.boardDraft.presentation = id;
        },
      };
    }
    if (key === "theme") {
      return {
        title: "Theme",
        options: D.themes.map(function (t) {
          return { id: t.name, label: t.name };
        }),
        get: function () {
          return state.draft.themeName;
        },
        set: function (id) {
          state.draft.themeName = id;
          var i;
          for (i = 0; i < D.themes.length; i++) {
            if (D.themes[i].name === id) {
              if (D.themes[i].patternColor1) {
                state.draft.patternColor1 = D.themes[i].patternColor1;
              }
              if (D.themes[i].patternColor2) {
                state.draft.patternColor2 = D.themes[i].patternColor2;
              }
              break;
            }
          }
        },
      };
    }
    if (key === "background") {
      return {
        title: "Background",
        options: D.backgroundOptions,
        get: function () {
          var d = state.draft;
          if (d.background === "pattern" || d.background === "wallpaper") {
            return d.background;
          }
          return d.bgColor || d.background || "main";
        },
        set: function (id) {
          state.draft.background = id;
          if (id !== "pattern" && id !== "wallpaper") {
            state.draft.bgColor = id;
          }
        },
      };
    }
    if (key === "bgColor") {
      return {
        title: "Background Color",
        options: D.colorRoles,
        get: function () {
          return state.draft.bgColor || "main";
        },
        set: function (id) {
          state.draft.bgColor = id;
        },
      };
    }
    if (key === "patternType") {
      return {
        title: "Pattern Type",
        options: D.patternTypes,
        get: function () {
          return state.draft.patternType;
        },
        set: function (id) {
          state.draft.patternType = id;
        },
      };
    }
    if (key === "patternColor1" || key === "patternColor2") {
      return {
        title: key === "patternColor1" ? "Pattern Color 1" : "Pattern Color 2",
        options: D.colorRoles,
        get: function () {
          return state.draft[key];
        },
        set: function (id) {
          state.draft[key] = id;
        },
      };
    }
    if (key === "wallpaper") {
      return {
        title: "Wallpaper Type",
        options: D.wallpapers,
        get: function () {
          return state.draft.wallpaper;
        },
        set: function (id) {
          state.draft.wallpaper = id;
        },
      };
    }
    if (key === "presentation") {
      return {
        title: "Presentation Style",
        options: D.presentationStyles,
        get: function () {
          return state.draft.presentation;
        },
        set: function (id) {
          state.draft.presentation = id;
        },
      };
    }
    if (key === "encoreStyle") {
      return {
        title: "Encore Spotlight Style",
        options: D.encoreStyles,
        get: function () {
          return state.draft.encoreStyle;
        },
        set: function (id) {
          state.draft.encoreStyle = id;
        },
      };
    }
    if (key === "encoreSpot") {
      return {
        title: "Encore Spotlight Color",
        options: D.encoreSpotColors,
        get: function () {
          return state.draft.encoreSpot;
        },
        set: function (id) {
          state.draft.encoreSpot = id;
        },
      };
    }
    if (key === "encoreBg") {
      return {
        title: "Encore Background",
        options: D.colorRoles,
        get: function () {
          return state.draft.encoreBg;
        },
        set: function (id) {
          state.draft.encoreBg = id;
        },
      };
    }
    if (key === "dataSource") {
      return {
        title: "Data Source",
        options: D.dataSources.slice()
          .sort(function (a, b) {
            function rank(s) {
              if (s.id === "restaurant") return 0;
              if (s.id === "beta") return 1;
              if (s.id === "alpha") return 3;
              return 2;
            }
            var pa = rank(a);
            var pb = rank(b);
            if (pa !== pb) return pa - pb;
            return String(a.name || a.id || "").localeCompare(
              String(b.name || b.id || "")
            );
          })
          .map(function (s) {
            return { id: s.id, label: s.name || s.id };
          }),
        get: function () {
          return state.draft.dataSource;
        },
        set: function (id) {
          var src = null;
          var i;
          var list = D.dataSources || [];
          for (i = 0; i < list.length; i++) {
            if (list[i].id === id || list[i].name === id) {
              src = list[i];
              break;
            }
          }
          var here = codeEnv();
          var want = src && src.env;
          if (src && src.id === "beta") {
            adoptCatalog("beta");
            return;
          }
          if (src && want && here !== "local" && want !== here) {
            var dest = sourceSiteUrl(src);
            if (dest) {
              toast("Opening " + (src.name || id) + " on " + want);
              location.href = dest + "/manager.html" + (location.hash || "#/system");
              return;
            }
            toast(
              (src.name || id) +
                " lives on the " +
                want +
                " site — ship that branch from Deployer first"
            );
            return;
          }
          adoptCatalog(src ? src.id : id);
        },
      };
    }
    if (key === "requireRestart") {
      return {
        title: "Require restart to update?",
        kind: "trueFalse",
        options: D.yesNo,
        get: function () {
          return state.draft.requireRestart;
        },
        set: function (id) {
          state.draft.requireRestart = id;
        },
      };
    }
    if (key === "refreshTimer") {
      return {
        title: "Refresh Timer",
        options: (D && D.refreshTimers) || [],
        get: function () {
          return state.draft.refreshTimer;
        },
        set: function (id) {
          var s = String(id || "").trim();
          var m = s.toLowerCase().match(/^(\d+)\s*(second|seconds|sec|s|minute|minutes|min|m)?$/);
          var n = m ? parseInt(m[1], 10) : 0;
          if (m && (m[2] || "s")[0] === "m") n *= 60;
          state.draft.refreshTimer = !n || n < 30 ? "30 seconds" : s;
        },
      };
    }
    if (key === "systemFont") {
      return {
        title: "System Font",
        options: D.fonts,
        get: function () {
          return state.draft.systemFont;
        },
        set: function (id) {
          state.draft.systemFont = id;
        },
      };
    }
    if (key === "limitHeavyFilters") {
      return {
        title: "Limit Heavy Filters to 30FPS",
        kind: "trueFalse",
        options: D.yesNo,
        get: function () {
          return state.draft.limitHeavyFilters;
        },
        set: function (id) {
          state.draft.limitHeavyFilters = id;
        },
      };
    }
    if (key === "confirmSave") {
      return {
        title: "Confirm save?",
        kind: "trueFalse",
        options: D.yesNo,
        get: function () {
          return state.draft.confirmSave;
        },
        set: function (id) {
          state.draft.confirmSave = id;
        },
      };
    }
    if (key === "debugMode") {
      return {
        title: "Debug Mode",
        kind: "trueFalse",
        options: D.yesNo,
        get: function () {
          return state.draft.debugMode;
        },
        set: function (id) {
          state.draft.debugMode = id;
        },
      };
    }
    return null;
  }

  function renderPicker() {
    var spec = state.picker ? pickerSpec(state.picker) : null;
    if (!spec) {
      els.picker.hidden = true;
      els.picker.innerHTML = "";
      return;
    }
    var shroud = '<div class="picker-shroud" data-act="picker-dismiss"></div>';
    if (spec.kind === "trueFalse") {
      var btns = spec.options
        .map(function (o) {
          return (
            '<button class="btn-primary" type="button" data-act="choose" data-id="' +
            escapeHtml(o.id) +
            '">' +
            escapeHtml(o.label) +
            "</button>"
          );
        })
        .join("");
      els.picker.hidden = false;
      els.picker.innerHTML =
        shroud +
        '<div class="picker-card is-binary" role="dialog" aria-labelledby="picker-title">' +
        '<h2 class="picker-title" id="picker-title">' +
        escapeHtml(spec.title) +
        "</h2>" +
        '<div class="dialog-actions">' +
        btns +
        "</div></div>";
      applyTheme();
      return;
    }
    var current = spec.get();
    var note = spec.note
      ? '<p class="picker-note">' + escapeHtml(spec.note) + "</p>"
      : "";
    var long = " is-long";
    var opts = spec.options
      .map(function (o) {
        var on = String(o.id) === String(current);
        var fontStyle = "";
        if (state.picker === "systemFont") {
          if (o.id === "poppins") fontStyle = "font-family:Poppins,sans-serif;";
          if (o.id === "roboto") fontStyle = "font-family:Roboto,sans-serif;";
        }
        var check = on
          ? '<span class="picker-check">' + CHECK_SVG + "</span>"
          : "";
        if (state.picker === "wallpaper" && o.id === "upload") {
          return (
            '<label class="picker-option">' +
            '<span class="picker-label">' +
            escapeHtml(o.label) +
            "</span>" +
            '<input class="picker-file" type="file" accept="image/*" aria-label="Upload wallpaper">' +
            "</label>"
          );
        }
        return (
          '<button class="picker-option' +
          (on ? " is-on" : "") +
          '" type="button" data-act="choose" data-id="' +
          escapeHtml(o.id) +
          '"' +
          (fontStyle ? ' style="' + fontStyle + '"' : "") +
          '><span class="picker-label">' +
          escapeHtml(o.label) +
          "</span>" +
          check +
          "</button>"
        );
      })
      .join("");
    els.picker.hidden = false;
    els.picker.innerHTML =
      shroud +
      '<div class="picker-card' +
      long +
      '" role="dialog" aria-labelledby="picker-title">' +
      '<h2 class="picker-title" id="picker-title">' +
      escapeHtml(spec.title) +
      "</h2>" +
      note +
      '<div class="picker-list">' +
      '<div class="picker-list-inner">' +
      opts +
      "</div></div></div>";
    applyTheme();
    bindPickerUpload();
  }

  function renderDialog() {
    if (!state.dialog) {
      els.dialog.hidden = true;
      els.dialog.innerHTML = "";
      return;
    }
    els.dialog.hidden = false;
    if (state.dialog === "confirm") {
      var confirmTitle = state.screen === "image" ? "Save changes?" : "Confirm Changes?";
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog" aria-labelledby="dlg-title">' +
        '<h2 id="dlg-title">' +
        confirmTitle +
        "</h2>" +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="confirm" data-val="yes">Yes</button>' +
        '<button class="btn-primary" type="button" data-act="confirm" data-val="no">No</button>' +
        '<button class="btn-primary" type="button" data-act="confirm" data-val="keep">Keep Editing</button>' +
        "</div></div>";
    } else if (state.dialog === "board-title") {
      var cur = (state.boardDraft && (state.boardDraft.menuTitle || state.boardDraft.title)) || "";
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog">' +
        "<h2>Menu Title</h2>" +
        '<input class="dialog-input" id="board-title-input" type="text" maxlength="48" value="' +
        escapeHtml(cur) +
        '">' +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="board-title-save">Save</button>' +
        '<button class="btn-primary" type="button" data-act="board-title-cancel">Cancel</button>' +
        "</div></div>";
      setTimeout(function () {
        var inp = document.getElementById("board-title-input");
        if (inp) {
          inp.focus();
          inp.select();
        }
      }, 30);
    } else if (state.dialog === "create") {
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog">' +
        "<h2>Create New Theme</h2>" +
        '<input class="dialog-input" id="theme-name" type="text" maxlength="32" placeholder="Theme name" value="Custom Theme">' +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="create-save">Create</button>' +
        '<button class="btn-primary" type="button" data-act="create-cancel">Cancel</button>' +
        "</div></div>";
      setTimeout(function () {
        var inp = document.getElementById("theme-name");
        if (inp) {
          inp.focus();
          inp.select();
        }
      }, 30);
    } else if (state.dialog === "item-name" || state.dialog === "item-subtitle") {
      var title = state.dialog === "item-name" ? "Item Name" : "Subtitle";
      var cur =
        state.dialog === "item-name"
          ? (state.itemDraft && state.itemDraft.name) || ""
          : (state.itemDraft && state.itemDraft.subtitle) || "";
      var ph = state.dialog === "item-subtitle" ? "Optional" : "";
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog">' +
        "<h2>" +
        escapeHtml(title) +
        "</h2>" +
        '<input class="dialog-input" id="item-field-input" type="text" maxlength="80" placeholder="' +
        escapeHtml(ph) +
        '" value="' +
        escapeHtml(cur) +
        '">' +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="item-field-save">Save</button>' +
        '<button class="btn-primary" type="button" data-act="item-field-cancel">Cancel</button>' +
        "</div></div>";
      setTimeout(function () {
        var inp = document.getElementById("item-field-input");
        if (inp) {
          inp.focus();
          inp.select();
        }
      }, 30);
    } else if (state.dialog === "item-tier") {
      var model = (state.itemDraft && state.itemDraft.priceModel) || "";
      var tierHint =
        model === "vb"
          ? "For items that come with multiple pieces (EG: 5, 10, 20)"
          : "For items that come in fixed sizing (EG: S, M, L)";
      var tierCur = "";
      if (state.itemDraft && state.itemDraft.tiers && state.itemDraft.tiers[state.itemTierIndex]) {
        tierCur = state.itemDraft.tiers[state.itemTierIndex].tier || "";
      }
      var tierPh = model === "vb" ? "5" : "S";
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog">' +
        "<h2>Tier</h2>" +
        '<p class="dialog-note">' +
        escapeHtml(tierHint) +
        "</p>" +
        '<input class="dialog-input" id="item-field-input" type="text" maxlength="80" placeholder="' +
        escapeHtml(tierPh) +
        '" value="' +
        escapeHtml(tierCur) +
        '">' +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="item-field-save">Save</button>' +
        '<button class="btn-primary" type="button" data-act="item-field-cancel">Cancel</button>' +
        "</div></div>";
      setTimeout(function () {
        var inp = document.getElementById("item-field-input");
        if (inp) {
          inp.focus();
          inp.select();
        }
      }, 30);
    } else if (state.dialog === "item-description") {
      var desc = (state.itemDraft && state.itemDraft.description) || "";
      els.dialog.innerHTML =
        '<div class="dialog-card is-tall" role="dialog">' +
        "<h2>Description</h2>" +
        '<textarea class="dialog-textarea" id="item-field-input" maxlength="600" rows="12">' +
        escapeHtml(desc) +
        "</textarea>" +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="item-field-save">Save</button>' +
        '<button class="btn-primary" type="button" data-act="item-field-cancel">Cancel</button>' +
        "</div></div>";
      setTimeout(function () {
        var inp = document.getElementById("item-field-input");
        if (inp) inp.focus();
      }, 30);
    } else if (state.dialog === "item-required") {
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog">' +
        "<h2>Title and price required</h2>" +
        '<p class="dialog-note">New items must have a title and at least one price.</p>' +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="item-required-ok">OK</button>' +
        "</div></div>";
    } else if (state.dialog === "item-missing") {
      var lis = (state.itemMissing || [])
        .map(function (label) {
          return "<li>" + escapeHtml(label) + "</li>";
        })
        .join("");
      var creating = state.itemDraft && String(state.itemDraft.key) === "new";
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog">' +
        "<h2>Missing features</h2>" +
        '<p class="dialog-note">Are you sure you want to ' +
        (creating ? "add" : "save") +
        " this item without the following features?</p>" +
        '<ul class="dialog-list">' +
        lis +
        "</ul>" +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="item-missing-go">' +
        (creating ? "Add anyway" : "Save anyway") +
        "</button>" +
        '<button class="btn-primary" type="button" data-act="item-missing-keep">Keep editing</button>' +
        "</div></div>";
    } else if (state.dialog === "item-include") {
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog">' +
        "<h2>Not shown on the board</h2>" +
        '<p class="dialog-note">This item will be saved but will not appear on the live board until Include in board is Yes.</p>' +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="item-include-go">Save anyway</button>' +
        '<button class="btn-primary" type="button" data-act="item-include-keep">Keep editing</button>' +
        "</div></div>";
    } else if (state.dialog === "image-opaque") {
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog">' +
        "<h2>Warning</h2>" +
        '<p class="dialog-note">Your item may not appear correctly because you haven\'t removed the background yet.</p>' +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="image-opaque-ok">OK</button>' +
        '<button class="btn-primary" type="button" data-act="image-opaque-cancel">Cancel</button>' +
        "</div></div>";
    } else if (state.dialog === "image-tutorial") {
      els.dialog.innerHTML = imageTutorialHtml();
    } else if (state.dialog === "item-delete") {
      var delItems = (state.boardDraft && state.boardDraft.items) || [];
      var delIdx = state.pendingDeleteIndex;
      var delName =
        delIdx != null && delItems[delIdx] ? delItems[delIdx].name : "this item";
      var delWarn = confirmSaveOff() ? " This cannot be undone." : "";
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog">' +
        "<h2>Delete this item?</h2>" +
        '<p class="dialog-note">Are you sure you want to delete ' +
        escapeHtml(delName) +
        "?" +
        delWarn +
        "</p>" +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="item-delete-yes">Yes</button>' +
        '<button class="btn-primary" type="button" data-act="item-delete-no">No</button>' +
        "</div></div>";
    }
    applyTheme();
    if (state.dialog === "image-tutorial") bindImageTutorial();
  }

  function toast(msg) {
    var el = els.toast;
    el.hidden = false;
    el.textContent = msg;
    el.classList.remove("is-out");
    el.classList.remove("is-on");
    void el.offsetWidth;
    el.classList.add("is-on");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.classList.remove("is-on");
      el.classList.add("is-out");
      state.toastTimer = setTimeout(function () {
        el.hidden = true;
        el.classList.remove("is-out");
      }, 380);
    }, 4000);
  }

  var TOOLTIP_FADE_MS = 400;
  var TOOLTIP_LAYOUT_MS = 520;
  var TOOLTIP_HOLD_MS = 6200;
  var ITEM_ORDER_IDLE_MS = 3000;
  var MSG_BOARD_SAVED = "Board Saved to Restaurant Settings";
  var MSG_ENCORE_SAVED = "Global Encore Style Settings updated";
  var MSG_ORDER_SAVED = "Menu Items Order Saved.";

  function playTooltipAnim(el, frames, onDone, duration) {
    var finished = false;
    var dur = duration == null ? TOOLTIP_FADE_MS : duration;
    function done() {
      if (finished) return;
      finished = true;
      if (onDone) onDone();
    }
    if (!el) {
      done();
      return null;
    }
    if (el._tokiTipAnim && typeof el._tokiTipAnim.cancel === "function") {
      try {
        var cs = window.getComputedStyle(el);
        var from = frames[0] || {};
        if (from.opacity != null) el.style.opacity = cs.opacity;
        if (from.transform != null) el.style.transform = cs.transform;
        if (from.height != null) el.style.height = cs.height;
        if (from.top != null) el.style.top = cs.top;
        el._tokiTipAnim.cancel();
      } catch (err) {}
    }
    if (typeof el.animate === "function") {
      var anim = el.animate(frames, {
        duration: dur,
        easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        fill: "forwards"
      });
      el._tokiTipAnim = anim;
      anim.addEventListener("finish", done);
      anim.addEventListener("cancel", done);
      setTimeout(done, dur + 100);
      return anim;
    }
    var to = frames[frames.length - 1] || {};
    if (to.opacity != null) el.style.opacity = String(to.opacity);
    if (to.transform != null) el.style.transform = to.transform;
    if (to.height != null) el.style.height = to.height;
    if (to.top != null) el.style.top = to.top;
    setTimeout(done, dur);
    return null;
  }

  function tooltipBoxPx(rect) {
    return { top: rect.top + "px", height: rect.height + "px" };
  }

  function applyTooltipBox(el, rect) {
    if (!el || !rect) return;
    el.style.top = rect.top + "px";
    el.style.height = rect.height + "px";
  }

  function readTooltipBox(el) {
    if (!el) return null;
    var cs = window.getComputedStyle(el);
    var top = parseFloat(cs.top);
    var height = parseFloat(cs.height);
    if (isNaN(top) || isNaN(height) || height <= 0) return null;
    return { top: Math.round(top), height: Math.round(height) };
  }

  function tooltipRectsEqual(a, b) {
    return !!(a && b && a.top === b.top && a.height === b.height);
  }

  function deviceCssScale() {
    var device = els.device;
    if (!device || !device.offsetWidth) return 1;
    return device.getBoundingClientRect().width / device.offsetWidth || 1;
  }

  // Desktop studio `.device` keeps transform:scale (even at 1), so fixed
  // positioning is relative to the phone frame, not the window.
  function clientToDevicePoint(clientX, clientY) {
    var originEl = els.app || els.device;
    if (!originEl) return { x: clientX, y: clientY, scale: 1 };
    var d = originEl.getBoundingClientRect();
    var scale = originEl.offsetWidth ? d.width / originEl.offsetWidth : deviceCssScale();
    if (!scale) scale = 1;
    return {
      x: (clientX - d.left) / scale,
      y: (clientY - d.top) / scale,
      scale: scale
    };
  }

  function rectInDevice(el) {
    var device = els.device;
    if (!el || !device) return null;
    var scale = deviceCssScale();
    var d = device.getBoundingClientRect();
    var r = el.getBoundingClientRect();
    return {
      top: Math.round((r.top - d.top) / scale),
      height: Math.round(r.height / scale)
    };
  }

  function tooltipDisplayRect() {
    var device = els.device;
    if (!device) return { top: 0, height: 0 };
    if (state.screen === "home") {
      var hero = rectInDevice(document.querySelector(".home-hero"));
      if (hero && hero.height > 0) return hero;
      return { top: 0, height: Math.round(device.clientHeight * 0.75) };
    }
    var slot = rectInDevice(document.querySelector(".status, .preview"));
    if (slot && slot.height > 0) return slot;
    var header = rectInDevice(document.querySelector(".header"));
    var top = header ? header.top + header.height : 0;
    return {
      top: top,
      height: Math.round(device.clientWidth * (2 / 3))
    };
  }

  function layoutTooltipOverlay(animate) {
    var root = els.tooltipRoot;
    if (!root || root.hidden) return;
    var shroud = root.querySelector(".tooltip-shroud");
    var scroll = els.tooltipScroll || root.querySelector(".tooltip-scroll");
    if (shroud) {
      shroud.style.top = "";
      shroud.style.height = "";
    }
    var dest = tooltipDisplayRect();
    if (!dest || dest.height <= 0) return;
    var from = readTooltipBox(scroll) || state.tooltipRect;
    state.tooltipRect = dest;
    var same = tooltipRectsEqual(from, dest);
    if (!animate || !from || same) {
      if (scroll && scroll._tokiTipAnim && typeof scroll._tokiTipAnim.cancel === "function") {
        try {
          scroll._tokiTipAnim.cancel();
        } catch (err) {}
      }
      applyTooltipBox(scroll, dest);
      return;
    }
    playTooltipAnim(
      scroll,
      [tooltipBoxPx(from), tooltipBoxPx(dest)],
      function () {
        applyTooltipBox(scroll, dest);
      },
      TOOLTIP_LAYOUT_MS
    );
  }

  function tooltipMarkup(opts) {
    var kind = opts.kind || "info";
    if (kind === "save") {
      return (
        '<div class="tooltip-save">' +
        escapeHtml(opts.title || opts.body || "") +
        "</div>"
      );
    }
    var html = "";
    if (opts.title) {
      html +=
        '<div class="tooltip-title">' + escapeHtml(opts.title) + "</div>";
    }
    var lines = (opts.lines || []).filter(Boolean);
    if (lines.length > 1) {
      html +=
        '<ul class="tooltip-list">' +
        lines
          .map(function (line) {
            return (
              "<li>" +
              escapeHtml(String(line).replace(/^[•\-\s]+/, "")) +
              "</li>"
            );
          })
          .join("") +
        "</ul>";
    } else if (lines.length === 1) {
      html +=
        '<div class="tooltip-body">' +
        escapeHtml(String(lines[0]).replace(/^[•\-\s]+/, "")) +
        "</div>";
    } else if (opts.body) {
      html +=
        '<div class="tooltip-body">' + escapeHtml(opts.body) + "</div>";
    }
    return html;
  }

  function fadeTooltipShroud(on, immediate) {
    var root = els.tooltipRoot;
    if (!root) return;
    var shroud = root.querySelector(".tooltip-shroud");
    var want = !!on;
    if (!immediate && state.tooltipShroudOn === want) {
      if (want) root.classList.add("is-on");
      return;
    }
    state.tooltipShroudOn = want;
    if (want) root.classList.add("is-on");
    if (!shroud) {
      if (!want) root.classList.remove("is-on");
      return;
    }
    if (immediate) {
      if (shroud._tokiTipAnim && typeof shroud._tokiTipAnim.cancel === "function") {
        try {
          shroud._tokiTipAnim.cancel();
        } catch (err) {}
      }
      shroud.style.opacity = want ? "1" : "0";
      if (!want) root.classList.remove("is-on");
      return;
    }
    playTooltipAnim(
      shroud,
      [{ opacity: want ? 0 : 1 }, { opacity: want ? 1 : 0 }],
      function () {
        if (!want && state.tooltipShroudOn === false) {
          root.classList.remove("is-on");
        }
      }
    );
  }

  function syncTooltipRoot() {
    var root = els.tooltipRoot;
    if (!root) return;
    if (state.tooltipItems.length) {
      var wasHidden = root.hidden;
      root.hidden = false;
      if (wasHidden) {
        void root.offsetWidth;
        layoutTooltipOverlay(false);
        fadeTooltipShroud(true);
      } else {
        root.classList.add("is-on");
      }
    } else {
      if (state.tooltipShroudOn) fadeTooltipShroud(false);
      clearTimeout(state.tooltipRootTimer);
      state.tooltipRootTimer = setTimeout(function () {
        if (!state.tooltipItems.length) {
          root.hidden = true;
          state.tooltipRect = null;
        }
      }, TOOLTIP_FADE_MS);
    }
  }

  function tooltipStillVisible(exceptId) {
    var n = 0;
    var i;
    for (i = 0; i < state.tooltipItems.length; i++) {
      var it = state.tooltipItems[i];
      if (exceptId != null && it.id === exceptId) continue;
      if (it.el && it.el.classList.contains("is-out")) continue;
      n++;
    }
    return n;
  }

  function removeTooltipItem(id) {
    var idx;
    for (idx = 0; idx < state.tooltipItems.length; idx++) {
      if (state.tooltipItems[idx].id !== id) continue;
      var node = state.tooltipItems[idx].slot || state.tooltipItems[idx].el;
      if (node && node.parentNode) node.parentNode.removeChild(node);
      state.tooltipItems.splice(idx, 1);
      break;
    }
    syncTooltipRoot();
  }

  function dismissTooltip(id, immediate) {
    var i;
    var item = null;
    for (i = 0; i < state.tooltipItems.length; i++) {
      if (state.tooltipItems[i].id === id) {
        item = state.tooltipItems[i];
        break;
      }
    }
    if (!item) return;
    clearTimeout(item.timer);
    if (immediate) {
      removeTooltipItem(id);
      return;
    }
    if (item.el && item.el.classList.contains("is-out")) return;
    if (tooltipStillVisible(id) === 0) {
      fadeTooltipShroud(false);
    }
    if (item.el) {
      item.el.classList.add("is-out");
      item.el.classList.remove("is-on");
    }
    var slot = item.slot;
    var h = slot ? slot.getBoundingClientRect().height : 0;
    if (slot) {
      slot.style.height = h + "px";
      void slot.offsetHeight;
      playTooltipAnim(slot, [{ height: h + "px" }, { height: "0px" }]);
    }
    if (item.el) {
      playTooltipAnim(
        item.el,
        [
          { opacity: 1, transform: "translateY(0px)" },
          { opacity: 0, transform: "translateY(-14px)" }
        ],
        function () {
          removeTooltipItem(id);
        }
      );
    } else {
      setTimeout(function () {
        removeTooltipItem(id);
      }, TOOLTIP_FADE_MS);
    }
  }

  function dismissAllTooltips(immediate) {
    if (immediate) fadeTooltipShroud(false, true);
    else fadeTooltipShroud(false);
    var ids = state.tooltipItems.map(function (item) {
      return item.id;
    });
    ids.forEach(function (id) {
      dismissTooltip(id, immediate);
    });
  }

  function showTooltip(opts) {
    var stack = els.tooltipStack;
    if (!stack) return;
    var id = ++state.tooltipSeq;
    var slot = document.createElement("div");
    slot.className = "tooltip-slot";
    var clip = document.createElement("div");
    clip.className = "tooltip-slot-clip";
    var inner = document.createElement("div");
    inner.className = "tooltip-slot-inner";
    var el = document.createElement("div");
    el.className =
      "tooltip-card" + (opts.kind === "save" ? " is-save" : " is-info");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("data-act", "tooltip-dismiss");
    el.setAttribute("data-tip-id", String(id));
    el.innerHTML = tooltipMarkup(opts);
    inner.appendChild(el);
    clip.appendChild(inner);
    slot.appendChild(clip);
    stack.appendChild(slot);
    var item = { id: id, el: el, slot: slot, timer: null };
    state.tooltipItems.push(item);
    syncTooltipRoot();
    var h = inner.scrollHeight;
    slot.style.height = "0px";
    void slot.offsetHeight;
    playTooltipAnim(slot, [{ height: "0px" }, { height: h + "px" }], function () {
      slot.style.height = h + "px";
    });
    playTooltipAnim(el, [
      { opacity: 0, transform: "translateY(18px)" },
      { opacity: 1, transform: "translateY(0px)" }
    ]);
    el.classList.add("is-on");
    item.timer = setTimeout(function () {
      dismissTooltip(id, false);
    }, TOOLTIP_HOLD_MS);
    return id;
  }

  function showSaveNotice(msg) {
    var text = String(msg || "").trim();
    if (!text) return;
    showTooltip({ kind: "save", title: text });
  }

  function showConfirmSaveTooltip(choice) {
    var isYes = String(choice) === "yes";
    showTooltip({
      title: isYes
        ? "Save confirmation enabled."
        : "Save confirmation surpassed.",
      lines: isYes
        ? [
            "Press < to save page.",
            "Changes go live after save confirmation"
          ]
        : [
            "Options save on a per-change basis",
            "Database and menu are updated instantly",
            "Use with caution"
          ],
    });
  }

  function showFamilyPortraitTooltip() {
    showTooltip({
      title: "Family Portrait Enabled",
      body: "Shows spread of all items in first slide of presentation.",
    });
  }

  function showEncoreTooltip() {
    showTooltip({
      title: "Encore Enabled",
      lines: [
        "Shows all products in spread and zooms in on each individually",
        "Overrides background with its own",
        "Heavy Filter (resource intensive, may not run well on all systems)",
      ],
    });
  }

  function showRequireRestartTooltip(choice) {
    var isYes = String(choice) === "yes";
    showTooltip({
      title: isYes ? "Soft refresh disabled." : "Soft refresh enabled.",
      body: isYes
        ? "TVs must be restarted for changes to take effect."
        : "Menus will check for updates on a fixed timer - you don't have to do a thing.",
    });
  }

  function showFilterCapTooltip() {
    showTooltip({
      title: "Filter Cap Enabled for Heavy Effects.",
    });
  }

  function showDebugModeTooltip() {
    showTooltip({
      title: "Debug Mode Enabled",
      body: "Debugger Console now showing on Menu Screens.",
    });
  }

  function showEncoreHardTooltip() {
    showTooltip({
      title: "WARNING:",
      body: "Performance issues with Fire Stick. Use with caution.",
    });
  }

  function encoreFieldsChanged(prev, next) {
    prev = prev || {};
    next = next || {};
    return (
      String(prev.encoreStyle || "") !== String(next.encoreStyle || "") ||
      String(prev.encoreSpot || "") !== String(next.encoreSpot || "") ||
      String(prev.encoreBg || "") !== String(next.encoreBg || "")
    );
  }

  function itemsOrderChanged(prev, next) {
    function names(snap) {
      return JSON.stringify(
        ((snap && snap.items) || []).map(function (it) {
          return it && it.name;
        })
      );
    }
    return names(prev) !== names(next);
  }

  function boardMetaChanged(prev, next) {
    prev = prev || {};
    next = next || {};
    return (
      String(prev.menuTitle || "") !== String(next.menuTitle || "") ||
      String(prev.familyPortrait || "") !== String(next.familyPortrait || "") ||
      String(prev.presentation || "") !== String(next.presentation || "") ||
      String(prev.includeDescriptions || "") !==
        String(next.includeDescriptions || "")
    );
  }

  function clearItemOrderSaveTimer() {
    if (state.itemOrderTimer) {
      clearTimeout(state.itemOrderTimer);
      state.itemOrderTimer = null;
    }
  }

  function applyInventoryRowNumbers(items, itemRows) {
    if (!items || !itemRows || !itemRows.length) return;
    var byName = {};
    var i;
    for (i = 0; i < itemRows.length; i++) {
      var n = String((itemRows[i] && itemRows[i].name) || "");
      if (n && byName[n] == null) byName[n] = itemRows[i];
    }
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      var hit =
        itemRows[i] && String(itemRows[i].name || "") === String(it.name || "")
          ? itemRows[i]
          : byName[String(it.name || "")];
      if (hit && hit.row) it.row = hit.row;
    }
  }

  function syncOpenItemRowFromBoard() {
    if (!state.itemDraft || !state.boardDraft || !state.boardDraft.items) return;
    var key = String(state.itemDraft.key || "");
    if (key === "new") return;
    var idx = parseInt(key, 10);
    var items = state.boardDraft.items;
    if (!isFinite(idx) || idx < 0 || !items[idx]) return;
    var row = items[idx].row;
    if (row) {
      state.itemDraft.row = row;
      if (state.itemCommitted) state.itemCommitted.row = row;
    }
  }

  /* Confirm save? No: persist the Inventory order without Confirm-on-back
     and without treating the item editor as the save target. */
  function persistBoardOrderQuiet() {
    clearItemOrderSaveTimer();
    state.pendingItemOrderSave = false;
    if (!state.boardDraft || state.boardDraft.kind === "announcements") {
      return Promise.resolve(false);
    }
    if (!boardDirty()) return Promise.resolve(false);
    var boardPrev =
      state.lastBoardSnap[state.boardDraft.id] ||
      boardSettingsSnap(state.boardCommitted);
    var boardNext = boardSettingsSnap(state.boardDraft);
    var orderDirty = itemsOrderChanged(boardPrev, boardNext);
    var boardMetaDirty = boardMetaChanged(boardPrev, boardNext);
    state.boardCommitted = clone(state.boardDraft);
    applyBoardToCatalog(state.boardDraft);
    rememberBoardSnap(state.boardDraft);
    state.persistInFlight = true;
    var p = persistBoardWrite(boardPrev, boardNext)
      .then(function (result) {
        state.persistInFlight = false;
        syncOpenItemRowFromBoard();
        if (result && result.wrote && result.wrote.ok) state.sheetDirty = false;
        showSaveOutcome(result, {
          onBoard: true,
          confirmed: false,
          encoreDirty: false,
          orderDirty: orderDirty,
          boardMetaDirty: boardMetaDirty,
        });
        return true;
      })
      .catch(function (err) {
        state.persistInFlight = false;
        console.warn("Menu Manager order save failed", err);
        showSaveNotice(
          "Could not write board to sheet — saved for this session"
        );
        return false;
      });
    state.itemOrderPersist = p.then(
      function () {},
      function () {}
    );
    return p;
  }

  function scheduleItemOrderSave() {
    state.pendingItemOrderSave = true;
    clearItemOrderSaveTimer();
    state.itemOrderTimer = setTimeout(function () {
      state.itemOrderTimer = null;
      if (!state.pendingItemOrderSave) return;
      if (!confirmSaveOff()) return;
      if (!boardDirty()) {
        state.pendingItemOrderSave = false;
        return;
      }
      state.pendingLeave = null;
      if (state.screen === "item") persistBoardOrderQuiet();
      else maybeAutoSave(true);
    }, ITEM_ORDER_IDLE_MS);
  }

  function styleWroteOnlyEncore(wrote) {
    return !!(
      wrote &&
      wrote.wroteEncore &&
      !wrote.wroteTheme &&
      !wrote.wroteBackground &&
      !wrote.wroteSpeeds &&
      !wrote.wrotePattern
    );
  }

  function yesToastSkippingEncore(needed, wrote, fb, kind) {
    if (!wrote || styleWroteOnlyEncore(wrote)) return "";
    if (kind === "board" || kind === "both") return "";
    if (
      !wrote.wroteTheme &&
      !wrote.wroteBackground &&
      !wrote.wroteSpeeds &&
      !wrote.wrotePattern
    ) {
      return "";
    }
    var cloneWrote = Object.assign({}, wrote, { wroteEncore: false });
    return yesToast(needed, cloneWrote, fb, kind);
  }

  function showSaveOutcome(out, flags) {
    flags = flags || {};
    var needed = !!(out && out.needed);
    var wrote = (out && out.wrote) || null;
    var fb = !!(out && out.fb);
    var kind = (out && out.kind) || "";
    if (!needed || !(wrote && wrote.ok)) {
      showSaveNotice(yesToast(needed, wrote, fb, kind));
      return;
    }
    var encoreSaved = !!flags.encoreDirty;
    var orderSaved = !!flags.orderDirty;
    var boardMeta = !!flags.boardMetaDirty;
    var onBoard = !!flags.onBoard;
    var confirmed = !!flags.confirmed;
    var cards = [];
    if (onBoard) {
      if (confirmed && (boardMeta || encoreSaved || orderSaved)) {
        cards.push(MSG_BOARD_SAVED);
      } else if (!confirmed && boardMeta) {
        cards.push(MSG_BOARD_SAVED);
      }
      if (encoreSaved) cards.push(MSG_ENCORE_SAVED);
      if (orderSaved) cards.push(MSG_ORDER_SAVED);
      if (cards.length) {
        cards.forEach(function (text) {
          showSaveNotice(text);
        });
        return;
      }
    }
    if (encoreSaved) {
      var styleMsg = yesToastSkippingEncore(needed, wrote, fb, kind);
      if (styleMsg) showSaveNotice(styleMsg);
      showSaveNotice(MSG_ENCORE_SAVED);
      return;
    }
    showSaveNotice(yesToast(needed, wrote, fb, kind));
  }

  function rememberStyleScroll() {
    var sc = document.getElementById("style-scroll");
    if (sc) state.styleScroll = sc.scrollTop;
    var bc = document.getElementById("board-scroll");
    if (bc) state.boardScroll = bc.scrollTop;
    var sysc = document.getElementById("system-scroll");
    if (sysc) state.systemScroll = sysc.scrollTop;
    var nav = els.app && els.app.querySelector(".nav-wrap");
    if (nav) state.menuScroll = nav.scrollTop;
    var ic = document.getElementById("item-scroll");
    if (ic) state.itemScroll = ic.scrollTop;
    var imc = document.getElementById("image-scroll");
    if (imc) state.imageScroll = imc.scrollTop;
  }

  function go(screen, boardId, itemKey) {
    if (state.screen === "style" || state.screen === "item" || state.screen === "image") {
      rememberStyleScroll();
    }
    state.picker = null;
    state.dialog = null;
    state.screen = screen;
    state.boardId = boardId || null;
    if (screen === "item" || screen === "image") {
      state.itemKey = itemKey != null ? String(itemKey) : String(state.itemKey || "new");
    } else if (screen !== "board") {
      state.itemKey = null;
    }
    if (screen !== "style") state.styleScroll = 0;
    if (screen !== "board" && screen !== "item" && screen !== "image") state.boardScroll = 0;
    if (screen !== "item" && screen !== "image") state.itemScroll = 0;
    if (screen !== "image") state.imageScroll = 0;
    if (screen !== "system") state.systemScroll = 0;
    if (screen !== "menu") state.menuScroll = 0;
    writeHash(true);
    renderAll();
  }

  function backTarget() {
    if (state.screen === "image") {
      return { screen: "item", boardId: state.boardId, itemKey: state.itemKey };
    }
    if (state.screen === "item") {
      return { screen: "board", boardId: state.boardId };
    }
    if (state.screen === "style" || state.screen === "board") {
      return { screen: "menu", boardId: null };
    }
    if (state.screen === "system" || state.screen === "menu") {
      return { screen: "home", boardId: null };
    }
    return { screen: "home", boardId: null };
  }

  function performBackNav(screen, boardId) {
    if (state.screen === "style" || state.screen === "item" || state.screen === "image") {
      rememberStyleScroll();
    }
    state.picker = null;
    state.dialog = null;
    state.screen = screen;
    state.boardId = boardId || null;
    if (screen !== "item" && screen !== "image") {
      state.itemKey = null;
      state.itemScroll = 0;
      state.imageDraft = null;
      state.imageCommitted = null;
    }
    if (screen !== "image") state.imageScroll = 0;
    if (screen !== "style") state.styleScroll = 0;
    if (screen !== "system") state.systemScroll = 0;
    if (screen !== "menu") state.menuScroll = 0;
    writeHash(false);
    renderAll();
  }

  function styleDirty() {
    return !eq(state.draft, state.committed);
  }

  function systemSettingsDirty() {
    if (!state.committed) return false;
    var keys = [
      "requireRestart",
      "systemFont",
      "limitHeavyFilters",
      "confirmSave",
      "refreshTimer",
      "debugMode",
    ];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (state.draft[k] !== state.committed[k]) return true;
    }
    return false;
  }

  function confirmSaveOff() {
    return state.draft.confirmSave === "no";
  }

  function styleWriteDirty() {
    return !eq(styleSnap(state.draft), styleSnap(state.committed));
  }

  function anySaveDirty() {
    return systemSettingsDirty() || styleWriteDirty() || boardDirty();
  }

  /* Confirm save? No: every option writes now (System, Style, Board),
     except menu-item reorder which waits ITEM_ORDER_IDLE_MS of idle.
     The toggle itself is always-immediate via choose(). quiet skips a
     remount when the caller already painted. On Edit Item / Create Item
     a pending order write stays in the background — confirmChoice would
     otherwise treat Yes as an item save and close the editor. */
  function maybeAutoSave(quiet) {
    if (!confirmSaveOff() || !anySaveDirty()) return false;
    if (state.screen === "item") {
      persistBoardOrderQuiet();
      return true;
    }
    confirmChoice("yes", quiet);
    return true;
  }

  function leaveBoard(next) {
    if (confirmSaveOff()) {
      state.pendingLeave = next;
      if (!maybeAutoSave()) {
        state.pendingLeave = null;
        next();
      }
      return;
    }
    if (boardDirty() || styleDirty()) {
      state.pendingLeave = next;
      state.dialog = "confirm";
      renderDialog();
      return;
    }
    next();
  }

  function leaveStyle(next) {
    if (confirmSaveOff()) {
      state.pendingLeave = next;
      if (!maybeAutoSave()) {
        state.pendingLeave = null;
        next();
      }
      return;
    }
    if (!eq(state.draft, state.committed)) {
      state.pendingLeave = next;
      state.dialog = "confirm";
      renderDialog();
      return;
    }
    next();
  }

  function leaveSystem(next) {
    if (systemSettingsDirty()) {
      if (confirmSaveOff()) {
        state.pendingLeave = next;
        confirmChoice("yes");
        return;
      }
      state.pendingLeave = next;
      state.dialog = "confirm";
      renderDialog();
      return;
    }
    next();
  }

  function back() {
    if (state.picker) {
      state.picker = null;
      renderPicker();
      return;
    }
    if (state.dialog) {
      if (state.dialog === "image-opaque") {
        cancelOpaqueImage();
        return;
      }
      if (state.dialog === "image-tutorial") {
        closeImageTutorial();
        return;
      }
      state.dialog = null;
      renderDialog();
      return;
    }
    var target = backTarget();
    if (state.screen === target.screen && String(state.boardId || "") === String(target.boardId || "")) {
      return;
    }
    if (state.screen === "style") {
      leaveStyle(function () {
        performBackNav(target.screen, target.boardId);
      });
      return;
    }
    if (state.screen === "image") {
      leaveImage(function () {
        performBackNav(target.screen, target.boardId);
      });
      return;
    }
    if (state.screen === "item") {
      leaveItem(function () {
        performBackNav(target.screen, target.boardId);
      });
      return;
    }
    if (state.screen === "board") {
      leaveBoard(function () {
        performBackNav(target.screen, target.boardId);
      });
      return;
    }
    if (state.screen === "system") {
      leaveSystem(function () {
        performBackNav(target.screen, target.boardId);
      });
      return;
    }
    if (state.screen === "menu") {
      performBackNav(target.screen, target.boardId);
      return;
    }
  }

  function openPicker(key) {
    var spec = pickerSpec(key);
    if (!spec) return;
    if (key === "boardTitle") {
      state.dialog = "board-title";
      renderDialog();
      return;
    }
    if (key === "itemName") {
      state.dialog = "item-name";
      renderDialog();
      return;
    }
    if (key === "itemSubtitle") {
      state.dialog = "item-subtitle";
      renderDialog();
      return;
    }
    if (key === "itemDescription") {
      state.dialog = "item-description";
      renderDialog();
      return;
    }
    if (key === "itemImage") {
      if (itemHasImage(state.itemDraft)) {
        openImageEditor();
        return;
      }
      openImageTutorial("item");
      return;
    }
    if (spec.kind === "zeroOne") {
      toggleZeroOne(key);
      return;
    }
    rememberStyleScroll();
    state.picker = key;
    renderPicker();
  }

  function toggleZeroOne(key) {
    var spec = pickerSpec(key);
    if (!spec || !spec.options || spec.options.length < 2) return;
    var cur = String(spec.get());
    var next =
      cur === String(spec.options[0].id)
        ? spec.options[1].id
        : spec.options[0].id;
    spec.set(next);
    rememberStyleScroll();
    renderAll();
    if (confirmSaveOff()) {
      state.pendingLeave = null;
      maybeAutoSave(true);
    }
  }

  function choose(id) {
    var spec = pickerSpec(state.picker);
    if (!spec) return;
    if (state.picker === "wallpaper" && id === "upload") {
      return;
    }
    var pickKey = state.picker;
    var wasPresentation = pickKey === "presentation";
    var oldPres = wasPresentation ? state.draft.presentation : null;
    if (pickKey === "dataSource") {
      spec.set(id);
      state.picker = null;
      renderAll();
      return;
    }
    spec.set(id);
    state.picker = null;
    if (state.screen === "item") {
      rememberStyleScroll();
      applyTheme();
      renderAll();
      return;
    }
    if (state.screen !== "board") state.sheetDirty = true;
    else if (
      pickKey === "encoreStyle" ||
      pickKey === "encoreSpot" ||
      pickKey === "encoreBg"
    ) {
      state.sheetDirty = true;
    }
    applyTheme();
    if (pickKey === "theme") {
      captureLastPaint(); // user changed theme in preview → update last-paint so next boot shows it immediately
    }
    renderAll();
    if (pickKey === "confirmSave") {
      showConfirmSaveTooltip(id);
      // Special: the "Confirm save?" toggle itself ALWAYS writes immediately
      // (sheet + behavior), whether the prior value was yes or no.
      // All other options — System, Style, Board — follow the current value.
      clearItemOrderSaveTimer();
      state.pendingLeave = null;
      confirmChoice("yes", true);
      if (id === "no" && boardDirty()) maybeAutoSave(true);
    } else if (confirmSaveOff()) {
      state.pendingLeave = null;
      maybeAutoSave(true);
    }
    if (pickKey === "requireRestart") {
      showRequireRestartTooltip(id);
    }
    if (pickKey === "limitHeavyFilters" && id === "yes") {
      showFilterCapTooltip();
    }
    if (pickKey === "debugMode" && id === "yes") {
      showDebugModeTooltip();
    }
    if (pickKey === "encoreStyle" && id === "hard_shadow") {
      showEncoreHardTooltip();
    }
    if (pickKey === "boardFamily" && id === "yes") {
      showFamilyPortraitTooltip();
    }
    if (
      (pickKey === "boardPresentation" || pickKey === "presentation") &&
      id === "encore"
    ) {
      showEncoreTooltip();
    }
    if (pickKey === "boardPresentation") {
      previewCtl.encoreFirst = true;
      if (id === "encore") fillPortraitGrid();
      retargetMotion();
    }
    if (wasPresentation && state.screen === "style") {
      var newPres = state.draft.presentation;
      if (oldPres !== newPres) {
        if (newPres === "encore") {
          previewCtl.encoreFirst = true;
          fillPortraitGrid();
        }
        retargetMotion();
      }
    }
  }

  function bindPickerUpload() {
    var inp = els.picker.querySelector(".picker-file");
    if (!inp || inp.getAttribute("data-bound")) return;
    inp.setAttribute("data-bound", "1");
    inp.addEventListener("change", function () {
      if (inp.files && inp.files.length) {
        toast("Upload coming soon");
      }
      inp.value = "";
    });
  }

  function bindWpFallback() {
    var imgs = els.app.querySelectorAll(".preview-wp-img");
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        if (img.getAttribute("data-fb")) return;
        img.setAttribute("data-fb", "1");
        img.addEventListener("error", function () {
          var fb = img.getAttribute("data-fallback");
          if (fb && img.src.indexOf(fb) === -1) img.src = fb;
        });
      })(imgs[i]);
    }
  }

  function rememberPillScroll() {
    var rows = els.app.querySelectorAll("[data-pills]");
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].getAttribute("data-pills");
      if (key) state.pillScroll[key] = rows[i].scrollLeft;
    }
  }

  function restorePillScroll() {
    var rows = els.app.querySelectorAll("[data-pills]");
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].getAttribute("data-pills");
      if (key && state.pillScroll[key] != null) {
        rows[i].scrollLeft = state.pillScroll[key];
      }
    }
  }

  function setPill(key, val) {
    var next = Number(val);
    if (state.draft[key] === next) return;
    rememberStyleScroll();
    rememberPillScroll();
    state.sheetDirty = true;
    state.draft[key] = next;
    var row = els.app.querySelector('[data-pills="' + key + '"]');
    if (row) {
      var pills = row.querySelectorAll(".pill");
      for (var i = 0; i < pills.length; i++) {
        pills[i].classList.toggle(
          "is-on",
          Number(pills[i].getAttribute("data-val")) === next
        );
      }
    }
    if (key === "scrollSpeed") {
      maybeAutoSave(true);
      return;
    }
    if (key === "presentationSpeed") {
      retargetMotion();
      maybeAutoSave(true);
      return;
    }
    renderScreen();
    maybeAutoSave(true);
  }

  function persistFallback() {
    var sheet = window.TOKI_MANAGER_SHEET;
    if (!sheet || !sheet.saveFallback) return Promise.resolve(false);
    if (!hadLiveSheetData) {
      // never snapshot pre-sheet boot defaultDraft or before live data committed this session
      return Promise.resolve(false);
    }
    var ds = state.draft && state.draft.dataSource;
    if (!ds) {
      // do not create a "source" bucket
      return Promise.resolve(false);
    }
    var meta = state.lastSheet || {};
    var entry = {
      sourceId: ds,
      sourceName: meta.sourceName || "",
      sheetId: meta.sheetId || "",
      draft: clone(state.draft),
      themes: D.themes,
      speedTiles: D.speedTiles,
      colorRoles: D.colorRoles,
      wallpapers: D.wallpapers,
      fieldValidations: meta.fieldValidations || null,
      dataSources: D.dataSources,
      catalogSettings: state.catalogSettings || [],
      motionStyles: D.motionStyles || {},
    };
    // skip write if identical to last we wrote (equals what is on disk from prior)
    var sig = JSON.stringify(entry);
    if (lastFallbackSnapshot === sig) {
      return Promise.resolve(true);
    }
    return sheet.saveFallback(entry).then(function (ok) {
      if (ok) lastFallbackSnapshot = sig;
      return ok;
    });
  }

  function styleSnap(d) {
    d = d || {};
    return {
      themeName: d.themeName || "",
      background: d.background || "",
      bgColor: d.bgColor || "",
      patternType: d.patternType || "",
      patternColor1: d.patternColor1 || "",
      patternColor2: d.patternColor2 || "",
      wallpaper: d.wallpaper || "",
      scrollSpeed: d.scrollSpeed,
      presentationSpeed: d.presentationSpeed,
      encoreStyle: d.encoreStyle || "",
      encoreSpot: d.encoreSpot || "",
      encoreBg: d.encoreBg || "",
    };
  }

  function yesToast(needed, wrote, fb, kind) {
    var src = (wrote && wrote.sourceName) || "sheet";
    if (kind === "board" || kind === "both") {
      if (!needed) return "Saved for this session";
      var boardOk = !!(wrote && (wrote.wroteBoard || (kind === "board" && wrote.ok)));
      var styleOk = !!(
        wrote &&
        (wrote.wroteTheme ||
          wrote.wroteBackground ||
          wrote.wroteSpeeds ||
          wrote.wroteEncore ||
          wrote.wrotePattern)
      );
      if (boardOk && styleOk) return "Board and Style saved to " + src;
      if (boardOk && wrote && wrote.wroteInventory) {
        return "Board items saved to " + src;
      }
      if (boardOk) return "Board saved to " + src;
      if (styleOk) return "Style saved to " + src;
      return "Could not write to sheet — saved for this session";
    }
    if (kind === "system") {
      if (!needed) return "Saved for this session";
      if (wrote && wrote.ok) {
        return "System settings saved to " + src;
      }
      return fb
        ? "System settings saved (fallback)"
        : "System settings saved for this session";
    }
    if (needed) {
      if (wrote && wrote.ok) {
        var bits = [];
        if (wrote.wroteTheme) bits.push("Theme");
        if (wrote.wroteBackground) bits.push("background");
        if (wrote.wrotePattern) bits.push("pattern colors");
        if (wrote.wroteSpeeds) bits.push("speeds");
        if (wrote.wroteEncore) bits.push("Encore");
        var what = bits.length ? bits.join(" and ") : "Style";
        return fb
          ? what + " saved to " + src
          : what + " saved to " + src + " (fallback not written)";
      }
      return fb
        ? "Could not write style to sheet — saved locally"
        : "Could not write style or fallback";
    }
    return fb
      ? "Saved fallback"
      : "Saved for this session (could not write fallback)";
  }

  function persistStyleWrite(prevSnap, nextSnap) {
    var sheet = window.TOKI_MANAGER_SHEET;
    var next = nextSnap || styleSnap(state.draft);
    var prev =
      prevSnap ||
      (state.lastSheet && state.lastSheet.style) ||
      styleSnap(state.committed);
    var themeChanged = !!(next.themeName && next.themeName !== prev.themeName);
    var bgChanged =
      next.background !== prev.background ||
      next.bgColor !== prev.bgColor ||
      next.patternType !== prev.patternType ||
      next.wallpaper !== prev.wallpaper;
    var scrollChanged =
      Number(next.scrollSpeed) !== Number(prev.scrollSpeed);
    var presChanged =
      Number(next.presentationSpeed) !== Number(prev.presentationSpeed);
    var encoreChanged =
      next.encoreStyle !== prev.encoreStyle ||
      next.encoreSpot !== prev.encoreSpot ||
      next.encoreBg !== prev.encoreBg;
    var patternChanged =
      next.patternColor1 !== prev.patternColor1 ||
      next.patternColor2 !== prev.patternColor2;
    if (
      !themeChanged &&
      !bgChanged &&
      !scrollChanged &&
      !presChanged &&
      !encoreChanged &&
      !patternChanged
    ) {
      return Promise.resolve({ needed: false, wrote: null });
    }
    var writer = sheet && (sheet.writeStyle || sheet.writeTheme);
    if (!writer) {
      return Promise.resolve({
        needed: true,
        wrote: { ok: false, error: "Style write not available" },
      });
    }
    var src = dataSource();
    var sheetId =
      (src && src.sheetId) ||
      (state.lastSheet && state.lastSheet.sheetId) ||
      "";
    var payload = { sheetId: sheetId };
    if (themeChanged) payload.theme = next.themeName;
    if (bgChanged) {
      payload.background = next.background;
      payload.bgColor = next.bgColor;
      payload.patternType = next.patternType;
      payload.wallpaper = next.wallpaper === "upload" ? "" : next.wallpaper;
    }
    if (scrollChanged) payload.scrollSpeed = next.scrollSpeed;
    if (presChanged) payload.presentationSpeed = next.presentationSpeed;
    if (encoreChanged) {
      payload.encoreStyle = next.encoreStyle;
      payload.encoreSpot = next.encoreSpot;
      payload.encoreBg = next.encoreBg;
    }
    if (patternChanged) {
      payload.patternColor1 = next.patternColor1;
      payload.patternColor2 = next.patternColor2;
    }
    var req = sheet.writeStyle
      ? sheet.writeStyle(payload)
      : sheet.writeTheme(next.themeName, sheetId);
    return req.then(function (wrote) {
      if (wrote && wrote.ok) {
        if (!state.lastSheet) state.lastSheet = {};
        state.lastSheet.themeName = next.themeName;
        state.lastSheet.style = next;
        if (wrote.sheetId) state.lastSheet.sheetId = wrote.sheetId;
        if (wrote.sourceName) state.lastSheet.sourceName = wrote.sourceName;
        if (patternChanged && next.themeName) {
          var ti;
          for (ti = 0; ti < D.themes.length; ti++) {
            if (D.themes[ti].name === next.themeName) {
              D.themes[ti].patternColor1 = next.patternColor1;
              D.themes[ti].patternColor2 = next.patternColor2;
              break;
            }
          }
        }
      }
      return { needed: true, wrote: wrote };
    });
  }

  function persistDirtyItems(prevSnap) {
    var sheet = window.TOKI_MANAGER_SHEET;
    var b = state.boardDraft;
    if (!sheet || typeof sheet.writeItem !== "function" || !b) {
      return Promise.resolve();
    }
    var prevItems = (prevSnap && prevSnap.items) || [];
    var prevByRow = {};
    var prevByName = {};
    var i;
    for (i = 0; i < prevItems.length; i++) {
      var p = prevItems[i];
      if (!p) continue;
      if (p.row) prevByRow[p.row] = p;
      if (p.name && !prevByName[p.name]) prevByName[p.name] = p;
    }
    var list = b.items || [];
    var chain = Promise.resolve();
    function writeOne(it) {
      if (!it || !String(it.name || "").trim()) return Promise.resolve();
      var prev = (it.row && prevByRow[it.row]) || prevByName[it.name] || null;
      var isNew = !it.row;
      var changed =
        isNew ||
        !!it.imageData ||
        JSON.stringify(inventorySnap(it)) !== JSON.stringify(inventorySnap(prev || {}));
      if (!changed) return Promise.resolve();
      var payload = {
        sheetId: catalogSheetId(),
        menu: boardMenuId(b),
        gid: b.gid || "",
        item: String(it.name || "").trim(),
        price1: it.price1 || "",
        price2: it.price2 || "",
        price3: it.price3 || "",
        subtitle: it.subtitle || "",
        description: it.description || "",
        isNew: it.isNew,
        include: it.include,
        image: it.image || "",
        imageName: it.imageName || "",
        imageData: it.imageData || "",
        menuimg: menuimgPayload(it),
      };
      if (it.row) payload.row = it.row;
      var req = Promise.resolve();
      if (it.row) {
        req = fetch("/api/health", { cache: "no-store" })
          .then(function (res) {
            return res.ok ? res.json() : {};
          })
          .then(function (h) {
            if (h && h.itemUpdate) return;
            throw new Error("Menu Settings needs a restart to update existing items.");
          });
      }
      return req.then(function () {
        return sheet.writeItem(payload).then(function (wrote) {
          if (!wrote || !wrote.ok) {
            throw new Error((wrote && wrote.error) || "item write failed");
          }
          if (wrote.imageCell) it.image = wrote.imageCell;
          if (wrote.row) it.row = wrote.row;
          it.imageData = "";
          return wrote;
        });
      });
    }
    for (i = 0; i < list.length; i++) {
      (function (it) {
        chain = chain.then(function () {
          return writeOne(it);
        });
      })(list[i]);
    }
    return chain;
  }

  function persistBoardWrite(prevSnap, nextSnap) {
    var b = state.boardDraft;
    if (!b || b.kind === "announcements") {
      return Promise.resolve({ needed: false, wrote: null });
    }
    var sheet = window.TOKI_MANAGER_SHEET;
    var next = nextSnap || boardSettingsSnap(b);
    var prev = prevSnap || state.lastBoardSnap[b.id] || null;
    var payload = { gid: b.gid || "" };
    var src = dataSource();
    payload.sheetId =
      (src && src.sheetId) ||
      (state.lastSheet && state.lastSheet.sheetId) ||
      "";
    var changed = false;
    if (!prev || next.menuTitle !== prev.menuTitle) {
      payload.menuTitle = next.menuTitle;
      changed = true;
    }
    if (!prev || next.familyPortrait !== prev.familyPortrait) {
      payload.familyPortrait = next.familyPortrait;
      changed = true;
    }
    if (!prev || next.presentation !== prev.presentation) {
      payload.presentation = next.presentation;
      changed = true;
    }
    if (!prev || next.includeDescriptions !== prev.includeDescriptions) {
      payload.includeDescriptions = next.includeDescriptions;
      changed = true;
    }
    var nextItems = next.items || itemsSnap(b);
    var prevItems = (prev && prev.items) || [];
    var itemsChanged = JSON.stringify(nextItems) !== JSON.stringify(prevItems);
    if (itemsChanged) {
      payload.items = nextItems;
      payload.pruneItems = true;
      changed = true;
    }
    if (!changed) return Promise.resolve({ needed: false, wrote: null });
    if (!sheet || !sheet.writeBoard) {
      return Promise.resolve({
        needed: true,
        wrote: { ok: false, error: "Board write not available" },
      });
    }
    return sheet.writeBoard(payload).then(function (wrote) {
      if (wrote && wrote.ok) {
        if (wrote.itemRows && wrote.itemRows.length && b.items) {
          applyInventoryRowNumbers(b.items, wrote.itemRows);
          if (state.boardCommitted && state.boardCommitted.id === b.id) {
            applyInventoryRowNumbers(state.boardCommitted.items, wrote.itemRows);
          }
          syncOpenItemRowFromBoard();
        }
        rememberBoardSnap(b);
        applyBoardToCatalog(b);
      } else {
        console.warn("Menu Manager board write failed", wrote && wrote.error);
      }
      return { needed: true, wrote: wrote };
    });
  }

  function persistSystemWrite(prevSys) {
    var sheet = window.TOKI_MANAGER_SHEET;
    if (!sheet || !sheet.writeSystem) {
      return Promise.resolve({
        needed: true,
        wrote: { ok: false, error: "System write not available" },
      });
    }
    var payload = {
      sourceId: editorSourceId(),
      sourceName: dataSource().name,
      requireRestart: state.draft.requireRestart,
      systemFont: state.draft.systemFont,
      limitHeavyFilters: state.draft.limitHeavyFilters,
      confirmSave: state.draft.confirmSave,
      refreshTimer: state.draft.refreshTimer,
      debugMode: state.draft.debugMode,
    };
    upsertCatalogChrome(payload.sourceId, chromeSnapFrom(state.draft));
    // Settings workbook id is known to server (different from catalog sheetId).
    // Writing here makes e.g. System Font affect the selected catalog's row.
    return sheet.writeSystem(payload).then(function (wrote) {
      return { needed: true, wrote: wrote };
    });
  }

  function confirmChoice(val, quiet) {
    if (state.screen === "image") {
      if (val === "yes") {
        state.dialog = null;
        renderDialog();
        toast("Saving image…");
        commitImageToItem()
          .then(function () {
            var nextImg = state.pendingLeave;
            state.pendingLeave = null;
            state.confirmLeave = !!nextImg;
            if (nextImg) nextImg();
            else performBackNav("item", state.boardId);
          })
          .catch(function (err) {
            console.warn("Edit Image save failed", err);
            toast("Could not save image");
          });
        return;
      }
      if (val === "no") {
        discardImageDraft();
        state.dialog = null;
        var nextImgNo = state.pendingLeave;
        state.pendingLeave = null;
        state.confirmLeave = !!nextImgNo;
        if (nextImgNo) nextImgNo();
        else performBackNav("item", state.boardId);
        return;
      }
      state.dialog = null;
      state.pendingLeave = null;
      renderDialog();
      return;
    }
    if (state.screen === "item") {
      if (val === "yes") {
        if (quiet) {
          persistBoardOrderQuiet();
          return;
        }
        state.dialog = null;
        renderDialog();
        beginItemSave();
        return;
      }
      if (val === "no") {
        discardItemDraft();
        state.dialog = null;
        var nextItemNo = state.pendingLeave;
        state.pendingLeave = null;
        state.confirmLeave = !!nextItemNo;
        if (nextItemNo) nextItemNo();
        else renderAll();
        return;
      }
      state.dialog = null;
      state.pendingLeave = null;
      renderDialog();
      return;
    }
    if (val === "yes") {
      var onBoard = state.screen === "board" && state.boardDraft;
      var boardPrev = null;
      var boardNext = onBoard ? boardSettingsSnap(state.boardDraft) : null;
      var stylePrev = styleSnap(state.committed);
      var styleNext = styleSnap(state.draft);
      if (state.lastSheet && state.lastSheet.style) {
        stylePrev = Object.assign({}, stylePrev, state.lastSheet.style);
      }
      var wasSystemDirty = systemSettingsDirty();
      var systemPrev = wasSystemDirty
        ? {
            dataSource: state.committed ? state.committed.dataSource : "",
            requireRestart: state.committed ? state.committed.requireRestart : "",
            systemFont: state.committed ? state.committed.systemFont : "",
            limitHeavyFilters: state.committed ? state.committed.limitHeavyFilters : "",
            confirmSave: state.committed ? state.committed.confirmSave : "",
            refreshTimer: state.committed ? state.committed.refreshTimer : "",
            debugMode: state.committed ? state.committed.debugMode : "",
          }
        : null;
      var confirmedSave = !confirmSaveOff();
      clearItemOrderSaveTimer();
      state.pendingItemOrderSave = false;
      if (onBoard) {
        boardPrev =
          state.lastBoardSnap[state.boardDraft.id] ||
          boardSettingsSnap(state.boardCommitted);
        state.boardCommitted = clone(state.boardDraft);
        applyBoardToCatalog(state.boardDraft);
        rememberBoardSnap(state.boardDraft);
      }
      var encoreDirty = encoreFieldsChanged(stylePrev, styleNext);
      var orderDirty = !!(onBoard && itemsOrderChanged(boardPrev, boardNext));
      var boardMetaDirty = !!(onBoard && boardMetaChanged(boardPrev, boardNext));
      var itemsDirty = !!(
        onBoard &&
        JSON.stringify((boardPrev && boardPrev.items) || []) !==
          JSON.stringify((boardNext && boardNext.items) || [])
      );
      state.committed = clone(state.draft);
      state.dialog = null;
      var next = state.pendingLeave;
      state.pendingLeave = null;
      state.confirmLeave = !!next;
      state.persistInFlight = true;
      renderDialog();
      if (next) next();
      else if (!quiet) renderAll();
      var persist = onBoard
        ? persistDirtyItems(boardPrev)
            .then(function () {
              boardNext = boardSettingsSnap(state.boardDraft);
              applyBoardToCatalog(state.boardDraft);
              rememberBoardSnap(state.boardDraft);
              if (state.boardCommitted && state.boardCommitted.id === state.boardDraft.id) {
                state.boardCommitted = clone(state.boardDraft);
              }
              return Promise.all([
                persistBoardWrite(boardPrev, boardNext),
                persistStyleWrite(stylePrev, styleNext),
              ]);
            })
            .then(function (pair) {
            var board = pair[0] || {};
            var style = pair[1] || {};
            var wrote = Object.assign({}, style.wrote || {}, board.wrote || {});
            if (board.wrote && board.wrote.ok) wrote.wroteBoard = true;
            return {
              needed: !!(board.needed || style.needed),
              wrote: wrote,
              kind: "both",
            };
          })
        : wasSystemDirty
        ? persistSystemWrite(systemPrev).then(function (sys) {
            return persistFallback().then(function (fb) {
              return {
                needed: !!(sys && sys.needed),
                wrote: sys && sys.wrote,
                fb: fb,
                kind: "system",
              };
            });
          })
        : persistStyleWrite(stylePrev, styleNext);
      persist
        .then(function (result) {
          if (onBoard) {
            return {
              needed: !!(result && result.needed),
              wrote: result && result.wrote,
              fb: false,
              kind: "both",
            };
          }
          if (wasSystemDirty) {
            // system already attached fb/kind in the branch above
            return result;
          }
          return persistFallback().then(function (fb) {
            return {
              needed: !!(result && result.needed),
              wrote: result && result.wrote,
              fb: fb,
              kind: "style",
            };
          });
        })
        .then(function (out) {
          state.persistInFlight = false;
          if (out && out.wrote && out.wrote.ok) state.sheetDirty = false;
          showSaveOutcome(out, {
            onBoard: onBoard,
            confirmed: confirmedSave,
            encoreDirty: encoreDirty,
            orderDirty: orderDirty,
            boardMetaDirty: boardMetaDirty || itemsDirty,
          });
        })
        .catch(function (err) {
          state.persistInFlight = false;
          console.warn("Menu Manager save failed", err);
          showSaveNotice(
            onBoard
              ? "Could not write board to sheet — saved for this session"
              : wasSystemDirty
              ? "Could not write system settings to sheet — saved for this session"
              : "Could not write style to sheet — saved for this session"
          );
        });
      return;
    }
    if (val === "no") {
      if (state.screen === "board" && state.boardCommitted) {
        state.boardDraft = clone(state.boardCommitted);
        applyBoardToCatalog(state.boardCommitted);
      }
      state.draft = clone(state.committed);
      state.dialog = null;
      applyTheme();
      var nextNo = state.pendingLeave;
      state.pendingLeave = null;
      if (nextNo) nextNo();
      else renderAll();
      return;
    }
    state.dialog = null;
    state.pendingLeave = null;
    renderDialog();
  }

  function gateNewTheme() {
    toast("Theme Authoring Coming Soon");
  }

  function openSheet() {
    var src = dataSource();
    var url = src.sheetId
      ? "https://docs.google.com/spreadsheets/d/" + src.sheetId + "/edit"
      : D.settingsSheetUrl;
    window.open(url, "_blank", "noopener");
  }

  function previewPresentation() {
    if (state.screen === "board" && state.boardDraft && state.boardDraft.presentation) {
      return state.boardDraft.presentation;
    }
    return state.draft.presentation;
  }

  function previewMotionStyle() {
    var TM = window.TOKI_MOTION;
    var mode = previewPresentation();
    if (TM && typeof TM.styleForMode === "function") {
      return TM.styleForMode(mode, D.motionStyles);
    }
    return TM ? TM.styleByMode(mode) : D.motionDefaults;
  }

  function previewSpeed() {
    return Number(state.draft.presentationSpeed);
  }

  /* 0 parks. 1–5 scale Beta Motion times (3 = 1×). */
  function presentationMotionOn(speed) {
    var n = speed != null ? Number(speed) : Number(state.draft.presentationSpeed);
    return n > 0;
  }

  function motionPhases() {
    var TM = window.TOKI_MOTION;
    var mode = previewPresentation();
    var style = previewMotionStyle();
    if (TM && TM.scaleStyleTimes && presentationMotionOn()) {
      style = TM.scaleStyleTimes(style, previewSpeed()) || style;
    }
    var encore = mode === "encore";
    var kb = mode === "kenburns";
    var punchIn = style.punchIn != null ? style.punchIn : 3.4;
    var punchOut = style.punchOut != null ? style.punchOut : 0.45;
    var holdRaw = style.hold != null ? style.hold : 1;
    var hold = holdRaw;
    var veilIn = encore && TM ? TM.encoreVeilIn(punchIn) : Math.min(0.45, punchIn);
    return {
      punchIn: punchIn,
      hold: hold,
      punchOut: punchOut,
      veilIn: veilIn,
      opacityDur: TM ? TM.OPACITY_DUR : 0.45,
      zoomMin: kb ? 0.93 : 1,
      zoomMax: kb ? 1 : encore ? (style.zoomTo || 1.24) : 1,
      paused: !presentationMotionOn(),
    };
  }

  function previewAfter(ms, gen, fn) {
    var id = setTimeout(function () {
      if (gen !== previewCtl.gen) return;
      fn();
    }, ms);
    previewCtl.timers.push(id);
  }

  function spotlightHex(item) {
    if (state.draft.encoreSpot === "highlight") {
      return item && item.isNew ? currentTheme().special : currentTheme().highlight;
    }
    return "#000000";
  }

  function armHighlightClock(sec) {
    var s = sec > 0 ? sec : 0.45;
    document.documentElement.style.setProperty("--motion-highlight", s + "s");
  }

  function highlightColorForItem(item) {
    return item && item.isNew ? currentTheme().special : currentTheme().highlight;
  }

  function syncPreviewNums(index, fadeOut) {
    var nums = els.app.querySelectorAll(".preview-nums [data-n]");
    var items = D.previewItems;
    var item = items[index];
    var color = highlightColorForItem(item);
    var preview = els.app.querySelector(".preview");
    if (preview) preview.style.setProperty("--item-highlight", color);
    for (var i = 0; i < nums.length; i++) {
      var n = Number(nums[i].getAttribute("data-n"));
      var neu = !!(items[n] && items[n].isNew);
      nums[i].classList.toggle("is-on", !fadeOut && n === index);
      nums[i].classList.toggle("is-new", !fadeOut && n === index && neu);
    }
  }

  function encoreStageEl() {
    return els.app.querySelector("#family-portrait-stage");
  }

  function encoreNeedsFill() {
    if (previewPresentation() !== "encore") return false;
    var stage = encoreStageEl();
    if (!stage || stage.hidden) return true;
    return !stage.querySelector(".family-portrait-item");
  }

  /** Fire Stick Silk cannot resolve 100cqi. Measure the preview box in px. */
  function syncEncoreLayout(preview) {
    preview = preview || (els.app && els.app.querySelector(".preview"));
    if (!preview) return;
    var h = preview.clientHeight || 0;
    var w = preview.clientWidth || 0;
    if (h < 2 || w < 2) return;
    var gutter = 103.332 * (h / 300);
    var boxW = Math.max(1, w - gutter);
    var scale = Math.max(boxW / 848.1, h / 1080);
    preview.style.setProperty("--encore-gutter", gutter + "px");
    preview.style.setProperty("--encore-box-w", boxW + "px");
    preview.style.setProperty("--encore-scale", String(scale));
    preview.style.setProperty("--plate-w", Math.min(boxW, h * 1.5) + "px");
    preview.style.setProperty("--plate-h", Math.min(boxW, h * 1.5) * (2 / 3) + "px");
  }

  function fillPortraitGrid() {
    var TM = window.TOKI_MOTION;
    var stage = encoreStageEl();
    if (!TM || !stage) return null;
    var items = (D.previewItems || []).map(function (it, i) {
      return { src: it.src, isNew: !!it.isNew, itemIndex: i };
    });
    previewCtl.lattice = TM.fillEncorePlates(stage, items, {
      stickerOverlay: PREVIEW_STICKER,
    });
    fitPreviewPlates(stage, previewCtl.lattice);
    return previewCtl.lattice;
  }

  /** Silk clips a 1500×1000 layout box inside the 848 stage. Size the img
      to the lattice scale so the border box is the visible plate. */
  function fitPreviewPlates(stage, layout) {
    if (!stage) return;
    var s = layout && Number(layout.scale);
    if (!(s > 0)) s = 0.4;
    var w = Math.round(1500 * s);
    var h = Math.round(1000 * s);
    var imgs = stage.querySelectorAll(".family-portrait-item");
    var i;
    for (i = 0; i < imgs.length; i++) {
      imgs[i].style.width = w + "px";
      imgs[i].style.height = h + "px";
      imgs[i].style.maxWidth = "none";
      imgs[i].style.transform = "translate(-50%, -50%)";
    }
  }

  function applyEncoreChrome(item) {
    var TM = window.TOKI_MOTION;
    var stage = encoreStageEl();
    if (!TM || !stage) return;
    TM.applyEncoreChrome(stage, {
      type: state.draft.encoreStyle,
      colorMode: state.draft.encoreSpot === "highlight" ? "highlight" : "black",
      veilHex: spotlightHex(item),
    });
  }

  function applyPreviewItem(item) {
    var img = els.app.querySelector("#hero") || els.app.querySelector(".preview-food");
    var sticker = els.app.querySelector(".preview-sticker");
    if (img) img.src = item.src;
    if (sticker) sticker.hidden = !item.isNew;
    if (previewPresentation() === "encore") {
      applyEncoreChrome(item);
      var stageAct = encoreStageEl();
      if (
        window.TOKI_MOTION &&
        typeof TOKI_MOTION.setEncoreActiveSticker === "function" &&
        stageAct
      ) {
        TOKI_MOTION.setEncoreActiveSticker(stageAct, state.previewIndex || 0);
      }
    }
    armHighlightClock(motionPhases().punchOut);
    syncPreviewNums(state.previewIndex || 0, false);
  }

  function scrollPxPerSec() {
    return 28 * 0.45 * (Number(state.draft.scrollSpeed) || 0);
  }

  function stepPattern(dt) {
    var wrap = els.app.querySelector(".preview-pattern");
    var track = wrap && wrap.querySelector(".preview-pattern-track");
    if (!track || !wrap || wrap.hidden) return;
    var speed = scrollPxPerSec();
    var period = 186;
    if (speed > 0) {
      previewCtl.stripeY = (previewCtl.stripeY + speed * dt) % period;
    }
    track.style.transform =
      "rotate(-51.5deg) translate3d(0," + previewCtl.stripeY + "px,0)";
  }

  function stepWallpaper(dt) {
    var wrap = els.app.querySelector(".preview-wallpaper");
    if (!wrap || wrap.hidden) return;
    var speed = scrollPxPerSec();
    if (speed <= 0) return;
    if (!previewCtl.wp) {
      var a = wrap.querySelector(".preview-wp-a");
      var b = wrap.querySelector(".preview-wp-b");
      if (!a || !b) return;
      previewCtl.wp = {
        layers: [
          { el: a, x: 0, on: true },
          { el: b, x: 0, on: false },
        ],
        fading: false,
      };
      a.classList.add("is-on");
      b.classList.remove("is-on");
    }
    var wp = previewCtl.wp;
    var i;
    for (i = 0; i < wp.layers.length; i++) {
      if (!wp.layers[i].on && wp.fading) continue;
      wp.layers[i].x -= speed * dt;
      wp.layers[i].el.style.transform =
        "translate3d(" + wp.layers[i].x + "px,0,0)";
    }
    var active = wp.layers[0].on ? wp.layers[0] : wp.layers[1];
    var other = wp.layers[0].on ? wp.layers[1] : wp.layers[0];
    var limit = -Math.max(80, wrap.offsetWidth * 0.35);
    if (!wp.fading && active.x < limit) {
      wp.fading = true;
      other.x = 0;
      other.el.style.transform = "translate3d(0,0,0)";
      other.el.style.transition = "opacity 0.45s ease";
      active.el.style.transition = "opacity 0.45s ease";
      other.el.classList.add("is-on");
      active.el.classList.remove("is-on");
      other.on = true;
      active.on = false;
      previewAfter(480, previewCtl.gen, function () {
        wp.fading = false;
        other.el.style.transition = "";
        active.el.style.transition = "";
      });
    }
  }

  function startPreviewRaf() {
    var last = 0;
    var gen = previewCtl.gen;
    function tick(ts) {
      if (gen !== previewCtl.gen) return;
      if (!last) last = ts;
      var dt = Math.min(48, ts - last) / 1000;
      last = ts;
      stepPattern(dt);
      stepWallpaper(dt);
      previewCtl.raf = requestAnimationFrame(tick);
    }
    previewCtl.raf = requestAnimationFrame(tick);
  }

  function phaseTarget(phase, phases, mode) {
    if (phase === "out") {
      return {
        opacity: 0,
        zoom: mode === "slideshow" ? 1 : phases.zoomMin,
        dur: phases.punchOut,
      };
    }
    if (phase === "hold") {
      return {
        opacity: 1,
        zoom: mode === "slideshow" ? 1 : phases.zoomMax,
        dur: phases.hold,
      };
    }
    return {
      opacity: 1,
      zoom: mode === "slideshow" ? 1 : phases.zoomMax,
      dur: phases.punchIn,
    };
  }

  function schedulePhaseEnd(gen) {
    previewAfter(previewCtl.phaseDur * 1000, gen, function () {
      advancePhase(gen);
    });
  }

  function beginPhase(phase, gen, snap) {
    if (gen !== previewCtl.gen) return;
    var phases = motionPhases();
    var mode = previewPresentation();
    var encore = mode === "encore";
    var TM = window.TOKI_MOTION;
    var zoomTo = TM && TM.ENCORE ? TM.ENCORE.zoomTo : 1.24;
    previewCtl.phase = phase;
    var tgt = phaseTarget(phase, phases, mode);

    if (phases.paused) {
      previewCtl.phaseDur = 0;
      if (encore && TM) {
        var stagePark = encoreStageEl();
        var originPark = TM.encoreSlotOrigin(stagePark, state.previewIndex || 0);
        if (originPark) TM.setEncoreZoomOrigin(stagePark, originPark.x, originPark.y);
        else TM.setPlaneCenterOrigin(stagePark);
        if (state.holdGrid) {
          TM.encoreSnap(stagePark, {
            zoom: 1,
            pinch: 0,
            dimmed: false,
            opacity: 1,
            itemIndex: state.previewIndex || 0,
          });
        } else {
          TM.encoreSnap(stagePark, {
            zoom: zoomTo,
            pinch: TOKI_MOTION.encoreHolePinchPx(state.draft.encoreStyle),
            dimmed: true,
            opacity: 1,
            itemIndex: state.previewIndex || 0,
          });
        }
      } else {
        var platePark = els.app.querySelector("#hero-plate");
        if (TM && platePark) {
          TM.heroSnap(platePark, 1, tgt.zoom);
        }
      }
      armHighlightClock(phases.punchOut);
      syncPreviewNums(state.previewIndex || 0, false);
      return;
    }

    /* Encore in/out/hold: TOKI_MOTION.runEncoreBlock. Hero: runHeroBlock. */
  }

  function advancePhase(gen) {
    if (gen !== previewCtl.gen) return;
    if (previewCtl.phase === "in") {
      beginPhase("hold", gen, false);
      return;
    }
    if (previewCtl.phase === "hold") {
      beginPhase("out", gen, false);
      return;
    }
    runPreviewBlock(previewCtl.itemIndex + 1, gen);
  }

  function retargetMotion() {
    /* Same as a board reload: kill the running block and punch in again
       at the new tempo. Mid-run retarget used to keep zoom at 1.24 so
       speed tiles looked like they did nothing. */
    startPreviewCycle();
  }

  function runPreviewBlock(index, gen) {
    if (gen !== previewCtl.gen) return;
    var items = D.previewItems;
    if (!items.length) return;
    var i = ((index % items.length) + items.length) % items.length;
    state.previewIndex = i;
    previewCtl.itemIndex = i;
    applyPreviewItem(items[i]);
    if (previewPresentation() === "encore") {
      var TM = window.TOKI_MOTION;
      var stage = encoreStageEl();
      if (!TM || !stage) return;
      applyEncoreChrome(items[i]);
      if (!presentationMotionOn()) {
        var originP = TM.encoreSlotOrigin(stage, i);
        if (originP) TM.setEncoreZoomOrigin(stage, originP.x, originP.y);
        TM.encoreSnap(stage, {
          zoom: TM.ENCORE.zoomTo,
          pinch: TOKI_MOTION.encoreHolePinchPx(state.draft.encoreStyle),
          dimmed: !state.holdGrid,
          opacity: 1,
          itemIndex: i,
        });
        syncPreviewNums(i, false);
        return;
      }
      var first = !!previewCtl.encoreFirst;
      previewCtl.encoreFirst = false;
      previewCtl.phase = "in";
      TM.runEncoreBlock(
        stage,
        {
          first: first,
          last: false,
          origin: TM.encoreSlotOrigin(stage, i),
          itemIndex: i,
          pinchPx: TOKI_MOTION.encoreHolePinchPx(state.draft.encoreStyle),
          zoomTo: TM.ENCORE.zoomTo,
          fpsCap: TOKI_MOTION.encoreFpsCap(
            state.draft.encoreStyle,
            state.draft.limitHeavyFilters !== "no"
          ),
          style: previewMotionStyle(),
          speed: previewSpeed(),
        },
        {
          afterMs: function (ms, fn) {
            previewAfter(ms, gen, fn);
          },
          onEntrance: function () {
            previewCtl.phase = "in";
            syncPreviewNums(i, false);
          },
          onHold: function () {
            previewCtl.phase = "hold";
          },
          onExit: function () {
            previewCtl.phase = "out";
            syncPreviewNums(i, true);
          },
          onDone: function () {
            if (gen !== previewCtl.gen) return;
            runPreviewBlock(i + 1, gen);
          },
        }
      );
      return;
    }
    var TM = window.TOKI_MOTION;
    var plate = els.app.querySelector("#hero-plate");
    if (!TM || !plate) return;
    var style = previewMotionStyle();
    if (!presentationMotionOn()) {
      TM.heroSnap(plate, 1, style.zoomMax);
      syncPreviewNums(i, false);
      return;
    }
    previewCtl.phase = "in";
    TM.runHeroBlock(plate, style, {
      speed: previewSpeed(),
      afterMs: function (ms, fn) {
        previewAfter(ms, gen, fn);
      },
      onEntrance: function () {
        previewCtl.phase = "in";
        syncPreviewNums(i, false);
      },
      onHold: function () {
        previewCtl.phase = "hold";
      },
      onExit: function () {
        previewCtl.phase = "out";
        syncPreviewNums(i, true);
      },
      onDone: function () {
        if (gen !== previewCtl.gen) return;
        runPreviewBlock(i + 1, gen);
      },
    });
  }

  function parkPreviewStill() {
    stopPreviewCycle();
    var items = D.previewItems;
    var item = items[state.previewIndex || 0] || items[0];
    if (item) applyPreviewItem(item);
    if (previewPresentation() === "encore") {
      fillPortraitGrid();
      var stageStill = encoreStageEl();
      if (window.TOKI_MOTION && stageStill) {
        window.TOKI_MOTION.encoreSnap(stageStill, {
          zoom: 1,
          pinch: 0,
          dimmed: false,
          opacity: 1,
          itemIndex: state.previewIndex || 0,
        });
      }
      return;
    }
    var plate = els.app.querySelector("#hero-plate");
    if (window.TOKI_MOTION && plate) {
      window.TOKI_MOTION.heroSnap(plate, 1, 1);
    }
  }

  /* Sync only the preview container's theme-dependent styles and layer visibility.
     Does NOT touch #hero-plate / .hero-anim / .preview-sticker DOM nodes.
     This is the core guardrail so KB/Slideshow transitions survive row updates,
     theme changes, and picker applies (see MOTION_GLOSSARY 3/4 and ticket). */
  function syncPreviewFromDraft(preview) {
    if (!preview) return;
    syncEncoreLayout(preview);
    var d = state.draft;
    var encore = previewPresentation() === "encore";
    preview.classList.toggle("is-encore", encore);
    var fill = encore
      ? roleHex(d.encoreBg)
      : d.background === "pattern" || d.background === "wallpaper"
        ? roleHex(d.bgColor || "main")
        : roleHex(d.background);
    preview.style.setProperty("--preview-fill", fill);
    preview.style.setProperty("--pattern-a", bakePatternHex(roleHex(d.patternColor1)));
    preview.style.setProperty("--pattern-b", bakePatternHex(roleHex(d.patternColor2)));
    var pat = preview.querySelector(".preview-pattern");
    var wpp = preview.querySelector(".preview-wallpaper");
    if (pat) {
      pat.hidden = encore || d.background !== "pattern";
      pat.style.display = pat.hidden ? "none" : "";
    }
    if (wpp) {
      wpp.hidden = encore || d.background !== "wallpaper";
      wpp.style.display = wpp.hidden ? "none" : "";
    }
    // Sync wallpaper image srcs from draft so the selector immediately updates
    // the mini-display preview (both crossfade layers) before any Save.
    // wallpaperSrc/wallpaperFallback always return the -sm variant for preview.
    if (wpp) {
      var wpSrc = wallpaperSrc();
      var wpFb = wallpaperFallback();
      var wpImgs = wpp.querySelectorAll(".preview-wp-img");
      for (var wi = 0; wi < wpImgs.length; wi++) {
        var img = wpImgs[wi];
        if (wpSrc && img.getAttribute("src") !== wpSrc) {
          img.setAttribute("src", wpSrc);
        }
        if (wpFb) {
          img.setAttribute("data-fallback", wpFb);
        } else if (img.hasAttribute("data-fallback")) {
          img.removeAttribute("data-fallback");
        }
      }
    }
    if (pat && !pat.hidden) {
      var track = pat.querySelector(".preview-pattern-track");
      if (track) {
        track.style.transform =
          "rotate(-51.5deg) translate3d(0," + previewCtl.stripeY + "px,0)";
      }
    }
    var stage = preview.querySelector("#family-portrait-stage");
    if (stage) {
      stage.hidden = !encore;
      if (encore) stage.setAttribute("aria-hidden", "false");
    }
  }

  /* Re-render only the controls under style screen. Leaves the preview plate/anim
     subtree in the DOM so running fade+zoom (or encore rig) is never remounted. */
  function refreshStyleRows() {
    if (state.screen !== "style") return;
    var existing = els.app.querySelector(".screen-style");
    if (!existing) return;
    var preview = existing.querySelector(".preview");
    syncPreviewFromDraft(preview);
    var scroll = existing.querySelector("#style-scroll");
    if (scroll) {
      scroll.innerHTML = '<div class="rows bounce-inner">' + styleRows() + '</div>';
    }
    restorePillScroll();
    bindWpFallback();
    bindPillDrag();
  }

  function startItemMiniMotion() {
    var bgOnly = !!previewCtl.raf && !previewCtl.phase;
    if (!bgOnly) {
      stopPreviewCycle();
      previewCtl.wp = null;
      startPreviewRaf();
    } else {
      previewCtl.wp = null;
    }
  }

  function startPreviewCycle() {
    stopPreviewCycle();
    previewCtl.encoreFirst = true;
    previewCtl.lattice = null;
    syncEncoreLayout();
    if (previewPresentation() === "encore") {
      fillPortraitGrid();
    }
    var gen = previewCtl.gen;
    previewCtl.wp = null;
    bindPillDrag();
    startPreviewRaf();
    runPreviewBlock(state.previewIndex || 0, gen);
  }

  function stopPreviewCycle() {
    previewCtl.gen += 1;
    previewCtl.timers.forEach(clearTimeout);
    previewCtl.timers = [];
    if (previewCtl.raf) cancelAnimationFrame(previewCtl.raf);
    previewCtl.raf = 0;
    previewCtl.phase = null;
    previewCtl.wp = null;
    if (window.TOKI_MOTION && window.TOKI_MOTION.cancelEncoreZoomStepper) {
      window.TOKI_MOTION.cancelEncoreZoomStepper();
    }
  }

  function bindPillDrag() {
    var rows = els.app.querySelectorAll(".pills");
    for (var i = 0; i < rows.length; i++) {
      (function (el) {
        if (el.getAttribute("data-drag")) return;
        el.setAttribute("data-drag", "1");
        var down = false;
        var dragging = false;
        var suppressClick = false;
        var pid = null;
        var x0 = 0;
        var sl = 0;
        var THRESH = 14;
        el.addEventListener("pointerdown", function (e) {
          if (e.pointerType === "touch") return;
          down = true;
          dragging = false;
          pid = e.pointerId;
          x0 = e.clientX;
          sl = el.scrollLeft;
        });
        el.addEventListener("pointermove", function (e) {
          if (!down) return;
          var dx = e.clientX - x0;
          if (!dragging && Math.abs(dx) >= THRESH) {
            dragging = true;
            suppressClick = true;
            el.classList.add("is-dragging");
            try {
              el.setPointerCapture(e.pointerId);
            } catch (err) {}
          }
          if (dragging) el.scrollLeft = sl - dx;
        });
        function endDrag(e) {
          if (pid != null && e && e.pointerId !== pid && e.type !== "pointercancel") {
            return;
          }
          if (dragging) {
            rememberPillScroll();
            try {
              if (pid != null) el.releasePointerCapture(pid);
            } catch (err) {}
          }
          down = false;
          dragging = false;
          pid = null;
          el.classList.remove("is-dragging");
        }
        el.addEventListener("pointerup", endDrag);
        el.addEventListener("pointercancel", endDrag);
        el.addEventListener(
          "click",
          function (e) {
            if (suppressClick) {
              e.preventDefault();
              e.stopPropagation();
              suppressClick = false;
            }
          },
          true
        );
      })(rows[i]);
    }
  }

  function bindItemReorder() {
    if (isAnnouncementsBoard(state.boardDraft)) return;
    var board = els.app.querySelector(".screen-board");
    if (!board || board.getAttribute("data-reorder")) return;
    board.setAttribute("data-reorder", "1");
    board.addEventListener("pointerdown", onItemHandleDown);
  }

  function onItemHandleDown(e) {
    if (state.itemDragging) return;
    if (e.button != null && e.button !== 0) return;
    var handle = e.target.closest(".item-handle");
    if (!handle) return;
    var row = handle.closest(".item-row");
    var list = document.getElementById("board-item-list");
    if (!row || !list || !list.contains(row) || row.classList.contains("item-placeholder")) {
      return;
    }
    e.preventDefault();
    startItemDrag(e, list, row, handle);
  }

  function clearItemDragStyles(row) {
    if (!row) return;
    row.classList.remove("is-dragging", "is-delete-candidate");
    row.style.position = "";
    row.style.width = "";
    row.style.height = "";
    row.style.left = "";
    row.style.top = "";
    row.style.zIndex = "";
    row.style.margin = "";
    row.style.transformOrigin = "";
  }

  function startItemDrag(e, list, row, handle) {
    var from = Number(row.getAttribute("data-item"));
    if (!isFinite(from)) return;
    var scroll = document.getElementById("board-scroll");
    var board = els.app.querySelector(".screen-board");
    var host = els.app;
    var startRect = row.getBoundingClientRect();
    var start = clientToDevicePoint(startRect.left, startRect.top);
    var grab = clientToDevicePoint(e.clientX, e.clientY);
    var offsetX = grab.x - start.x;
    var offsetY = grab.y - start.y;
    var scale = start.scale || 1;
    var y0 = e.clientY;
    var x0 = e.clientX;
    var pid = e.pointerId;
    var dragging = false;
    var ended = false;
    var placeholder = null;
    var lastX = e.clientX;
    var lastY = e.clientY;
    var autoDir = 0;
    var raf = 0;
    var THRESH = 6;
    var footer = board && board.querySelector(".footer-add-item");
    var deleteArmed = false;
    state.itemDragging = true;
    state.pendingDeleteIndex = null;
    try {
      handle.setPointerCapture(pid);
    } catch (err) {}

    function placeAt(clientX, clientY) {
      lastX = clientX;
      lastY = clientY;
      var p = clientToDevicePoint(clientX, clientY);
      row.style.left = p.x - offsetX + "px";
      row.style.top = p.y - offsetY + "px";
      if (!placeholder) return;
      var statics = [];
      var nodes = list.querySelectorAll(".item-row");
      var i;
      for (i = 0; i < nodes.length; i++) {
        if (nodes[i] !== row && nodes[i] !== placeholder) statics.push(nodes[i]);
      }
      var insertBefore = null;
      for (i = 0; i < statics.length; i++) {
        var rr = statics[i].getBoundingClientRect();
        if (clientY < rr.top + rr.height / 2) {
          insertBefore = statics[i];
          break;
        }
      }
      if (insertBefore) {
        if (placeholder.nextSibling !== insertBefore) insertBefore.before(placeholder);
      } else if (statics.length) {
        var last = statics[statics.length - 1];
        if (last.nextSibling !== placeholder) last.after(placeholder);
      }
      updateDeleteArm();
    }

    function updateDeleteArm() {
      if (!footer || !handle || !board) {
        deleteArmed = false;
        return false;
      }
      var fr = footer.getBoundingClientRect();
      var hr = handle.getBoundingClientRect();
      var handleMid = hr.top + hr.height / 2;
      var trigger = fr.top + fr.height * 0.5;
      deleteArmed = handleMid >= trigger;
      board.classList.toggle("is-delete-armed", deleteArmed);
      row.classList.toggle("is-delete-candidate", deleteArmed);
      return deleteArmed;
    }

    function edgeScroll(clientY) {
      if (!scroll) {
        autoDir = 0;
        return;
      }
      var box = scroll.getBoundingClientRect();
      var edge = 20;
      var max = scroll.scrollHeight - scroll.clientHeight;
      if (clientY < box.top + edge && scroll.scrollTop > 0) autoDir = -10;
      else if (clientY > box.bottom - edge && scroll.scrollTop < max - 1) autoDir = 10;
      else autoDir = 0;
      if (autoDir && !raf) raf = requestAnimationFrame(tick);
    }

    function tick() {
      raf = 0;
      if (!dragging || ended) return;
      if (autoDir && scroll) {
        scroll.scrollTop += autoDir;
        placeAt(lastX, lastY);
      }
      if (autoDir) raf = requestAnimationFrame(tick);
    }

    function begin() {
      if (dragging) return;
      dragging = true;
      document.documentElement.classList.add("is-item-dragging");
      if (board) board.classList.add("is-item-dragging");
      placeholder = document.createElement("div");
      placeholder.className = "item-row item-placeholder";
      placeholder.style.height = startRect.height / scale + "px";
      row.after(placeholder);
      row.classList.add("is-dragging");
      row.style.position = "absolute";
      row.style.width = startRect.width / scale + "px";
      row.style.height = startRect.height / scale + "px";
      row.style.left = start.x + "px";
      row.style.top = start.y + "px";
      row.style.zIndex = "20";
      row.style.margin = "0";
      row.style.transformOrigin = offsetX + "px " + offsetY + "px";
      if (host) host.appendChild(row);
      try {
        handle.setPointerCapture(pid);
      } catch (err) {}
    }

    function move(ev) {
      if (ended || ev.pointerId !== pid) return;
      if (!dragging) {
        if (Math.abs(ev.clientY - y0) < THRESH && Math.abs(ev.clientX - x0) < THRESH) {
          return;
        }
        begin();
      }
      ev.preventDefault();
      placeAt(ev.clientX, ev.clientY);
      edgeScroll(ev.clientY);
    }

    function onSelectStart(ev) {
      ev.preventDefault();
    }

    function finish(commit, ev) {
      if (ended) return;
      if (ev && ev.pointerId != null && ev.pointerId !== pid) return;
      ended = true;
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
      document.removeEventListener("selectstart", onSelectStart, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("blur", onBlur);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try {
        handle.releasePointerCapture(pid);
      } catch (err) {}
      if (row.parentNode && row.parentNode !== list) {
        row.parentNode.removeChild(row);
      }
      row.classList.remove("is-delete-candidate");
      if (board) board.classList.remove("is-delete-armed");
      if (commit && dragging && deleteArmed && state.boardDraft && state.boardDraft.items) {
        if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
        list.innerHTML = itemListHtml(state.boardDraft.items);
        state.pendingDeleteIndex = from;
        state.dialog = "item-delete";
        renderDialog();
      } else if (commit && dragging && placeholder && state.boardDraft && state.boardDraft.items) {
        var items = state.boardDraft.items.slice();
        var next = [];
        var kids = Array.prototype.slice.call(list.children);
        var k;
        for (k = 0; k < kids.length; k++) {
          var el = kids[k];
          if (el === placeholder) next.push(items[from]);
          else if (el.classList.contains("item-row") && el !== row) {
            next.push(items[Number(el.getAttribute("data-item"))]);
          }
        }
        if (next.length === items.length) state.boardDraft.items = next;
        if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
        list.innerHTML = itemListHtml(state.boardDraft.items);
        var orderChanged = itemsOrderChanged({ items: items }, { items: next });
        if (orderChanged && confirmSaveOff()) {
          state.pendingLeave = null;
          scheduleItemOrderSave();
        }
      } else {
        if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
        if (dragging && state.boardDraft) {
          list.innerHTML = itemListHtml(state.boardDraft.items);
        } else {
          if (host && row.parentNode === host) list.appendChild(row);
          clearItemDragStyles(row);
        }
      }
      document.documentElement.classList.remove("is-item-dragging");
      if (board) board.classList.remove("is-item-dragging");
      dragging = false;
      state.itemDragging = false;
    }

    function onUp(ev) {
      finish(true, ev);
    }
    function onCancel(ev) {
      finish(false, ev);
    }
    function onBlur() {
      finish(false);
    }
    function onMouseMove(ev) {
      if (ended) return;
      if (dragging && ev.buttons != null && !(ev.buttons & 1)) {
        finish(true, ev);
        return;
      }
      if (!dragging) {
        if (Math.abs(ev.clientY - y0) < THRESH && Math.abs(ev.clientX - x0) < THRESH) {
          return;
        }
        begin();
      }
      placeAt(ev.clientX, ev.clientY);
      edgeScroll(ev.clientY);
    }
    function onMouseUp(ev) {
      if (ev.button != null && ev.button !== 0) return;
      finish(true, ev);
    }

    document.addEventListener("pointermove", move, { capture: true, passive: false });
    document.addEventListener("pointerup", onUp, { capture: true });
    document.addEventListener("pointercancel", onCancel, { capture: true });
    document.addEventListener("selectstart", onSelectStart, { capture: true });
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("blur", onBlur);
  }

  function renderAll() {
    renderScreen();
    renderPicker();
    renderDialog();
  }

  function writeHash(shouldPush) {
    var hash = "#/";
    if (state.screen === "system") hash = "#/system";
    else if (state.screen === "menu") hash = "#/menu";
    else if (state.screen === "style") hash = "#/menu/style";
    else if (state.screen === "image") {
      hash =
        "#/menu/board/" +
        state.boardId +
        "/item/" +
        encodeURIComponent(String(state.itemKey || "new")) +
        "/image";
    }
    else if (state.screen === "item") {
      hash =
        "#/menu/board/" +
        state.boardId +
        "/item/" +
        encodeURIComponent(String(state.itemKey || "new"));
    }
    else if (state.screen === "board") hash = "#/menu/board/" + state.boardId;
    var href = location.pathname + location.search + hash;
    if (location.hash !== hash) {
      if (shouldPush) {
        history.pushState(null, "", href);
      } else {
        history.replaceState(null, "", href);
      }
    }
  }

  function queryParams() {
    var raw = (location.hash || "").replace(/^#/, "");
    var qi = raw.indexOf("?");
    if (qi >= 0) return new URLSearchParams(raw.slice(qi + 1));
    return new URLSearchParams(location.search || "");
  }

  function parseScreenFromHash() {
    var raw = (location.hash || "#/").replace(/^#/, "");
    var qi = raw.indexOf("?");
    if (qi >= 0) raw = raw.slice(0, qi);
    var parts = raw.split("/").filter(Boolean);
    if (parts[0] === "system") {
      return { screen: "system", boardId: null };
    } else if (parts[0] === "menu" && parts[1] === "style") {
      return { screen: "style", boardId: null };
    } else if (
      parts[0] === "menu" &&
      parts[1] === "board" &&
      parts[3] === "item" &&
      parts[5] === "image"
    ) {
      return {
        screen: "image",
        boardId: parts[2] || "1",
        itemKey: decodeURIComponent(parts[4] || "new"),
      };
    } else if (parts[0] === "menu" && parts[1] === "board" && parts[3] === "item") {
      return {
        screen: "item",
        boardId: parts[2] || "1",
        itemKey: decodeURIComponent(parts[4] || "new"),
      };
    } else if (parts[0] === "menu" && parts[1] === "board") {
      return { screen: "board", boardId: parts[2] || "1", itemKey: null };
    } else if (parts[0] === "menu") {
      return { screen: "menu", boardId: null };
    } else {
      return { screen: "home", boardId: null };
    }
  }

  function flushPendingTip() {
    var tip = state.pendingTip;
    if (!tip) return;
    state.pendingTip = null;
    setTimeout(function () {
      if (tip === "stack") {
        showFamilyPortraitTooltip();
        showEncoreTooltip();
      } else if (tip === "family") {
        showFamilyPortraitTooltip();
      } else if (tip === "encore") {
        showEncoreTooltip();
      } else if (tip === "restart" || tip === "restart-yes") {
        showRequireRestartTooltip("yes");
      } else if (tip === "restart-no") {
        showRequireRestartTooltip("no");
      } else if (tip === "filter") {
        showFilterCapTooltip();
      } else if (tip === "debug") {
        showDebugModeTooltip();
      } else if (tip === "hard" || tip === "hard-shadow") {
        showEncoreHardTooltip();
      } else if (tip === "confirm" || tip === "yes") {
        showConfirmSaveTooltip("yes");
      } else if (tip === "no") {
        showConfirmSaveTooltip("no");
      } else if (tip === "save") {
        showTooltip({ kind: "save", title: "Data Saved to Sheet." });
      } else if (tip === "encore-save") {
        showSaveNotice(MSG_ENCORE_SAVED);
      } else if (tip === "order") {
        showSaveNotice(MSG_ORDER_SAVED);
      } else if (tip === "board-save") {
        showSaveNotice(MSG_BOARD_SAVED);
        showSaveNotice(MSG_ENCORE_SAVED);
        showSaveNotice(MSG_ORDER_SAVED);
      }
    }, 60);
  }

  function applyQueryParams() {
    var params = queryParams();
    if (urlHasBetaFlag()) {
      state.draft.dataSource = "beta";
      if (state.committed) state.committed.dataSource = "beta";
    }
    if (params.get("pick")) state.picker = params.get("pick");
    if (params.get("confirm") === "1") state.dialog = "confirm";
    if (params.get("confirmsave") === "yes" || params.get("confirmsave") === "no") {
      state.draft.confirmSave = params.get("confirmsave");
      if (state.committed) state.committed.confirmSave = params.get("confirmsave");
    }
    if (params.get("newtheme") === "1") state.dialog = "create";
    if (params.get("theme")) {
      var want = params.get("theme");
      if (D.themes.some(function (t) { return t.name === want; })) {
        state.draft.themeName = want;
      }
    }
    if (params.get("bg")) state.draft.background = params.get("bg");
    if (params.get("pres")) state.draft.presentation = params.get("pres");
    if (params.get("spot")) state.draft.encoreSpot = params.get("spot");
    if (params.get("ebg")) state.draft.encoreBg = params.get("ebg");
    if (params.get("item")) {
      var n = parseInt(params.get("item"), 10);
      if (!isNaN(n)) state.previewIndex = n;
    }
    if (params.get("speed") != null && params.get("speed") !== "") {
      var sp = parseInt(params.get("speed"), 10);
      if (!isNaN(sp)) state.draft.presentationSpeed = sp;
    }
    if (!state.tipQueryApplied) {
      var tip = params.get("tip");
      if (tip) state.pendingTip = tip;
      state.tipQueryApplied = true;
    }
    if (params.get("holdGrid") === "1") {
      state.draft.presentation = "encore";
      state.draft.presentationSpeed = 0;
      state.holdGrid = true;
    }

    showManagerBetaBadge();
  }

  function readHash() {
    var target = parseScreenFromHash();
    state.picker = null;
    state.dialog = null;
    state.screen = target.screen;
    state.boardId = target.boardId;
    state.itemKey = target.itemKey || null;
    applyQueryParams();
  }

  function handleLocationChange() {
    var target = parseScreenFromHash();
    var prevScreen = state.screen;
    var prevBoard = state.boardId;
    var prevItem = state.itemKey;
    if (state.confirmLeave) {
      state.confirmLeave = false;
      readHash();
      renderAll();
      return;
    }
    var isDirtyStyle = prevScreen === "style" && !eq(state.draft, state.committed);
    var leavingDirtyStyle = isDirtyStyle && target.screen !== "style";
    if (leavingDirtyStyle) {
      // Browser back (or hash pop) from dirty style: bounce to keep URL + screen on style,
      // show the same Confirm dialog as internal back(). On confirm leave we history.back()
      // to actually pop to the target. Confirm save? No writes immediately then lets nav through.
      state.picker = null;
      if (confirmSaveOff()) {
        if (anySaveDirty()) confirmChoice("yes", true);
        readHash();
        renderAll();
        return;
      }
      var styleHash = "#/menu/style";
      if (location.hash !== styleHash) {
        history.replaceState(null, "", styleHash);
      }
      state.pendingLeave = function () {
        history.back();
      };
      state.dialog = "confirm";
      renderAll();
      return;
    }
    var leavingDirtySystem =
      prevScreen === "system" &&
      systemSettingsDirty() &&
      target.screen !== "system";
    if (leavingDirtySystem) {
      if (!confirmSaveOff()) {
        // Browser back (or hash pop) from dirty system: bounce + show Confirm
        // dialog (same as leaveSystem). Respect the Confirm save? toggle.
        state.picker = null;
        var sysHash = "#/system";
        if (location.hash !== sysHash) {
          history.replaceState(null, "", sysHash);
        }
        state.pendingLeave = function () {
          history.back();
        };
        state.dialog = "confirm";
        renderAll();
        return;
      }
      // When "Confirm save?" is No, allow the nav; draft change stays until
      // reload (internal back paths still auto-persist via leaveSystem).
    }
    var sameItemEditor =
      (target.screen === "item" || target.screen === "image") &&
      String(target.itemKey || "") === String(prevItem || "") &&
      (target.boardId || null) === (prevBoard || null);
    var leavingDirtyImage =
      prevScreen === "image" && imageDirty() && target.screen !== "image";
    if (leavingDirtyImage) {
      state.picker = null;
      var imageHash =
        "#/menu/board/" +
        prevBoard +
        "/item/" +
        encodeURIComponent(String(prevItem || "new")) +
        "/image";
      if (location.hash !== imageHash) {
        history.replaceState(null, "", imageHash);
      }
      state.pendingLeave = function () {
        history.back();
      };
      state.dialog = "confirm";
      renderAll();
      return;
    }
    var leavingDirtyItem =
      prevScreen === "item" && itemDirty() && !sameItemEditor;
    if (leavingDirtyItem) {
      state.picker = null;
      var itemHash =
        "#/menu/board/" +
        prevBoard +
        "/item/" +
        encodeURIComponent(String(state.itemKey || "new"));
      if (location.hash !== itemHash) {
        history.replaceState(null, "", itemHash);
      }
      state.pendingLeave = function () {
        history.back();
      };
      state.dialog = "confirm";
      renderAll();
      return;
    }
    var leavingDirtyBoard =
      prevScreen === "board" &&
      (boardDirty() || styleDirty()) &&
      ((target.screen !== "board" &&
        target.screen !== "item" &&
        target.screen !== "image") ||
        (target.boardId || null) !== (prevBoard || null));
    if (leavingDirtyBoard) {
      state.picker = null;
      if (confirmSaveOff()) {
        if (anySaveDirty()) confirmChoice("yes", true);
        readHash();
        renderAll();
        return;
      }
      var boardHash = "#/menu/board/" + prevBoard;
      if (location.hash !== boardHash) {
        history.replaceState(null, "", boardHash);
      }
      state.pendingLeave = function () {
        history.back();
      };
      state.dialog = "confirm";
      renderAll();
      return;
    }
    readHash();
    var boardChanged = (target.boardId || null) !== (prevBoard || null);
    var itemChanged =
      String(target.itemKey || "") !== String(prevItem || "");
    if (target.screen !== prevScreen || boardChanged || itemChanged) {
      renderAll();
    } else {
      // Same screen (hashchange/pop from our writeHash when entering Style,
      // or other self events). Skip renderAll — a rebuild would remount
      // #hero-plate / .hero-anim and tear down the running cycle
      // (gen++, cleared timers, snap lost). This regressed after back-button
      // support. Guardrail protects Ken Burns / Slideshow fade+zoom.
      // (MOTION_GLOSSARY 3 and 4.)
      writeHash(false);
    }
  }

  function applySheetPayload(payload) {
    if (!payload || !payload.ok) return;
    if (payload.catalogSettings && payload.catalogSettings.length) {
      state.catalogSettings = payload.catalogSettings;
    }
    try {
      document.documentElement.setAttribute(
        "data-catalog-rows",
        String((state.catalogSettings || []).length)
      );
    } catch (e) {}
    if (payload.dataSources && payload.dataSources.length) {
      D.dataSources = payload.dataSources;
    }
    if (payload.boards && payload.boards.length) {
      D.boards = payload.boards;
      var bi;
      for (bi = 0; bi < payload.boards.length; bi++) {
        var pack = payload.boards[bi];
        var keepDirty =
          ((state.screen === "board" && boardDirty()) ||
            (state.screen === "item" && itemDirty()) ||
            (state.screen === "image" && (itemDirty() || imageDirty()))) &&
          state.boardDraft &&
          state.boardDraft.id === pack.id;
        if (!keepDirty) rememberBoardSnap(pack);
      }
      if (
        (state.screen === "board" || state.screen === "item" || state.screen === "image") &&
        state.boardId &&
        !boardDirty() &&
        !((state.screen === "item" || state.screen === "image") && itemDirty()) &&
        !(state.screen === "image" && imageDirty())
      ) {
        var fresh = findBoard(resolveBoardId(state.boardId));
        if (fresh && fresh.id) {
          state.boardDraft = clone(fresh);
          state.boardCommitted = clone(fresh);
        }
      }
      // Re-apply the last board Yes (committed) after a sheet payload so that
      // board names (and settings) updated without reload survive the D.boards
      // assign (late initial load at boot, or explicit reload-sheet). This keeps
      // the Menu Settings list (and future board entries) consistent like theme
      // draft updates, without forcing a sheet re-read.
      if (state.boardCommitted && state.boardCommitted.id) {
        var kDirty =
          state.screen === "board" &&
          boardDirty() &&
          state.boardDraft &&
          state.boardDraft.id === state.boardCommitted.id;
        if (!kDirty) {
          applyBoardToCatalog(state.boardCommitted);
        }
      }
    }
    if (payload.themes && payload.themes.length) {
      D.themes = payload.themes;
    }
    if (payload.colorRoles && payload.colorRoles.length) {
      D.colorRoles = payload.colorRoles;
      var extras = [];
      var bi;
      for (bi = 0; bi < (D.backgroundOptions || []).length; bi++) {
        var b = D.backgroundOptions[bi];
        if (b && (b.id === "pattern" || b.id === "wallpaper")) extras.push(b);
      }
      D.backgroundOptions = D.colorRoles.concat(extras);
    }
    if (payload.wallpapers && payload.wallpapers.length) {
      D.wallpapers = payload.wallpapers;
    }
    state.lastSheet = {
      sourceName: payload.sourceName || "",
      sheetId: payload.sheetId || "",
      themeName: payload.draft && payload.draft.themeName
        ? payload.draft.themeName
        : "",
      style: styleSnap(payload.draft),
      fieldValidations: payload.fieldValidations || null,
      motionStyles: payload.motionStyles || {},
    };
    D.motionStyles = payload.motionStyles || {};
    if (payload.speedTiles) {
      D.speedTiles = {
        scroll: Object.assign({}, D.speedTiles.scroll, payload.speedTiles.scroll),
        presentation: Object.assign(
          {},
          D.speedTiles.presentation,
          payload.speedTiles.presentation
        ),
      };
    }
    if (payload.draft) {
      var fromSheet = Object.assign({}, D.defaultDraft, payload.draft);
      fromSheet.confirmSave = fromSheet.confirmSave || "yes";
      fromSheet.refreshTimer = fromSheet.refreshTimer || "30 seconds";
      (function clampRefresh(d) {
        var s = String(d.refreshTimer || "").trim().toLowerCase();
        var m = s.match(/^(\d+)\s*(second|seconds|sec|s|minute|minutes|min|m)?$/);
        if (!m) {
          d.refreshTimer = "30 seconds";
          return;
        }
        var n = parseInt(m[1], 10);
        var unit = (m[2] || "s").toLowerCase();
        if (unit.charAt(0) === "m") n *= 60;
        if (!n || n < 30) d.refreshTimer = "30 seconds";
      })(fromSheet);
      fromSheet.debugMode = fromSheet.debugMode || "no";
      // Keep draft numbers inside the live tile set (sheet conditionals).
      fromSheet.scrollSpeed = clampDraftSpeed(
        fromSheet.scrollSpeed,
        "scroll"
      );
      fromSheet.presentationSpeed = clampDraftSpeed(
        fromSheet.presentationSpeed,
        "presentation"
      );
      if (state.sheetDirty || state.persistInFlight) {
        /* Keep the in-edit draft/committed. A late sheet load used to
           reset committed and bounce Confirm after Yes. */
      } else {
        state.committed = clone(fromSheet);
        state.draft = clone(fromSheet);
        applyQueryParams();
      }
      persistCatalogChoice(state.draft.dataSource);
    }
    state.sheetSource = "sheet";
    try {
      document.documentElement.setAttribute("data-sheet-source", "sheet");
    } catch (e2) {}
    applyTheme();
    if (payload && !payload.fromFallback) {
      hadLiveSheetData = true;
      captureLastPaint(); // successful live apply (painted real theme) → remember for next boot no-flash
    }
    renderAll();
    if (state.screen === "style" || state.screen === "board") {
      // Boot refresh lands on the board hash before the sheet arrives, so the
      // first cycle is Ken Burns. When the sheet says Encore, retarget fills
      // plates — otherwise the veil runs on an empty stage.
      retargetMotion();
    }
  }

  function clampDraftSpeed(raw, kind) {
    var spec = speedTileSpec(kind);
    var n = Number(raw);
    if (!isFinite(n)) n = spec.min;
    n = Math.round(n);
    if (spec.values && spec.values.length) {
      if (spec.values.indexOf(n) !== -1) return n;
      // Nearest allowed tile
      var best = spec.values[0];
      var bestDist = Math.abs(best - n);
      for (var i = 1; i < spec.values.length; i++) {
        var d = Math.abs(spec.values[i] - n);
        if (d < bestDist) {
          best = spec.values[i];
          bestDist = d;
        }
      }
      return best;
    }
    if (n < spec.min) return spec.min;
    if (n > spec.max) return spec.max;
    return n;
  }

  var HANG_RECOVERY_MS = 10000;
  var sheetHangTimer = 0;
  var sheetLiveOk = false;
  var sheetLoadInFlight = false;
  var pendingSheetLoad = null;
  var hadLiveSheetData = false; // for manager-fallback.json: only write recovery snapshot after seeing real live data this session (avoid pre-sheet defaultDraft)
  var lastFallbackSnapshot = null; // memory of last sent to avoid re-POST identical to disk (skip if equals)

  function clearSheetHangRetry() {
    if (sheetHangTimer) {
      clearTimeout(sheetHangTimer);
      sheetHangTimer = 0;
    }
  }

  function armSheetHangRetry(reason) {
    if (sheetLiveOk || sheetHangTimer) return;
    console.warn(
      "Menu Manager hang recovery in " + HANG_RECOVERY_MS + "ms —",
      reason || "sheet load failed"
    );
    sheetHangTimer = setTimeout(function () {
      sheetHangTimer = 0;
      if (state.sheetDirty) {
        armSheetHangRetry("waiting for unsaved edits");
        return;
      }
      loadSheet({ force: true, hangRetry: true });
    }, HANG_RECOVERY_MS);
  }

  function loadSheet(opts) {
    opts = opts || {};
    if (!opts.sourceId) opts.sourceId = editorSourceId();
    var loader = window.TOKI_MANAGER_SHEET;
    if (!loader || !loader.load) {
      state.sheetSource = "local";
      armSheetHangRetry("no sheet loader");
      return;
    }
    if (sheetLoadInFlight) {
      pendingSheetLoad = opts;
      if (opts.hangRetry) armSheetHangRetry("load already in progress");
      return;
    }
    if (opts.force && !opts.hangRetry) toast("Reloading sheet…");
    sheetLoadInFlight = true;
    loader
      .load(opts)
      .then(function (payload) {
        var incoming = payload && payload.draft && payload.draft.dataSource;
        var stale =
          pendingSheetLoad &&
          pendingSheetLoad.sourceId &&
          incoming &&
          incoming !== pendingSheetLoad.sourceId;
        if (stale) {
          return;
        }
        if (opts.force) state.sheetDirty = false;
        applySheetPayload(payload);
        sheetLiveOk = !(payload && payload.fromFallback);
        if (sheetLiveOk) clearSheetHangRetry();
        else armSheetHangRetry("loaded fallback snapshot");
        if (payload && payload.sourceName && !opts.hangRetry) {
          toast("Loaded " + payload.sourceName + " from sheet");
        } else if (opts.hangRetry && sheetLiveOk) {
          toast("Sheet reconnected");
        }
      })
      .catch(function (err) {
        console.warn("Menu Manager sheet load failed", err);
        var fb = loader.loadFallback;
        if (!fb) {
          state.sheetSource = "local";
          renderAll();
          if (!opts.hangRetry) toast("Could not load sheet — using local defaults");
          armSheetHangRetry(err && err.message ? err.message : err);
          return;
        }
        return fb(state.draft && state.draft.dataSource).then(function (payload) {
          if (payload && payload.ok) {
            applySheetPayload(payload);
            sheetLiveOk = false;
            if (!opts.hangRetry) toast("Loaded last saved fallback");
            armSheetHangRetry("using fallback after API fail");
            return;
          }
          state.sheetSource = "local";
          renderAll();
          if (!opts.hangRetry) toast("Could not load sheet — using local defaults");
          armSheetHangRetry("fallback missing");
        });
      })
      .then(function () {
        sheetLoadInFlight = false;
        if (pendingSheetLoad) {
          var next = pendingSheetLoad;
          pendingSheetLoad = null;
          loadSheet(next);
        }
      }, function () {
        sheetLoadInFlight = false;
        if (pendingSheetLoad) {
          var next = pendingSheetLoad;
          pendingSheetLoad = null;
          loadSheet(next);
        }
      });
  }

  function onClick(e) {
    var t = e.target.closest("[data-act]");
    if (!t) {
      if (e.target === els.dialog && state.dialog === "create") {
        state.dialog = null;
        renderDialog();
      }
      return;
    }
    var act = t.getAttribute("data-act");
    if (act === "go") {
      go(t.getAttribute("data-to"), t.getAttribute("data-board"));
    } else if (act === "back") {
      back();
    } else if (act === "pick") {
      openPicker(t.getAttribute("data-key"));
    } else if (act === "toggle") {
      toggleZeroOne(t.getAttribute("data-key"));
    } else if (act === "choose") {
      choose(t.getAttribute("data-id"));
    } else if (act === "pill") {
      setPill(t.getAttribute("data-key"), t.getAttribute("data-val"));
    } else if (act === "confirm") {
      confirmChoice(t.getAttribute("data-val"));
    } else if (act === "create-theme") {
      state.dialog = "create";
      renderDialog();
    } else if (act === "create-save") {
      gateNewTheme();
    } else if (act === "create-cancel") {
      state.dialog = null;
      renderDialog();
    } else if (act === "tooltip-dismiss") {
      var tipId = parseInt(t.getAttribute("data-tip-id"), 10);
      if (!isNaN(tipId)) dismissTooltip(tipId, false);
    } else if (act === "tooltip-dismiss-all") {
      dismissAllTooltips(false);
    } else if (act === "picker-dismiss") {
      state.picker = null;
      renderPicker();
    } else if (act === "open-sheet") {
      openSheet();
    } else if (act === "open-settings-sheet") {
      window.open(D.settingsSheetUrl, "_blank", "noopener");
    } else if (act === "copy-permalink") {
      copyPermalink();
    } else if (act === "board-title-cancel") {
      state.dialog = null;
      renderDialog();
    } else if (act === "board-title-save") {
      var inp = document.getElementById("board-title-input");
      var next = inp ? String(inp.value || "").trim() : "";
      if (state.boardDraft && next) {
        state.boardDraft.menuTitle = next;
        state.boardDraft.title = next;
      }
      state.dialog = null;
      renderDialog();
      renderAll();
      if (confirmSaveOff()) {
        state.pendingLeave = null;
        maybeAutoSave(true);
      }
    } else if (act === "toast-add" || act === "toast-fill") {
      toast("Coming soon — add items from Toast.");
    } else if (act === "item-add") {
      openItemEditor("new");
    } else if (act === "edit-item") {
      openItemEditor(t.getAttribute("data-item"));
    } else if (act === "item-add-tier") {
      addItemTier();
    } else if (act === "item-tier") {
      state.itemTierIndex = parseInt(t.getAttribute("data-tier"), 10);
      state.dialog = "item-tier";
      renderDialog();
    } else if (act === "item-field-cancel") {
      state.dialog = null;
      renderDialog();
    } else if (act === "item-field-save") {
      var field = document.getElementById("item-field-input");
      var nextField = field ? String(field.value || "") : "";
      if (state.dialog === "item-name") {
        nextField = nextField.trim();
        if (state.itemDraft && nextField) state.itemDraft.name = nextField;
      } else if (state.dialog === "item-subtitle") {
        if (state.itemDraft) state.itemDraft.subtitle = nextField.trim();
      } else if (state.dialog === "item-description") {
        if (state.itemDraft) state.itemDraft.description = nextField.trim();
      } else if (state.dialog === "item-tier" && state.itemDraft) {
        var ti = state.itemTierIndex;
        if (!state.itemDraft.tiers[ti]) state.itemDraft.tiers[ti] = { tier: "", price: "" };
        if (state.itemDraft.priceModel === "vb") {
          state.itemDraft.tiers[ti].tier = nextField.replace(/\D/g, "").slice(0, 3);
        } else {
          state.itemDraft.tiers[ti].tier = nextField.trim().slice(0, 8);
        }
      }
      state.dialog = null;
      renderDialog();
      refreshItemScreen();
    } else if (act === "item-required-ok") {
      state.dialog = null;
      state.pendingLeave = null;
      renderDialog();
    } else if (act === "item-missing-keep" || act === "item-include-keep") {
      state.dialog = null;
      state.pendingLeave = null;
      renderDialog();
    } else if (act === "item-missing-go") {
      state.dialog = null;
      renderDialog();
      continueItemSaveAfterMissing();
    } else if (act === "item-include-go") {
      finishItemSave();
    } else if (act === "item-delete-no") {
      state.pendingDeleteIndex = null;
      state.dialog = null;
      renderDialog();
    } else if (act === "item-delete-yes") {
      deleteBoardItem(state.pendingDeleteIndex);
      state.pendingDeleteIndex = null;
      state.dialog = null;
      renderDialog();
      refreshBoardRows();
    } else if (act === "image-how") {
      e.preventDefault();
      openImageTutorial("image");
    } else if (act === "image-replace") {
      openImageTutorial("image");
    } else if (act === "image-tutorial-cancel") {
      closeImageTutorial();
    } else if (act === "image-tutorial-upload") {
      pickImageAfterTutorial();
    } else if (act === "image-tutorial-page") {
      e.preventDefault();
      scrollTutorialPage(parseInt(t.getAttribute("data-page"), 10) || 0);
    } else if (act === "image-opaque-ok") {
      continueOpaqueImage();
    } else if (act === "image-opaque-cancel") {
      cancelOpaqueImage();
    } else if (act === "copy-hex") {
      copyHex(t.getAttribute("data-hex"));
    } else if (act === "reload-sheet") {
      loadSheet({ force: true, sourceId: editorSourceId() });
    }
  }

  function onKey(e) {
    if (e.key === "Escape") {
      if (state.tooltipItems.length && !state.picker && !state.dialog) {
        dismissAllTooltips(false);
        return;
      }
      back();
      return;
    }
    if (
      (e.key === "Enter" || e.key === " ") &&
      e.target &&
      e.target.getAttribute &&
      e.target.getAttribute("data-act") === "tooltip-dismiss"
    ) {
      e.preventDefault();
      var tipId = parseInt(e.target.getAttribute("data-tip-id"), 10);
      if (!isNaN(tipId)) dismissTooltip(tipId, false);
    }
  }

  /* Safari on phones often lays out ~4/3 as many CSS pixels as the screen
     (aA page zoom / a wider layout viewport), so 88px rows look compact.
     Chrome and Firefox stay at width=device-width (375 on iPhone X), so the
     same px chrome looks scaled up. Compact those 100% viewports to the
     Safari density; leave an already-wide layout alone so Safari does not
     shrink twice. */
  var compactDensity = { scale: 1 };

  function deviceCssWidth() {
    var sw = window.screen && window.screen.width ? window.screen.width : 0;
    var sh = window.screen && window.screen.height ? window.screen.height : 0;
    if (!sw) return window.innerWidth || 0;
    var landscape = false;
    try {
      landscape = window.matchMedia("(orientation: landscape)").matches;
    } catch (e1) {}
    if (!landscape && window.innerWidth && window.innerHeight) {
      landscape = window.innerWidth > window.innerHeight;
    }
    return landscape ? Math.max(sw, sh) : Math.min(sw, sh);
  }

  function layoutCssWidth() {
    return document.documentElement.clientWidth || window.innerWidth || 0;
  }

  function isNativePhone() {
    var w = deviceCssWidth();
    if (w && w <= 520) return true;
    try {
      if (window.matchMedia("(max-width: 520px)").matches) return true;
      if (window.matchMedia("(max-device-width: 520px)").matches) return true;
    } catch (e2) {}
    return false;
  }

  function compactPhoneScale() {
    if (!isNativePhone()) return 1;
    try {
      if (
        window.visualViewport &&
        Math.abs(window.visualViewport.scale - 1) > 0.03
      ) {
        return compactDensity.scale || 1;
      }
    } catch (e3) {}
    var lw = layoutCssWidth();
    if (!lw) return 1;
    var sw = deviceCssWidth();
    var basis = sw && sw <= 520 ? sw : lw;
    /* 4/3 matches the measured Safari-vs-Chrome screenshot ratio on iPhone X
       (201px vs 268px rows). Skip when the layout is already that wide. */
    var target = Math.round(basis * 4 / 3);
    if (lw >= target * 0.97) return 1;
    var s = lw / target;
    if (s < 0.7) s = 0.7;
    if (s > 1) s = 1;
    return s;
  }

  function clearNativeCompact(device, slot) {
    device.style.transform = "";
    device.style.transformOrigin = "";
    device.style.width = "";
    device.style.height = "";
    device.classList.remove("is-compact-density");
    /* Fall back to CSS --device-w: 100vw (a width). Never leave 100% —
       --top-slot-h would then be 2/3 of the screen height. */
    device.style.removeProperty("--device-w");
    device.style.removeProperty("--top-slot-h");
    if (slot) {
      slot.style.width = "";
      slot.style.height = "";
    }
  }

  function fitDevice() {
    var device = els.device;
    var slot = document.getElementById("device-slot");
    var native = isNativePhone();
    device.classList.toggle("is-native", native);
    if (native) {
      var scale = compactPhoneScale();
      compactDensity.scale = scale;
      var visW = layoutCssWidth();
      var visH = window.innerHeight || visW;
      try {
        if (window.visualViewport && window.visualViewport.height) {
          visH = window.visualViewport.height;
        }
      } catch (e4) {}
      document.documentElement.classList.toggle("is-phone-compact", scale < 0.995);
      if (scale < 0.995 && visW) {
        var layoutW = visW / scale;
        var layoutH = visH / scale;
        device.style.transformOrigin = "top left";
        device.style.transform = "scale(" + scale + ")";
        device.style.width = layoutW + "px";
        device.style.height = layoutH + "px";
        device.style.setProperty("--device-w", layoutW + "px");
        device.style.setProperty("--top-slot-h", layoutW * 2 / 3 + "px");
        device.classList.add("is-compact-density");
        if (slot) {
          slot.style.width = visW + "px";
          slot.style.height = visH + "px";
          slot.style.overflow = "hidden";
        }
      } else {
        clearNativeCompact(device, slot);
      }
      syncEncoreLayout();
      if (state.tooltipItems.length) layoutTooltipOverlay(false);
      return;
    }
    compactDensity.scale = 1;
    document.documentElement.classList.remove("is-phone-compact");
    device.classList.remove("is-compact-density");
    device.style.width = "";
    device.style.height = "";
    device.style.removeProperty("--device-w");
    device.style.removeProperty("--top-slot-h");
    var pad = 32;
    var sx = (window.innerWidth - pad) / 390;
    var sy = (window.innerHeight - pad) / 844;
    var s = Math.min(1, sx, sy);
    device.style.transform = "scale(" + s + ")";
    device.style.transformOrigin = "top left";
    if (slot) {
      slot.style.width = 390 * s + "px";
      slot.style.height = 844 * s + "px";
    }
    syncEncoreLayout();
    if (state.tooltipItems.length) layoutTooltipOverlay(false);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function init() {
    els.device = document.getElementById("device");
    els.app = document.getElementById("app");
    els.picker = document.getElementById("picker");
    els.dialog = document.getElementById("dialog");
    els.toast = document.getElementById("toast");
    els.tooltipRoot = document.getElementById("tooltip-root");
    els.tooltipScroll = document.getElementById("tooltip-scroll");
    els.tooltipStack = document.getElementById("tooltip-stack");
    els.device.addEventListener("click", onClick);
    function blockHeroScroll(e) {
      if (e.target.closest && e.target.closest(".tooltip-root")) return;
      if (e.target.closest && e.target.closest(".status, .preview, .header, .home-hero")) {
        e.preventDefault();
      }
    }
    els.device.addEventListener("touchmove", blockHeroScroll, { passive: false });
    els.device.addEventListener("wheel", blockHeroScroll, { passive: false });
    // Suppress pinch/double-tap page zoom so mobile Menu Manager feels like an app (iOS Settings style).
    document.addEventListener("gesturestart", function (e) { e.preventDefault(); }, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", fitDevice);
    window.addEventListener("orientationchange", fitDevice);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", fitDevice);
    }
    window.addEventListener("hashchange", handleLocationChange);
    window.addEventListener("popstate", handleLocationChange);
    readHash();
    writeHash(false);
    applyTheme();
    applyLastPaintOverlay(); // overlay last real paint immediately (CSS default is always Toki); do not write here
    showManagerBetaBadge();
    watchFonts();
    fitDevice();
    renderAll();
    flushPendingTip();
    loadSheet();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

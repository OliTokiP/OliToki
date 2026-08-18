/**
 * OliToki Menu Manager — layout + sheet read.
 * Draft theme tokens restyle the app immediately. Confirm-on-back Yes writes
 * Theme Selector, Background (BG Color / Pattern / Wallpaper), and the
 * speed pills (scroll + presentation) on the selected catalog
 * (via TOKI_MANAGER_SHEET.writeStyle), including Presentation Speed and
 * Encore spotlight/background (global Style K/L/M). Board Yes writes Menu Title,
 * Family Portrait, Presentation Mode, and Include Descriptions?
 * (via TOKI_MANAGER_SHEET.writeBoard) and also persists dirty Style fields.
 * Inventory order stays local.
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
    styleScroll: 0,
    pillScroll: {},
    pendingLeave: null,
    sheetDirty: false,
    sheetSource: "loading",
    lastSheet: null,
    boardDraft: null,
    boardCommitted: null,
    lastBoardSnap: {},
    itemDragging: false,
  };

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
    return find(D.dataSources, state.draft.dataSource);
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
    return seen && loaded;
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
    ["Poppins", "Roboto"].forEach(function (fam) {
      try {
        document.fonts.load('16px "' + fam + '"').then(syncFontReadyClass).catch(syncFontReadyClass);
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

  function buildVersionLabel() {
    var b = window.TOKI_BUILD;
    var hash = b && (b.hash || (b.hashFull && String(b.hashFull).slice(0, 7)));
    return hash ? "Version " + hash : "Version " + D.version;
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
    var b = window.TOKI_BUILD;
    var hash = b && (b.hash || (b.hashFull && String(b.hashFull).slice(0, 7)));
    var h = hash || D.version;
    var subj = b && b.subject;
    if (subj) {
      return h + " — " + subj;
    }
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

  function statusBlock() {
    var t = currentTheme();
    return (
      '<div class="status">' +
      "<p>Data Source: " +
      escapeHtml(dataSource().name) +
      "</p>" +
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
    var cls = "row" + (opts.child ? " is-child" : "");
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
      '<span class="row-value">' +
      escapeHtml(opts.value) +
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

  function footerBar(label, act) {
    var labelHtml =
      '<span class="footer-label">' + escapeHtml(label) + "</span>";
    if (!act) {
      return '<div class="footer-bar footer-soon">' + labelHtml + "</div>";
    }
    return (
      '<button class="footer-bar" type="button" data-act="' +
      act +
      '">' +
      '<span class="plus-circle" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
      "</span>" +
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
    return (
      '<section class="screen">' +
      header("System Settings") +
      statusBlock() +
      '<div class="rows"><div class="bounce-inner">' +
      row({
        key: "dataSource",
        label: "Data Source",
        value: dataSource().name,
      }) +
      row({
        key: "requireRestart",
        label: "Require restart to update?",
        value: labelOf(D.yesNo, state.draft.requireRestart),
      }) +
      row({
        key: "systemFont",
        label: "System Font",
        value: labelOf(D.fonts, state.draft.systemFont),
      }) +
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

  function ensureBoardDraft() {
    var id = resolveBoardId(state.boardId);
    state.boardId = id;
    var src = find(D.boards, id);
    if (!src) return null;
    if (!state.boardDraft || state.boardDraft.id !== id) {
      state.boardDraft = clone(src);
      state.boardCommitted = clone(src);
      if (!state.lastBoardSnap[id]) rememberBoardSnap(src);
    }
    return state.boardDraft;
  }

  function resolveBoardId(id) {
    if (id === "announcements") {
      var four = find(D.boards, "4");
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

  function boardSettingsSnap(b) {
    b = b || {};
    return {
      menuTitle: String(b.menuTitle || b.title || ""),
      familyPortrait: b.familyPortrait === "yes" ? "yes" : "no",
      presentation: b.presentation || "kenburns",
      includeDescriptions: b.includeDescriptions === "yes" ? "yes" : "no",
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
        label: "Family Portrait (Shows Spread of All Items)",
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
      '<button class="row" type="button" data-act="open-permalink">' +
      '<span class="row-label">Permalink</span>' +
      '<span class="row-value row-value-url">' +
      escapeHtml(b.permalink || "—") +
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
    for (i = 0; i < items.length; i++) {
      html +=
        '<div class="item-row" data-item="' +
        i +
        '">' +
        '<button class="item-handle" type="button" aria-label="Reorder ' +
        escapeHtml(items[i].name) +
        '"></button>' +
        '<span class="item-name">' +
        escapeHtml(items[i].name) +
        "</span></div>";
    }
    return html;
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
    if (b.kind === "announcements" || b.id === "4" || b.id === "announcements") {
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
    return (
      '<section class="screen screen-board">' +
      header(title) +
      previewHtml() +
      '<div class="style-scroll" id="board-scroll">' +
      '<div class="rows bounce-inner">' +
      boardRows() +
      "</div></div>" +
      footerBar("Add Item From Toast", "toast-add") +
      "</section>"
    );
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
    html += row({
      key: "presentation",
      label: "Presentation Style",
      value: labelOf(D.presentationStyles, d.presentation),
    });
    if (d.presentation === "encore") {
      html += row({
        key: "encoreStyle",
        label: "Encore Spotlight Style",
        value: labelOf(D.encoreStyles, d.encoreStyle),
        child: true,
      });
      html += row({
        key: "encoreSpot",
        label: "Encore Spotlight Color",
        value: labelOf(D.encoreSpotColors, d.encoreSpot),
        child: true,
      });
      html += row({
        key: "encoreBg",
        label: "Encore Background",
        value: labelOf(D.colorRoles, d.encoreBg),
        child: true,
      });
    }
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

  function encoreStageClass(d) {
    var type = d.encoreStyle === "soft" ? "soft" : "hard";
    var cls = "encore-spot-" + (d.encoreStyle === "hard_shadow" ? "hard-shadow" : type);
    if (d.encoreStyle === "hard_shadow") cls += " encore-spot-hard";
    if (d.encoreSpot === "highlight") cls += " encore-spot-color-highlight";
    else cls += " encore-spot-color-black";
    return cls;
  }

  function wallpaperSrc() {
    var paper = wallpaperPaper();
    return paper && paper.src ? paper.src : "";
  }

  function wallpaperFallback() {
    var paper = wallpaperPaper();
    return (paper && paper.fallback) || "";
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
      '<div class="family-portrait-veil" aria-hidden="true"></div>' +
      "</div></div></div>" +
      '<div class="preview-sticker"' +
      (first.isNew ? "" : " hidden") +
      ">" +
      '<img class="preview-sticker-shadow" alt="" src="' +
      D.sticker.shadow +
      '">' +
      '<div class="preview-sticker-body">' +
      '<img class="preview-sticker-body-img" alt="" src="' +
      D.sticker.body +
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
    var html = "";
    if (state.screen === "home") html = screenHome();
    else if (state.screen === "system") html = screenSystem();
    else if (state.screen === "menu") html = screenMenu();
    else if (state.screen === "style") html = screenStyle();
    else if (state.screen === "board") html = screenBoard();

    if (state.screen === "board") {
      var existingBoard = els.app.querySelector(".screen-board");
      if (existingBoard) {
        refreshBoardRows();
        applyTheme();
        bindItemReorder();
        if (!previewCtl.phase) startPreviewCycle();
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
        if (!previewCtl.phase) startPreviewCycle();
        return;
      }
    }

    els.app.innerHTML = html;
    applyTheme();
    if (state.screen === "home") attachPeak();
    if (state.screen === "style" || state.screen === "board") {
      var sc = document.getElementById(
        state.screen === "board" ? "board-scroll" : "style-scroll"
      );
      if (sc && state.screen === "style") sc.scrollTop = state.styleScroll;
      restorePillScroll();
      bindWpFallback();
      if (state.screen === "board") bindItemReorder();
      startPreviewCycle();
    } else {
      stopPreviewCycle();
    }
  }

  function pickerSpec(key) {
    if (key === "boardTitle") {
      return { kind: "text" };
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
        note: "Encore settings are global.",
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
        note: "Encore settings are global.",
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
        options: D.dataSources.map(function (s) {
          return { id: s.id, label: s.name };
        }),
        get: function () {
          return state.draft.dataSource;
        },
        set: function (id) {
          state.draft.dataSource = id;
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
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog" aria-labelledby="dlg-title">' +
        '<h2 id="dlg-title">Confirm Changes?</h2>' +
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
    } else if (state.dialog === "open-permalink") {
      els.dialog.innerHTML =
        '<div class="dialog-card" role="dialog">' +
        "<h2>Save board and open permalink?</h2>" +
        "<p class=\"tiny\">This overwrites the live sheet for this board, then opens the permalink.</p>" +
        '<div class="dialog-actions">' +
        '<button class="btn-primary" type="button" data-act="permalink-yes">Yes</button>' +
        '<button class="btn-primary" type="button" data-act="permalink-no">No</button>' +
        "</div></div>";
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
    }
    applyTheme();
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

  function rememberStyleScroll() {
    var sc = document.getElementById("style-scroll");
    if (sc) state.styleScroll = sc.scrollTop;
  }

  function go(screen, boardId) {
    if (state.screen === "style") rememberStyleScroll();
    state.picker = null;
    state.dialog = null;
    state.screen = screen;
    state.boardId = boardId || null;
    if (screen !== "style") state.styleScroll = 0;
    writeHash(true);
    renderAll();
  }

  function styleDirty() {
    return !eq(state.draft, state.committed);
  }

  function leaveBoard(next) {
    if (boardDirty() || styleDirty()) {
      state.pendingLeave = next;
      state.dialog = "confirm";
      renderDialog();
      return;
    }
    next();
  }

  function leaveStyle(next) {
    if (!eq(state.draft, state.committed)) {
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
      state.dialog = null;
      renderDialog();
      return;
    }
    if (state.screen === "style") {
      leaveStyle(function () {
        history.back();
      });
      return;
    }
    if (state.screen === "board") {
      leaveBoard(function () {
        history.back();
      });
      return;
    }
    if (state.screen === "system" || state.screen === "menu") {
      history.back();
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
    spec.set(id);
    state.picker = null;
    if (state.screen !== "board") state.sheetDirty = true;
    else if (
      pickKey === "encoreStyle" ||
      pickKey === "encoreSpot" ||
      pickKey === "encoreBg"
    ) {
      state.sheetDirty = true;
    }
    applyTheme();
    renderAll();
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
    if (key === "scrollSpeed") return;
    if (key === "presentationSpeed") {
      retargetMotion();
      return;
    }
    renderScreen();
  }

  function persistFallback() {
    var sheet = window.TOKI_MANAGER_SHEET;
    if (!sheet || !sheet.saveFallback) return Promise.resolve(false);
    var meta = state.lastSheet || {};
    return sheet.saveFallback({
      sourceId: state.draft.dataSource || "source",
      sourceName: meta.sourceName || "",
      sheetId: meta.sheetId || "",
      draft: clone(state.draft),
      themes: D.themes,
      speedTiles: D.speedTiles,
      colorRoles: D.colorRoles,
      wallpapers: D.wallpapers,
      fieldValidations: meta.fieldValidations || null,
      dataSources: D.dataSources,
      motionStyles: D.motionStyles || {},
    });
  }

  function styleSnap(d) {
    d = d || {};
    return {
      themeName: d.themeName || "",
      background: d.background || "",
      bgColor: d.bgColor || "",
      patternType: d.patternType || "",
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
          wrote.wroteEncore)
      );
      if (boardOk && styleOk) return "Board and Style saved to " + src;
      if (boardOk) return "Board saved to " + src;
      if (styleOk) return "Style saved to " + src;
      return "Could not write to sheet — saved for this session";
    }
    if (needed) {
      if (wrote && wrote.ok) {
        var bits = [];
        if (wrote.wroteTheme) bits.push("Theme");
        if (wrote.wroteBackground) bits.push("background");
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

  function persistStyleWrite(prevSnap) {
    var sheet = window.TOKI_MANAGER_SHEET;
    var d = state.draft || {};
    var next = styleSnap(d);
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
    if (
      !themeChanged &&
      !bgChanged &&
      !scrollChanged &&
      !presChanged &&
      !encoreChanged
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
      }
      return { needed: true, wrote: wrote };
    });
  }

  function persistBoardWrite(prevSnap) {
    var b = state.boardDraft;
    if (!b || b.kind === "announcements") {
      return Promise.resolve({ needed: false, wrote: null });
    }
    var sheet = window.TOKI_MANAGER_SHEET;
    var next = boardSettingsSnap(b);
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
    if (!changed) return Promise.resolve({ needed: false, wrote: null });
    if (!sheet || !sheet.writeBoard) {
      return Promise.resolve({
        needed: true,
        wrote: { ok: false, error: "Board write not available" },
      });
    }
    return sheet.writeBoard(payload).then(function (wrote) {
      if (wrote && wrote.ok) {
        rememberBoardSnap(b);
        applyBoardToCatalog(b);
      } else {
        console.warn("Menu Manager board write failed", wrote && wrote.error);
      }
      return { needed: true, wrote: wrote };
    });
  }

  function confirmChoice(val) {
    if (val === "yes") {
      var onBoard = state.screen === "board" && state.boardDraft;
      var boardPrev = null;
      var stylePrev = styleSnap(state.committed);
      if (state.lastSheet && state.lastSheet.style) {
        stylePrev = Object.assign({}, stylePrev, state.lastSheet.style);
      }
      if (onBoard) {
        boardPrev =
          state.lastBoardSnap[state.boardDraft.id] ||
          boardSettingsSnap(state.boardCommitted);
        state.boardCommitted = clone(state.boardDraft);
      }
      state.committed = clone(state.draft);
      state.dialog = null;
      var next = state.pendingLeave;
      state.pendingLeave = null;
      renderDialog();
      var persist = onBoard
        ? Promise.all([
            persistBoardWrite(boardPrev),
            persistStyleWrite(stylePrev),
          ]).then(function (pair) {
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
        : persistStyleWrite(stylePrev);
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
          toast(yesToast(out.needed, out.wrote, out.fb, out.kind));
          if (next) next();
          else renderAll();
        })
        .catch(function (err) {
          console.warn("Menu Manager save failed", err);
          toast(
            onBoard
              ? "Could not write board to sheet — saved for this session"
              : "Could not write style to sheet — saved for this session"
          );
          if (next) next();
          else renderAll();
        });
      return;
    }
    if (val === "no") {
      if (state.screen === "board" && state.boardCommitted) {
        state.boardDraft = clone(state.boardCommitted);
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

  function fillPortraitGrid() {
    var TM = window.TOKI_MOTION;
    var stage = encoreStageEl();
    if (!TM || !stage) return null;
    var items = (D.previewItems || []).map(function (it, i) {
      return { src: it.src, isNew: !!it.isNew, itemIndex: i };
    });
    previewCtl.lattice = TM.fillEncorePlates(stage, items, {
      sticker: D.sticker,
    });
    return previewCtl.lattice;
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
          TM.encoreSnap(stagePark, { zoom: 1, pinch: 0, dimmed: false, opacity: 1 });
        } else {
          TM.encoreSnap(stagePark, {
            zoom: zoomTo,
            pinch: TOKI_MOTION.encoreHolePinchPx(state.draft.encoreStyle),
            dimmed: true,
            opacity: 1,
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
          pinchPx: TOKI_MOTION.encoreHolePinchPx(state.draft.encoreStyle),
          zoomTo: TM.ENCORE.zoomTo,
          fpsCap: TOKI_MOTION.encoreFpsCap(state.draft.encoreStyle),
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
    if (pat) pat.hidden = encore || d.background !== "pattern";
    if (wpp) wpp.hidden = encore || d.background !== "wallpaper";
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

  function startPreviewCycle() {
    stopPreviewCycle();
    previewCtl.encoreFirst = true;
    previewCtl.lattice = null;
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
    var board = els.app.querySelector(".screen-board");
    if (!board || board.getAttribute("data-reorder")) return;
    board.setAttribute("data-reorder", "1");
    board.addEventListener("pointerdown", onItemHandleDown);
  }

  function onItemHandleDown(e) {
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

  function startItemDrag(e, list, row, handle) {
    var from = Number(row.getAttribute("data-item"));
    if (!isFinite(from)) return;
    var scroll = document.getElementById("board-scroll");
    var board = els.app.querySelector(".screen-board");
    var startRect = row.getBoundingClientRect();
    var y0 = e.clientY;
    var x0 = e.clientX;
    var offsetY = e.clientY - startRect.top;
    var pid = e.pointerId;
    var dragging = false;
    var placeholder = null;
    var lastY = e.clientY;
    var autoDir = 0;
    var raf = 0;
    var THRESH = 6;
    try {
      handle.setPointerCapture(pid);
    } catch (err) {}

    function placeAt(clientY) {
      lastY = clientY;
      row.style.top = clientY - offsetY + "px";
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
      if (!dragging) return;
      if (autoDir && scroll) {
        scroll.scrollTop += autoDir;
        placeAt(lastY);
      }
      if (autoDir) raf = requestAnimationFrame(tick);
    }

    function begin() {
      dragging = true;
      state.itemDragging = true;
      if (board) board.classList.add("is-item-dragging");
      placeholder = document.createElement("div");
      placeholder.className = "item-row item-placeholder";
      placeholder.style.height = startRect.height + "px";
      row.after(placeholder);
      row.classList.add("is-dragging");
      row.style.position = "fixed";
      row.style.width = startRect.width + "px";
      row.style.height = startRect.height + "px";
      row.style.left = startRect.left + "px";
      row.style.top = startRect.top + "px";
      row.style.zIndex = "8";
    }

    function move(ev) {
      if (ev.pointerId !== pid) return;
      if (!dragging) {
        if (Math.abs(ev.clientY - y0) < THRESH && Math.abs(ev.clientX - x0) < THRESH) {
          return;
        }
        begin();
      }
      ev.preventDefault();
      placeAt(ev.clientY);
      edgeScroll(ev.clientY);
    }

    function finish() {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try {
        handle.releasePointerCapture(pid);
      } catch (err) {}
      if (dragging && placeholder && state.boardDraft && state.boardDraft.items) {
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
        list.innerHTML = itemListHtml(state.boardDraft.items);
      } else {
        row.classList.remove("is-dragging");
        row.style.position = "";
        row.style.width = "";
        row.style.height = "";
        row.style.left = "";
        row.style.top = "";
        row.style.zIndex = "";
        if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      }
      if (board) board.classList.remove("is-item-dragging");
      dragging = false;
      state.itemDragging = false;
    }

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
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
    else if (state.screen === "board") hash = "#/menu/board/" + state.boardId;
    if (location.hash !== hash) {
      if (shouldPush) {
        history.pushState(null, "", hash);
      } else {
        history.replaceState(null, "", hash);
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
    } else if (parts[0] === "menu" && parts[1] === "board") {
      return { screen: "board", boardId: parts[2] || "1" };
    } else if (parts[0] === "menu") {
      return { screen: "menu", boardId: null };
    } else {
      return { screen: "home", boardId: null };
    }
  }

  function applyQueryParams() {
    var params = queryParams();
    if (params.get("pick")) state.picker = params.get("pick");
    if (params.get("confirm") === "1") state.dialog = "confirm";
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
    if (params.get("holdGrid") === "1") {
      state.draft.presentation = "encore";
      state.draft.presentationSpeed = 0;
      state.holdGrid = true;
    }
  }

  function readHash() {
    var target = parseScreenFromHash();
    state.picker = null;
    state.dialog = null;
    state.screen = target.screen;
    state.boardId = target.boardId;
    applyQueryParams();
  }

  function handleLocationChange() {
    var target = parseScreenFromHash();
    var prevScreen = state.screen;
    var prevBoard = state.boardId;
    var isDirtyStyle = prevScreen === "style" && !eq(state.draft, state.committed);
    var leavingDirtyStyle = isDirtyStyle && target.screen !== "style";
    if (leavingDirtyStyle) {
      // Browser back (or hash pop) from dirty style: bounce to keep URL + screen on style,
      // show the same Confirm dialog as internal back(). On confirm leave we history.back()
      // to actually pop to the target.
      state.picker = null;
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
    var leavingDirtyBoard =
      prevScreen === "board" &&
      (boardDirty() || styleDirty()) &&
      (target.screen !== "board" ||
        (target.boardId || null) !== (prevBoard || null));
    if (leavingDirtyBoard) {
      state.picker = null;
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
    if (target.screen !== prevScreen || boardChanged) {
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
    if (payload.dataSources && payload.dataSources.length) {
      D.dataSources = payload.dataSources;
    }
    if (payload.boards && payload.boards.length) {
      D.boards = payload.boards;
      var bi;
      for (bi = 0; bi < payload.boards.length; bi++) {
        var pack = payload.boards[bi];
        var keepDirty =
          state.screen === "board" &&
          boardDirty() &&
          state.boardDraft &&
          state.boardDraft.id === pack.id;
        if (!keepDirty) rememberBoardSnap(pack);
      }
      if (state.screen === "board" && state.boardId && !boardDirty()) {
        var fresh = find(D.boards, resolveBoardId(state.boardId));
        if (fresh) {
          state.boardDraft = clone(fresh);
          state.boardCommitted = clone(fresh);
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
      // Keep draft numbers inside the live tile set (sheet conditionals).
      fromSheet.scrollSpeed = clampDraftSpeed(
        fromSheet.scrollSpeed,
        "scroll"
      );
      fromSheet.presentationSpeed = clampDraftSpeed(
        fromSheet.presentationSpeed,
        "presentation"
      );
      state.committed = clone(fromSheet);
      if (!state.sheetDirty) {
        state.draft = clone(fromSheet);
        applyQueryParams();
      }
    }
    state.sheetSource = "sheet";
    applyTheme();
    renderAll();
    if (state.screen === "style") {
      // Sheet may have new presentation/speed/etc. Retarget keeps the plate elements
      // (no remount) but adopts the new phase timings/zoom per glossary.
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

  function loadSheet(opts) {
    opts = opts || {};
    var loader = window.TOKI_MANAGER_SHEET;
    if (!loader || !loader.load) {
      state.sheetSource = "local";
      return;
    }
    if (opts.force) toast("Reloading sheet…");
    loader
      .load(opts)
      .then(function (payload) {
        if (opts.force) state.sheetDirty = false;
        applySheetPayload(payload);
        if (payload && payload.sourceName) {
          toast("Loaded " + payload.sourceName + " from sheet");
        }
      })
      .catch(function (err) {
        console.warn("Menu Manager sheet load failed", err);
        var fb = loader.loadFallback;
        if (!fb) {
          state.sheetSource = "local";
          renderAll();
          toast("Could not load sheet — using local defaults");
          return;
        }
        return fb(state.draft && state.draft.dataSource).then(function (payload) {
          if (payload && payload.ok) {
            applySheetPayload(payload);
            toast("Loaded last saved fallback");
            return;
          }
          state.sheetSource = "local";
          renderAll();
          toast("Could not load sheet — using local defaults");
        });
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
    } else if (act === "picker-dismiss") {
      state.picker = null;
      renderPicker();
    } else if (act === "open-sheet") {
      openSheet();
    } else if (act === "open-settings-sheet") {
      window.open(D.settingsSheetUrl, "_blank", "noopener");
    } else if (act === "open-permalink") {
      state.dialog = "open-permalink";
      renderDialog();
    } else if (act === "permalink-no") {
      state.dialog = null;
      renderDialog();
    } else if (act === "permalink-yes") {
      state.dialog = null;
      renderDialog();
      var permaPrev = state.boardDraft
        ? state.lastBoardSnap[state.boardDraft.id] ||
          boardSettingsSnap(state.boardCommitted)
        : null;
      var permaStylePrev = styleSnap(state.committed);
      if (state.lastSheet && state.lastSheet.style) {
        permaStylePrev = Object.assign({}, permaStylePrev, state.lastSheet.style);
      }
      if (state.boardDraft) state.boardCommitted = clone(state.boardDraft);
      state.committed = clone(state.draft);
      var href = state.boardDraft && state.boardDraft.permalink;
      Promise.all([
        persistBoardWrite(permaPrev),
        persistStyleWrite(permaStylePrev),
      ]).then(function (pair) {
        var out = {
          needed: !!(pair[0] && pair[0].needed) || !!(pair[1] && pair[1].needed),
          wrote: Object.assign(
            {},
            (pair[1] && pair[1].wrote) || {},
            (pair[0] && pair[0].wrote) || {}
          ),
        };
        if (pair[0] && pair[0].wrote && pair[0].wrote.ok) out.wrote.wroteBoard = true;
        if (href) {
          window.open(href, "_blank", "noopener");
          if (out && out.needed && out.wrote && out.wrote.ok) {
            toast("Board saved — opened permalink");
          } else if (out && out.needed) {
            toast("Could not write board — opened permalink");
          } else {
            toast("Opened permalink");
          }
        } else toast("No permalink on this board");
      }).catch(function (err) {
        console.warn("Menu Manager permalink save failed", err);
        if (href) {
          window.open(href, "_blank", "noopener");
          toast("Could not write board — opened permalink");
        } else toast("No permalink on this board");
      });
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
    } else if (act === "toast-add") {
      toast("Coming soon — add items from Toast.");
    } else if (act === "copy-hex") {
      copyHex(t.getAttribute("data-hex"));
    } else if (act === "reload-sheet") {
      loadSheet({ force: true });
    }
  }

  function onKey(e) {
    if (e.key === "Escape") back();
  }

  function fitDevice() {
    var device = els.device;
    var slot = document.getElementById("device-slot");
    var native = window.matchMedia("(max-width: 520px)").matches;
    device.classList.toggle("is-native", native);
    if (native) {
      device.style.transform = "";
      if (slot) {
        slot.style.width = "";
        slot.style.height = "";
      }
      return;
    }
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
    els.device.addEventListener("click", onClick);
    function blockHeroScroll(e) {
      if (e.target.closest && e.target.closest(".status, .preview, .header, .home-hero")) {
        e.preventDefault();
      }
    }
    els.device.addEventListener("touchmove", blockHeroScroll, { passive: false });
    els.device.addEventListener("wheel", blockHeroScroll, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", fitDevice);
    window.addEventListener("hashchange", handleLocationChange);
    window.addEventListener("popstate", handleLocationChange);
    readHash();
    writeHash(false);
    applyTheme();
    watchFonts();
    fitDevice();
    renderAll();
    loadSheet();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

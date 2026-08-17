/**
 * OliToki Menu Manager — layout + one-way sheet read.
 * Draft theme tokens restyle the app immediately. Confirm-on-back is local only
 * (no Google Sheet writes).
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

  function watchFonts() {
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
    return hash || D.version;
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
    if (!act) {
      return (
        '<div class="footer-bar footer-soon"><span>' +
        escapeHtml(label) +
        "</span></div>"
      );
    }
    return (
      '<button class="footer-bar" type="button" data-act="' +
      act +
      '">' +
      '<span class="plus-circle" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
      "</span><span>" +
      escapeHtml(label) +
      "</span></button>"
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
      items +=
        '<button class="nav-item" type="button" data-act="go" data-to="board" data-board="' +
        b.id +
        '">' +
        escapeHtml(b.title) +
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

  function screenBoard() {
    var board = find(D.boards, state.boardId);
    var feats = D.comingSoonFeatures
      .map(function (f) {
        return "<dd>" + escapeHtml(f) + "</dd>";
      })
      .join("");
    return (
      '<section class="screen screen-soon">' +
      header(board.title) +
      '<div class="soon-body">' +
      '<h2 class="soon-title">Coming Soon</h2>' +
      '<p class="soon-sub">(edit google sheet for now)</p>' +
      '<dl class="soon-features"><dt>Features:</dt>' +
      feats +
      "</dl></div>" +
      footerBar("Add Item From Toast", "toast-add") +
      "</section>"
    );
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
    if (d.background === "pattern" || d.background === "wallpaper") {
      html += row({
        key: "bgColor",
        label: "Background Color",
        value: labelOf(D.colorRoles, d.bgColor || "main"),
        child: true,
      });
    }
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
    var encore = d.presentation === "encore";
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
      '><div class="preview-pattern-track"></div></div>' +
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
      '<div class="preview-plate">' +
      '<div class="preview-anim">' +
      '<img class="preview-food" alt="" src="' +
      escapeHtml(first.src) +
      '"></div></div>' +
      '<div class="preview-fp-world' +
      (encore ? " " + encoreStageClass(d) : "") +
      '">' +
      '<div class="family-portrait-rig">' +
      '<div class="family-portrait-plates"></div></div></div>' +
      '<div class="preview-encore-shroud' +
      (encore ? " " + encoreStageClass(d) : "") +
      '"' +
      (encore ? "" : " hidden") +
      "></div></div>" +
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
    els.app.innerHTML = html;
    applyTheme();
    if (state.screen === "home") attachPeak();
    if (state.screen === "style") {
      var sc = document.getElementById("style-scroll");
      if (sc) sc.scrollTop = state.styleScroll;
      restorePillScroll();
      bindWpFallback();
      /* Do not start motion until the sheet has resolved. loadSheet →
         renderAll used to remount mid Punch-In, so the plate snapped and
         the next photo just appeared (0696e41 never had that remount). */
      if (state.sheetSource === "loading") {
        parkPreviewStill();
      } else {
        // Guardrail: double-rAF after innerHTML lets layout + CSS vars on .preview
        // (incl. --ease-fade / --ease-out) settle before snap + rAF kick. Extra frame
        // protects against races after sheet apply, picker changes, or hash nav.
        // Prevents remount teardown and makes KB/Slideshow reliable (MOTION_GLOSSARY 3, 4).
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (state.screen === "style" && state.sheetSource !== "loading") {
              startPreviewCycle();
            }
          });
        });
      }
    } else {
      stopPreviewCycle();
    }
  }

  function pickerSpec(key) {
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
        note: "Note: Presentation styles are applied per-board.",
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
    if (state.screen === "board" || state.screen === "system" || state.screen === "menu") {
      history.back();
      return;
    }
  }

  function openPicker(key) {
    var spec = pickerSpec(key);
    if (!spec) return;
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
    spec.set(id);
    state.picker = null;
    state.sheetDirty = true;
    applyTheme();
    renderAll();
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

  function confirmChoice(val) {
    if (val === "yes") {
      state.committed = clone(state.draft);
      state.dialog = null;
      toast("Saved for this session (sheet write not wired yet).");
      var next = state.pendingLeave;
      state.pendingLeave = null;
      if (next) next();
      else renderAll();
      return;
    }
    if (val === "no") {
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

  function motionPhases() {
    var TM = window.TOKI_MOTION;
    var mode = state.draft.presentation;
    var style = TM
      ? TM.styleByMode(mode)
      : D.motionDefaults;
    var speed = Number(state.draft.presentationSpeed) || 0;
    var encore = mode === "encore";
    var kb = mode === "kenburns";
    var punchIn = style.punchIn != null ? style.punchIn : 3.4;
    var punchOut = style.punchOut != null ? style.punchOut : 0.45;
    var holdRaw = style.hold != null ? style.hold : 1;
    var hold = encore && TM ? TM.encoreHold(holdRaw) : holdRaw;
    var veilIn = encore && TM ? TM.encoreVeilIn(punchIn) : Math.min(0.45, punchIn);
    return {
      punchIn: punchIn,
      hold: hold,
      punchOut: punchOut,
      veilIn: veilIn,
      opacityDur: TM ? TM.OPACITY_DUR : 0.45,
      zoomMin: kb ? 0.93 : 1,
      zoomMax: kb ? 1 : encore ? (style.zoomTo || 1.24) : 1,
      paused: speed <= 0,
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

  function encoreWorldEl() {
    return els.app.querySelector(".preview-fp-world");
  }

  function encoreShroudEl() {
    return els.app.querySelector(".preview-encore-shroud");
  }

  function encoreRigEl() {
    return els.app.querySelector(".preview-fp-world .family-portrait-rig");
  }

  function imageBoxOrigin() {
    var preview = els.app.querySelector(".preview");
    var h = preview && preview.clientHeight ? preview.clientHeight : 0;
    var u = h / 300;
    return {
      x: 250 * u,
      y: 150 * u,
      u: u,
      h: h,
      w: preview ? preview.clientWidth : 0,
    };
  }

  function encorePinchPx() {
    if (state.draft.encoreStyle === "soft") return 0;
    var TM = window.TOKI_MOTION;
    var o = imageBoxOrigin();
    var holeR = 0.42 * 300 * o.u;
    if (TM && TM.scaledHolePinch) return TM.scaledHolePinch(holeR);
    return holeR ? 40 * (holeR / 160) : 40;
  }

  function currentLatticeSlot() {
    var layout = previewCtl.lattice;
    if (!layout || !layout.slots || !layout.slots.length) return null;
    var i = state.previewIndex || 0;
    return layout.slots[i] || layout.slots[0] || null;
  }

  function encoreCenterPoint() {
    var layout = previewCtl.lattice;
    if (!layout || typeof layout.stageW !== "number") return null;
    return { x: layout.stageW / 2, y: layout.stageH / 2 };
  }

  function placeEncoreWorldAt(point) {
    var world = encoreWorldEl();
    var o = imageBoxOrigin();
    if (!world || o.h <= 0 || !point) return;
    var s = o.h / 1080;
    // Re-apply the fixed form-factor scale (idempotent). Do not clobber during camera anims.
    if (!world.style.transform || world.style.transform.indexOf("scale(") !== 0) {
      world.style.transform = "scale(" + s + ")";
    }
    world.style.left = o.x - point.x * s + "px";
    world.style.top = o.y - point.y * s + "px";
    world.style.setProperty("--encore-hole-x", point.x + "px");
    world.style.setProperty("--encore-hole-y", point.y + "px");
  }

  function placeEncoreWorld() {
    placeEncoreWorldAt(currentLatticeSlot());
  }

  function setPreviewEncoreHoleProps() {
    var preview = els.app.querySelector(".preview");
    var o = imageBoxOrigin();
    if (preview && o) {
      preview.style.setProperty("--encore-hole-x", o.x + "px");
      preview.style.setProperty("--encore-hole-y", o.y + "px");
      if (o.u) preview.style.setProperty("--encore-hole-r", 0.42 * 300 * o.u + "px");
    }
  }

  function setEncoreOrigin() {
    setPreviewEncoreHoleProps();
    var slot = currentLatticeSlot();
    if (slot) placeEncoreWorldAt(slot);
  }

  function appendPreviewPortraitSticker(slotEl, photoScale) {
    var el = document.createElement("div");
    el.className = "family-portrait-sticker";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<img class="new-sticker-shadow" alt="" src="' +
      D.sticker.shadow +
      '">' +
      '<div class="new-sticker-body">' +
      '<img class="new-sticker-body-img" alt="" src="' +
      D.sticker.body +
      '">' +
      '<span class="new-sticker-tint"></span></div>' +
      '<span class="new-sticker-label">New!</span>';
    var ox = 280 * photoScale;
    var oy = 160 * photoScale;
    el.style.left = "calc(50% + " + ox + "px)";
    el.style.top = "calc(50% + " + oy + "px)";
    var stickScale = Math.max(0.16, Math.min(0.4, photoScale * 0.9));
    el.style.transform = "translate(-50%, -50%) scale(" + stickScale + ")";
    slotEl.appendChild(el);
  }

  function fillPortraitGrid() {
    var host = els.app.querySelector(
      ".preview-fp-world .family-portrait-plates"
    );
    var world = encoreWorldEl();
    var L = window.TOKI_LATTICE;
    if (!host || !L) return null;
    host.innerHTML = "";
    var items = D.previewItems;
    var layout = L.buildPortraitLayout(items.length);
    previewCtl.lattice = layout;
    var i;
    for (i = 0; i < items.length; i++) {
      var slot = layout.slots[i];
      var it = items[i];
      if (!slot || !it) continue;
      var wrap = document.createElement("div");
      wrap.className = "family-portrait-slot";
      wrap.style.left = slot.x + "px";
      wrap.style.top = slot.y + "px";
      wrap.style.zIndex = String(slot.zIndex);
      var img = document.createElement("img");
      img.className = "family-portrait-item";
      img.alt = "";
      img.draggable = false;
      img.src = it.src;
      img.style.transform =
        "translate(-50%, -50%) scale(" + layout.scale + ")";
      wrap.appendChild(img);
      if (it.isNew) appendPreviewPortraitSticker(wrap, layout.scale);
      host.appendChild(wrap);
    }
    try {
      var q = new URLSearchParams(location.hash.split("?")[1] || location.search || "");
      if (world && (q.get("portraitDebug") === "1" || q.get("portraitDebug") === "true")) {
        world.classList.add("portrait-debug");
      }
    } catch (e) {
      /* ignore */
    }
    // Initial park prefers center (family spread). The first "in" will drive the
    // camera push (lateral + zoom) to the starting item. Matches Encore wind-up
    // centering + MOTION_GLOSSARY §5.0 / §5.6.
    var initP = encoreCenterPoint() || currentLatticeSlot();
    if (initP) {
      placeEncoreWorldAt(initP);
    } else {
      setEncoreOrigin();
    }
    setPreviewEncoreHoleProps();
    return layout;
  }

  function applyEncoreChrome(item) {
    var world = encoreWorldEl();
    var shroud = encoreShroudEl();
    var nodes = [world, shroud];
    var d = state.draft;
    var n;
    for (n = 0; n < nodes.length; n++) {
      if (!nodes[n]) continue;
      nodes[n].classList.remove(
        "encore-spot-hard",
        "encore-spot-hard-shadow",
        "encore-spot-soft",
        "encore-spot-color-highlight",
        "encore-spot-color-black"
      );
      if (d.encoreStyle === "soft") nodes[n].classList.add("encore-spot-soft");
      else if (d.encoreStyle === "hard_shadow") {
        nodes[n].classList.add("encore-spot-hard", "encore-spot-hard-shadow");
      } else {
        nodes[n].classList.add("encore-spot-hard");
      }
      if (d.encoreSpot === "highlight") {
        nodes[n].classList.add("encore-spot-color-highlight");
      } else {
        nodes[n].classList.add("encore-spot-color-black");
      }
    }
    var preview = els.app.querySelector(".preview");
    if (preview) {
      preview.style.setProperty("--encore-veil-color", spotlightHex(item));
    }
    // Do not call setEncoreOrigin / place here. Parking the lattice (slot vs center)
    // is managed inside beginPhase camera phases so punch-in/out can include
    // lateral motion. We still keep the fixed visual hole/radius up to date.
    setPreviewEncoreHoleProps();
  }

  function setEncoreZoom(scale) {
    var world = encoreWorldEl();
    if (world) world.style.setProperty("--encore-zoom", String(scale));
  }

  function setEncorePinch(px) {
    var preview = els.app.querySelector(".preview");
    var shroud = encoreShroudEl();
    var v = Math.max(0, px) + "px";
    if (preview) preview.style.setProperty("--encore-hole-pinch", v);
    if (shroud) shroud.style.setProperty("--encore-hole-pinch", v);
  }

  function snapEncoreCamera(zoom, pinch) {
    var rig = encoreRigEl();
    var shroud = encoreShroudEl();
    var world = encoreWorldEl();
    if (rig) rig.style.transition = "none";
    if (shroud) shroud.style.transition = "none";
    if (world) world.style.transition = "none";
    setEncoreZoom(zoom);
    setEncorePinch(pinch);
    void (rig && rig.offsetWidth);
    void (world && world.offsetWidth);
  }

  function encoreRigTransition(sec, easeVar, includePinch) {
    var t = "transform " + sec + "s var(" + easeVar + ", ease)";
    if (includePinch) {
      t += ", --encore-hole-pinch " + sec + "s var(" + easeVar + ", ease)";
    }
    return t;
  }

  function setEncoreDimmed(on, veilSec) {
    var shroud = encoreShroudEl();
    var preview = els.app.querySelector(".preview");
    if (veilSec != null && preview) {
      preview.style.setProperty("--motion-veil", veilSec + "s");
    }
    if (shroud) {
      if (veilSec != null) {
        shroud.style.transition =
          "opacity " + veilSec + "s var(--ease-fade, ease)";
      }
      shroud.classList.toggle("is-dimmed", !!on);
    }
  }

  function setEncoreStageVisible(on) {
    var world = encoreWorldEl();
    if (world) world.classList.toggle("is-visible", !!on);
  }

  function applyPreviewItem(item) {
    var img = els.app.querySelector(".preview-food");
    var sticker = els.app.querySelector(".preview-sticker");
    if (img) img.src = item.src;
    if (sticker) sticker.hidden = !item.isNew;
    if (state.draft.presentation === "encore") {
      applyEncoreChrome(item);
    }
    armHighlightClock(motionPhases().punchOut);
    syncPreviewNums(state.previewIndex || 0, false);
  }

  function currentScale(el) {
    if (!el) return 1;
    var t = getComputedStyle(el).transform;
    if (!t || t === "none") return 1;
    var m = t.match(/matrix\(([^)]+)\)/);
    if (m) return Math.abs(parseFloat(m[1].split(",")[0])) || 1;
    var m3 = t.match(/matrix3d\(([^)]+)\)/);
    if (m3) return Math.abs(parseFloat(m3[1].split(",")[0])) || 1;
    return 1;
  }

  /* Plate runner per MOTION_GLOSSARY 3 (Slideshow) and 4 (Ken Burns).
     .preview-plate owns fade (opacity 0→1/1→0). .preview-anim owns Ken Burns
     scale only (0.93→1 on in; reverse on out). Sticker is sibling, fades but
     does not scale. Inline transform + explicit transition to ensure it runs.
     Uses concrete EASE from TOKI_MOTION (glossary) + var fallback; explicit
     flush after transition decls (and before targets) is the guardrail so values
     never snap. */
  function setPlate(opacity, zoom, dur, kind) {
    var plate = els.app.querySelector(".preview-plate");
    var anim = els.app.querySelector(".preview-anim");
    if (!plate) return;
    var phases = motionPhases();
    var fade = phases.opacityDur || 0.45;
    var move = Math.max(0.02, dur || phases.punchIn);
    var TM = window.TOKI_MOTION;
    var fadeEase = (TM && TM.EASE && TM.EASE.fade) || "var(--ease-fade, ease)";
    var outEase = (TM && TM.EASE && TM.EASE.out) || "var(--ease-out, ease-out)";
    var zoomEase = kind === "out" ? fadeEase : outEase;
    var z = Number(zoom);
    if (!isFinite(z)) z = 1;
    plate.style.transition = "opacity " + fade + "s " + fadeEase;
    plate.style.setProperty("--hero-zoom", String(z));
    plate.classList.toggle(
      "is-kb-in",
      kind === "in" && state.draft.presentation === "kenburns"
    );
    if (anim) {
      anim.style.transition = "transform " + move + "s " + zoomEase;
      anim.style.setProperty("--hero-zoom", String(z));
    }
    var sticker = els.app.querySelector(".preview-sticker");
    var showSticker = !!(sticker && !sticker.hidden);
    if (showSticker) {
      sticker.style.transition = "opacity " + fade + "s " + fadeEase;
    }
    // Force reflow after declaring transitions (before writing target values) so
    // the 0→1 fade and 0.93→1 zoom actually run instead of appearing.
    // This + double-rAF start + concrete EASE guard against future races.
    // Sticker gets same flush treatment when visible.
    void (plate && plate.offsetWidth);
    if (anim) void (anim.offsetWidth);
    if (showSticker) void (sticker.offsetWidth);
    if (anim) {
      anim.style.transform = "scale(" + z + ")";
    }
    plate.style.opacity = String(opacity);
    if (showSticker) {
      sticker.style.opacity = String(opacity);
    }
  }

  function snapPlate(opacity, zoom) {
    var plate = els.app.querySelector(".preview-plate");
    var anim = els.app.querySelector(".preview-anim");
    var z = Number(zoom);
    if (!isFinite(z)) z = 1;
    if (plate) {
      plate.style.transition = "none";
      plate.classList.remove("is-kb-in");
      plate.style.setProperty("--hero-zoom", String(z));
      plate.style.opacity = String(opacity);
    }
    if (anim) {
      anim.style.transition = "none";
      anim.style.setProperty("--hero-zoom", String(z));
      anim.style.transform = "scale(" + z + ")";
    }
    var sticker = els.app.querySelector(".preview-sticker");
    if (sticker) {
      sticker.style.transition = "none";
      sticker.style.opacity = sticker.hidden ? "0" : String(opacity);
    }
    void (plate && plate.offsetWidth);
    void (anim && anim.offsetWidth);
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
    if (speed <= 0) return;
    previewCtl.stripeY = (previewCtl.stripeY + speed * dt) % period;
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
    var mode = state.draft.presentation;
    var encore = mode === "encore";
    var TM = window.TOKI_MOTION;
    var zoomTo = TM && TM.ENCORE ? TM.ENCORE.zoomTo : 1.24;
    previewCtl.phase = phase;
    var tgt = phaseTarget(phase, phases, mode);
    var rig = encoreRigEl();

    if (phases.paused) {
      previewCtl.phaseDur = 0;
      if (encore) {
        // For holdGrid (or rest state) park at center per MOTION_GLOSSARY §5.6 so entire
        // family spread is visible and centered after punch-out.
        var park = state.holdGrid ? (encoreCenterPoint() || currentLatticeSlot()) : currentLatticeSlot();
        if (park) {
          placeEncoreWorldAt(park);
        } else {
          setEncoreOrigin();
        }
        setPreviewEncoreHoleProps();
        setEncoreStageVisible(true);
        if (state.holdGrid) {
          snapEncoreCamera(1, 0);
          setEncoreDimmed(false, 0);
        } else {
          snapEncoreCamera(zoomTo, encorePinchPx());
          setEncoreDimmed(true, 0.2);
        }
      } else {
        setPlate(1, tgt.zoom, 0.25, "in");
      }
      armHighlightClock(phases.punchOut);
      syncPreviewNums(state.previewIndex || 0, false);
      return;
    }

    previewCtl.phaseDur = Math.max(0.03, tgt.dur);
    previewCtl.phaseT0 = performance.now();
    armHighlightClock(phases.punchOut);

    if (encore && phase === "in") {
      var first = !!previewCtl.encoreFirst;
      previewCtl.encoreFirst = false;
      var targetSlot = currentLatticeSlot();
      // Do not snap park to slot immediately. Per feedback + MOTION_GLOSSARY §5.6,
      // the punch-in must include lateral camera movement (park shift from family center
      // to target slot while zooming 1→1.24). Snapping x/y before the zoom produced
      // non-camera motion.
      if (first) {
        // First bow after fill (which parks center): start camera push from centered 1×.
        // The park-to-slot + zoom happens inside the timed block below.
        snapEncoreCamera(1, 0);
        setEncoreDimmed(false, 0);
        setEncoreStageVisible(false);
        void (encoreWorldEl() && encoreWorldEl().offsetWidth);
        setEncoreStageVisible(true);
      } else {
        setEncoreDimmed(false, 0);
        snapEncoreCamera(1, 0);
        // Ensure we are at center park coming out of previous Punch-Out (MOTION_GLOSSARY §5.6).
        // Snap the park instantly (no trans) at 1× before starting the new camera in.
        var c = encoreCenterPoint();
        if (c) {
          var w = encoreWorldEl();
          if (w) w.style.transition = "none";
          placeEncoreWorldAt(c);
          void (w && w.offsetWidth);
        }
      }
      previewAfter(20, gen, function () {
        var preview = els.app.querySelector(".preview");
        var worldEl = encoreWorldEl();
        if (rig) {
          rig.style.transition = encoreRigTransition(
            phases.punchIn,
            "--ease-out",
            false
          );
        }
        // Drive lateral + zoom together for camera-like push-in (no pre-zoom snap).
        if (worldEl && targetSlot) {
          var t = phases.punchIn + "s var(--ease-out, ease)";
          worldEl.style.transition =
            "left " + t + ", top " + t + ", --encore-hole-x " + t + ", --encore-hole-y " + t;
          placeEncoreWorldAt(targetSlot);
        }
        if (preview) {
          preview.style.transition =
            "--encore-hole-pinch " +
            phases.punchIn +
            "s var(--ease-out, ease)";
        }
        setEncoreZoom(zoomTo);
        setEncorePinch(encorePinchPx());
        setEncoreDimmed(true, phases.veilIn);
        syncPreviewNums(state.previewIndex || 0, false);
        schedulePhaseEnd(gen);
      });
      return;
    }

    if (encore && phase === "out") {
      // Punch-Out camera per MOTION_GLOSSARY §5.6: undim veil (0.45s), zoom 1.24→1
      // (ease-fade), pinch kept, grid stays. To center the family portrait and provide
      // lateral camera movement (not straight-out from slot, not x/y snap before next in),
      // we also animate the world parking offset + rig origin from leaving slot to
      // plane center during the same 0.45s. This produces the pull-back + pan so the
      // entire spread is framed centered at 1× after punch-out.
      setEncoreDimmed(false, phases.punchOut);
      var centerP = encoreCenterPoint();
      var worldEl = encoreWorldEl();
      if (worldEl && centerP) {
        var tsec = phases.punchOut;
        var t = tsec + "s var(--ease-fade, ease)";
        if (rig) {
          rig.style.transition = "transform " + t;
        }
        worldEl.style.transition =
          "left " + t + ", top " + t + ", --encore-hole-x " + t + ", --encore-hole-y " + t;
        void worldEl.offsetWidth;
        placeEncoreWorldAt(centerP);
      } else if (rig) {
        rig.style.transition = encoreRigTransition(
          phases.punchOut,
          "--ease-fade",
          false
        );
      }
      void (rig && rig.offsetWidth);
      void (encoreWorldEl() && encoreWorldEl().offsetWidth);
      setEncoreZoom(1);
      syncPreviewNums(state.previewIndex || 0, true);
      schedulePhaseEnd(gen);
      return;
    }

    if (encore && phase === "hold") {
      schedulePhaseEnd(gen);
      return;
    }

    // Always snap "from" state for "out" (and when caller asks for in) so that
    // the fade/zoom transition is forced from a committed value. Prevents snap-to-final
    // when coming out of hold or after other style updates. Matches MOTION_GLOSSARY 3/4.
    var doSnap = snap || phase === "out";
    if (doSnap) {
      snapPlate(
        phase === "out" ? 1 : 0,
        phase === "out" ? tgt.zoom : phases.zoomMin
      );
    }
    if (phase === "in" && snap) {
      // Use chained rAFs (instead of fixed timeout) after snap to ensure the "from"
      // state (opacity 0 / zoomMin) is committed by the browser before we declare
      // the transition and set the target values. This, combined with the
      // offsetWidth flush inside setPlate and the double-rAF at renderScreen entry,
      // makes the fade+zoom survive re-renders from hash, sheet conditionals,
      // picker, etc. See MOTION_GLOSSARY §3/4 and ticket 2026-08-16 Ken Burns...
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (gen === previewCtl.gen) {
            setPlate(tgt.opacity, tgt.zoom, previewCtl.phaseDur, "in");
            syncPreviewNums(state.previewIndex || 0, false);
            schedulePhaseEnd(gen);
          }
        });
      });
      return;
    }
    if (phase === "out") syncPreviewNums(state.previewIndex || 0, true);
    setPlate(tgt.opacity, tgt.zoom, previewCtl.phaseDur, phase === "out" ? "out" : "in");
    schedulePhaseEnd(gen);
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
    var gen = previewCtl.gen;
    var phases = motionPhases();
    var mode = state.draft.presentation;
    previewCtl.timers.forEach(clearTimeout);
    previewCtl.timers = [];
    if (!previewCtl.phase) {
      runPreviewBlock(state.previewIndex || 0, gen);
      return;
    }
    if (mode === "encore") {
      if (phases.paused) {
        var p = state.holdGrid ? (encoreCenterPoint() || currentLatticeSlot()) : currentLatticeSlot();
        if (p) {
          placeEncoreWorldAt(p);
        } else {
          setEncoreOrigin();
        }
        setPreviewEncoreHoleProps();
        setEncoreStageVisible(true);
        snapEncoreCamera(phases.zoomMax, encorePinchPx());
        setEncoreDimmed(true, 0.2);
        syncPreviewNums(state.previewIndex || 0, false);
        return;
      }
      beginPhase(previewCtl.phase, gen, false);
      return;
    }
    if (phases.paused) {
      setPlate(1, mode === "slideshow" ? 1 : phases.zoomMax, 0.2, "in");
      return;
    }
    var tgt = phaseTarget(previewCtl.phase, phases, mode);
    var elapsed = (performance.now() - previewCtl.phaseT0) / 1000;
    var oldDur = Math.max(0.03, previewCtl.phaseDur || tgt.dur);
    var p = Math.min(1, Math.max(0, elapsed / oldDur));
    var remaining = Math.max(0.04, tgt.dur * (1 - p));
    var plate = els.app.querySelector(".preview-plate");
    var anim = els.app.querySelector(".preview-anim");
    if (plate) {
      var opNow = getComputedStyle(plate).opacity;
      plate.style.transition = "none";
      plate.style.opacity = opNow;
    }
    if (anim) {
      var zNow = currentScale(anim);
      anim.style.transition = "none";
      anim.style.setProperty("--hero-zoom", String(zNow));
      anim.style.transform = "scale(" + zNow + ")";
    }
    void (plate && plate.offsetWidth);
    previewCtl.phaseDur = tgt.dur;
    previewCtl.phaseT0 = performance.now() - p * tgt.dur * 1000;
    setPlate(tgt.opacity, tgt.zoom, remaining, previewCtl.phase === "out" ? "out" : "in");
    previewAfter(remaining * 1000, gen, function () {
      advancePhase(gen);
    });
  }

  function runPreviewBlock(index, gen) {
    if (gen !== previewCtl.gen) return;
    var items = D.previewItems;
    if (!items.length) return;
    var i = ((index % items.length) + items.length) % items.length;
    state.previewIndex = i;
    previewCtl.itemIndex = i;
    applyPreviewItem(items[i]);
    beginPhase("in", gen, true);
  }

  function parkPreviewStill() {
    stopPreviewCycle();
    var items = D.previewItems;
    var item = items[state.previewIndex || 0] || items[0];
    if (item) applyPreviewItem(item);
    if (state.draft.presentation === "encore") {
      fillPortraitGrid();
      setEncoreStageVisible(true);
      return;
    }
    snapPlate(1, state.draft.presentation === "slideshow" ? 1 : 1);
  }

  function startPreviewCycle() {
    stopPreviewCycle();
    previewCtl.encoreFirst = true;
    previewCtl.lattice = null;
    if (state.draft.presentation === "encore") {
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
    readHash();
    var boardChanged = (target.boardId || null) !== (prevBoard || null);
    if (target.screen !== prevScreen || boardChanged) {
      renderAll();
    } else {
      // Same screen (hashchange/pop from our writeHash when entering Style,
      // or other self events). Skip renderAll — a rebuild would remount
      // .preview-plate / .preview-anim and tear down the running cycle
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
    if (payload.themes && payload.themes.length) {
      D.themes = payload.themes;
    }
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
        state.sheetSource = "local";
        renderAll();
        toast("Could not load sheet — using local defaults");
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

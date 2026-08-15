/**
 * OliToki Menu Manager — layout prototype.
 * Draft theme tokens restyle the app immediately. Confirm-on-back is local only
 * (no Google Sheet writes in this prototype).
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
    previewTimer: null,
    toastTimer: null,
    styleScroll: 0,
    pendingLeave: null,
  };

  var previewCtl = { gen: 0, timers: [], raf: 0 };

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

  function statusBlock() {
    return (
      '<div class="status">' +
      "<p>Data Source: " +
      escapeHtml(dataSource().name) +
      "</p>" +
      "<p>Current Theme: " +
      escapeHtml(themeStatusName()) +
      "</p>" +
      "<p>Menus on?: 1, 2, 3, 4</p>" +
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

  function speedRow(label, key, value, max) {
    var html =
      '<div class="row' +
      (key === "scrollSpeed" ? " is-child" : "") +
      '">' +
      '<span class="row-label">' +
      escapeHtml(label) +
      "</span>" +
      '<div class="pills" data-pills="' +
      key +
      '" data-range-min="0" data-range-max="' +
      max +
      '">';
    for (var i = 0; i <= max; i++) {
      html +=
        '<button class="pill' +
        (i === value ? " is-on" : "") +
        '" type="button" data-act="pill" data-key="' +
        key +
        '" data-val="' +
        i +
        '">' +
        i +
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
      '<div class="rows">' +
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
      "</div></section>"
    );
  }

  function screenMenu() {
    var items = '<div class="nav-wrap"><div class="nav-list">';
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
      value: labelOf(D.backgroundOptions, d.background),
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
        D.speedTiles.scroll.max
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
        D.speedTiles.scroll.max
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
      D.speedTiles.presentation.max
    );
    return html;
  }

  function wallpaperSrc() {
    var paper = find(D.wallpapers, state.draft.wallpaper);
    return paper && paper.src ? paper.src : D.wallpapers[0].src;
  }

  function scrollDurationSec() {
    var speed = Number(state.draft.scrollSpeed) || 0;
    if (speed <= 0) return 0;
    var period = 44;
    var px = 28 * 0.45 * speed;
    return Math.max(0.45, period / Math.max(0.01, px));
  }

  function previewHtml() {
    var d = state.draft;
    var encore = d.presentation === "encore";
    var fill = encore
      ? roleHex(d.encoreBg)
      : d.background === "pattern" || d.background === "wallpaper"
        ? roleHex("main")
        : roleHex(d.background);
    var scrollOn =
      !encore &&
      d.scrollSpeed > 0 &&
      (d.background === "pattern" || d.background === "wallpaper");
    var veilKind =
      d.encoreStyle === "soft"
        ? "soft"
        : d.encoreStyle === "hard"
          ? "hard"
          : "hard-shadow";
    var veilFill =
      d.encoreSpot === "highlight" ? currentTheme().highlight : "#000000";
    var wp = wallpaperSrc();
    return (
      '<div class="preview" style="--preview-fill:' +
      fill +
      ";--pattern-a:" +
      roleHex(d.patternColor1) +
      ";--pattern-b:" +
      roleHex(d.patternColor2) +
      ";--wallpaper-image:url('" +
      wp +
      "');--scroll-dur:" +
      scrollDurationSec() +
      's;--veil-fill:' +
      veilFill +
      '">' +
      '<div class="preview-layer preview-solid"></div>' +
      '<div class="preview-layer preview-pattern' +
      (scrollOn && d.background === "pattern" ? " is-scrolling" : "") +
      '"' +
      (encore || d.background !== "pattern" ? " hidden" : "") +
      '><div class="preview-pattern-track"></div></div>' +
      '<div class="preview-layer preview-wallpaper"' +
      (encore || d.background !== "wallpaper" ? " hidden" : "") +
      ">" +
      '<div class="preview-wp preview-wp-a is-on"></div>' +
      '<div class="preview-wp preview-wp-b"></div></div>' +
      '<div class="preview-plate">' +
      '<div class="preview-anim">' +
      '<img class="preview-food" alt="" src="' +
      (D.previewItems[0] && D.previewItems[0].src) +
      '">' +
      '<div class="preview-sticker" hidden>' +
      '<img class="preview-sticker-shadow" alt="" src="' +
      D.sticker.shadow +
      '">' +
      '<img class="preview-sticker-body" alt="New!" src="' +
      D.sticker.body +
      '">' +
      "</div></div></div>" +
      '<div class="preview-layer preview-veil is-' +
      veilKind +
      '"' +
      (encore ? "" : " hidden") +
      "></div></div>"
    );
  }

  function screenStyle() {
    return (
      '<section class="screen screen-style">' +
      header("Style and Theme") +
      previewHtml() +
      '<div class="style-scroll" id="style-scroll">' +
      '<div class="rows">' +
      styleRows() +
      "</div></div>" +
      footerBar("Coming soon") +
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
      startPreviewCycle();
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
          return state.draft.background;
        },
        set: function (id) {
          state.draft.background = id;
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
          (on ? '<span class="picker-check">' + CHECK_SVG + "</span>" : "") +
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
      opts +
      "</div></div>";
    applyTheme();
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
    els.toast.hidden = false;
    els.toast.textContent = msg;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      els.toast.hidden = true;
    }, 2400);
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
    writeHash();
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
        go("menu");
      });
      return;
    }
    if (state.screen === "board") {
      go("menu");
      return;
    }
    if (state.screen === "system" || state.screen === "menu") {
      go("home");
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
      state.picker = null;
      renderPicker();
      openUploadSoon();
      return;
    }
    spec.set(id);
    state.picker = null;
    applyTheme();
    renderAll();
  }

  function openUploadSoon() {
    var inp = document.getElementById("toki-upload");
    if (!inp) {
      inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "image/*";
      inp.id = "toki-upload";
      inp.hidden = true;
      document.body.appendChild(inp);
      inp.addEventListener("change", function () {
        if (inp.files && inp.files.length) toast("Coming soon");
        inp.value = "";
      });
    }
    inp.click();
  }

  function setPill(key, val) {
    state.draft[key] = Number(val);
    rememberStyleScroll();
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

  function createTheme() {
    var inp = document.getElementById("theme-name");
    var name = ((inp && inp.value) || "").trim() || "Custom Theme";
    var exists = D.themes.some(function (t) {
      return t.name.toLowerCase() === name.toLowerCase();
    });
    if (exists) name = name + " " + (D.themes.length + 1);
    var t = currentTheme();
    D.themes.push({
      name: name,
      main: t.main,
      secondary: t.secondary,
      highlight: t.highlight,
      special: t.special,
    });
    state.draft.themeName = name;
    state.dialog = null;
    renderAll();
    toast("Theme added locally — not written to the sheet.");
  }

  function openSheet() {
    var src = dataSource();
    var url = src.sheetId
      ? "https://docs.google.com/spreadsheets/d/" + src.sheetId + "/edit"
      : D.settingsSheetUrl;
    window.open(url, "_blank", "noopener");
  }

  function motionPhases() {
    var m = D.motionDefaults;
    var speed = Number(state.draft.presentationSpeed) || 0;
    var scale = (m.previewScale || 0.7) / Math.max(1, speed);
    return {
      punchIn: m.punchIn * scale,
      hold: m.hold * scale,
      punchOut: m.punchOut * scale,
      zoomMin: m.zoomMin,
      zoomMax: m.zoomMax,
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

  function applyPreviewItem(item) {
    var img = els.app.querySelector(".preview-food");
    var sticker = els.app.querySelector(".preview-sticker");
    var veil = els.app.querySelector(".preview-veil");
    if (img) img.src = item.src;
    if (sticker) sticker.hidden = !item.isNew;
    if (veil) {
      var fill = item.isNew
        ? currentTheme().special
        : state.draft.encoreSpot === "highlight"
          ? currentTheme().highlight
          : "#000000";
      veil.style.setProperty("--veil-fill", fill);
    }
  }

  function setPlate(opacity, zoom, durIn, durOut) {
    var plate = els.app.querySelector(".preview-plate");
    var anim = els.app.querySelector(".preview-anim");
    if (!plate) return;
    var op = Math.min(0.45, durIn || 0.45);
    plate.style.transition = "opacity " + op + "s ease";
    if (anim) {
      anim.style.transition =
        "transform " + (durIn || 0.45) + "s ease-out";
      anim.style.setProperty("--hero-zoom", String(zoom));
    }
    plate.style.opacity = String(opacity);
    var veil = els.app.querySelector(".preview-veil");
    if (veil && state.draft.presentation === "encore") {
      veil.style.transition = "opacity " + op + "s ease";
      veil.style.opacity = String(opacity);
    }
  }

  function startWallpaperPan() {
    var wrap = els.app.querySelector(".preview-wallpaper");
    if (!wrap || wrap.hidden) return;
    var a = wrap.querySelector(".preview-wp-a");
    var b = wrap.querySelector(".preview-wp-b");
    if (!a || !b) return;
    var speed = 28 * 0.45 * (Number(state.draft.scrollSpeed) || 0);
    if (speed <= 0) return;
    var layers = [
      { el: a, x: 0, on: true },
      { el: b, x: 0, on: false },
    ];
    layers[0].el.classList.add("is-on");
    layers[1].el.classList.remove("is-on");
    var last = 0;
    var fading = false;
    var gen = previewCtl.gen;
    function tick(ts) {
      if (gen !== previewCtl.gen) return;
      if (!last) last = ts;
      var dt = Math.min(48, ts - last) / 1000;
      last = ts;
      var i;
      for (i = 0; i < layers.length; i++) {
        if (!layers[i].on && fading) continue;
        layers[i].x -= speed * dt;
        layers[i].el.style.transform = "translate3d(" + layers[i].x + "px,0,0)";
      }
      var active = layers[0].on ? layers[0] : layers[1];
      var other = layers[0].on ? layers[1] : layers[0];
      var limit = -Math.max(80, wrap.offsetWidth * 0.35);
      if (!fading && active.x < limit) {
        fading = true;
        other.x = 0;
        other.el.style.transform = "translate3d(0,0,0)";
        other.el.style.transition = "opacity 0.45s ease";
        active.el.style.transition = "opacity 0.45s ease";
        other.el.classList.add("is-on");
        active.el.classList.remove("is-on");
        other.on = true;
        active.on = false;
        previewAfter(480, gen, function () {
          fading = false;
          other.el.style.transition = "";
          active.el.style.transition = "";
        });
      }
      previewCtl.raf = requestAnimationFrame(tick);
    }
    previewCtl.raf = requestAnimationFrame(tick);
  }

  function runPreviewBlock(index, gen) {
    if (gen !== previewCtl.gen) return;
    var items = D.previewItems;
    if (!items.length) return;
    var i = ((index % items.length) + items.length) % items.length;
    state.previewIndex = i;
    var item = items[i];
    var phases = motionPhases();
    var mode = state.draft.presentation;
    var zoom = mode === "slideshow" ? 1 : phases.zoomMin;
    applyPreviewItem(item);
    var plate = els.app.querySelector(".preview-plate");
    var anim = els.app.querySelector(".preview-anim");
    if (plate) {
      plate.style.transition = "none";
      plate.style.opacity = "0";
    }
    if (anim) {
      anim.style.transition = "none";
      anim.style.setProperty("--hero-zoom", String(zoom));
    }
    var veil = els.app.querySelector(".preview-veil");
    if (veil) {
      veil.style.transition = "none";
      veil.style.opacity = "0";
    }
    void (plate && plate.offsetWidth);
    if (phases.paused) {
      setPlate(1, mode === "slideshow" ? 1 : phases.zoomMax, 0.3, 0.3);
      return;
    }
    previewAfter(30, gen, function () {
      var zIn = mode === "slideshow" ? 1 : phases.zoomMax;
      setPlate(1, zIn, phases.punchIn, phases.punchOut);
      previewAfter(phases.punchIn * 1000 + phases.hold * 1000, gen, function () {
        var zOut = mode === "slideshow" ? 1 : phases.zoomMin;
        setPlate(0, zOut, phases.punchOut, phases.punchOut);
        previewAfter(phases.punchOut * 1000, gen, function () {
          runPreviewBlock(i + 1, gen);
        });
      });
    });
  }

  function startPreviewCycle() {
    stopPreviewCycle();
    var gen = previewCtl.gen;
    bindPillDrag();
    startWallpaperPan();
    runPreviewBlock(state.previewIndex || 0, gen);
  }

  function stopPreviewCycle() {
    previewCtl.gen += 1;
    previewCtl.timers.forEach(clearTimeout);
    previewCtl.timers = [];
    if (previewCtl.raf) cancelAnimationFrame(previewCtl.raf);
    previewCtl.raf = 0;
  }

  function bindPillDrag() {
    var rows = els.app.querySelectorAll(".pills");
    for (var i = 0; i < rows.length; i++) {
      (function (el) {
        if (el.getAttribute("data-drag")) return;
        el.setAttribute("data-drag", "1");
        var down = false;
        var moved = false;
        var x0 = 0;
        var sl = 0;
        el.addEventListener("pointerdown", function (e) {
          if (e.pointerType === "touch") return;
          down = true;
          moved = false;
          x0 = e.clientX;
          sl = el.scrollLeft;
          try {
            el.setPointerCapture(e.pointerId);
          } catch (err) {}
        });
        el.addEventListener("pointermove", function (e) {
          if (!down) return;
          var dx = e.clientX - x0;
          if (Math.abs(dx) > 6) moved = true;
          if (moved) el.scrollLeft = sl - dx;
        });
        function up() {
          down = false;
        }
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
        el.addEventListener(
          "click",
          function (e) {
            if (moved) {
              e.preventDefault();
              e.stopPropagation();
              moved = false;
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

  function writeHash() {
    var hash = "#/";
    if (state.screen === "system") hash = "#/system";
    else if (state.screen === "menu") hash = "#/menu";
    else if (state.screen === "style") hash = "#/menu/style";
    else if (state.screen === "board") hash = "#/menu/board/" + state.boardId;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function readHash() {
    var raw = (location.hash || "#/").replace(/^#/, "");
    var q = "";
    var qi = raw.indexOf("?");
    if (qi >= 0) {
      q = raw.slice(qi + 1);
      raw = raw.slice(0, qi);
    }
    var parts = raw.split("/").filter(Boolean);
    state.picker = null;
    state.dialog = null;
    if (parts[0] === "system") {
      state.screen = "system";
    } else if (parts[0] === "menu" && parts[1] === "style") {
      state.screen = "style";
    } else if (parts[0] === "menu" && parts[1] === "board") {
      state.screen = "board";
      state.boardId = parts[2] || "1";
    } else if (parts[0] === "menu") {
      state.screen = "menu";
    } else {
      state.screen = "home";
    }
    var params = new URLSearchParams(q);
    if (params.get("pick")) state.picker = params.get("pick");
    if (params.get("confirm") === "1") state.dialog = "confirm";
    if (params.get("theme")) {
      var want = params.get("theme");
      if (D.themes.some(function (t) { return t.name === want; })) {
        state.draft.themeName = want;
      }
    }
    if (params.get("bg")) state.draft.background = params.get("bg");
    if (params.get("pres")) state.draft.presentation = params.get("pres");
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
    } else if (act === "create-theme" || act === "create-save") {
      state.dialog = null;
      toast("Coming soon");
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
    window.addEventListener("hashchange", function () {
      readHash();
      renderAll();
    });
    readHash();
    applyTheme();
    fitDevice();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

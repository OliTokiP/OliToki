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

  var LOGO_PATH =
    "M124.5,61.3s3.2-6.5,14.6-20.7c0,0,11.8-11-2.5-22.2,0,0-8.8-9.6-20.5-2.6,0,0-33.6,18.4-34.2,56.4,0,0-14.1-8.7-32.8,2.1,0,0-4.4-14.6,12.8-42.4,0,0,11.4-13.7-2.5-24.4,0,0-12.3-12.7-28.3,4.7,0,0-18.2,17.4-22.3,43.3,0,0-4.3,31.7,6.1,47.4,0,0-19.8,17.9-8.3,51.5,11.5,33.6,59.7,36.5,59.7,36.5,0,0,45.5,2.6,67.2-32.6,21.1-34.1-15.7-69.2-15.7-69.2-2.1-13.8,7.5-29.1,7.5-29.1";

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

  function logoSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 146.7 193.9" aria-hidden="true">' +
      '<path class="logo-outline" d="' +
      LOGO_PATH +
      '"/>' +
      '<circle class="logo-eye" cx="100.8" cy="136.6" r="7"/>' +
      '<circle class="logo-eye" cx="44.3" cy="136.6" r="7"/>' +
      "</svg>"
    );
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

  function row(opts) {
    var cls = "row" + (opts.child ? " is-child" : "");
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

  function screenHome() {
    return (
      '<section class="screen screen-home">' +
      '<div class="home-hero">' +
      '<p class="home-brand">OliToki</p>' +
      '<p class="home-kicker">MENU MANAGER</p>' +
      '<p class="home-tag">Edit the look, feel and behavior of the OliToki Menu System.</p>' +
      '<p class="home-ver">Version ' +
      D.version +
      "</p>" +
      "</div>" +
      '<div class="home-body">' +
      '<div class="home-logo">' +
      logoSvg() +
      "</div>" +
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
      "</div>" +
      '<div class="sheet-wrap">' +
      '<button class="btn-sheet" type="button" data-act="open-sheet">Google Sheet</button>' +
      "</div></section>"
    );
  }

  function screenMenu() {
    var items = '<div class="nav-list">';
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
    items += "</div>";
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
      html += speedRow("BG Scroll Speed", "scrollSpeed", d.scrollSpeed, 5);
    }
    if (d.background === "wallpaper") {
      html += row({
        key: "wallpaper",
        label: "Wallpaper Type",
        value: labelOf(D.wallpapers, d.wallpaper),
        child: true,
      });
      html += speedRow("BG Scroll Speed", "scrollSpeed", d.scrollSpeed, 5);
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
      7
    );
    return html;
  }

  function previewHtml() {
    var item = D.previewItems[state.previewIndex] || D.previewItems[0];
    var d = state.draft;
    var showNew = item.isNew;
    var paper = find(D.wallpapers, d.wallpaper);
    var scrollOn =
      d.scrollSpeed > 0 &&
      (d.background === "pattern" || d.background === "wallpaper");
    var kb = d.presentation === "kenburns" || d.presentation === "encore";
    var veil = d.presentation === "encore";
    var bgClass = "preview-solid";
    if (d.background === "pattern") bgClass = "preview-pattern";
    if (d.background === "wallpaper") bgClass = "preview-wallpaper";
    var scrollClass = scrollOn ? " is-scrolling" : "";
    var fill =
      d.presentation === "encore"
        ? roleHex(d.encoreBg)
        : d.background === "pattern" || d.background === "wallpaper"
          ? roleHex("main")
          : roleHex(d.background);
    var veilFill =
      d.encoreSpot === "highlight" ? currentTheme().highlight : "#000000";
    var hold = Math.max(2, d.presentationSpeed || 1);
    var scrollDur = Math.max(6, 22 - d.scrollSpeed * 3);
    var layerStyle =
      d.background === "wallpaper"
        ? ' style="background-image:url(\'' + paper.src + "')\""
        : "";
    var sticker = showNew
      ? '<div class="preview-sticker">' +
        '<img class="preview-sticker-shadow" alt="" src="' +
        D.sticker.shadow +
        '">' +
        '<img class="preview-sticker-body" alt="New!" src="' +
        D.sticker.body +
        '">' +
        "</div>"
      : "";
    var veilEl = veil
      ? '<div class="preview-layer preview-veil is-' +
        (d.encoreStyle === "soft" ? "soft" : "hard") +
        '" style="--veil-fill:' +
        veilFill +
        '"></div>'
      : "";
    return (
      '<div class="preview" style="--preview-fill:' +
      fill +
      ";--pattern-a:" +
      roleHex(d.patternColor1) +
      ";--pattern-b:" +
      roleHex(d.patternColor2) +
      ";--hold-dur:" +
      hold +
      "s;--scroll-dur:" +
      scrollDur +
      's">' +
      '<div class="preview-layer ' +
      bgClass +
      scrollClass +
      '"' +
      layerStyle +
      "></div>" +
      '<div class="preview-plate' +
      (kb ? " is-kb" : "") +
      '">' +
      '<img class="preview-food" alt="" src="' +
      item.src +
      '">' +
      sticker +
      "</div>" +
      veilEl +
      "</div>"
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
      footerBar("Create New Theme", "create-theme") +
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
    var current = spec.get();
    var note = spec.note
      ? '<p class="picker-note">' + escapeHtml(spec.note) + "</p>"
      : "";
    var opts = spec.options
      .map(function (o) {
        var on = String(o.id) === String(current);
        return (
          '<button class="picker-option' +
          (on ? " is-on" : "") +
          '" type="button" data-act="choose" data-id="' +
          escapeHtml(o.id) +
          '"><span class="picker-label">' +
          escapeHtml(o.label) +
          "</span></button>"
        );
      })
      .join("");
    els.picker.hidden = false;
    els.picker.innerHTML =
      '<div class="picker-panel">' +
      "<h2 class=\"picker-title\">" +
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
    if (!pickerSpec(key)) return;
    rememberStyleScroll();
    state.picker = key;
    renderPicker();
  }

  function choose(id) {
    var spec = pickerSpec(state.picker);
    if (!spec) return;
    spec.set(id);
    state.picker = null;
    applyTheme();
    renderAll();
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

  function startPreviewCycle() {
    stopPreviewCycle();
    var sec = Number(state.draft.presentationSpeed) || 0;
    if (sec <= 0) return;
    state.previewTimer = setInterval(function () {
      state.previewIndex = (state.previewIndex + 1) % D.previewItems.length;
      var wrap = els.app.querySelector(".preview");
      if (!wrap) return;
      var parent = wrap.parentNode;
      var html = previewHtml();
      var tmp = document.createElement("div");
      tmp.innerHTML = html;
      parent.replaceChild(tmp.firstChild, wrap);
    }, sec * 1000);
  }

  function stopPreviewCycle() {
    if (state.previewTimer) {
      clearInterval(state.previewTimer);
      state.previewTimer = null;
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
      createTheme();
    } else if (act === "create-cancel") {
      state.dialog = null;
      renderDialog();
    } else if (act === "open-sheet") {
      openSheet();
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

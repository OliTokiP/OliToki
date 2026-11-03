/**
 * TokiMenu — Christmas Theme helpers + Holiday Roulette art.
 *
 * When Style Theme Selector is Christmas, Menu Manager shows Holiday
 * Roulette (On / Off). TV boards cover the live menu with a solid
 * Main-color “Happy Holidays!” marquee (js/holiday-roulette.js) while
 * that flag is On.
 *
 * QA: ?theme=Christmas  (palette + overlay gate without writing the sheet)
 */
(function (root) {
  "use strict";

  var ART_VER = "20261102hr6";

  var PALETTE = {
    main: "#1A3C2A",
    secondary: "#FFF8F0",
    highlight: "#C41E3A",
    special: "#F5D76E",
  };

  var MASCOT = {
    1: { file: "toki-santa.svg", label: "Toki Santa" },
    2: { file: "toki-rudolph.svg", label: "Toki Rudolph" },
    3: { file: "toki-santa.svg", label: "Toki Santa" },
    4: { file: "toki-rudolph.svg", label: "Toki Rudolph" },
  };

  function normalizeThemeKey(raw) {
    return String(raw == null ? "" : raw)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function isChristmas(name) {
    var k = normalizeThemeKey(name);
    return k === "christmas" || k === "holiday";
  }

  function layoutFromConfig(cfg) {
    var layout = (cfg && String(cfg.layout || "").toLowerCase()) || "";
    if (layout === "handhelds") return 2;
    if (layout === "munchies") return 3;
    if (layout === "drinks") return 4;
    return 1;
  }

  function layoutFromBoardId(id) {
    var s = String(id == null ? "" : id).toLowerCase();
    if (s === "2" || s === "handhelds") return 2;
    if (s === "3" || s === "munchies") return 3;
    if (s === "4" || s === "announcements" || s === "drinks") return 4;
    return 1;
  }

  function mascotForSlot(slot) {
    var n = Number(slot) || 1;
    if (n < 1 || n > 4) n = 1;
    return MASCOT[n] || MASCOT[1];
  }

  function mascotUrl(slot) {
    var row = mascotForSlot(slot);
    return "assets/christmas/" + row.file + "?v=" + ART_VER;
  }

  function mascotLabel(slot) {
    return mascotForSlot(slot).label;
  }

  function urlThemeOverride() {
    try {
      var t = new URLSearchParams(location.search).get("theme");
      return t ? String(t).trim() : "";
    } catch (e) {
      return "";
    }
  }

  function applyPalette() {
    try {
      var rootEl = document.documentElement;
      rootEl.style.setProperty("--main-color", PALETTE.main);
      rootEl.style.setProperty("--secondary-color", PALETTE.secondary);
      rootEl.style.setProperty("--highlight", PALETTE.highlight);
      rootEl.style.setProperty("--highlight-special", PALETTE.special);
      rootEl.style.setProperty("--highlight-new", PALETTE.special);
    } catch (e) {}
  }

  root.TOKI_CHRISTMAS = {
    ART_VER: ART_VER,
    PALETTE: PALETTE,
    MASCOT: MASCOT,
    normalizeThemeKey: normalizeThemeKey,
    isChristmas: isChristmas,
    layoutFromConfig: layoutFromConfig,
    layoutFromBoardId: layoutFromBoardId,
    mascotUrl: mascotUrl,
    mascotLabel: mascotLabel,
    urlThemeOverride: urlThemeOverride,
    applyPalette: applyPalette,
  };
})(window);

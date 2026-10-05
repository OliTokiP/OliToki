/**
 * TokiMenu — Halloween Theme costumes + Closed Status ghost art.
 *
 * When Style Theme Selector is Halloween, each board Logo (#logo) swaps from
 * the default Toki mark to that board’s costume. Closed Status Board 4 uses
 * Toki Ghost in place of the outline bunny (mockup Closed Status H 1–4).
 *
 * Menu Manager Style / Board previews use the same files.
 */
(function (root) {
  "use strict";

  var ART_VER = "20261005h3";
  var CLOSED_VER = "20260924closed2";
  var DEFAULT_LOGO = "assets/TokiLogoFix.svg?v=20260815qa4";

  var COSTUME = {
    bowls: { file: "tokula.svg", label: "Tokula" },
    handhelds: { file: "toki-mummy.svg", label: "Toki Mummy" },
    munchies: { file: "toki-pirate.svg", label: "Toki Pirate" },
    drinks: { file: "toki-witch.svg", label: "Toki Witch" },
  };

  function normalizeThemeKey(raw) {
    return String(raw == null ? "" : raw)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function isHalloween(name) {
    return normalizeThemeKey(name) === "halloween";
  }

  function layoutFromConfig(cfg) {
    var layout = (cfg && String(cfg.layout || "").toLowerCase()) || "";
    if (COSTUME[layout]) return layout;
    return "bowls";
  }

  function layoutFromBoardId(id) {
    var s = String(id == null ? "" : id).toLowerCase();
    if (s === "2" || s === "handhelds") return "handhelds";
    if (s === "3" || s === "munchies") return "munchies";
    if (s === "4" || s === "announcements" || s === "drinks") return "drinks";
    return "bowls";
  }

  function costumeUrl(layout) {
    var row = COSTUME[layout] || COSTUME.bowls;
    return "assets/halloween/" + row.file + "?v=" + ART_VER;
  }

  function costumeLabel(layout) {
    var row = COSTUME[layout] || COSTUME.bowls;
    return row.label;
  }

  function closedArtUrl(slot, halloween) {
    var n = Number(slot) || 1;
    if (n < 1 || n > 4) n = 1;
    if (halloween) {
      return "assets/closed/closed-h-" + n + ".svg?v=" + ART_VER;
    }
    return "assets/closed/closed-" + n + ".svg?v=" + CLOSED_VER;
  }

  function urlThemeOverride() {
    try {
      var t = new URLSearchParams(location.search).get("theme");
      return t ? String(t).trim() : "";
    } catch (e) {
      return "";
    }
  }

  root.TOKI_HALLOWEEN = {
    ART_VER: ART_VER,
    COSTUME: COSTUME,
    DEFAULT_LOGO: DEFAULT_LOGO,
    normalizeThemeKey: normalizeThemeKey,
    isHalloween: isHalloween,
    layoutFromConfig: layoutFromConfig,
    layoutFromBoardId: layoutFromBoardId,
    costumeUrl: costumeUrl,
    costumeLabel: costumeLabel,
    closedArtUrl: closedArtUrl,
    urlThemeOverride: urlThemeOverride,
  };
})(window);

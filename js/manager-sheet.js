/**
 * OliToki Menu Manager — one-way sheet read.
 * Loads OliToki Menu Settings + the chosen catalog's Style and Theme tab.
 * Never writes. Field-name draft only (no column indexes in the UI).
 */
(function (global) {
  "use strict";

  var SETTINGS_SHEET_ID = "1OwNKHzjP46xKJBW8sTm4IOWhIzf0lENdZ8rv_GY37fY";
  var STYLE_GID = "183083022";

  var STYLE_SETTINGS = {
    themeSelector: 0,
    bgColor: 1,
    bgPattern: 2,
    bgImage: 3,
    bgScrollSpeed: 7,
    slideshowSpeed: 8,
    encoreSpotlightType: 10,
    encoreSpotlightColor: 11,
    encoreBackgroundColor: 12,
  };
  var STYLE_THEME = {
    themeName: 0,
    mainColor: 1,
    secondaryColor: 2,
    highlight: 3,
    highlightSpecial: 4,
    patternColor1: 10,
    patternColor2: 11,
  };

  var _proxy = null;

  function cell(row, idx) {
    if (!row || idx == null || idx < 0 || idx >= row.length) return "";
    var v = row[idx];
    return v == null ? "" : String(v).trim();
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = "";
    var i = 0;
    var inQuotes = false;
    var s = String(text || "").replace(/^\uFEFF/, "");
    while (i < s.length) {
      var ch = s[i];
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
        if (row.some(function (c) { return String(c).trim() !== ""; })) {
          rows.push(row);
        }
        row = [];
        if (ch === "\r" && s[i + 1] === "\n") i++;
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    row.push(field);
    if (row.some(function (c) { return String(c).trim() !== ""; })) rows.push(row);
    return rows;
  }

  function extractSpreadsheetId(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]{30,}$/.test(s) && s.indexOf(" ") === -1) return s;
    return "";
  }

  function sourceId(name) {
    var n = String(name || "").trim().toLowerCase();
    if (n.indexOf("restaurant") !== -1) return "restaurant";
    if (n.indexOf("alpha") !== -1) return "alpha";
    return n.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "source";
  }

  function parseYesNo(raw, fallback) {
    var s = String(raw == null ? "" : raw).trim().toLowerCase();
    if (!s) return fallback ? "yes" : "no";
    if (s === "1" || s === "yes" || s === "y" || s === "true" || s === "on") {
      return "yes";
    }
    if (s === "0" || s === "no" || s === "n" || s === "false" || s === "off") {
      return "no";
    }
    return fallback ? "yes" : "no";
  }

  function parseSystemFont(raw) {
    var s = String(raw || "").trim().toLowerCase();
    if (s.indexOf("poppin") !== -1) return "poppins";
    return "roboto";
  }

  function foldKey(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function colorRole(raw) {
    var s = foldKey(raw);
    if (!s || s === "none") return null;
    if (s.indexOf("special") !== -1) return "special";
    if (s.indexOf("highlight") !== -1) return "highlight";
    if (s.indexOf("secondary") !== -1) return "secondary";
    if (s.indexOf("main") !== -1) return "main";
    return null;
  }

  function hexKey(raw) {
    var s = String(raw || "").trim();
    var m = s.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/);
    if (!m) return "";
    var h = m[1];
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    return h.toLowerCase();
  }

  function colorRoleFromTheme(raw, theme) {
    var role = colorRole(raw);
    if (role) return role;
    var want = hexKey(raw);
    if (!want || !theme) return null;
    if (hexKey(theme.special) === want) return "special";
    if (hexKey(theme.highlight) === want) return "highlight";
    if (hexKey(theme.secondary) === want) return "secondary";
    if (hexKey(theme.main) === want) return "main";
    return null;
  }

  function headerIndex(headerRow, names) {
    var i;
    var n;
    var h;
    var folded = [];
    for (n = 0; n < names.length; n++) folded.push(foldKey(names[n]));
    for (i = 0; i < (headerRow || []).length; i++) {
      h = foldKey(headerRow[i]);
      if (!h) continue;
      for (n = 0; n < folded.length; n++) {
        if (h === folded[n]) return i;
      }
    }
    return -1;
  }

  function noneValue(raw) {
    var s = String(raw || "").trim().toLowerCase();
    return !s || /^(none|off|0|false|no|-|—|–)$/.test(s);
  }

  function wallpaperId(raw) {
    if (noneValue(raw)) return null;
    var s = String(raw).toLowerCase();
    if (s.indexOf("film") !== -1) return "film";
    if (s.indexOf("galaxy") !== -1) return "galaxy";
    return "galaxy";
  }

  function patternId(raw) {
    if (noneValue(raw)) return null;
    var s = String(raw).toLowerCase();
    if (s.indexOf("stripe") !== -1) return "stripes";
    return "stripes";
  }

  function encoreStyle(raw) {
    var s = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (s.indexOf("soft") !== -1) return "soft";
    if (s.indexOf("hard_shadow") !== -1 || s === "hardshadow") {
      return "hard_shadow";
    }
    if (s.indexOf("hard") !== -1) return "hard";
    return "hard_shadow";
  }

  function encoreSpot(raw) {
    var s = String(raw || "").trim().toLowerCase();
    if (s.indexOf("highlight") !== -1 || s.indexOf("special") !== -1) {
      return "highlight";
    }
    return "black";
  }

  function clampSpeed(raw, fallback, min, max) {
    if (raw === undefined || raw === null || raw === "") return fallback;
    var n = Number(raw);
    if (!isFinite(n)) return fallback;
    n = Math.round(n);
    if (min != null && isFinite(min) && n < min) return min;
    if (max != null && isFinite(max) && n > max) return max;
    return n;
  }

  function offlineSpeedTiles() {
    var D = global.TOKI_MANAGER_DATA;
    var st = (D && D.speedTiles) || {};
    return {
      scroll: {
        min: st.scroll && st.scroll.min != null ? st.scroll.min : 0,
        max: st.scroll && st.scroll.max != null ? st.scroll.max : 5,
      },
      presentation: {
        min: st.presentation && st.presentation.min != null ? st.presentation.min : 0,
        max: st.presentation && st.presentation.max != null ? st.presentation.max : 7,
      },
    };
  }

  function foldField(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function fieldValidation(fields, names) {
    if (!fields) return null;
    var folded = [];
    var n;
    for (n = 0; n < names.length; n++) folded.push(foldField(names[n]));
    var keys = Object.keys(fields);
    var i;
    var k;
    var fk;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      fk = foldField(k);
      for (n = 0; n < folded.length; n++) {
        if (fk === folded[n]) return fields[k];
      }
    }
    return null;
  }

  function parseConditionNumber(raw) {
    if (raw === undefined || raw === null || raw === "") return null;
    var s = String(raw).trim();
    if (!s) return null;
    // Strip formula-ish wrappers; validation values are usually plain digits.
    if (s.charAt(0) === "=") s = s.slice(1).trim();
    var n = Number(s);
    if (!isFinite(n)) return null;
    return n;
  }

  /**
   * Turn a Sheets dataValidation condition into integer tile bounds.
   * Needs both lower and upper after merge with offline defaults — unbounded
   * rules must not become an infinite pill strip.
   * Returns { min, max } or null when the condition is not a finite number range.
   */
  function numberBoundsFromValidation(rule, fallback) {
    var fb = fallback || { min: 0, max: 5 };
    var fMin = fb.min != null && isFinite(fb.min) ? Number(fb.min) : 0;
    var fMax = fb.max != null && isFinite(fb.max) ? Number(fb.max) : fMin;
    if (!rule || !rule.type) {
      return { min: fMin, max: fMax };
    }
    var type = String(rule.type || "").toUpperCase();
    var vals = rule.values || [];
    var a = parseConditionNumber(vals[0]);
    var b = parseConditionNumber(vals[1]);
    var min = fMin;
    var max = fMax;
    var list = null;

    if (type === "NUMBER_BETWEEN" && a != null && b != null) {
      min = Math.min(a, b);
      max = Math.max(a, b);
    } else if (type === "NUMBER_NOT_BETWEEN") {
      // Cannot express exclusion as a simple pill strip — keep offline tiles.
      return { min: fMin, max: fMax };
    } else if (type === "NUMBER_GREATER_THAN_EQ" && a != null) {
      min = a;
      max = Math.max(fMax, a);
    } else if (type === "NUMBER_GREATER" && a != null) {
      min = Math.floor(a) + 1;
      max = Math.max(fMax, min);
    } else if (type === "NUMBER_LESS_THAN_EQ" && a != null) {
      max = a;
      min = Math.min(fMin, a);
    } else if (type === "NUMBER_LESS" && a != null) {
      max = Math.ceil(a) - 1;
      min = Math.min(fMin, max);
    } else if (type === "NUMBER_EQ" && a != null) {
      min = a;
      max = a;
    } else if (type === "ONE_OF_LIST") {
      list = [];
      for (var i = 0; i < vals.length; i++) {
        var n = parseConditionNumber(vals[i]);
        if (n == null) continue;
        n = Math.round(n);
        if (list.indexOf(n) === -1) list.push(n);
      }
      if (!list.length) return { min: fMin, max: fMax };
      list.sort(function (x, y) {
        return x - y;
      });
      return { min: list[0], max: list[list.length - 1], values: list };
    } else {
      // ONE_OF_RANGE / text / unknown — offline tiles
      return { min: fMin, max: fMax };
    }

    min = Math.round(min);
    max = Math.round(max);
    if (max < min) {
      var t = min;
      min = max;
      max = t;
    }
    // Guard against pathological ranges (e.g. 0…1e9)
    if (max - min > 30) {
      console.warn(
        "manager-sheet: number validation span too large, clamping to offline max",
        type,
        min,
        max
      );
      max = min + Math.min(30, Math.max(0, fMax - fMin));
    }
    return { min: min, max: max };
  }

  function buildSpeedTiles(fields) {
    var base = offlineSpeedTiles();
    var scrollRule = fieldValidation(fields, [
      "BG Scroll Speed",
      "Background Scroll Speed",
      "Scroll Speed",
    ]);
    var presRule = fieldValidation(fields, [
      "Presentation Speed",
      "Slideshow Speed",
    ]);
    var scroll = numberBoundsFromValidation(scrollRule, base.scroll);
    var presentation = numberBoundsFromValidation(presRule, base.presentation);
    return { scroll: scroll, presentation: presentation };
  }

  function hexOrEmpty(raw) {
    var s = String(raw || "").trim();
    var m = s.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/);
    return m ? m[0] : s;
  }

  function findSectionData(rows, label) {
    var want = String(label || "").trim().toLowerCase();
    for (var i = 0; i < (rows || []).length; i++) {
      var a = cell(rows[i], 0).toLowerCase();
      if (a === want || a.indexOf(want) === 0) return i + 2;
    }
    return -1;
  }

  function settingsSheetId() {
    var D = global.TOKI_MANAGER_DATA;
    if (D && D.settingsSheetId) return String(D.settingsSheetId).trim();
    if (global.TOKI_SETTINGS_SHEET_ID) {
      return String(global.TOKI_SETTINGS_SHEET_ID).trim();
    }
    return SETTINGS_SHEET_ID;
  }

  async function detectProxy() {
    if (_proxy != null) return _proxy;
    try {
      var res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) {
        _proxy = false;
        return false;
      }
      var j = await res.json();
      _proxy = !!(j && j.sheetsApi);
      return _proxy;
    } catch (e) {
      _proxy = false;
      return false;
    }
  }

  function publicCsvUrl(sheetId, gid) {
    return (
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(sheetId) +
      "/export?format=csv&gid=" +
      encodeURIComponent(String(gid)) +
      "&cachebust=" +
      Date.now()
    );
  }

  async function fetchText(url) {
    var res = await fetch(url, { cache: "no-store", mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
    var text = await res.text();
    if (/^\s*</.test(text)) {
      throw new Error("Google returned HTML (sheet not public?)");
    }
    return text;
  }

  async function fetchCsv(gid, sheetId, force) {
    var useProxy = await detectProxy();
    var extra = force ? "&force=1" : "";
    if (useProxy) {
      try {
        return parseCsv(
          await fetchText(
            "/api/sheets/csv?gid=" +
              encodeURIComponent(String(gid)) +
              "&single=1" +
              extra +
              "&t=" +
              Date.now()
          )
        );
      } catch (err) {
        console.warn("manager-sheet: proxy csv failed, trying public", err);
      }
    }
    var id = String(sheetId || "").trim();
    if (!id) throw new Error("No spreadsheet id for gid " + gid);
    return parseCsv(await fetchText(publicCsvUrl(id, gid)));
  }

  function parseSettingsRows(rows) {
    var dataSource = "";
    var requireRestart = "no";
    var systemFont = "roboto";
    var catalog = [];
    var headerIdx = -1;
    var catalogIdx = -1;
    var i;
    for (i = 0; i < (rows || []).length; i++) {
      var a = cell(rows[i], 0).toLowerCase();
      var b = cell(rows[i], 1).toLowerCase();
      if (headerIdx < 0 && a === "data source") headerIdx = i;
      if (
        catalogIdx < 0 &&
        (a + " " + b).indexOf("gsheet") !== -1 &&
        (a + " " + b).indexOf("url") !== -1
      ) {
        catalogIdx = i;
      }
    }
    if (headerIdx >= 0 && headerIdx + 1 < rows.length) {
      dataSource = cell(rows[headerIdx + 1], 0);
      requireRestart = parseYesNo(cell(rows[headerIdx + 1], 1), false);
      var header = rows[headerIdx] || [];
      for (var c = 0; c < header.length; c++) {
        if (String(header[c] || "").toLowerCase().indexOf("system font") !== -1) {
          systemFont = parseSystemFont(cell(rows[headerIdx + 1], c));
          break;
        }
      }
    }
    if (catalogIdx >= 0) {
      for (i = catalogIdx + 1; i < rows.length; i++) {
        var name = cell(rows[i], 0);
        var url = cell(rows[i], 1);
        if (!name && !url) continue;
        catalog.push({
          name: name,
          url: url,
          sheetId: extractSpreadsheetId(url),
        });
      }
    }
    var match = null;
    var key = dataSource.toLowerCase();
    if (key) {
      for (i = 0; i < catalog.length; i++) {
        if (String(catalog[i].name || "").trim().toLowerCase() === key) {
          match = catalog[i];
          break;
        }
      }
    }
    return {
      dataSource: dataSource || "Alpha Copy",
      requireRestart: requireRestart,
      systemFont: systemFont,
      sheetId: (match && match.sheetId) || "",
      sourceName: (match && match.name) || dataSource || "",
      catalog: catalog,
    };
  }

  function catalogToSources(catalog) {
    return (catalog || [])
      .filter(function (c) { return c && (c.name || c.sheetId); })
      .map(function (c) {
        return {
          id: sourceId(c.name),
          name: c.name,
          sheetId: c.sheetId || "",
        };
      });
  }

  async function fetchSettings(force) {
    var useProxy = await detectProxy();
    if (useProxy) {
      try {
        var res = await fetch(
          "/api/settings?" + (force ? "force=1&" : "") + "t=" + Date.now(),
          { cache: "no-store" }
        );
        if (res.ok) {
          var j = await res.json();
          var catalog = j.catalog || [];
          if (!catalog.length) {
            try {
              var pub = await fetchSettingsPublic();
              if (pub.catalog && pub.catalog.length) catalog = pub.catalog;
            } catch (e) {}
          }
          return {
            dataSource: j.dataSource || "",
            requireRestart: parseYesNo(j.requireRestart, false),
            systemFont: parseSystemFont(j.systemFont),
            sheetId: j.sheetId || "",
            sourceName: j.sourceName || j.dataSource || "",
            catalog: catalog,
          };
        }
      } catch (err) {
        console.warn("manager-sheet: /api/settings failed", err);
      }
    }
    return fetchSettingsPublic();
  }

  async function fetchSettingsPublic() {
    var text = await fetchText(publicCsvUrl(settingsSheetId(), 0));
    return parseSettingsRows(parseCsv(text));
  }

  function parseThemes(rows) {
    var start = findSectionData(rows, "themes database");
    if (start < 0) start = 5;
    var themes = [];
    var defaults = { patternColor1: "special", patternColor2: "highlight" };
    for (var i = start; i < (rows || []).length; i++) {
      var name = cell(rows[i], STYLE_THEME.themeName);
      if (!name) continue;
      var low = name.toLowerCase();
      if (low === "theme name" || low.indexOf("glossary") !== -1) continue;
      var theme = {
        name: name,
        main: hexOrEmpty(cell(rows[i], STYLE_THEME.mainColor)) || "#000000",
        secondary: hexOrEmpty(cell(rows[i], STYLE_THEME.secondaryColor)) || "#FFFFFF",
        highlight: hexOrEmpty(cell(rows[i], STYLE_THEME.highlight)) || "#26BBCB",
        special: hexOrEmpty(cell(rows[i], STYLE_THEME.highlightSpecial)) || "#FFF900",
        patternColor1: colorRole(cell(rows[i], STYLE_THEME.patternColor1)),
        patternColor2: colorRole(cell(rows[i], STYLE_THEME.patternColor2)),
      };
      if (low.replace(/\s+/g, "") === "tokidefault") {
        if (theme.patternColor1) defaults.patternColor1 = theme.patternColor1;
        if (theme.patternColor2) defaults.patternColor2 = theme.patternColor2;
      }
      themes.push(theme);
    }
    themes.forEach(function (t) {
      if (!t.patternColor1) t.patternColor1 = defaults.patternColor1;
      if (!t.patternColor2) t.patternColor2 = defaults.patternColor2;
    });
    return themes;
  }

  function parseStyleDraft(rows, themes, speedTiles) {
    var start = findSectionData(rows, "settings");
    if (start < 0) start = 2;
    var headers = rows[start - 1] || [];
    var row = rows[start] || [];
    var colTheme = headerIndex(headers, ["Theme Selector"]);
    var colBg = headerIndex(headers, ["BG Color", "Background Color"]);
    var colPat = headerIndex(headers, ["BG Pattern", "Background Pattern"]);
    var colWp = headerIndex(headers, ["BG Wallpaper", "Background Wallpaper"]);
    if (colTheme < 0) colTheme = STYLE_SETTINGS.themeSelector;
    if (colBg < 0) colBg = STYLE_SETTINGS.bgColor;
    if (colPat < 0) colPat = STYLE_SETTINGS.bgPattern;
    if (colWp < 0) colWp = STYLE_SETTINGS.bgImage;

    var tiles = speedTiles || offlineSpeedTiles();
    var scrollMin = tiles.scroll.min;
    var scrollMax = tiles.scroll.max;
    var presMin = tiles.presentation.min;
    var presMax = tiles.presentation.max;

    var themeName = cell(row, colTheme) || "Toki Default";
    var chosen = null;
    var key = themeName.toLowerCase();
    for (var i = 0; i < themes.length; i++) {
      if (String(themes[i].name || "").toLowerCase() === key) {
        chosen = themes[i];
        break;
      }
    }
    if (!chosen && themes.length) chosen = themes[0];

    var rawBg = cell(row, colBg);
    var wp = wallpaperId(cell(row, colWp));
    var pat = patternId(cell(row, colPat));
    var bgRole = colorRoleFromTheme(rawBg, chosen);
    if (!bgRole) bgRole = "main";
    var background = bgRole;
    if (wp) background = "wallpaper";
    else if (pat) background = "pattern";

    console.info(
      "Style Settings BG Color:",
      JSON.stringify(rawBg),
      "→",
      bgRole,
      wp ? "(wallpaper on)" : pat ? "(pattern on)" : "(solid)"
    );

    return {
      themeName: (chosen && chosen.name) || themeName,
      background: background,
      bgColor: bgRole,
      patternType: pat || "stripes",
      patternColor1:
        (chosen && chosen.patternColor1) || "special",
      patternColor2:
        (chosen && chosen.patternColor2) || "highlight",
      wallpaper: wp || "galaxy",
      scrollSpeed: clampSpeed(
        cell(row, STYLE_SETTINGS.bgScrollSpeed),
        1,
        scrollMin,
        scrollMax
      ),
      encoreStyle: encoreStyle(cell(row, STYLE_SETTINGS.encoreSpotlightType)),
      encoreSpot: encoreSpot(cell(row, STYLE_SETTINGS.encoreSpotlightColor)),
      encoreBg:
        colorRole(cell(row, STYLE_SETTINGS.encoreBackgroundColor)) ||
        "secondary",
      presentationSpeed: clampSpeed(
        cell(row, STYLE_SETTINGS.slideshowSpeed),
        1,
        presMin,
        presMax
      ),
    };
  }

  async function fetchValidations(gid, force) {
    var useProxy = await detectProxy();
    if (!useProxy) return null;
    try {
      var res = await fetch(
        "/api/sheets/validations?gid=" +
          encodeURIComponent(String(gid)) +
          (force ? "&force=1" : "") +
          "&t=" +
          Date.now(),
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      var j = await res.json();
      return (j && j.fields) || null;
    } catch (err) {
      console.warn("manager-sheet: validations failed", err);
      return null;
    }
  }

  function buildPayload(settings, styleRows, validationFields) {
    var speedTiles = buildSpeedTiles(validationFields || null);
    var themes = parseThemes(styleRows);
    var style = parseStyleDraft(styleRows, themes, speedTiles);
    var sources = catalogToSources(settings.catalog);
    var dsId = sourceId(settings.dataSource || settings.sourceName);
    var draft = {
      themeName: style.themeName,
      background: style.background,
      bgColor: style.bgColor || "main",
      patternType: style.patternType,
      patternColor1: style.patternColor1,
      patternColor2: style.patternColor2,
      wallpaper: style.wallpaper,
      scrollSpeed: style.scrollSpeed,
      presentation: "kenburns",
      encoreStyle: style.encoreStyle,
      encoreSpot: style.encoreSpot,
      encoreBg: style.encoreBg,
      presentationSpeed: style.presentationSpeed,
      dataSource: dsId,
      requireRestart: settings.requireRestart,
      systemFont: settings.systemFont,
    };
    return {
      ok: true,
      sourceName: settings.sourceName || settings.dataSource || "",
      sheetId: settings.sheetId || "",
      dataSources: sources,
      themes: themes,
      draft: draft,
      speedTiles: speedTiles,
      fieldValidations: validationFields || null,
    };
  }

  async function load(opts) {
    opts = opts || {};
    var force = !!opts.force;
    var t0 =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    var useProxy = await detectProxy();
    var settings;
    var styleRows;
    var validationFields = null;
    if (useProxy) {
      var triple = await Promise.all([
        fetchSettings(force),
        fetchCsv(STYLE_GID, "", force),
        fetchValidations(STYLE_GID, force),
      ]);
      settings = triple[0];
      styleRows = triple[1];
      validationFields = triple[2];
    } else {
      settings = await fetchSettings(force);
      if (!settings.sheetId && settings.catalog && settings.catalog.length) {
        settings.sheetId = settings.catalog[0].sheetId || "";
      }
      styleRows = await fetchCsv(STYLE_GID, settings.sheetId, force);
      // Public CSV has no dataValidation — offline speedTiles stay.
    }
    if (!settings.sheetId && settings.catalog && settings.catalog.length) {
      settings.sheetId = settings.catalog[0].sheetId || "";
    }
    var payload = buildPayload(settings, styleRows, validationFields);
    var ms =
      (typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()) - t0;
    var st = payload.speedTiles || {};
    console.info(
      "Menu Manager sheet:",
      payload.sourceName || "?",
      "theme=" + payload.draft.themeName,
      "bg=" + payload.draft.background,
      "bgColor=" + payload.draft.bgColor,
      "font=" + payload.draft.systemFont,
      "restart=" + payload.draft.requireRestart,
      "scrollTiles=" +
        ((st.scroll && st.scroll.min) != null ? st.scroll.min : "?") +
        ".." +
        ((st.scroll && st.scroll.max) != null ? st.scroll.max : "?"),
      "presTiles=" +
        ((st.presentation && st.presentation.min) != null
          ? st.presentation.min
          : "?") +
        ".." +
        ((st.presentation && st.presentation.max) != null
          ? st.presentation.max
          : "?"),
      Math.round(ms) + "ms",
      force ? "force" : "cache-ok"
    );
    return payload;
  }

  global.TOKI_MANAGER_SHEET = {
    load: load,
    styleGid: STYLE_GID,
  };
})(window);

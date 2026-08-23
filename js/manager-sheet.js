/**
 * OliToki Menu Manager — sheet read + theme write.
 * Loads OliToki Menu Settings + the chosen catalog's Style and Theme tab.
 * Field-name draft only (no column indexes in the UI). Confirm posts
 * theme + background + Pattern Color 1 / 2 to /api/manager/style; the
 * server maps Theme Selector (A3), BG Color / Pattern / Wallpaper
 * (B3 / C3 / D3), and Pattern Color 1 / 2 on the selected Themes
 * Database row (K/L).
 * Board Settings Yes posts /api/manager/board (Menu Title, Family Portrait,
 * Presentation Mode, Include Descriptions?) — field names, not columns.
 * System Settings (incl. Confirm save?) post via /api/manager/settings (fallback always).
 * Switching to a color writes none into C3 and D3 (pattern wins on boards).
 * Number pills follow a validator in the Settings header — same CSV
 * Pages already reads. House style:
 *   BG Scroll Speed (0<=5)
 *   Presentation Speed (0,1,2,3)
 *   Theme Selector (='Style and Theme'!$A$6:$A$17)
 * Also: [0-5], [0..5], [A6:A17], (>=3). Offline last.
 */
(function (global) {
  "use strict";

  var SETTINGS_SHEET_ID = "1OwNKHzjP46xKJBW8sTm4IOWhIzf0lENdZ8rv_GY37fY";
  var STYLE_GID = "183083022";
  var BETA_FEATURES_GID = "1710200195";
  var INFO_GID = "605471002";
  var DEBUGGER_GID = "195166367";

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
  var _tvSheetId = "";

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
        rows.push(row);
        row = [];
        if (ch === "\r" && s[i + 1] === "\n") i++;
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    row.push(field);
    rows.push(row);
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
    if (n.indexOf("beta") !== -1) return "beta";
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
    for (n = 0; n < names.length; n++) folded.push(foldKey(headerName(names[n])));
    for (i = 0; i < (headerRow || []).length; i++) {
      h = foldKey(headerName(headerRow[i]));
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

  function looksLikeValidator(inner) {
    var s = String(inner || "").trim();
    if (!s) return false;
    if (s.charAt(0) === "=") return true;
    if (/[<>]=?/.test(s)) return true;
    if (/^'[^']+'\s*!/.test(s)) return true;
    if (/^\$?[A-Za-z]+\$?\d+/.test(s)) return true;
    if (/^-?\d+(?:\.\d+)?\s*(?:-|\.\.)\s*-?\d+(?:\.\d+)?$/.test(s)) return true;
    if (/^-?\d+(?:\.\d+)?(\s*,\s*-?\d+(?:\.\d+)?)+$/.test(s)) return true;
    return false;
  }

  /* "BG Scroll Speed (0<=5)" → { name, spec }. Leaves "Highlight Color (Special)" alone. */
  function splitHeader(raw) {
    var full = String(raw == null ? "" : raw).trim();
    var m = full.match(/^(.*?)[\s]*[\(\[](.+)[\)\]]\s*$/);
    if (m && looksLikeValidator(m[2])) {
      return { name: m[1].trim() || full, spec: String(m[2]).trim() };
    }
    return { name: full, spec: "" };
  }

  function headerName(raw) {
    return splitHeader(raw).name;
  }

  function colLettersToIndex(letters) {
    var n = 0;
    var s = String(letters || "").toUpperCase();
    var i;
    for (i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 65 || c > 90) continue;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  function parseA1Range(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    if (s.charAt(0) === "=") s = s.slice(1).trim();
    s = s.replace(/^'[^']+'\s*!/, "").replace(/^[^'!]+!/, "");
    s = s.replace(/\$/g, "").toUpperCase();
    var m = s.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (m) {
      return {
        c1: colLettersToIndex(m[1]),
        r1: parseInt(m[2], 10),
        c2: colLettersToIndex(m[3]),
        r2: parseInt(m[4], 10),
      };
    }
    m = s.match(/^([A-Z]+)(\d+):([A-Z]+)$/);
    if (m) {
      return {
        c1: colLettersToIndex(m[1]),
        r1: parseInt(m[2], 10),
        c2: colLettersToIndex(m[3]),
        r2: 0,
      };
    }
    m = s.match(/^([A-Z]+)(\d+)$/);
    if (m) {
      var c = colLettersToIndex(m[1]);
      var r = parseInt(m[2], 10);
      return { c1: c, r1: r, c2: c, r2: r };
    }
    return null;
  }

  function resolveA1Values(rows, spec) {
    var a1 = parseA1Range(spec);
    if (!a1) return [];
    var r2 = a1.r2;
    if (!r2) r2 = (rows || []).length;
    var c1 = Math.min(a1.c1, a1.c2);
    var c2 = Math.max(a1.c1, a1.c2);
    var r1 = Math.min(a1.r1, r2);
    r2 = Math.max(a1.r1, r2);
    var out = [];
    var r;
    var c;
    for (r = r1; r <= r2; r++) {
      var row = (rows || [])[r - 1] || [];
      for (c = c1; c <= c2; c++) {
        var v = cell(row, c);
        if (v) out.push(v);
      }
    }
    return out;
  }

  function parseLabelSpec(spec) {
    var raw = String(spec || "").trim();
    if (!raw) return null;
    var s = raw.charAt(0) === "=" ? raw.slice(1).trim() : raw;
    var m;
    m = s.match(
      /^(-?\d+(?:\.\d+)?)\s*<=\s*[a-zA-Z]?\s*<=\s*(-?\d+(?:\.\d+)?)$/
    );
    if (m) {
      return {
        type: "NUMBER_BETWEEN",
        values: [m[1], m[2]],
      };
    }
    m = s.match(/^(-?\d+(?:\.\d+)?)\s*<=\s*(-?\d+(?:\.\d+)?)$/);
    if (m) {
      return { type: "NUMBER_BETWEEN", values: [m[1], m[2]] };
    }
    m = s.match(/^>=\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { type: "NUMBER_GREATER_THAN_EQ", values: [m[1]] };
    m = s.match(/^<=\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { type: "NUMBER_LESS_THAN_EQ", values: [m[1]] };
    m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|\.\.)\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { type: "NUMBER_BETWEEN", values: [m[1], m[2]] };
    if (/^-?\d+(?:\.\d+)?(\s*,\s*-?\d+(?:\.\d+)?)+$/.test(s)) {
      return {
        type: "ONE_OF_LIST",
        values: s.split(/\s*,\s*/),
      };
    }
    if (parseA1Range(raw) || parseA1Range(s)) {
      return {
        type: "ONE_OF_RANGE",
        values: [raw.charAt(0) === "=" ? raw : "=" + raw],
      };
    }
    return null;
  }

  function ruleFromHeader(header, rows) {
    var parts = splitHeader(header);
    if (!parts.spec) return null;
    var rule = parseLabelSpec(parts.spec);
    if (!rule) return null;
    if (parseA1Range(parts.spec)) {
      var resolved = resolveA1Values(rows, parts.spec);
      rule = {
        type: resolved.length ? "ONE_OF_LIST" : "ONE_OF_RANGE",
        values: resolved.length ? resolved : rule.values,
        a1: parts.spec,
      };
    }
    return { name: parts.name, rule: rule };
  }

  function rulesFromStyleRows(rows) {
    var start = findSectionData(rows, "settings");
    if (start < 0) start = 2;
    var headers = rows[start - 1] || [];
    var fields = {};
    var i;
    for (i = 0; i < headers.length; i++) {
      var parsed = ruleFromHeader(headers[i], rows);
      if (!parsed || !parsed.name) continue;
      fields[parsed.name] = parsed.rule;
    }
    return fields;
  }

  function fieldValidation(fields, names) {
    if (!fields) return null;
    var folded = [];
    var n;
    for (n = 0; n < names.length; n++) folded.push(foldField(headerName(names[n])));
    var keys = Object.keys(fields);
    var i;
    var k;
    var fk;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      fk = foldField(headerName(k));
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

  function buildSpeedTiles(fields, headerRules) {
    var base = offlineSpeedTiles();
    var scrollNames = [
      "BG Scroll Speed",
      "Background Scroll Speed",
      "Scroll Speed",
    ];
    var presNames = ["Presentation Speed", "Slideshow Speed"];
    var scrollRule =
      fieldValidation(headerRules, scrollNames) ||
      fieldValidation(fields, scrollNames);
    var presRule =
      fieldValidation(headerRules, presNames) ||
      fieldValidation(fields, presNames);
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

  var _proxyBase = "";
  var _proxyAt = 0;

  function apiUrl(path) {
    var p = path.charAt(0) === "/" ? path : "/" + path;
    if (_proxy && !_proxyBase) return p;
    var base = _proxyBase || String(global.TOKI_API_BASE || "").replace(/\/$/, "");
    return base ? base + p : p;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  var FETCH_TIMEOUT_MS = 10000;
  var WRITE_TIMEOUT_MS = 20000;

  function timeoutError(ms) {
    return new Error("Request timed out after " + ms + "ms");
  }

  function fetchWithTimeout(url, init, ms) {
    init = init || {};
    if (ms == null) ms = FETCH_TIMEOUT_MS;
    if (!(ms > 0)) return fetch(url, init);
    if (typeof AbortController === "undefined") {
      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          reject(timeoutError(ms));
        }, ms);
        fetch(url, init).then(
          function (res) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(res);
          },
          function (err) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        );
      });
    }
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      try {
        ctrl.abort();
      } catch (e) {}
    }, ms);
    var opts = Object.assign({}, init, { signal: ctrl.signal });
    return fetch(url, opts).then(
      function (res) {
        clearTimeout(timer);
        return res;
      },
      function (err) {
        clearTimeout(timer);
        var name = err && err.name;
        if (name === "AbortError" || name === "TimeoutError") {
          throw timeoutError(ms);
        }
        throw err;
      }
    );
  }

  async function detectProxy() {
    // A true hit is sticky. A miss is not — Cloud Run cold-start reports
    // sheetsApi:false for a moment; locking that would drop Menu Settings.
    if (_proxy === true) return true;
    if (_proxy === false && Date.now() - _proxyAt < 2000) return false;
    var configured = String(global.TOKI_API_BASE || "").replace(/\/$/, "");
    var candidates = ["/api/health"];
    if (configured) candidates.push(configured + "/api/health");
    var attempt;
    var deadline = Date.now() + FETCH_TIMEOUT_MS;
    for (attempt = 0; attempt < 8; attempt++) {
      if (Date.now() >= deadline) break;
      var i;
      var waking = false;
      for (i = 0; i < candidates.length; i++) {
        var remain = deadline - Date.now();
        if (remain < 200) break;
        try {
          var res = await fetchWithTimeout(
            candidates[i],
            { cache: "no-store" },
            remain
          );
          if (!res.ok) continue;
          var j = await res.json();
          if (j && j.sheetsApi) {
            _proxy = true;
            _proxyBase =
              candidates[i].indexOf("http") === 0
                ? candidates[i].replace(/\/api\/health$/, "")
                : "";
            return true;
          }
          if (j && j.ok && j.sheetsApi === false) waking = true;
        } catch (e) {}
      }
      if (!waking && attempt >= 1) break;
      if (Date.now() + 400 >= deadline) break;
      await sleep(400);
    }
    _proxy = false;
    _proxyAt = Date.now();
    return false;
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
    var res = await fetchWithTimeout(url, { cache: "no-store", mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
    var text = await res.text();
    if (/^\s*</.test(text)) {
      throw new Error("Google returned HTML (sheet not public?)");
    }
    return text;
  }

  function isForeignCatalog(sheetId) {
    var id = String(sheetId || "").trim();
    var live = String(_tvSheetId || "").trim();
    return !!(id && live && id !== live);
  }

  async function fetchCsv(gid, sheetId, force) {
    var useProxy = await detectProxy();
    var extra = force ? "&force=1" : "";
    var id = String(sheetId || "").trim();
    var sidQ = id ? "&sheetId=" + encodeURIComponent(id) : "";
    // Live A2 workbook can use the proxy. A different catalog (Beta) must
    // not — older toki_server ignores sheetId and would return Restaurant.
    if (useProxy && !isForeignCatalog(id)) {
      try {
        return parseCsv(
          await fetchText(
            apiUrl("/api/sheets/csv") + "?gid=" +
              encodeURIComponent(String(gid)) +
              "&single=1" +
              extra +
              sidQ +
              "&t=" +
              Date.now()
          )
        );
      } catch (err) {
        console.warn("manager-sheet: proxy csv failed, trying public", err);
      }
    }
    if (!id) throw new Error("No spreadsheet id for gid " + gid);
    return parseCsv(await fetchText(publicCsvUrl(id, gid)));
  }

  function matchCatalogEntry(name, catalog) {
    var key = String(name || "").trim().toLowerCase();
    var i;
    var n;
    if (!key) return null;
    for (i = 0; i < (catalog || []).length; i++) {
      n = String((catalog[i] && catalog[i].name) || "").trim().toLowerCase();
      if (n === key) return catalog[i];
    }
    var want = sourceId(name);
    for (i = 0; i < (catalog || []).length; i++) {
      if (sourceId((catalog[i] && catalog[i].name) || "") === want) {
        return catalog[i];
      }
    }
    for (i = 0; i < (catalog || []).length; i++) {
      n = String((catalog[i] && catalog[i].name) || "").trim().toLowerCase();
      if (n && (key.indexOf(n) !== -1 || n.indexOf(key) !== -1)) return catalog[i];
    }
    return null;
  }

  function normalizeCatalogChrome(row) {
    if (!row) return null;
    var name = String(row.name || "").trim();
    if (!name) return null;
    return {
      id: row.id || sourceId(name),
      name: name,
      requireRestart: parseYesNo(row.requireRestart, false),
      systemFont: parseSystemFont(row.systemFont),
      limitHeavyFilters: parseYesNo(row.limitHeavyFilters, true),
      confirmSave: parseYesNo(row.confirmSave, true),
      refreshTimer: String(row.refreshTimer || "").trim(),
      debugMode: parseYesNo(row.debugMode, false),
      sheetId: String(row.sheetId || "").trim(),
      sourceUrl: String(row.sourceUrl || row.url || "").trim(),
    };
  }

  function parseOneSettingsRow(row, header, catalog) {
    var name = cell(row, 0);
    if (!name || name.toLowerCase().indexOf("gsheet") !== -1) return null;
    var systemFont = "roboto";
    var limitHeavyFilters = "yes";
    var confirmSave = "yes";
    var refreshTimer = "";
    var debugMode = "no";
    var requireRestart = parseYesNo(cell(row, 1), false);
    var c;
    for (c = 0; c < (header || []).length; c++) {
      var h = String(header[c] || "").toLowerCase();
      if (h.indexOf("require restart") !== -1) {
        requireRestart = parseYesNo(cell(row, c), false);
      }
      if (h.indexOf("system font") !== -1) {
        systemFont = parseSystemFont(cell(row, c));
      }
      if (isHeavyFilterHeader(h)) {
        limitHeavyFilters = parseYesNo(cell(row, c), true);
      }
      if (h.indexOf("confirm") !== -1 && h.indexOf("save") !== -1) {
        confirmSave = parseYesNo(cell(row, c), true);
      }
      if (h.indexOf("refresh timer") !== -1) {
        refreshTimer = cell(row, c) || refreshTimer;
      }
      if (h.indexOf("debug") !== -1 && h.indexOf("mode") !== -1) {
        debugMode = parseYesNo(cell(row, c), false);
      }
    }
    var match = matchCatalogEntry(name, catalog);
    return normalizeCatalogChrome({
      name: name,
      requireRestart: requireRestart,
      systemFont: systemFont,
      limitHeavyFilters: limitHeavyFilters,
      confirmSave: confirmSave,
      refreshTimer: refreshTimer,
      debugMode: debugMode,
      sheetId: (match && match.sheetId) || "",
      sourceUrl: (match && match.url) || "",
    });
  }

  function pickLiveCatalogChrome(catalogSettings) {
    var i;
    for (i = 0; i < (catalogSettings || []).length; i++) {
      if (catalogSettings[i] && catalogSettings[i].id === "restaurant") {
        return catalogSettings[i];
      }
    }
    return (catalogSettings && catalogSettings[0]) || null;
  }

  function overlayCatalogChrome(settings, wantId) {
    if (!settings) return settings;
    var rows = settings.catalogSettings || [];
    var want = sourceId(wantId || settings.dataSource || settings.sourceName);
    var match = null;
    var i;
    for (i = 0; i < rows.length; i++) {
      if (!rows[i]) continue;
      if (rows[i].id === want || sourceId(rows[i].name) === want) {
        match = rows[i];
        break;
      }
    }
    if (!match) return settings;
    settings.requireRestart = match.requireRestart;
    settings.systemFont = match.systemFont;
    settings.limitHeavyFilters = match.limitHeavyFilters;
    settings.confirmSave = match.confirmSave;
    settings.refreshTimer = match.refreshTimer || settings.refreshTimer;
    settings.debugMode = parseYesNo(match.debugMode, false);
    return settings;
  }

  function parseSettingsRows(rows) {
    var catalog = [];
    var catalogSettings = [];
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
    if (headerIdx >= 0) {
      var header = rows[headerIdx] || [];
      var end = catalogIdx >= 0 ? catalogIdx : rows.length;
      for (i = headerIdx + 1; i < end; i++) {
        var parsed = parseOneSettingsRow(rows[i], header, catalog);
        if (parsed) catalogSettings.push(parsed);
      }
    }
    var live = pickLiveCatalogChrome(catalogSettings);
    var dataSource = (live && live.name) || "";
    var match = matchCatalogEntry(dataSource, catalog);
    return {
      dataSource: dataSource || "Restaurant Copy",
      requireRestart: (live && live.requireRestart) || "no",
      systemFont: (live && live.systemFont) || "roboto",
      limitHeavyFilters: (live && live.limitHeavyFilters) || "yes",
      confirmSave: (live && live.confirmSave) || "yes",
      refreshTimer: (live && live.refreshTimer) || "",
      debugMode: (live && live.debugMode) || "no",
      sheetId: (live && live.sheetId) || (match && match.sheetId) || "",
      sourceName: (match && match.name) || dataSource || "",
      catalog: catalog,
      catalogSettings: catalogSettings,
    };
  }

  function parseDebugMenu(rows) {
    var out = { debugMode: "no", features: {} };
    var i;
    var c;
    if (!rows || !rows.length) return out;
    for (i = 0; i < rows.length - 1; i++) {
      if (cell(rows[i], 0).toLowerCase() === "debug mode") {
        out.debugMode = parseYesNo(cell(rows[i + 1], 0), false);
        break;
      }
    }
    for (i = 0; i < rows.length - 2; i++) {
      if (cell(rows[i], 0).toLowerCase() === "debug features") {
        var headers = rows[i + 1] || [];
        var values = rows[i + 2] || [];
        for (c = 0; c < headers.length; c++) {
          var name = String(headers[c] || "").trim();
          if (name) out.features[name] = parseYesNo(values[c], false);
        }
        break;
      }
    }
    return out;
  }

  function attachDebugSettings(settings, dbg) {
    if (!settings) return settings;
    if (dbg) {
      // Features still live on the Debugger tab. Debug Mode is a Settings
      // column per catalog — do not let a leftover Debugger A2 overwrite it.
      settings.debugFeatures = dbg.features || {};
    }
    if (!settings.debugMode) settings.debugMode = "no";
    return settings;
  }

  async function fetchDebuggerPublic() {
    var rows = parseCsv(await fetchText(publicCsvUrl(settingsSheetId(), DEBUGGER_GID)));
    return parseDebugMenu(rows);
  }

  function isHeavyFilterHeader(raw) {
    var h = String(raw || "").trim().toLowerCase();
    if (h.indexOf("heavy") === -1) return false;
    return (
      h.indexOf("fps") !== -1 ||
      h.indexOf("30") !== -1 ||
      h.indexOf("filter") !== -1 ||
      h.indexOf("fitler") !== -1
    );
  }

  function decorateSource(src) {
    var id = src && src.id ? src.id : "";
    if (id === "restaurant") {
      src.env = "restaurant";
      src.siteUrl =
        global.TOKI_RESTAURANT_SITE || "https://olitokip.github.io/OliToki";
    } else if (id === "beta" || id === "alpha") {
      // Catalog workbooks edited in this Manager. Not a testing/restaurant
      // site pin — picking them must not navigate away or write Settings A2.
      src.env = "";
      src.siteUrl = "";
    }
    return src;
  }

  function ensureCatalogSources(sources) {
    var list = (sources || []).slice();
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === "beta") return list;
    }
    var stock = (global.TOKI_MANAGER_DATA && global.TOKI_MANAGER_DATA.dataSources) || [];
    for (i = 0; i < stock.length; i++) {
      if (stock[i] && stock[i].id === "beta") {
        list.push(
          decorateSource({
            id: "beta",
            name: stock[i].name,
            sheetId: stock[i].sheetId || "",
          })
        );
        break;
      }
    }
    return list;
  }

  function catalogToSources(catalog) {
    return ensureCatalogSources(
      (catalog || [])
        .filter(function (c) { return c && (c.name || c.sheetId); })
        .map(function (c) {
          return decorateSource({
            id: sourceId(c.name),
            name: c.name,
            sheetId: c.sheetId || "",
          });
        })
    );
  }

  function pinnedSourceId() {
    var raw = String(global.TOKI_DEFAULT_SOURCE || "").trim();
    if (raw) return sourceId(raw);
    var env = String(global.TOKI_ENV || "local").trim().toLowerCase();
    if (env === "restaurant") return "restaurant";
    if (env === "testing") return "alpha";
    return "";
  }

  function applyPinnedSource(settings) {
    if (!settings) return settings;
    var want = pinnedSourceId();
    if (!want) return settings;
    var sources = catalogToSources(settings.catalog);
    var i;
    var match = null;
    for (i = 0; i < sources.length; i++) {
      if (sources[i].id === want) {
        match = sources[i];
        break;
      }
    }
    if (!match) return settings;
    settings.dataSource = match.name;
    settings.sourceName = match.name;
    if (match.sheetId) settings.sheetId = match.sheetId;
    settings.forcedSource = want;
    return settings;
  }

  function applyEditorSource(settings, wantId) {
    if (!settings) return settings;
    _tvSheetId = String(settings.sheetId || "").trim();
    var sources = catalogToSources(settings.catalog);
    var want = String(wantId || "").trim();
    if (!want) want = sourceId(settings.dataSource || settings.sourceName);
    var match = null;
    var i;
    for (i = 0; i < sources.length; i++) {
      if (sources[i].id === want || sources[i].name === want) {
        match = sources[i];
        break;
      }
    }
    if (!match) return overlayCatalogChrome(settings, want);
    settings.dataSource = match.name || settings.dataSource;
    settings.sourceName = match.name || settings.sourceName;
    if (match.sheetId) settings.sheetId = match.sheetId;
    settings.editorSource = match.id;
    return overlayCatalogChrome(settings, match.id || want);
  }

  async function fetchSettings(force) {
    var useProxy = await detectProxy();
    if (useProxy) {
      try {
        var res = await fetchWithTimeout(
          apiUrl("/api/settings") + "?" + (force ? "force=1&" : "") + "t=" + Date.now(),
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
          var catalogSettings = [];
          var cs = j.catalogSettings || [];
          var ci;
          for (ci = 0; ci < cs.length; ci++) {
            var chrome = normalizeCatalogChrome(cs[ci]);
            if (chrome) catalogSettings.push(chrome);
          }
          if (!catalogSettings.length) {
            catalogSettings.push(
              normalizeCatalogChrome({
                name: j.sourceName || j.dataSource || "",
                requireRestart: j.requireRestart,
                systemFont: j.systemFont,
                limitHeavyFilters: j.limitHeavyFilters,
                confirmSave: j.confirmSave,
                refreshTimer: j.refreshTimer,
                debugMode: j.debugMode,
                sheetId: j.sheetId,
                sourceUrl: j.sourceUrl,
              })
            );
            catalogSettings = catalogSettings.filter(Boolean);
          }
          var settings = applyPinnedSource({
            dataSource: j.dataSource || "",
            requireRestart: parseYesNo(j.requireRestart, false),
            systemFont: parseSystemFont(j.systemFont),
            limitHeavyFilters: parseYesNo(j.limitHeavyFilters, true),
            confirmSave: parseYesNo(j.confirmSave, true),
            refreshTimer: j.refreshTimer || "",
            debugMode: parseYesNo(j.debugMode, false),
            debugFeatures: j.debugFeatures || {},
            sheetId: j.sheetId || "",
            sourceName: j.sourceName || j.dataSource || "",
            catalog: catalog,
            catalogSettings: catalogSettings,
          });
          if (!settings.debugFeatures || !Object.keys(settings.debugFeatures).length) {
            try {
              attachDebugSettings(settings, await fetchDebuggerPublic());
            } catch (dbgErr) {}
          }
          return settings;
        }
      } catch (err) {
        console.warn("manager-sheet: /api/settings failed", err);
      }
    }
    return fetchSettingsPublic();
  }

  async function fetchSettingsPublic() {
    var text = await fetchText(publicCsvUrl(settingsSheetId(), 0));
    var settings = applyPinnedSource(parseSettingsRows(parseCsv(text)));
    try {
      attachDebugSettings(settings, await fetchDebuggerPublic());
    } catch (err) {
      settings.debugMode = settings.debugMode || "no";
    }
    return settings;
  }

  function isThemeNameJunk(name) {
    var low = String(name || "").trim().toLowerCase();
    if (!low) return true;
    if (low === "theme name" || low === "settings") return true;
    if (low.indexOf("glossary") !== -1) return true;
    if (low.indexOf("themes database") === 0) return true;
    return false;
  }

  function themeFromRow(row, nameOverride) {
    var name = nameOverride || cell(row, STYLE_THEME.themeName);
    if (isThemeNameJunk(name)) return null;
    return {
      name: name,
      main: hexOrEmpty(cell(row, STYLE_THEME.mainColor)) || "#000000",
      secondary: hexOrEmpty(cell(row, STYLE_THEME.secondaryColor)) || "#FFFFFF",
      highlight: hexOrEmpty(cell(row, STYLE_THEME.highlight)) || "#26BBCB",
      special: hexOrEmpty(cell(row, STYLE_THEME.highlightSpecial)) || "#FFF900",
      patternColor1: colorRole(cell(row, STYLE_THEME.patternColor1)),
      patternColor2: colorRole(cell(row, STYLE_THEME.patternColor2)),
    };
  }

  function finishThemes(themes) {
    var defaults = { patternColor1: "special", patternColor2: "highlight" };
    var i;
    for (i = 0; i < themes.length; i++) {
      var low = String(themes[i].name || "").replace(/\s+/g, "").toLowerCase();
      if (low !== "tokidefault") continue;
      if (themes[i].patternColor1) defaults.patternColor1 = themes[i].patternColor1;
      if (themes[i].patternColor2) defaults.patternColor2 = themes[i].patternColor2;
    }
    for (i = 0; i < themes.length; i++) {
      if (!themes[i].patternColor1) themes[i].patternColor1 = defaults.patternColor1;
      if (!themes[i].patternColor2) themes[i].patternColor2 = defaults.patternColor2;
    }
    return themes;
  }

  function parseThemes(rows) {
    var start = findSectionData(rows, "themes database");
    if (start < 0) start = 5;
    var themes = [];
    var i;
    for (i = start; i < (rows || []).length; i++) {
      var theme = themeFromRow(rows[i]);
      if (theme) themes.push(theme);
    }
    return finishThemes(themes);
  }

  function themesFromA1(rows, spec) {
    var a1 = parseA1Range(spec);
    if (!a1) return [];
    var r2 = a1.r2 || (rows || []).length;
    var r1 = Math.min(a1.r1, r2);
    r2 = Math.max(a1.r1, r2);
    var themes = [];
    var r;
    for (r = r1; r <= r2; r++) {
      var row = (rows || [])[r - 1];
      if (!row) continue;
      var pointed = cell(row, a1.c1);
      if (!pointed) continue;
      var theme = themeFromRow(row, pointed);
      if (theme) themes.push(theme);
    }
    return finishThemes(themes);
  }

  function selectThemes(rows, headerRules) {
    var rule = fieldValidation(headerRules, ["Theme Selector"]);
    if (rule && rule.a1) {
      var listed = themesFromA1(rows, rule.a1);
      if (listed.length) return listed;
    }
    return parseThemes(rows);
  }

  function colorRolesFromRule(rule) {
    if (!rule || !rule.values || !rule.values.length) return null;
    var stock = (global.TOKI_MANAGER_DATA && global.TOKI_MANAGER_DATA.colorRoles) || [];
    var out = [];
    var seen = {};
    var i;
    for (i = 0; i < rule.values.length; i++) {
      var raw = rule.values[i];
      var id = colorRole(raw);
      if (!id || seen[id]) continue;
      seen[id] = true;
      var label = raw;
      var s;
      for (s = 0; s < stock.length; s++) {
        if (stock[s].id === id) {
          label = stock[s].label;
          break;
        }
      }
      out.push({ id: id, label: label });
    }
    return out.length ? out : null;
  }

  function wallpapersFromRule(rule) {
    if (!rule || !rule.values || !rule.values.length) return null;
    var stock = (global.TOKI_MANAGER_DATA && global.TOKI_MANAGER_DATA.wallpapers) || [];
    var out = [];
    var seen = {};
    var i;
    var s;
    for (i = 0; i < rule.values.length; i++) {
      var raw = rule.values[i];
      var id;
      if (noneValue(raw)) id = "none";
      else if (String(raw).toLowerCase().indexOf("film") !== -1) id = "film";
      else if (String(raw).toLowerCase().indexOf("galaxy") !== -1) id = "galaxy";
      else {
        id = String(raw)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "wp";
      }
      if (seen[id]) continue;
      seen[id] = true;
      var known = null;
      for (s = 0; s < stock.length; s++) {
        if (stock[s].id === id) {
          known = stock[s];
          break;
        }
      }
      if (known) out.push(known);
      else if (id === "none") out.push({ id: "none", label: "None" });
      else out.push({ id: id, label: raw, src: String(raw) });
    }
    return out.length ? out : null;
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
    var colScroll = headerIndex(headers, [
      "BG Scroll Speed",
      "Background Scroll Speed",
      "Scroll Speed",
    ]);
    var colPres = headerIndex(headers, [
      "Presentation Speed",
      "Slideshow Speed",
    ]);
    if (colTheme < 0) colTheme = STYLE_SETTINGS.themeSelector;
    if (colBg < 0) colBg = STYLE_SETTINGS.bgColor;
    if (colPat < 0) colPat = STYLE_SETTINGS.bgPattern;
    if (colWp < 0) colWp = STYLE_SETTINGS.bgImage;
    if (colScroll < 0) colScroll = STYLE_SETTINGS.bgScrollSpeed;
    if (colPres < 0) colPres = STYLE_SETTINGS.slideshowSpeed;

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
    // Boards: pattern wins over wallpaper. Keep Manager read in the same order
    // so a leftover D3 cannot hide a live C3 stripe.
    if (pat) background = "pattern";
    else if (wp) background = "wallpaper";

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
        cell(row, colScroll),
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
        cell(row, colPres),
        3,
        presMin,
        presMax
      ),
    };
  }

  async function fetchValidations(gid, force, sheetId) {
    var useProxy = await detectProxy();
    if (!useProxy) return null;
    if (isForeignCatalog(sheetId)) return null;
    try {
      var res = await fetchWithTimeout(
        apiUrl("/api/sheets/validations") + "?gid=" +
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

  function motionLog(map) {
    if (!map) return "motion=(none)";
    var names = Object.keys(map);
    if (!names.length) return "motion=(none)";
    return names
      .map(function (n) {
        var s = map[n];
        return n + " " + s.punchIn + "/" + s.hold + "/" + s.punchOut;
      })
      .join(" | ");
  }

  async function fetchBetaMotion(sheetId, force) {
    try {
      var rows = await fetchCsv(BETA_FEATURES_GID, sheetId, force);
      var TM = global.TOKI_MOTION;
      if (TM && typeof TM.parseMotionStylesTable === "function") {
        return TM.parseMotionStylesTable(rows);
      }
      return {};
    } catch (err) {
      console.warn("manager-sheet: Beta Motion failed", err);
      return {};
    }
  }

  function buildPayload(settings, styleRows, validationFields, motionStyles) {
    var headerRules = rulesFromStyleRows(styleRows);
    var merged = Object.assign({}, validationFields || {}, headerRules);
    var speedTiles = buildSpeedTiles(validationFields || null, headerRules);
    var themes = selectThemes(styleRows, headerRules);
    var themeRule = fieldValidation(headerRules, ["Theme Selector"]);
    console.info(
      "Menu Manager themes from",
      themeRule && themeRule.a1 ? themeRule.a1 : "Themes Database walk",
      themes.map(function (t) { return t.name; })
    );
    var colorRoles = colorRolesFromRule(
      fieldValidation(headerRules, ["BG Color", "Background Color"])
    );
    var wallpapers = wallpapersFromRule(
      fieldValidation(headerRules, ["BG Wallpaper", "Background Wallpaper"])
    );
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
      refreshTimer: settings.refreshTimer || "30 seconds",
      systemFont: settings.systemFont,
      limitHeavyFilters: settings.limitHeavyFilters || "yes",
      confirmSave: settings.confirmSave || "yes",
      debugMode: settings.debugMode || "no",
    };
    return {
      ok: true,
      sourceName: settings.sourceName || settings.dataSource || "",
      sheetId: settings.sheetId || "",
      catalogSettings: settings.catalogSettings || [],
      dataSources: sources,
      themes: themes,
      colorRoles: colorRoles,
      wallpapers: wallpapers,
      draft: draft,
      speedTiles: speedTiles,
      fieldValidations: merged,
      motionStyles: motionStyles || {},
    };
  }

  function parseGidToken(raw) {
    var s = String(raw || "").trim();
    var m = s.match(/gid=(\d+)/i);
    if (m) return m[1];
    if (/^\d{6,}$/.test(s)) return s;
    return "";
  }

  function parsePresentationMode(raw) {
    var s = foldKey(raw);
    if (!s) return "kenburns";
    if (s.indexOf("encore") !== -1) return "encore";
    if (s.indexOf("slide") !== -1) return "slideshow";
    return "kenburns";
  }

  function parseInfoCatalog(rows) {
    var out = [];
    var i;
    for (i = 0; i < (rows || []).length; i++) {
      var a = cell(rows[i], 0);
      var b = cell(rows[i], 1);
      var c = cell(rows[i], 2);
      if (!a || foldKey(a) === "menu") continue;
      if (!/^\d+$/.test(a)) continue;
      var gid = parseGidToken(c);
      if (!gid) continue;
      out.push({
        id: a,
        number: a,
        permalink: b,
        gid: gid,
      });
    }
    return out;
  }

  function parseBoardTab(rows, meta) {
    meta = meta || {};
    var start = findSectionData(rows, "settings");
    if (start < 0) start = 2;
    var headers = rows[start - 1] || [];
    var data = rows[start] || [];
    var colTitle = headerIndex(headers, ["Menu Title", "Title"]);
    var colFam = headerIndex(headers, ["Family Portrait"]);
    var colPres = headerIndex(headers, ["Presentation Mode", "Presentation Style"]);
    var colDesc = headerIndex(headers, ["Include Descriptions?", "Include Item Descriptions"]);
    if (colTitle < 0) colTitle = 0;
    var title = cell(data, colTitle) || ("Board " + (meta.number || meta.id || ""));
    var kind = colPres < 0 && colFam < 0 ? "announcements" : "board";
    var items = [];
    var inv = findSectionData(rows, "inventory");
    if (inv >= 0) {
      var ih = rows[inv - 1] || [];
      var nameCol = headerIndex(ih, ["Item"]);
      if (nameCol < 0) nameCol = 0;
      var r;
      for (r = inv; r < rows.length; r++) {
        var name = cell(rows[r], nameCol);
        if (!name) continue;
        if (foldKey(name) === "item") continue;
        items.push({ name: name, row: r + 1 });
      }
    } else if (kind === "announcements") {
      var ar = start + 2;
      for (; ar < (rows || []).length; ar++) {
        var at = cell(rows[ar], 0);
        if (!at) continue;
        if (foldKey(at).indexOf("announcementtitle") !== -1) continue;
        items.push({ name: at, row: ar + 1 });
      }
    }
    return {
      id: String(meta.id || meta.number || ""),
      number: String(meta.number || meta.id || ""),
      title: title,
      menuTitle: title,
      gid: meta.gid || "",
      permalink: meta.permalink || "",
      kind: kind,
      familyPortrait: parseYesNo(colFam >= 0 ? cell(data, colFam) : "no", false),
      presentation: parsePresentationMode(colPres >= 0 ? cell(data, colPres) : ""),
      includeDescriptions: parseYesNo(
        colDesc >= 0 ? cell(data, colDesc) : "no",
        false
      ),
      items: items,
    };
  }

  async function loadBoards(sheetId, force) {
    var infoRows;
    try {
      infoRows = await fetchCsv(INFO_GID, sheetId, force);
    } catch (err) {
      console.warn("manager-sheet: Info tab failed", err);
      return [];
    }
    var catalog = parseInfoCatalog(infoRows);
    if (!catalog.length) return [];
    var packs = await Promise.all(
      catalog.map(function (c) {
        return fetchCsv(c.gid, sheetId, force)
          .then(function (rows) {
            return parseBoardTab(rows, c);
          })
          .catch(function (err) {
            console.warn("manager-sheet: board " + c.id + " failed", err);
            return parseBoardTab([], c);
          });
      })
    );
    return packs.filter(function (b) {
      return b && b.id;
    });
  }

  async function load(opts) {
    opts = opts || {};
    var force = !!opts.force;
    if (opts.hangRetry) _proxy = null;
    var t0 =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    var settings;
    var styleRows;
    var validationFields = null;
    var motionStyles = {};
    settings = await fetchSettings(force);
    settings = applyEditorSource(settings, opts.sourceId);
    if (!settings.sheetId && settings.catalog && settings.catalog.length) {
      settings.sheetId = settings.catalog[0].sheetId || "";
    }
    var sid = settings.sheetId || "";
    var pack = await Promise.all([
      fetchCsv(STYLE_GID, sid, force),
      fetchValidations(STYLE_GID, force, sid),
      fetchBetaMotion(sid, force),
    ]);
    styleRows = pack[0];
    validationFields = pack[1];
    motionStyles = pack[2] || {};
    var boards = [];
    try {
      boards = await loadBoards(sid, force);
    } catch (err) {
      console.warn("manager-sheet: boards catalog failed", err);
    }
    var payload = buildPayload(
      settings,
      styleRows,
      validationFields,
      motionStyles
    );
    payload.boards = boards;
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
      motionLog(motionStyles),
      Math.round(ms) + "ms",
      force ? "force" : "cache-ok"
    );
    return payload;
  }

  var FALLBACK_URL = "data/manager-fallback.json";

  function fallbackToPayload(store, wantId) {
    if (!store || !store.sources) return null;
    var id = wantId || store.active || "";
    var entry = store.sources[id] || store.sources[store.active];
    if (!entry && store.sources) {
      var keys = Object.keys(store.sources);
      if (keys.length) entry = store.sources[keys[0]];
    }
    if (!entry) return null;
    return {
      ok: true,
      fromFallback: true,
      sourceName: entry.sourceName || "",
      sheetId: entry.sheetId || "",
      catalogSettings: entry.catalogSettings || [],
      dataSources: entry.dataSources || [],
      themes: entry.themes || [],
      colorRoles: entry.colorRoles || null,
      wallpapers: entry.wallpapers || null,
      draft: entry.draft || null,
      speedTiles: entry.speedTiles || null,
      fieldValidations: entry.fieldValidations || null,
      motionStyles: entry.motionStyles || {},
    };
  }

  async function loadFallback(wantId) {
    try {
      var text = await fetchText(FALLBACK_URL + "?t=" + Date.now());
      return fallbackToPayload(JSON.parse(text), wantId);
    } catch (err) {
      console.warn("manager-sheet: no fallback json", err);
      return null;
    }
  }

  async function saveFallback(entry) {
    try {
      var res = await fetchWithTimeout(
        apiUrl("/api/manager/fallback"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry || {}),
        },
        WRITE_TIMEOUT_MS
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      var j = await res.json();
      return !!(j && j.ok);
    } catch (err) {
      console.warn("manager-sheet: save fallback failed", err);
      return false;
    }
  }

  async function postManager(path, payload) {
    await detectProxy();
    var urls = [path];
    var via = apiUrl(path);
    if (via && urls.indexOf(via) < 0) urls.push(via);
    // Settings workbook is shared. Restaurant Cloud Run URL is the static
    // robot link — Menu Settings writes must not depend on a git push or
    // on the testing container having recovered from a quota spike.
    if (String(path).indexOf("/api/manager/settings") >= 0) {
      var rest = String(global.TOKI_RESTAURANT_API || "").replace(/\/$/, "");
      if (rest) {
        var rurl = rest + (path.charAt(0) === "/" ? path : "/" + path);
        if (urls.indexOf(rurl) < 0) urls.push(rurl);
      }
    }
    var last = { ok: false, error: "Write failed" };
    var i;
    for (i = 0; i < urls.length; i++) {
      try {
        var res = await fetchWithTimeout(
          urls[i],
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload || {}),
          },
          WRITE_TIMEOUT_MS
        );
        var j = {};
        try {
          j = await res.json();
        } catch (e) {
          j = {};
        }
        if (res.ok && j.ok) return j;
        last = {
          ok: false,
          error: (j && j.error) || ("HTTP " + res.status),
        };
      } catch (err) {
        last = { ok: false, error: String((err && err.message) || err) };
      }
    }
    return last;
  }

  async function writeStyle(payload) {
    var out = await postManager("/api/manager/style", payload || {});
    if (!out.ok) console.warn("manager-sheet: style write failed", out.error);
    return out;
  }

  async function writeTheme(themeName, sheetId) {
    var name = String(themeName || "").trim();
    if (!name) return { ok: false, error: "missing theme" };
    return writeStyle({
      theme: name,
      sheetId: String(sheetId || "").trim(),
    });
  }

  async function writeBoard(payload) {
    var out = await postManager("/api/manager/board", payload || {});
    if (!out.ok) console.warn("manager-sheet: board write failed", out.error);
    return out;
  }

  async function writeSystem(payload) {
    // Persists Require restart / System Font / Limit Heavy Filters /
    // Confirm Save / Refresh Timer / Debug Mode into the OliToki Menu Settings workbook.
    // Each catalog has its own Settings row (Restaurant A2–G2, Beta A3–G3).
    // sourceId selects that row. Column A is the row's catalog name — never
    // overwrite it as a TV pointer. TVs keep reading the Restaurant row.
    // Debug Mode writes Settings column G (header "Debug Mode") on that row.
    // See scripts/toki_server.py for the full "all new settings must be in the sheet" contract.
    // Server maps to the correct cells under the matching header. This makes e.g.
    // Refresh Timer and System Font affect the menu boards on their next settings load.
    //
    // All new user-accessible settings features must live in (or be mapped from) the
    // Settings sheet. If a column does not exist yet for a feature worked on in a Pass,
    // the Pass text must carry a reminder to Lead to add the header.
    payload = Object.assign({}, payload || {});
    delete payload.dataSource;
    var out = await postManager("/api/manager/settings", payload);
    if (!out.ok) console.warn("manager-sheet: system settings write failed", out.error);
    return out;
  }

  global.TOKI_MANAGER_SHEET = {
    load: load,
    loadFallback: loadFallback,
    saveFallback: saveFallback,
    writeStyle: writeStyle,
    writeTheme: writeTheme,
    writeBoard: writeBoard,
    writeSystem: writeSystem,
    styleGid: STYLE_GID,
  };
})(window);

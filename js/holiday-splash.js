/**
 * TokiMenu — Holiday Splash (Spooky Roulette).
 *
 * When Style Theme is Halloween and Spooky Roulette is On, each board paints
 * one of six full-stage splash SVGs at the top of every Eastern minute.
 * All four boards shuffle the same minute seed so no two match (4 of 6).
 * Fade-in staggers left → right (0.25s each, 1s total), holds 7s after the
 * last board is in, then all four fade out together (0.5s).
 *
 * Sheet: Style and Theme Settings → Spooky Roulette (column N). Menu Manager
 * shows that row only when Theme is Halloween.
 *
 * QA: ?theme=Halloween&roulette=1&splash=1 (play now)
 *     ?splash=hold (show and stay)  ?splashAt= ISO freeze
 *     ?roulette=0 force off
 */
(function (root) {
  "use strict";

  var TZ = "America/New_York";
  var STYLE_GID = "183083022";
  var BETA_COPY_SHEET_ID = "1Bh5pbaBUT5kzANZg_r_ELGxEkphOty4uNyg92ZDBMs8";
  var FETCH_MS = 8000;
  var POLL_MS = 30 * 1000;
  var FADE_IN_MS = 250;
  var STAGGER_MS = 250;
  var HOLD_MS = 7000;
  var FADE_OUT_MS = 500;
  var BOARD_COUNT = 4;

  var started = false;
  var overlay = null;
  var art = null;
  var slot = 1;
  var sheetRoulette = false;
  var sheetHalloween = false;
  var frozenNow = null;
  var playing = false;
  var armTimer = 0;
  var pollTimer = 0;
  var fadeInTimer = 0;
  var fadeOutTimer = 0;
  var hideTimer = 0;
  var lastMinuteKey = null;
  var liveSheetId = "";
  var styleFetchGen = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function boardSlot() {
    var H = root.TOKI_HALLOWEEN;
    var cfg = root.TOKI_CONFIG;
    if (H && typeof H.layoutFromConfig === "function") {
      var layout = H.layoutFromConfig(cfg);
      if (layout === "handhelds") return 2;
      if (layout === "munchies") return 3;
      if (layout === "drinks") return 4;
      if (layout === "bowls") return 1;
    }
    var path = "";
    try {
      path = String(location.pathname || "");
    } catch (e) {
      path = "";
    }
    if (/index4/i.test(path)) return 4;
    if (/index3/i.test(path)) return 3;
    if (/index2/i.test(path)) return 2;
    return 1;
  }

  function query() {
    try {
      return new URLSearchParams(location.search);
    } catch (e) {
      return new URLSearchParams();
    }
  }

  function readFrozenNow() {
    try {
      var raw = query().get("splashAt") || query().get("wxNow") || query().get("hoursAt");
      if (!raw) return null;
      var d = new Date(raw);
      if (isNaN(d.getTime())) return null;
      return d;
    } catch (e) {
      return null;
    }
  }

  function readForceRoulette() {
    try {
      var raw = query().get("roulette");
      if (raw == null || raw === "") return null;
      raw = String(raw).trim().toLowerCase();
      if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
        return true;
      }
      if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
        return false;
      }
    } catch (e) {}
    return null;
  }

  function readSplashMode() {
    try {
      var raw = query().get("splash");
      if (raw == null || raw === "") return "";
      raw = String(raw).trim().toLowerCase();
      if (raw === "hold") return "hold";
      if (raw === "1" || raw === "true" || raw === "yes" || raw === "now" || raw === "on") {
        return "now";
      }
      if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
        return "off";
      }
    } catch (e) {}
    return "";
  }

  function nowDate() {
    return frozenNow || new Date();
  }

  function easternParts(d) {
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    var map = {};
    fmt.formatToParts(d).forEach(function (p) {
      map[p.type] = p.value;
    });
    return {
      year: Number(map.year) || 0,
      month: Number(map.month) || 0,
      day: Number(map.day) || 0,
      hour: Number(map.hour) || 0,
      minute: Number(map.minute) || 0,
      second: Number(map.second) || 0,
    };
  }

  function minuteKey(d) {
    var p = easternParts(d);
    return p.year * 525600 + p.month * 44640 + p.day * 1440 + p.hour * 60 + p.minute;
  }

  function msIntoMinute(d) {
    var p = easternParts(d);
    return p.second * 1000 + (d.getMilliseconds() % 1000);
  }

  function splashWindowMs() {
    return BOARD_COUNT * STAGGER_MS + HOLD_MS + FADE_OUT_MS;
  }

  function mix32(n) {
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return (n ^ (n >>> 16)) >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shufflePicks(key, count) {
    var ids = [];
    var i;
    var j;
    var tmp;
    for (i = 0; i < count; i++) ids.push(i);
    var rng = mulberry32(mix32(key));
    for (i = count - 1; i > 0; i--) {
      j = Math.floor(rng() * (i + 1));
      tmp = ids[i];
      ids[i] = ids[j];
      ids[j] = tmp;
    }
    return ids;
  }

  function halloweenOn() {
    var H = root.TOKI_HALLOWEEN;
    if (H && typeof H.urlThemeOverride === "function" && H.isHalloween(H.urlThemeOverride())) {
      return true;
    }
    if (document.body && document.body.classList.contains("theme-halloween")) {
      return true;
    }
    if (sheetHalloween) return true;
    try {
      var raw = localStorage.getItem("tokiLastPaint");
      var lp = raw ? JSON.parse(raw) : null;
      if (H && lp && H.isHalloween(lp.themeName)) return true;
    } catch (e) {}
    return false;
  }

  function rouletteOn() {
    var force = readForceRoulette();
    if (force != null) return force;
    return !!sheetRoulette;
  }

  function enabled() {
    if (readSplashMode() === "off") return false;
    if (root.TOKI_STORE_CLOSED) return false;
    return halloweenOn() && rouletteOn();
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
      if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
        continue;
      }
      if (ch === "\r") {
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

  function cell(row, idx) {
    if (!row || idx == null || idx < 0 || idx >= row.length) return "";
    var v = row[idx];
    return v == null ? "" : String(v).trim();
  }

  function foldKey(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function parseYesNo(raw, fallback) {
    var s = String(raw == null ? "" : raw).trim().toLowerCase();
    if (!s) return !!fallback;
    if (s === "1" || s === "yes" || s === "y" || s === "true" || s === "on") {
      return true;
    }
    if (s === "0" || s === "no" || s === "n" || s === "false" || s === "off") {
      return false;
    }
    return !!fallback;
  }

  function urlWantsBeta() {
    try {
      return query().has("beta");
    } catch (e) {
      return false;
    }
  }

  function catalogSheetId() {
    if (urlWantsBeta()) return BETA_COPY_SHEET_ID;
    if (liveSheetId) return liveSheetId;
    // Do not use TOKI_CONFIG.googleSheetId — config.js still names Alpha Copy.
    // Boards paint Restaurant (or ?beta) after live settings; splash must match.
    return "";
  }

  function fetchWithTimeout(url, ms) {
    ms = ms || FETCH_MS;
    var opts = { cache: "no-store", mode: "cors" };
    if (typeof AbortController !== "function") {
      return fetch(url, opts);
    }
    var ctrl = new AbortController();
    opts.signal = ctrl.signal;
    var t = window.setTimeout(function () {
      try {
        ctrl.abort();
      } catch (e) {}
    }, ms);
    return fetch(url, opts).then(
      function (res) {
        window.clearTimeout(t);
        return res;
      },
      function (err) {
        window.clearTimeout(t);
        throw err;
      }
    );
  }

  function healthUrls() {
    var urls = ["/api/health"];
    var base = String(root.TOKI_API_BASE || "").replace(/\/$/, "");
    if (base) urls.push(base + "/api/health");
    return urls;
  }

  function fetchHealthSheetId() {
    if (urlWantsBeta()) {
      liveSheetId = BETA_COPY_SHEET_ID;
      return Promise.resolve(liveSheetId);
    }
    if (liveSheetId) return Promise.resolve(liveSheetId);
    var urls = healthUrls();
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve("");
      var url = urls[i++];
      return fetchWithTimeout(url, 6000)
        .then(function (res) {
          if (!res.ok) throw new Error("health " + res.status);
          return res.json();
        })
        .then(function (j) {
          var sid = String((j && j.sheetId) || "").trim();
          if (!sid) throw new Error("health empty");
          liveSheetId = sid;
          return sid;
        })
        .catch(function () {
          return next();
        });
    }
    return next();
  }

  function parseStyleFlags(rows) {
    var start = -1;
    var i;
    var a;
    for (i = 0; i < (rows || []).length; i++) {
      a = cell(rows[i], 0).toLowerCase();
      if (a === "settings" || a.indexOf("settings") === 0) {
        start = i + 2;
        break;
      }
    }
    if (start < 0) start = 2;
    var headers = rows[start - 1] || [];
    var row = rows[start] || [];
    var colTheme = -1;
    var colRoulette = -1;
    var c;
    var fold;
    for (c = 0; c < headers.length; c++) {
      fold = foldKey(headers[c]);
      if (
        (fold === "themeselector" || fold.indexOf("themeselector") === 0) &&
        colTheme < 0
      ) {
        colTheme = c;
      }
      if (fold === "spookyroulette" && colRoulette < 0) colRoulette = c;
    }
    if (colTheme < 0) colTheme = 0;
    if (colRoulette < 0 && headers.length > 13) {
      fold = foldKey(headers[13]);
      if (!fold || fold === "spookyroulette") colRoulette = 13;
    }
    var H = root.TOKI_HALLOWEEN;
    var themeName = colTheme >= 0 ? cell(row, colTheme) : "";
    var halloween = !!(H && H.isHalloween(themeName));
    var roulette = colRoulette >= 0 ? parseYesNo(cell(row, colRoulette), false) : false;
    return { halloween: halloween, roulette: roulette, themeName: themeName };
  }

  function applyStyleFlags(flags) {
    if (!flags) return;
    sheetHalloween = !!flags.halloween;
    sheetRoulette = !!flags.roulette;
  }

  function styleCsvUrls() {
    var sid = catalogSheetId();
    var urls = [];
    var q =
      "?gid=" +
      encodeURIComponent(STYLE_GID) +
      (sid ? "&sheetId=" + encodeURIComponent(sid) : "") +
      "&t=" +
      Date.now();
    urls.push("/api/sheets/csv" + q);
    var base = String(root.TOKI_API_BASE || "").replace(/\/$/, "");
    if (base) urls.push(base + "/api/sheets/csv" + q);
    if (sid) {
      urls.push(
        "https://docs.google.com/spreadsheets/d/" +
          encodeURIComponent(sid) +
          "/export?format=csv&gid=" +
          encodeURIComponent(STYLE_GID) +
          "&cachebust=" +
          Date.now()
      );
    }
    return urls;
  }

  function fetchText(url) {
    return fetchWithTimeout(url).then(function (res) {
      if (!res.ok) throw new Error("splash style " + res.status);
      return res.text();
    });
  }

  function fetchStyleFlags() {
    var gen = ++styleFetchGen;
    return fetchHealthSheetId()
      .then(function () {
        var urls = styleCsvUrls();
        var i = 0;
        function next() {
          if (i >= urls.length) {
            return Promise.reject(new Error("splash style empty"));
          }
          var url = urls[i++];
          return fetchText(url).then(
            function (text) {
              if (/^\s*</.test(text)) throw new Error("splash style HTML");
              var flags = parseStyleFlags(parseCsv(text));
              if (gen !== styleFetchGen) return flags;
              applyStyleFlags(flags);
              console.info(
                "[TokiMenu splash] style",
                flags.themeName || "?",
                "roulette",
                flags.roulette ? "yes" : "no",
                "sheet",
                catalogSheetId() || "tv-default"
              );
              return flags;
            },
            function () {
              return next();
            }
          );
        }
        return next();
      })
      .catch(function (err) {
        console.warn("[TokiMenu splash] Style", err);
        return null;
      });
  }

  function ensureOverlay() {
    var stage = $("stage");
    if (!stage) return null;
    overlay = $("holiday-splash");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "holiday-splash";
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("role", "img");
      overlay.setAttribute("aria-label", "Holiday splash");
      art = document.createElement("img");
      art.id = "holiday-splash-art";
      art.alt = "";
      art.draggable = false;
      art.classList.add("toki-decoded");
      overlay.appendChild(art);
      stage.appendChild(overlay);
    } else {
      art = $("holiday-splash-art") || overlay.querySelector("img");
    }
    overlay.setAttribute("data-board", String(slot));
    return overlay;
  }

  function clearPlayTimers() {
    if (fadeInTimer) window.clearTimeout(fadeInTimer);
    if (fadeOutTimer) window.clearTimeout(fadeOutTimer);
    if (hideTimer) window.clearTimeout(hideTimer);
    fadeInTimer = 0;
    fadeOutTimer = 0;
    hideTimer = 0;
  }

  function hideOverlay() {
    clearPlayTimers();
    playing = false;
    if (!overlay) return;
    overlay.classList.remove("is-in");
    overlay.classList.remove("is-visible");
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.transition = "";
    overlay.style.opacity = "";
  }

  function pickIndex(key) {
    var H = root.TOKI_HALLOWEEN;
    var count = H && typeof H.splashCount === "function" ? H.splashCount() : 6;
    if (count < BOARD_COUNT) count = BOARD_COUNT;
    var picks = shufflePicks(key, count);
    var idx = picks[slot - 1];
    if (idx == null) idx = 0;
    return idx;
  }

  function play(key, mode) {
    if (!enabled()) {
      hideOverlay();
      return;
    }
    var H = root.TOKI_HALLOWEEN;
    if (!H || typeof H.splashUrl !== "function") return;
    ensureOverlay();
    if (!overlay || !art) return;
    slot = boardSlot();
    var idx = pickIndex(key);
    var src = H.splashUrl(idx);
    var label = H.splashLabel ? H.splashLabel(idx) : String(idx);
    if (art.getAttribute("src") !== src) art.src = src;
    art.classList.add("toki-decoded");
    art.classList.remove("toki-await-decode");
    overlay.setAttribute("aria-label", "Holiday splash " + label);
    lastMinuteKey = key;
    playing = true;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.add("is-visible");
    console.info(
      "[TokiMenu splash] board",
      slot,
      label,
      "minute",
      key,
      mode || "tick"
    );
    if (mode === "hold") {
      overlay.style.transition = "none";
      overlay.style.opacity = "1";
      overlay.classList.add("is-in");
      return;
    }
    var elapsed = mode === "now" ? 0 : msIntoMinute(nowDate());
    var fadeStart = (slot - 1) * STAGGER_MS;
    var fadeOutAt = BOARD_COUNT * STAGGER_MS + HOLD_MS;
    if (elapsed >= fadeOutAt + FADE_OUT_MS) {
      hideOverlay();
      return;
    }
    clearPlayTimers();
    if (elapsed >= fadeStart + FADE_IN_MS) {
      overlay.style.transition = "none";
      overlay.style.opacity = "1";
      overlay.classList.add("is-in");
    } else {
      overlay.style.transition = "none";
      overlay.style.opacity = "0";
      overlay.classList.remove("is-in");
      var delay = Math.max(0, fadeStart - elapsed);
      fadeInTimer = window.setTimeout(function () {
        fadeInTimer = 0;
        overlay.style.transition = "opacity " + FADE_IN_MS + "ms linear";
        overlay.style.opacity = "1";
        overlay.classList.add("is-in");
      }, delay);
    }
    if (elapsed >= fadeOutAt) {
      overlay.style.transition = "opacity " + FADE_OUT_MS + "ms linear";
      overlay.style.opacity = "0";
      overlay.classList.remove("is-in");
      hideTimer = window.setTimeout(function () {
        hideTimer = 0;
        hideOverlay();
      }, FADE_OUT_MS + 20);
      return;
    }
    fadeOutTimer = window.setTimeout(function () {
      fadeOutTimer = 0;
      overlay.style.transition = "opacity " + FADE_OUT_MS + "ms linear";
      overlay.style.opacity = "0";
      overlay.classList.remove("is-in");
      hideTimer = window.setTimeout(function () {
        hideTimer = 0;
        hideOverlay();
      }, FADE_OUT_MS + 20);
    }, fadeOutAt - elapsed);
  }

  function tickSplash() {
    if (!enabled()) {
      if (playing) hideOverlay();
      return;
    }
    if (readSplashMode() === "hold") return;
    var now = nowDate();
    var key = minuteKey(now);
    var elapsed = msIntoMinute(now);
    if (elapsed <= splashWindowMs()) {
      if (key !== lastMinuteKey || (!playing && elapsed < BOARD_COUNT * STAGGER_MS + HOLD_MS)) {
        play(key, "tick");
      }
    } else if (playing && elapsed > splashWindowMs()) {
      hideOverlay();
    }
  }

  function arm() {
    if (armTimer) window.clearInterval(armTimer);
    armTimer = 0;
    if (!enabled()) return;
    if (readSplashMode() === "hold") return;
    tickSplash();
    armTimer = window.setInterval(tickSplash, 250);
  }

  function syncEnabled() {
    if (!enabled()) {
      hideOverlay();
      if (armTimer) window.clearInterval(armTimer);
      armTimer = 0;
      return;
    }
    var mode = readSplashMode();
    if (mode === "hold") {
      play(minuteKey(nowDate()), "hold");
      return;
    }
    if (!armTimer) arm();
    else tickSplash();
  }

  function start() {
    if (started) return;
    if (!$("stage")) return;
    started = true;
    slot = boardSlot();
    frozenNow = readFrozenNow();
    ensureOverlay();
    var mode = readSplashMode();
    if (mode === "hold" || mode === "now") {
      if (enabled()) play(minuteKey(nowDate()), mode === "hold" ? "hold" : "now");
    }
    syncEnabled();
    fetchStyleFlags().then(function () {
      if (mode === "hold" || mode === "now") {
        if (enabled() && !playing) play(minuteKey(nowDate()), mode === "hold" ? "hold" : "now");
        else syncEnabled();
      } else {
        syncEnabled();
      }
    });
    pollTimer = window.setInterval(function () {
      fetchStyleFlags().then(syncEnabled);
    }, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      fetchStyleFlags().then(syncEnabled);
    });
    window.addEventListener("toki:theme-change", function (ev) {
      var H = root.TOKI_HALLOWEEN;
      var name = ev && ev.detail && ev.detail.themeName;
      if (H && name) sheetHalloween = H.isHalloween(name);
      syncEnabled();
    });
    window.addEventListener("toki:closed-change", function () {
      syncEnabled();
    });
  }

  function stop() {
    if (pollTimer) window.clearInterval(pollTimer);
    if (armTimer) window.clearInterval(armTimer);
    pollTimer = 0;
    armTimer = 0;
    hideOverlay();
    started = false;
  }

  root.TOKI_HOLIDAY_SPLASH = {
    start: start,
    stop: stop,
    play: function () {
      play(minuteKey(nowDate()), "now");
    },
    boardSlot: function () {
      return slot;
    },
    enabled: enabled,
  };

  if ($("stage")) {
    start();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(window);

/**
 * TokiMenu — Holiday Splash (Spooky Roulette).
 *
 * When Style Theme is Halloween and Spooky Roulette is On, each board paints
 * one of six full-stage splash SVGs at the top of every Eastern minute.
 * All four boards shuffle the same minute seed so no two match (4 of 6).
 * Fade-in staggers left → right (0.25s each, 1s total), holds 7s after the
 * last board is in, then all four fade out together (0.5s).
 *
 * Overlay is a CSS background on #holiday-splash — never an <img>, so it
 * stays out of the food-image decoder. Spooky Roulette is read from the
 * Style tab menu.js already loaded (toki:theme-change / TOKI_SPOOKY_ROULETTE).
 * This file does not fetch Style or /api/health; extra sheet traffic starved
 * the Google load (dead theme, empty plates, blank drinks).
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
  var FADE_IN_MS = 250;
  var STAGGER_MS = 250;
  var HOLD_MS = 7000;
  var FADE_OUT_MS = 500;
  var BOARD_COUNT = 4;

  var started = false;
  var overlay = null;
  var slot = 1;
  var sheetRoulette = false;
  var sheetHalloween = false;
  var frozenNow = null;
  var playing = false;
  var armTimer = 0;
  var fadeInTimer = 0;
  var fadeOutTimer = 0;
  var hideTimer = 0;
  var lastMinuteKey = null;
  var lastSrc = "";
  var preloaded = false;

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

  function msUntilNextMinute(d) {
    var rem = 60000 - msIntoMinute(d);
    if (rem < 50) rem += 60000;
    return rem;
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
    if (sheetRoulette) return true;
    try {
      if (root.TOKI_SPOOKY_ROULETTE) return true;
    } catch (e) {}
    return false;
  }

  function enabled() {
    if (readSplashMode() === "off") return false;
    if (root.TOKI_STORE_CLOSED) return false;
    return halloweenOn() && rouletteOn();
  }

  function preloadArt() {
    var H = root.TOKI_HALLOWEEN;
    if (preloaded || !H || typeof H.splashCount !== "function") return;
    preloaded = true;
    var n = H.splashCount();
    var i;
    for (i = 0; i < n; i++) {
      var img = new Image();
      img.decoding = "async";
      img.src = H.splashUrl(i);
    }
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
      stage.appendChild(overlay);
    }
    var leftover = overlay.querySelector("img");
    if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
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
    overlay.classList.remove("is-out");
    overlay.classList.remove("is-hold");
    overlay.classList.remove("is-visible");
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.backgroundImage = "";
    lastSrc = "";
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

  function applyArt(idx) {
    var H = root.TOKI_HALLOWEEN;
    var src = H.splashUrl(idx);
    var label = H.splashLabel ? H.splashLabel(idx) : String(idx);
    if (src !== lastSrc) {
      overlay.style.backgroundImage = "url(" + JSON.stringify(src) + ")";
      lastSrc = src;
    }
    overlay.setAttribute("aria-label", "Holiday splash " + label);
    overlay.setAttribute("data-splash", label);
    return label;
  }

  function play(key, mode) {
    if (!enabled()) {
      hideOverlay();
      return;
    }
    var H = root.TOKI_HALLOWEEN;
    if (!H || typeof H.splashUrl !== "function") return;
    ensureOverlay();
    if (!overlay) return;
    slot = boardSlot();
    if (mode !== "now" && mode !== "hold" && playing && lastMinuteKey === key) {
      return;
    }
    preloadArt();
    var idx = pickIndex(key);
    var label = applyArt(idx);
    lastMinuteKey = key;
    playing = true;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.remove("is-in");
    overlay.classList.remove("is-out");
    overlay.classList.remove("is-hold");
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
      overlay.classList.add("is-hold");
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
      overlay.classList.add("is-hold");
      overlay.classList.add("is-in");
    } else {
      var delay = Math.max(0, fadeStart - elapsed);
      fadeInTimer = window.setTimeout(function () {
        fadeInTimer = 0;
        overlay.classList.remove("is-hold");
        overlay.classList.remove("is-out");
        window.requestAnimationFrame(function () {
          if (!playing || !overlay) return;
          overlay.classList.add("is-in");
        });
      }, delay);
    }
    if (elapsed >= fadeOutAt) {
      overlay.classList.remove("is-hold");
      overlay.classList.remove("is-in");
      overlay.classList.add("is-out");
      hideTimer = window.setTimeout(function () {
        hideTimer = 0;
        hideOverlay();
      }, FADE_OUT_MS + 20);
      return;
    }
    fadeOutTimer = window.setTimeout(function () {
      fadeOutTimer = 0;
      overlay.classList.remove("is-hold");
      overlay.classList.remove("is-in");
      overlay.classList.add("is-out");
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
    if (armTimer) window.clearTimeout(armTimer);
    armTimer = 0;
    if (!enabled()) return;
    if (readSplashMode() === "hold") return;
    tickSplash();
    if (frozenNow) return;
    armTimer = window.setTimeout(function () {
      armTimer = 0;
      tickSplash();
      arm();
    }, msUntilNextMinute(nowDate()));
  }

  function syncEnabled() {
    if (!enabled()) {
      hideOverlay();
      if (armTimer) window.clearTimeout(armTimer);
      armTimer = 0;
      return;
    }
    preloadArt();
    var mode = readSplashMode();
    if (mode === "hold") {
      play(minuteKey(nowDate()), "hold");
      return;
    }
    if (!armTimer) arm();
    else tickSplash();
  }

  function onThemeChange(ev) {
    var d = ev && ev.detail;
    var H = root.TOKI_HALLOWEEN;
    if (d && d.themeName && H) sheetHalloween = H.isHalloween(d.themeName);
    if (d && d.halloween != null) sheetHalloween = !!d.halloween;
    if (d && d.spookyRoulette != null) sheetRoulette = !!d.spookyRoulette;
    syncEnabled();
  }

  function start() {
    if (started) return;
    if (!$("stage")) return;
    started = true;
    slot = boardSlot();
    frozenNow = readFrozenNow();
    ensureOverlay();
    if (root.TOKI_SPOOKY_ROULETTE) sheetRoulette = true;
    var mode = readSplashMode();
    if (mode === "hold" || mode === "now") {
      if (enabled()) play(minuteKey(nowDate()), mode === "hold" ? "hold" : "now");
    }
    syncEnabled();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      syncEnabled();
    });
    window.addEventListener("toki:theme-change", onThemeChange);
    window.addEventListener("toki:closed-change", function () {
      syncEnabled();
    });
  }

  function stop() {
    if (armTimer) window.clearTimeout(armTimer);
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

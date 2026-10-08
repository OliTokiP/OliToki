/**
 * TokiMenu — Holiday Splash (Spooky Roulette).
 *
 * When Style Theme is Halloween and Spooky Roulette is On, each board paints
 * one of six full-stage splash SVGs at the top of every Eastern minute.
 * All four boards shuffle the same minute seed so no two match (4 of 6).
 * Fade-in staggers left → right (0.25s each, 1s total), holds 7s after the
 * last board is in, then all four fade out together (0.5s).
 *
 * The trigger is the weather clock (toki:clock-tick). That clock is Cloud
 * Run nowMs plus a local offset, so four sticks share one Eastern second.
 * Fade-in staggers from that minute mark; fade-out is one shared 8s mark.
 * Minute key is still the shuffle seed so four TVs pick the same costumes.
 *
 * Overlay is a CSS background on #holiday-splash — never an <img>, so it
 * stays out of the food-image decoder. Fade is an inline CSS opacity
 * transition (Silk drops WAAPI interpolation on this full-stage layer when
 * drinks stripes are scrolling). Art preloads before the fade so the SVG
 * is not still decoding at full opacity. Costume art keeps its own fills; #splash-bg
 * and #splash-caption take that board’s theme pair:
 *   1 Highlight / Main, 2 Secondary / Main, 3 Special / Main, 4 Main / Secondary.
 * Spooky Roulette is read from last-paint, then toki:theme-change /
 * TOKI_SPOOKY_ROULETTE — never from its own Style fetch.
 * A board that wakes during the window joins mid-stagger; past fade-out
 * it waits for the next minute.
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

  var LAST_PAINT_KEY = "tokiLastPaint";
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
  var lastBlob = "";
  var svgTextCache = {};
  var preloaded = false;
  var preloadDone = false;
  var preloadWaiters = [];
  var splashFadeGen = 0;

  var FALLBACK_MAIN = "#1A0A24";
  var FALLBACK_SECONDARY = "#F5E6D3";
  var FALLBACK_HIGHLIGHT = "#FF6B00";
  var FALLBACK_SPECIAL = "#9ACD32";

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
    if (frozenNow) return frozenNow;
    var wx = root.TOKI_WEATHER_WIDGET;
    if (wx && typeof wx.nowDate === "function") return wx.nowDate();
    return new Date();
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

  function msUntilNextSecond(d) {
    var wait = 1000 - d.getMilliseconds();
    if (wait < 1) wait = 1000;
    return wait;
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

  function readLastPaint() {
    try {
      var raw = localStorage.getItem(LAST_PAINT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function cssColor(name, fallback) {
    try {
      var v = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(name);
      v = String(v || "").trim();
      if (v) return v;
    } catch (e) {}
    return fallback;
  }

  function themeColors() {
    var lp = readLastPaint() || {};
    return {
      main: cssColor("--main-color", lp.main || FALLBACK_MAIN),
      secondary: cssColor(
        "--secondary-color",
        lp.secondary || FALLBACK_SECONDARY
      ),
      highlight: cssColor("--highlight", lp.highlight || FALLBACK_HIGHLIGHT),
      special: cssColor(
        "--highlight-special",
        lp.special || FALLBACK_SPECIAL
      ),
    };
  }

  function boardTint(s) {
    var c = themeColors();
    s = Number(s) || slot;
    if (s === 2) return { bg: c.secondary, caption: c.main };
    if (s === 3) return { bg: c.special, caption: c.main };
    if (s === 4) return { bg: c.main, caption: c.secondary };
    return { bg: c.highlight, caption: c.main };
  }

  function svgCacheKey(src) {
    return String(src || "").split("?")[0];
  }

  function loadSvgText(src) {
    var key = svgCacheKey(src);
    if (svgTextCache[key]) {
      return Promise.resolve(svgTextCache[key]);
    }
    return fetch(src, { cache: "force-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("splash art " + res.status);
        return res.text();
      })
      .then(function (text) {
        svgTextCache[key] = text;
        return text;
      });
  }

  function tintSvg(text, bg, caption) {
    var doc;
    try {
      doc = new DOMParser().parseFromString(text, "image/svg+xml");
    } catch (e) {
      return text;
    }
    var svg = doc.documentElement;
    if (!svg || String(svg.nodeName).toLowerCase() !== "svg") return text;
    var bgEl =
      doc.getElementById("splash-bg") || svg.querySelector("#splash-bg");
    if (bgEl) {
      bgEl.setAttribute("fill", bg);
      bgEl.style.fill = bg;
      bgEl.removeAttribute("class");
    }
    var cap =
      doc.getElementById("splash-caption") ||
      svg.querySelector("#splash-caption");
    if (cap) {
      cap.setAttribute("fill", caption);
      cap.style.fill = caption;
      var nodes = cap.querySelectorAll(
        "path, circle, ellipse, polygon, polyline, text, tspan"
      );
      var i;
      for (i = 0; i < nodes.length; i++) {
        nodes[i].setAttribute("fill", caption);
        nodes[i].style.fill = caption;
        nodes[i].removeAttribute("class");
      }
    }
    var defs = svg.querySelector("defs");
    if (!defs) {
      defs = doc.createElementNS("http://www.w3.org/2000/svg", "defs");
      svg.insertBefore(defs, svg.firstChild);
    }
    var style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent =
      "#splash-bg{fill:" +
      bg +
      " !important;}" +
      "#splash-caption path,#splash-caption circle,#splash-caption ellipse," +
      "#splash-caption polygon,#splash-caption polyline,#splash-caption text{" +
      "fill:" +
      caption +
      " !important;}";
    defs.appendChild(style);
    var out = new XMLSerializer().serializeToString(svg);
    if (out.indexOf("xmlns") === -1) {
      out = out.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return out;
  }

  function blobUrlFor(text) {
    return URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  }

  function revokeBlob() {
    if (lastBlob) {
      try {
        URL.revokeObjectURL(lastBlob);
      } catch (e) {}
      lastBlob = "";
    }
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
    var lp = readLastPaint();
    if (H && lp && H.isHalloween(lp.themeName)) return true;
    return false;
  }

  function rouletteOn() {
    var force = readForceRoulette();
    if (force != null) return force;
    if (sheetRoulette) return true;
    try {
      if (root.TOKI_SPOOKY_ROULETTE) return true;
    } catch (e) {}
    var lp = readLastPaint();
    if (lp && lp.spookyRoulette != null) return !!lp.spookyRoulette;
    return false;
  }

  function enabled() {
    if (readSplashMode() === "off") return false;
    if (root.TOKI_STORE_CLOSED) return false;
    return halloweenOn() && rouletteOn();
  }

  function finishPreload() {
    if (preloadDone) return;
    preloadDone = true;
    var q = preloadWaiters;
    preloadWaiters = [];
    var i;
    for (i = 0; i < q.length; i++) {
      try {
        q[i]();
      } catch (e) {}
    }
  }

  function preloadArt(done) {
    var H = root.TOKI_HALLOWEEN;
    if (typeof done === "function") {
      if (preloadDone) {
        done();
        return;
      }
      preloadWaiters.push(done);
    }
    if (preloaded) return;
    if (!H || typeof H.splashCount !== "function") {
      finishPreload();
      return;
    }
    preloaded = true;
    var n = H.splashCount();
    var left = n;
    var i;
    if (left <= 0) {
      finishPreload();
      return;
    }
    window.setTimeout(function () {
      if (!preloadDone) finishPreload();
    }, 2000);
    for (i = 0; i < n; i++) {
      (function (src) {
        var settled = false;
        function one() {
          if (preloadDone || settled) return;
          settled = true;
          left -= 1;
          if (left <= 0) finishPreload();
        }
        loadSvgText(src).then(one).catch(one);
      })(H.splashUrl(i));
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

  function setStripeFadePause(on) {
    try {
      if (document.body) {
        document.body.classList.toggle("splash-fading", !!on);
      }
    } catch (e) {}
  }

  function cancelFade() {
    splashFadeGen += 1;
    setStripeFadePause(false);
    if (!overlay) return;
    if (overlay.getAnimations) {
      overlay.getAnimations().forEach(function (a) {
        try {
          a.cancel();
        } catch (e) {}
      });
    }
    overlay.style.transition = "none";
  }

  function currentOpacity() {
    if (!overlay) return 0;
    var o = parseFloat(window.getComputedStyle(overlay).opacity);
    return isFinite(o) ? o : 0;
  }

  function fadeOpacity(to, ms, done) {
    if (!overlay) {
      if (done) done();
      return;
    }
    cancelFade();
    var gen = splashFadeGen;
    function alive() {
      return gen === splashFadeGen && overlay;
    }
    var from = currentOpacity();
    var dur = ms > 0 ? ms : 0;
    overlay.style.transition = "none";
    overlay.style.opacity = String(from);
    void overlay.offsetWidth;
    if (dur <= 0 || from === to) {
      overlay.style.opacity = String(to);
      if (done) done();
      return;
    }
    // Pause drinks stripe scroll only for the fade window. Silk drops a
    // full-stage opacity interpolation while the 320% stripe track is
    // transforming; announcements could keep scrolling because those boxes
    // are small. Resume as soon as this fade commits.
    setStripeFadePause(true);
    requestAnimationFrame(function () {
      if (!alive()) return;
      requestAnimationFrame(function () {
        if (!alive()) return;
        overlay.style.transition = "none";
        overlay.style.opacity = String(from);
        void overlay.offsetWidth;
        overlay.style.transition = "opacity " + dur + "ms linear";
        overlay.style.opacity = String(to);
        window.setTimeout(function () {
          if (!alive()) return;
          overlay.style.transition = "none";
          overlay.style.opacity = String(to);
          setStripeFadePause(false);
          if (done) done();
        }, dur + 40);
      });
    });
  }

  function hideOverlay() {
    clearPlayTimers();
    playing = false;
    if (!overlay) return;
    cancelFade();
    overlay.style.opacity = "0";
    overlay.classList.remove("is-in");
    overlay.classList.remove("is-out");
    overlay.classList.remove("is-hold");
    overlay.classList.remove("is-visible");
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.backgroundImage = "";
    lastSrc = "";
    revokeBlob();
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
    var tint = boardTint(slot);
    var key = src + "|" + tint.bg + "|" + tint.caption;
    var text = svgTextCache[svgCacheKey(src)];
    if (text && key !== lastSrc) {
      var painted = tintSvg(text, tint.bg, tint.caption);
      revokeBlob();
      lastBlob = blobUrlFor(painted);
      overlay.style.backgroundImage = "url(" + JSON.stringify(lastBlob) + ")";
      lastSrc = key;
    } else if (!text) {
      overlay.style.backgroundImage = "url(" + JSON.stringify(src) + ")";
      lastSrc = src;
      loadSvgText(src)
        .then(function () {
          if (!overlay) return;
          if (overlay.getAttribute("data-splash") !== label) return;
          lastSrc = "";
          applyArt(idx);
        })
        .catch(function () {});
    }
    overlay.setAttribute("aria-label", "Holiday splash " + label);
    overlay.setAttribute("data-splash", label);
    overlay.setAttribute("data-splash-bg", tint.bg);
    overlay.setAttribute("data-splash-caption", tint.caption);
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
    if (mode !== "now" && mode !== "hold" && lastMinuteKey === key) {
      return;
    }
    preloadArt(function () {
      runPlay(key, mode || "tick");
    });
  }

  function runPlay(key, mode) {
    if (!enabled()) {
      hideOverlay();
      return;
    }
    if (mode !== "now" && mode !== "hold" && lastMinuteKey === key) {
      return;
    }
    ensureOverlay();
    if (!overlay) return;
    slot = boardSlot();
    var elapsed = mode === "now" ? 0 : msIntoMinute(nowDate());
    var fadeStart = (slot - 1) * STAGGER_MS;
    var staggerEnd = BOARD_COUNT * STAGGER_MS;
    var fadeOutAt = staggerEnd + HOLD_MS;
    if (mode !== "now" && mode !== "hold") {
      if (elapsed >= fadeOutAt + FADE_OUT_MS) {
        lastMinuteKey = key;
        hideOverlay();
        return;
      }
    }
    var idx = pickIndex(key);
    var label = applyArt(idx);
    lastMinuteKey = key;
    playing = true;
    clearPlayTimers();
    cancelFade();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.remove("is-in");
    overlay.classList.remove("is-out");
    overlay.classList.remove("is-hold");
    overlay.classList.add("is-visible");
    overlay.style.opacity = "0";
    void overlay.offsetWidth;
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
      overlay.style.opacity = "1";
      return;
    }
    function startFadeIn() {
      if (!playing || !overlay || lastMinuteKey !== key) return;
      fadeInTimer = 0;
      overlay.classList.remove("is-hold");
      overlay.classList.remove("is-out");
      overlay.classList.add("is-in");
      fadeOpacity(1, FADE_IN_MS);
    }
    function startFadeOut() {
      if (!playing || !overlay || lastMinuteKey !== key) return;
      fadeOutTimer = 0;
      overlay.classList.remove("is-hold");
      overlay.classList.remove("is-in");
      overlay.classList.add("is-out");
      fadeOpacity(0, FADE_OUT_MS, function () {
        if (lastMinuteKey !== key) return;
        hideOverlay();
      });
    }
    if (elapsed >= fadeOutAt) {
      overlay.style.opacity = "1";
      overlay.classList.add("is-in");
      startFadeOut();
      return;
    }
    if (elapsed >= fadeStart + FADE_IN_MS) {
      overlay.classList.add("is-hold");
      overlay.classList.add("is-in");
      overlay.style.opacity = "1";
    } else if (elapsed >= fadeStart) {
      var already = (elapsed - fadeStart) / FADE_IN_MS;
      overlay.style.opacity = String(Math.max(0, Math.min(1, already)));
      overlay.classList.add("is-in");
      fadeOpacity(1, fadeStart + FADE_IN_MS - elapsed);
    } else {
      overlay.style.opacity = "0";
      var wait = fadeStart - elapsed;
      if (wait <= 16) {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(startFadeIn);
        });
      } else {
        fadeInTimer = window.setTimeout(startFadeIn, wait);
      }
    }
    fadeOutTimer = window.setTimeout(startFadeOut, fadeOutAt - elapsed);
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
      if (key !== lastMinuteKey) play(key, "tick");
    } else if (playing && elapsed > splashWindowMs()) {
      hideOverlay();
    }
  }

  function onClockTick() {
    tickSplash();
  }

  function fallbackClock() {
    if (armTimer) window.clearTimeout(armTimer);
    armTimer = 0;
    tickSplash();
    if (frozenNow) return;
    armTimer = window.setTimeout(function () {
      armTimer = 0;
      fallbackClock();
    }, msUntilNextSecond(nowDate()));
  }

  function arm() {
    if (!enabled()) return;
    if (readSplashMode() === "hold") return;
    tickSplash();
    if (frozenNow) return;
    window.removeEventListener("toki:clock-tick", onClockTick);
    window.addEventListener("toki:clock-tick", onClockTick);
    var wx = root.TOKI_WEATHER_WIDGET;
    if (wx && typeof wx.startClock === "function") {
      wx.startClock();
      if (armTimer) window.clearTimeout(armTimer);
      armTimer = 0;
      return;
    }
    fallbackClock();
  }

  function syncEnabled() {
    if (!enabled()) {
      hideOverlay();
      window.removeEventListener("toki:clock-tick", onClockTick);
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
    arm();
  }

  function onThemeChange(ev) {
    var d = ev && ev.detail;
    var H = root.TOKI_HALLOWEEN;
    if (d && d.themeName && H) sheetHalloween = H.isHalloween(d.themeName);
    if (d && d.halloween != null) sheetHalloween = !!d.halloween;
    if (d && d.spookyRoulette != null) sheetRoulette = !!d.spookyRoulette;
    syncEnabled();
    if (playing && overlay && !overlay.hidden && lastMinuteKey) {
      lastSrc = "";
      applyArt(pickIndex(lastMinuteKey));
    }
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
    window.removeEventListener("toki:clock-tick", onClockTick);
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
    artReady: function () {
      return preloadDone;
    },
    snapshot: function () {
      var el = overlay || $("holiday-splash");
      var cs = el ? window.getComputedStyle(el) : null;
      var op = cs ? parseFloat(cs.opacity) : 0;
      return {
        slot: slot,
        enabled: enabled(),
        playing: playing,
        label: el ? el.getAttribute("data-splash") || "" : "",
        opacity: isFinite(op) ? op : 0,
        hidden: !el || !!el.hidden,
        src: lastSrc,
      };
    },
  };

  if ($("stage")) {
    start();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(window);

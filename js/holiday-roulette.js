/**
 * TokiMenu — Holiday Roulette (Christmas Theme).
 *
 * When Style Theme is Christmas and Holiday Roulette is On, all four
 * boards overlay a unified “Happy Holidays!” marquee at the top of every
 * Eastern minute. Three Fraunces Black Italic rows (Highlight / Secondary /
 * Special) scroll as one 4-board wall: top LTR, middle RTL, bottom LTR.
 * Toki Santa (boards 1+3) and Toki Rudolph (2+4) sit on the mascot plate.
 *
 * Sync (the Halloween stagger cannot happen here):
 *   Opacity and translateX are f(nowDate()) on every rAF — never a
 *   setTimeout that then runs a CSS animation on its own clock.
 *   nowDate() is Cloud Run nowMs + local offset (weather-widget). A late
 *   board joins at the current Eastern elapsed, so the wall seam stays
 *   aligned. Fade-in is simultaneous (no per-slot stagger). Font/art
 *   preload before the first paint; if the font is still loading, the
 *   overlay stays hidden and snaps on when ready.
 *
 * Overlay is a solid Main-color plate (Christmas green) plus CSS text and
 * a CSS-background mascot — never an <img>, so the food-image decoder
 * never sees it. While the plate is up, menu.js halts galaxy pan,
 * presentation, stripes, and soft-refresh (same hang as Closed Status)
 * and CSS hides the rest of the Stage so Fire Sticks are not compositing
 * the menu under an opaque layer. The weather clock stays armed —
 * roulette scroll is f(nowMs). Closed Status still wins.
 *
 * Vertical: the PDF’s 9pt optical frames sit at -101 / 266 / 633. The
 * shipped 72pt Black Italic draws its ink higher, so those frames clip
 * the caps. CSS shifts that same 367px pitch down 88px and centers the
 * tight ink in the 1080 Stage.
 *
 * Fire Stick: each track is a few phrase copies (not a 50k-px run) and
 * translateX wraps inside one phrase. Eastern ms-into-minute caches the
 * timezone offset so the rAF does not build Intl every frame. Opacity is
 * written only while it is changing.
 *
 * Sheet: Style and Theme Settings → Holiday Roulette (column O). Menu
 * Manager shows that row only when Theme is Christmas.
 *
 * QA: ?theme=Christmas&roulette=1&splash=1 (play now)
 *     ?splash=hold (show and stay; keeps scrolling unless splashAt/wxNow)
 *     ?roulette=0 force off
 */
(function (root) {
  "use strict";

  var TZ = "America/New_York";
  var FADE_IN_MS = 250;
  var HOLD_MS = 7000;
  var FADE_OUT_MS = 500;
  var BOARD_W = 1920;
  var SPEED_PX_S = 192;
  var PHRASE = "Happy Holidays! ";
  var FONT_CSS = '900 italic 306px "Fraunces"';

  var LAST_PAINT_KEY = "tokiLastPaint";
  var started = false;
  var overlay = null;
  var tracks = [];
  var mascotEl = null;
  var slot = 1;
  var sheetRoulette = false;
  var sheetChristmas = false;
  var frozenNow = null;
  var playing = false;
  var armTimer = 0;
  var rafId = 0;
  var lastMinuteKey = null;
  var phraseW = 0;
  var fontReady = false;
  var artReady = false;
  var preloaded = false;
  var haltOn = false;
  var easternFmt = null;
  var tzCacheAt = 0;
  var tzCacheOff = 0;
  var paintedOp = "";
  var paintedVis = "";
  var splashNowDone = false;

  function $(id) {
    return document.getElementById(id);
  }

  function boardSlot() {
    var C = root.TOKI_CHRISTMAS;
    var cfg = root.TOKI_CONFIG;
    if (C && typeof C.layoutFromConfig === "function") {
      var n = C.layoutFromConfig(cfg);
      if (n >= 1 && n <= 4) return n;
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

  function easternFormatter() {
    if (!easternFmt) {
      easternFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    }
    return easternFmt;
  }

  function easternParts(d) {
    var map = {};
    easternFormatter().formatToParts(d).forEach(function (p) {
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

  // America/New_York offset is whole hours and changes only at DST.
  // Cache it so the scroll rAF does not call formatToParts every frame.
  function easternOffsetMs(d) {
    var t = d.getTime();
    if (tzCacheAt && Math.abs(t - tzCacheAt) < 30000) return tzCacheOff;
    var p = easternParts(d);
    var asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    var truncated = t - (t % 1000);
    tzCacheOff = asUTC - truncated;
    tzCacheAt = t;
    return tzCacheOff;
  }

  function msIntoMinute(d) {
    var ms = d.getTime() + easternOffsetMs(d);
    var m = ms % 60000;
    if (m < 0) m += 60000;
    return m;
  }

  function splashWindowMs() {
    return FADE_IN_MS + HOLD_MS + FADE_OUT_MS;
  }

  function readLastPaint() {
    try {
      var raw = localStorage.getItem(LAST_PAINT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function christmasOn() {
    var C = root.TOKI_CHRISTMAS;
    if (C && typeof C.urlThemeOverride === "function" && C.isChristmas(C.urlThemeOverride())) {
      return true;
    }
    if (document.body && document.body.classList.contains("theme-christmas")) {
      return true;
    }
    if (sheetChristmas) return true;
    var lp = readLastPaint();
    if (C && lp && C.isChristmas(lp.themeName)) return true;
    return false;
  }

  function rouletteOn() {
    var force = readForceRoulette();
    if (force != null) return force;
    if (sheetRoulette) return true;
    try {
      if (root.TOKI_HOLIDAY_ROULETTE) return true;
    } catch (e) {}
    var lp = readLastPaint();
    if (lp && lp.holidayRoulette != null) return !!lp.holidayRoulette;
    return false;
  }

  function enabled() {
    if (readSplashMode() === "off") return false;
    if (root.TOKI_STORE_CLOSED) return false;
    return christmasOn() && rouletteOn();
  }

  function ensureOverlay() {
    var stage = $("stage");
    if (!stage) return null;
    overlay = $("holiday-roulette");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "holiday-roulette";
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("role", "img");
      overlay.setAttribute("aria-label", "Holiday roulette");
      var rows = document.createElement("div");
      rows.className = "holiday-roulette-rows";
      var dirs = ["ltr", "rtl", "ltr"];
      var kinds = ["top", "mid", "bot"];
      var i;
      tracks = [];
      for (i = 0; i < 3; i++) {
        var row = document.createElement("div");
        row.className = "holiday-roulette-row is-" + kinds[i];
        row.setAttribute("data-dir", dirs[i]);
        var track = document.createElement("div");
        track.className = "holiday-roulette-track";
        var run = document.createElement("span");
        run.className = "holiday-roulette-run";
        run.textContent = PHRASE.repeat(4);
        run.setAttribute("data-n", "4");
        track.appendChild(run);
        row.appendChild(track);
        rows.appendChild(row);
        tracks.push({ el: track, dir: dirs[i] });
      }
      mascotEl = document.createElement("div");
      mascotEl.className = "holiday-roulette-mascot";
      mascotEl.setAttribute("aria-hidden", "true");
      overlay.appendChild(rows);
      overlay.appendChild(mascotEl);
      stage.appendChild(overlay);
    } else if (!tracks.length) {
      var found = overlay.querySelectorAll(".holiday-roulette-track");
      tracks = [];
      var d;
      for (d = 0; d < found.length; d++) {
        tracks.push({
          el: found[d],
          dir: found[d].parentNode.getAttribute("data-dir") || (d === 1 ? "rtl" : "ltr"),
        });
      }
      mascotEl = overlay.querySelector(".holiday-roulette-mascot");
    }
    overlay.setAttribute("data-board", String(slot));
    return overlay;
  }

  function applyMascot() {
    var C = root.TOKI_CHRISTMAS;
    if (!mascotEl || !C) return;
    var src = C.mascotUrl(slot);
    var label = C.mascotLabel(slot);
    mascotEl.style.backgroundImage = "url(" + JSON.stringify(src) + ")";
    overlay.setAttribute("aria-label", "Holiday roulette " + label);
    overlay.setAttribute("data-mascot", label);
  }

  function trackRun(track) {
    var run = track.querySelector(".holiday-roulette-run");
    if (run) return run;
    var probe = track.querySelector(".holiday-roulette-probe");
    run = document.createElement("span");
    run.className = "holiday-roulette-run";
    run.textContent = PHRASE.repeat(4);
    run.setAttribute("data-n", "4");
    track.textContent = "";
    track.appendChild(run);
    if (probe) track.appendChild(probe);
    return run;
  }

  // One board shows 1920px. translateX wraps inside a phrase, so the track
  // only needs one phrase plus one board, plus a spare copy.
  function copiesNeeded() {
    var w = phraseW;
    if (!w || w < 32) return 4;
    var n = Math.ceil((w + BOARD_W) / w) + 1;
    if (n < 3) n = 3;
    if (n > 8) n = 8;
    return n;
  }

  function fitCopies() {
    if (!tracks.length) return 0;
    var n = copiesNeeded();
    var text = PHRASE.repeat(n);
    var i;
    for (i = 0; i < tracks.length; i++) {
      var run = trackRun(tracks[i].el);
      if (run.getAttribute("data-n") === String(n)) continue;
      run.textContent = text;
      run.setAttribute("data-n", String(n));
    }
    return n;
  }

  function measurePhrase() {
    if (!overlay || !tracks.length) return 0;
    var track = tracks[0].el;
    var probe = track.querySelector(".holiday-roulette-probe");
    if (!probe) {
      probe = document.createElement("span");
      probe.className = "holiday-roulette-probe";
      probe.textContent = PHRASE;
      track.appendChild(probe);
    }
    var w = probe.getBoundingClientRect().width;
    var stage = $("stage");
    var stageW = stage ? stage.getBoundingClientRect().width : 0;
    if (stageW > 0 && BOARD_W > 0) {
      w = w * (BOARD_W / stageW);
    }
    if (!isFinite(w) || w < 32) return 0;
    return w;
  }

  function loadFont() {
    if (fontReady) return Promise.resolve();
    var fonts = document.fonts;
    if (!fonts || typeof fonts.load !== "function") {
      fontReady = true;
      return Promise.resolve();
    }
    return fonts
      .load(FONT_CSS)
      .then(function () {
        fontReady = true;
      })
      .catch(function () {
        fontReady = true;
      });
  }

  function preloadArt() {
    if (preloaded) return Promise.resolve();
    preloaded = true;
    var C = root.TOKI_CHRISTMAS;
    var urls = C ? [C.mascotUrl(1), C.mascotUrl(2)] : [];
    var left = urls.length;
    return new Promise(function (resolve) {
      function one() {
        left -= 1;
        if (left <= 0) {
          artReady = true;
          resolve();
        }
      }
      if (!urls.length) {
        artReady = true;
        resolve();
        return;
      }
      window.setTimeout(function () {
        if (!artReady) {
          artReady = true;
          resolve();
        }
      }, 2000);
      urls.forEach(function (src) {
        var img = new Image();
        img.onload = one;
        img.onerror = one;
        img.src = src;
      });
    });
  }

  function opacityAt(elapsed, mode) {
    if (mode === "hold") return 1;
    if (elapsed <= 0) return 0;
    if (elapsed < FADE_IN_MS) return elapsed / FADE_IN_MS;
    if (elapsed < FADE_IN_MS + HOLD_MS) return 1;
    var out = elapsed - FADE_IN_MS - HOLD_MS;
    if (out >= FADE_OUT_MS) return 0;
    return 1 - out / FADE_OUT_MS;
  }

  function wrapMod(n, period) {
    if (!period) return 0;
    var x = n % period;
    if (x < 0) x += period;
    return x;
  }

  function paintFrame(elapsed, mode) {
    if (!overlay || !tracks.length) return;
    if (!phraseW) phraseW = measurePhrase();
    var period = phraseW || 1;
    var raw = (elapsed / 1000) * SPEED_PX_S;
    var scrolled = wrapMod(raw, period);
    var slotOff = (slot - 1) * BOARD_W;
    var i;
    for (i = 0; i < tracks.length; i++) {
      var dir = tracks[i].dir === "rtl" ? -1 : 1;
      // Same wall phase as the unwrapped lead formula, folded into one phrase
      // so the layer stays a few copies wide. Keep subpixel (do not round per
      // board) or the seam between sticks drifts by a pixel.
      var x = wrapMod(dir * scrolled - slotOff, period) - period;
      var next = "translate3d(" + x.toFixed(3) + "px,0,0)";
      if (tracks[i].x !== next) {
        tracks[i].el.style.transform = next;
        tracks[i].x = next;
      }
    }
    var op = opacityAt(elapsed, mode);
    var opStr = op >= 0.999 ? "1" : op <= 0.001 ? "0" : op.toFixed(3);
    if (opStr !== paintedOp) {
      overlay.style.opacity = opStr;
      paintedOp = opStr;
    }
    var vis = op > 0.001 ? "visible" : "hidden";
    if (vis !== paintedVis) {
      overlay.style.visibility = vis;
      paintedVis = vis;
    }
  }

  function stopRaf() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function setMenuHalt(on) {
    on = !!on;
    if (haltOn === on) return;
    haltOn = on;
    try {
      if (document.body) {
        document.body.classList.toggle("holiday-roulette-on", on);
      }
    } catch (e) {}
    try {
      window.dispatchEvent(
        new CustomEvent("toki:holiday-roulette-change", {
          detail: { playing: on, board: slot },
        })
      );
    } catch (e) {}
  }

  function hideOverlay() {
    stopRaf();
    playing = false;
    setMenuHalt(false);
    paintedOp = "";
    paintedVis = "";
    if (!overlay) return;
    overlay.style.opacity = "0";
    overlay.style.visibility = "hidden";
    overlay.classList.remove("is-visible");
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
  }

  function rafLoop(mode) {
    stopRaf();
    function frame() {
      rafId = 0;
      if (!playing || !overlay) return;
      if (document.hidden) return;
      if (!enabled()) {
        hideOverlay();
        return;
      }
      var elapsed;
      if (mode === "now") {
        elapsed = Date.now() - playStartedAt;
        if (elapsed > splashWindowMs()) {
          splashNowDone = true;
          hideOverlay();
          return;
        }
      } else if (mode === "hold") {
        elapsed = msIntoMinute(nowDate());
        paintFrame(elapsed, "hold");
        if (!frozenNow) rafId = window.requestAnimationFrame(frame);
        return;
      } else {
        elapsed = msIntoMinute(nowDate());
        if (elapsed > splashWindowMs()) {
          hideOverlay();
          return;
        }
      }
      paintFrame(elapsed, mode);
      rafId = window.requestAnimationFrame(frame);
    }
    rafId = window.requestAnimationFrame(frame);
  }

  var playStartedAt = 0;

  function runPlay(key, mode) {
    if (!enabled()) {
      hideOverlay();
      return;
    }
    ensureOverlay();
    if (!overlay) return;
    slot = boardSlot();
    if (!fontReady) return;
    applyMascot();
    overlay.hidden = false;
    // Force a blank frame before the measured paint. The skip-cache must
    // match these writes or a second play() leaves the plate at opacity 0.
    overlay.style.opacity = "0";
    overlay.style.visibility = "hidden";
    paintedOp = "0";
    paintedVis = "hidden";
    void overlay.offsetWidth;
    if (!phraseW) phraseW = measurePhrase();
    fitCopies();
    if (!phraseW) {
      window.setTimeout(function () {
        if (playing && overlay && !phraseW) {
          phraseW = measurePhrase();
          if (phraseW) {
            fitCopies();
            paintFrame(mode === "now" ? 0 : msIntoMinute(nowDate()), mode);
          }
        }
      }, 50);
    }
    var elapsed = mode === "now" ? 0 : msIntoMinute(nowDate());
    if (mode !== "now" && mode !== "hold") {
      if (elapsed >= splashWindowMs()) {
        lastMinuteKey = key;
        hideOverlay();
        return;
      }
    }
    lastMinuteKey = key;
    playing = true;
    setMenuHalt(true);
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.add("is-visible");
    if (mode === "now") playStartedAt = Date.now();
    paintFrame(mode === "now" ? 0 : elapsed, mode);
    console.info(
      "[TokiMenu holiday-roulette] board",
      slot,
      "minute",
      key,
      mode || "tick",
      "phraseW",
      Math.round(phraseW)
    );
    rafLoop(mode);
  }

  function play(key, mode) {
    if (!enabled()) {
      hideOverlay();
      return;
    }
    if (mode !== "now" && mode !== "hold" && lastMinuteKey === key && playing) {
      return;
    }
    ensureOverlay();
    if (!overlay) return;
    slot = boardSlot();
    Promise.all([loadFont(), preloadArt()]).then(function () {
      if (!enabled()) {
        hideOverlay();
        return;
      }
      runPlay(key, mode || "tick");
    });
  }

  function tickRoulette() {
    if (!enabled()) {
      if (playing) hideOverlay();
      return;
    }
    var splashMode = readSplashMode();
    if (splashMode === "hold") {
      if (!playing) play(minuteKey(nowDate()), "hold");
      return;
    }
    // ?splash=1 owns its own 8s clock. The minute tick must not cut it
    // off when the Eastern second is already past the window, and must
    // not start a second copy after that play finishes.
    if (splashMode === "now") {
      if (!splashNowDone && !playing) play(minuteKey(nowDate()), "now");
      return;
    }
    var now = nowDate();
    var key = minuteKey(now);
    var elapsed = msIntoMinute(now);
    maybeSyncClock(elapsed);
    if (elapsed <= splashWindowMs()) {
      if (key !== lastMinuteKey || !playing) play(key, "tick");
    } else if (playing && elapsed > splashWindowMs()) {
      hideOverlay();
    }
  }

  var lastSyncKey = null;
  function maybeSyncClock(elapsed) {
    if (frozenNow) return;
    if (elapsed < 55000 || elapsed > 59500) return;
    var key = minuteKey(nowDate());
    if (lastSyncKey === key) return;
    lastSyncKey = key;
    var wx = root.TOKI_WEATHER_WIDGET;
    if (wx && typeof wx.syncNow === "function") {
      try {
        wx.syncNow();
      } catch (e) {}
    }
  }

  function onClockTick() {
    tickRoulette();
  }

  function msUntilNextSecond(d) {
    var wait = 1000 - d.getMilliseconds();
    if (wait < 1) wait = 1000;
    return wait;
  }

  function fallbackClock() {
    if (armTimer) window.clearTimeout(armTimer);
    armTimer = 0;
    tickRoulette();
    if (frozenNow) return;
    armTimer = window.setTimeout(function () {
      armTimer = 0;
      fallbackClock();
    }, msUntilNextSecond(nowDate()));
  }

  function arm() {
    if (!enabled()) return;
    tickRoulette();
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
    loadFont();
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
    var C = root.TOKI_CHRISTMAS;
    if (d && d.themeName && C) sheetChristmas = C.isChristmas(d.themeName);
    if (d && d.christmas != null) sheetChristmas = !!d.christmas;
    if (d && d.holidayRoulette != null) sheetRoulette = !!d.holidayRoulette;
    syncEnabled();
    if (playing && overlay && !overlay.hidden) applyMascot();
  }

  function start() {
    if (started) return;
    if (!$("stage")) return;
    started = true;
    slot = boardSlot();
    frozenNow = readFrozenNow();
    ensureOverlay();
    if (root.TOKI_HOLIDAY_ROULETTE) sheetRoulette = true;
    var mode = readSplashMode();
    if (mode === "hold" || mode === "now") {
      if (enabled()) play(minuteKey(nowDate()), mode === "hold" ? "hold" : "now");
    }
    syncEnabled();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopRaf();
        return;
      }
      if (playing && overlay && !overlay.hidden) {
        var mode = readSplashMode();
        rafLoop(mode === "hold" ? "hold" : mode === "now" ? "now" : "tick");
      }
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

  root.TOKI_HOLIDAY_ROULETTE_UI = {
    start: start,
    stop: stop,
    play: function () {
      play(minuteKey(nowDate()), "now");
    },
    boardSlot: function () {
      return slot;
    },
    enabled: enabled,
    playing: function () {
      return !!playing;
    },
    snapshot: function () {
      var el = overlay || $("holiday-roulette");
      var cs = el ? window.getComputedStyle(el) : null;
      var op = cs ? parseFloat(cs.opacity) : 0;
      return {
        slot: slot,
        enabled: enabled(),
        playing: playing,
        haltOn: haltOn,
        opacity: isFinite(op) ? op : 0,
        hidden: !el || !!el.hidden,
        phraseW: phraseW,
        copies: tracks.length ? Number(trackRun(tracks[0].el).getAttribute("data-n")) || 0 : 0,
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

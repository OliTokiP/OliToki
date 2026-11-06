/**
 * TokiMenu — circle snow on the open menu (Christmas).
 *
 * The same ?snow= flag as Closed Status. 0 is a small flurry and 100 is
 * a blizzard. Omitting it runs the plates at 10 (a low flurry). Closed
 * Status still uses 40 when the flag is omitted.
 *
 * Layer stack, back to front:
 *   Background > small flakes > menu (frame + text) > medium flakes
 *   > plates > large flakes
 *
 * One 7680-wide field, f(nowMs) from the weather clock, so a flake can
 * cross the TV seam. Three small canvases, no shadow, no blur. Encore
 * parks the Family Portrait under the frame, so the medium layer is
 * clipped to the frame and a second copy sits behind that portrait.
 * Closed Status and Holiday Roulette hide the stage; this rAF stops
 * while they own it. Presentation keeps running.
 */
(function (root) {
  "use strict";

  var BOARD_W = 1920;
  var WALL_W = 7680;
  var STAGE_H = 1080;
  // Open-menu density when ?snow= is omitted. Closed Status keeps 40.
  var PLATE_SNOW_DEFAULT = 10;
  var SNOW_SPECS = [
    {
      name: "back",
      perBoard: 100,
      r0: 4,
      r1: 9,
      s0: 200,
      s1: 320,
      d0: -26,
      d1: 26,
      a0: 0.5,
      a1: 0.8,
      sway: 14,
      bw: 800,
      bh: 450,
    },
    {
      name: "mid",
      perBoard: 22,
      r0: 12,
      r1: 22,
      s0: 240,
      s1: 390,
      d0: -40,
      d1: 40,
      a0: 0.7,
      a1: 0.92,
      sway: 20,
      bw: 800,
      bh: 450,
    },
    {
      name: "front",
      perBoard: 6,
      r0: 26,
      r1: 40,
      s0: 150,
      s1: 260,
      d0: -56,
      d1: 56,
      a0: 0.84,
      a1: 0.97,
      sway: 28,
      bw: 960,
      bh: 540,
    },
  ];

  var started = false;
  var snowLayers = [];
  var photoLayer = null;
  var snowRaf = 0;
  var snowWanted = false;
  var themeWhite = "#FFF8F0";
  var snowLevelCached = null;
  var slot = 1;
  var seatKey = "";
  var classObs = null;
  var themeSettled = false;

  function boardSlot() {
    var layout =
      (root.TOKI_CONFIG && String(root.TOKI_CONFIG.layout || "").toLowerCase()) ||
      "";
    if (layout === "handhelds") return 2;
    if (layout === "munchies") return 3;
    if (layout === "drinks") return 4;
    if (document.body) {
      if (document.body.classList.contains("board-handhelds")) return 2;
      if (document.body.classList.contains("board-munchies")) return 3;
      if (document.body.classList.contains("board-drinks")) return 4;
    }
    return 1;
  }

  function readSnowLevel() {
    try {
      var raw = new URLSearchParams(location.search).get("snow");
      if (raw == null || String(raw).trim() === "") return PLATE_SNOW_DEFAULT;
      var n = Number(String(raw).trim());
      if (!isFinite(n)) return PLATE_SNOW_DEFAULT;
      if (n < 0) n = 0;
      if (n > 100) n = 100;
      return n;
    } catch (e) {
      return PLATE_SNOW_DEFAULT;
    }
  }

  function snowLevel() {
    if (snowLevelCached == null) snowLevelCached = readSnowLevel();
    return snowLevelCached;
  }

  // Same curve as Closed Status. Scale 1 matches Holiday Roulette’s field.
  function snowMul() {
    var t = snowLevel() / 100;
    return {
      count: 0.18 + t * 2.2,
      radius: 0.85 + t * 0.45,
      speed: 0.7 + t * 0.6,
    };
  }

  function hash01(i, salt) {
    var x = Math.imul(i + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    x = x ^ (x >>> 16);
    return (x >>> 0) / 4294967295;
  }

  function wrapMod(n, m) {
    var r = n % m;
    if (r < 0) r += m;
    return r;
  }

  function isWallPreview() {
    try {
      if (new URLSearchParams(location.search).get("preview") === "all") return true;
      if (document.body && document.body.classList.contains("preview-wall")) return true;
    } catch (e) {}
    return false;
  }

  function isPureWhite(raw) {
    var s = String(raw || "").replace(/\s+/g, "").toLowerCase();
    return (
      s === "#fff" ||
      s === "#ffffff" ||
      s === "white" ||
      s === "rgb(255,255,255)" ||
      s === "rgba(255,255,255,1)" ||
      s === "rgba(255,255,255,1.0)"
    );
  }

  function refreshSnowColor() {
    var C = root.TOKI_CHRISTMAS;
    var fallback = (C && C.PALETTE && C.PALETTE.secondary) || "#FFF8F0";
    var raw = "";
    try {
      raw = getComputedStyle(document.documentElement).getPropertyValue(
        "--secondary-color"
      );
    } catch (e) {
      raw = "";
    }
    raw = String(raw || "").trim();
    if (!raw || isPureWhite(raw)) raw = fallback;
    themeWhite = raw;
  }

  function christmasOn() {
    var C = root.TOKI_CHRISTMAS;
    if (!C || typeof C.isChristmas !== "function") return false;
    if (typeof C.urlThemeOverride === "function") {
      var override = C.urlThemeOverride();
      if (override) return C.isChristmas(override);
    }
    if (document.body) {
      if (document.body.classList.contains("theme-christmas")) return true;
      if (document.body.classList.contains("theme-halloween")) return false;
    }
    // Last paint only covers the gap before Style arrives. After that, a
    // non-Christmas theme must not keep the flurry on.
    if (themeSettled) return false;
    try {
      var raw = localStorage.getItem("tokiLastPaint");
      var lp = raw ? JSON.parse(raw) : null;
      if (lp && C.isChristmas(lp.themeName)) return true;
    } catch (e) {}
    return false;
  }

  function stageCovered() {
    if (document.hidden) return true;
    var body = document.body;
    if (!body) return true;
    if (body.classList.contains("store-closed")) return true;
    if (body.classList.contains("holiday-roulette-cover")) return true;
    return false;
  }

  function encoreUnderFrame() {
    var stage = document.getElementById("family-portrait-stage");
    if (!stage || stage.hidden) return false;
    if (document.documentElement.classList.contains("encore-veil-detached")) return true;
    if (stage.classList.contains("encore-veil-detached")) return true;
    return false;
  }

  function nowMs() {
    var wx = root.TOKI_WEATHER_WIDGET;
    if (wx && typeof wx.nowDate === "function") {
      try {
        var d = wx.nowDate();
        if (d && isFinite(d.getTime())) return d.getTime();
      } catch (e) {}
    }
    return Date.now();
  }

  function makeCanvas(className) {
    var canvas = document.createElement("canvas");
    canvas.className = className;
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
  }

  function buildFlakes(spec, index, count, mul) {
    var list = [];
    var n;
    for (n = 0; n < count; n++) {
      var sizeT = hash01(n, index * 17 + 2);
      if (spec.name !== "front") sizeT = sizeT * sizeT;
      list.push({
        x0: ((n + hash01(n, index * 17 + 1)) / count) * WALL_W,
        r: (spec.r0 + (spec.r1 - spec.r0) * sizeT) * mul.radius,
        speed: (spec.s0 + (spec.s1 - spec.s0) * hash01(n, index * 17 + 4)) * mul.speed,
        drift: (spec.d0 + (spec.d1 - spec.d0) * hash01(n, index * 17 + 5)) * mul.speed,
        alpha: spec.a0 + (spec.a1 - spec.a0) * hash01(n, index * 17 + 6),
        sway: spec.sway * (0.55 + 0.9 * hash01(n, index * 17 + 8)),
        swayHz: 0.35 + 0.7 * hash01(n, index * 17 + 9),
        phase: hash01(n, index * 17 + 7) * Math.PI * 2,
      });
    }
    return list;
  }

  function ensureSnow() {
    if (snowLayers.length) return;
    var stage = document.getElementById("stage");
    if (!stage) return;
    var wall = isWallPreview();
    var mul = snowMul();
    var countScale = (wall ? 0.55 : 1) * mul.count;
    var resScale = wall ? 0.7 : 1;
    var i;
    for (i = 0; i < SNOW_SPECS.length; i++) {
      var spec = SNOW_SPECS[i];
      var canvas = makeCanvas("plate-snow is-" + spec.name);
      var bw = Math.max(160, Math.round(spec.bw * resScale));
      var bh = Math.max(90, Math.round(spec.bh * resScale));
      canvas.width = bw;
      canvas.height = bh;
      var count = Math.round(spec.perBoard * 4 * countScale);
      var floor = spec.name === "front" ? 4 : spec.name === "mid" ? 8 : 20;
      if (wall) floor = spec.name === "front" ? 2 : 4;
      if (count < floor) count = floor;
      snowLayers.push({
        spec: spec,
        canvas: canvas,
        ctx: canvas.getContext("2d"),
        flakes: buildFlakes(spec, i, count, mul),
      });
    }
    var photo = makeCanvas("plate-snow is-mid-photo");
    var mid = snowLayers[1];
    photo.width = mid.canvas.width;
    photo.height = mid.canvas.height;
    photoLayer = {
      canvas: photo,
      ctx: photo.getContext("2d"),
      flakes: mid.flakes,
    };
    seatLayers();
  }

  function seatLayers() {
    var stage = document.getElementById("stage");
    if (!stage || snowLayers.length < 3) return;
    var back = snowLayers[0].canvas;
    var mid = snowLayers[1].canvas;
    var front = snowLayers[2].canvas;
    var photo = photoLayer && photoLayer.canvas;
    var frame = document.getElementById("frame");
    var galaxy = document.getElementById("galaxy");
    var bg = document.getElementById("bg-pattern");
    var hero = document.getElementById("hero-wrap");
    var portrait = document.getElementById("family-portrait-stage");
    if (bg && bg.parentNode === stage) stage.insertBefore(back, bg.nextSibling);
    else if (galaxy && galaxy.parentNode === stage) stage.insertBefore(back, galaxy.nextSibling);
    else if (frame && frame.parentNode === stage) stage.insertBefore(back, frame);
    if (hero && hero.parentNode === stage) stage.insertBefore(mid, hero);
    else stage.appendChild(mid);
    if (portrait && portrait.parentNode === stage) {
      if (photo) stage.insertBefore(photo, portrait);
      if (portrait.nextSibling) stage.insertBefore(front, portrait.nextSibling);
      else stage.appendChild(front);
    } else if (hero && hero.parentNode === stage) {
      if (hero.nextSibling) stage.insertBefore(front, hero.nextSibling);
      else stage.appendChild(front);
    } else {
      stage.appendChild(front);
    }
  }

  function paintLayer(layer, origin, t) {
    var ctx = layer.ctx;
    var canvas = layer.canvas;
    if (!ctx || !canvas) return 0;
    var sx = canvas.width / BOARD_W;
    var sy = canvas.height / STAGE_H;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = themeWhite;
    var flakes = layer.flakes;
    var drawn = 0;
    var n;
    for (n = 0; n < flakes.length; n++) {
      var f = flakes[n];
      var world = f.x0 + f.drift * t + Math.sin(t * f.swayHz + f.phase) * f.sway;
      world = wrapMod(world, WALL_W);
      var x = world - origin;
      if (x < -f.r) x += WALL_W;
      else if (x > BOARD_W + f.r) x -= WALL_W;
      if (x < -f.r || x > BOARD_W + f.r) continue;
      var loop = STAGE_H + f.r * 2 + 48;
      var y = -f.r - 12 + wrapMod(f.speed * t, loop);
      ctx.globalAlpha = f.alpha;
      ctx.beginPath();
      ctx.arc(x * sx, y * sy, Math.max(0.6, f.r * sx), 0, Math.PI * 2);
      ctx.fill();
      drawn++;
    }
    ctx.globalAlpha = 1;
    return drawn;
  }

  function drawSnow(ms) {
    if (!snowLayers.length) return;
    var origin = (slot - 1) * BOARD_W;
    var t = ms / 1000;
    var i;
    for (i = 0; i < snowLayers.length; i++) paintLayer(snowLayers[i], origin, t);
    if (
      photoLayer &&
      photoLayer.canvas &&
      photoLayer.canvas.classList.contains("is-on")
    ) {
      paintLayer(photoLayer, origin, t);
    }
  }

  function applyEncoreClip() {
    var mid = snowLayers[1] && snowLayers[1].canvas;
    var photo = photoLayer && photoLayer.canvas;
    var under = encoreUnderFrame();
    if (mid) mid.classList.toggle("is-menu-only", under);
    if (photo) photo.classList.toggle("is-on", !!(under && snowWanted));
  }

  function showCanvases(on) {
    var i;
    for (i = 0; i < snowLayers.length; i++) {
      snowLayers[i].canvas.classList.toggle("is-on", !!on);
      if (!on && snowLayers[i].ctx) {
        snowLayers[i].ctx.clearRect(
          0,
          0,
          snowLayers[i].canvas.width,
          snowLayers[i].canvas.height
        );
      }
    }
    applyEncoreClip();
    if (!on && photoLayer && photoLayer.ctx) {
      photoLayer.canvas.classList.remove("is-on");
      photoLayer.ctx.clearRect(
        0,
        0,
        photoLayer.canvas.width,
        photoLayer.canvas.height
      );
    }
  }

  function snowFrame() {
    if (!snowWanted) return;
    if (stageCovered() || !christmasOn()) {
      stopSnow();
      return;
    }
    snowRaf = window.requestAnimationFrame(snowFrame);
    slot = boardSlot();
    var key = encoreUnderFrame() ? "encore" : "plates";
    if (key !== seatKey) {
      seatKey = key;
      seatLayers();
      applyEncoreClip();
    }
    drawSnow(nowMs());
  }

  function startSnow() {
    if (snowWanted && snowRaf) return;
    if (!document.getElementById("stage")) return;
    if (stageCovered() || !christmasOn()) return;
    ensureSnow();
    if (!snowLayers.length) return;
    slot = boardSlot();
    refreshSnowColor();
    seatKey = "";
    seatLayers();
    snowWanted = true;
    showCanvases(true);
    if (snowRaf) return;
    console.info("[TokiMenu plates] holiday snow", snowLevel());
    snowRaf = window.requestAnimationFrame(snowFrame);
  }

  function stopSnow() {
    snowWanted = false;
    if (snowRaf) window.cancelAnimationFrame(snowRaf);
    snowRaf = 0;
    showCanvases(false);
  }

  function syncRunning() {
    if (christmasOn() && !stageCovered()) startSnow();
    else if (snowWanted || snowRaf) stopSnow();
  }

  function watchClasses() {
    if (classObs || typeof MutationObserver !== "function") return;
    classObs = new MutationObserver(function () {
      syncRunning();
    });
    classObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    if (document.body) {
      classObs.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    var portrait = document.getElementById("family-portrait-stage");
    if (portrait) {
      classObs.observe(portrait, {
        attributes: true,
        attributeFilter: ["class", "hidden"],
      });
    }
  }

  function stackInfo() {
    var nodes = document.querySelectorAll(".plate-snow");
    var out = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var cs = getComputedStyle(el);
      out.push({
        className: el.className,
        z: cs.zIndex,
        display: cs.display,
        clipped: cs.clipPath && cs.clipPath !== "none",
      });
    }
    return out;
  }

  function counts() {
    var out = [];
    var i;
    for (i = 0; i < snowLayers.length; i++) {
      out.push({
        name: snowLayers[i].spec.name,
        n: snowLayers[i].flakes.length,
      });
    }
    return out;
  }

  function start() {
    if (started) return;
    if (!document.getElementById("stage")) return;
    started = true;
    slot = boardSlot();
    watchClasses();
    syncRunning();
    window.addEventListener("toki:theme-change", function () {
      themeSettled = true;
      refreshSnowColor();
      syncRunning();
    });
    window.addEventListener("toki:closed-change", syncRunning);
    window.addEventListener("toki:holiday-roulette-change", syncRunning);
    document.addEventListener("visibilitychange", syncRunning);
  }

  function boot() {
    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  root.TOKI_PLATE_SNOW = {
    start: start,
    stop: stopSnow,
    sync: syncRunning,
    level: snowLevel,
    running: function () {
      return !!snowWanted;
    },
    counts: counts,
    stack: stackInfo,
    encoreUnderFrame: encoreUnderFrame,
  };
})(window);

/**
 * Board presentation motion — one file for the live menu AND Menu Manager.
 *
 * Ken Burns / Slideshow hero punch-in and punch-out are copied from the
 * live engine in js/menu.js (motionRunEntrance / motionRunExit). Do not
 * write a second plate runner. Call these functions from both hosts.
 *
 * CSS treatments: css/motion.css (#hero-plate / .hero-anim).
 */
(function (global) {
  "use strict";

  var EASE = {
    fade: "cubic-bezier(0.4, 0, 0.2, 1)",
    out: "cubic-bezier(0.22, 1, 0.36, 1)",
    in: "cubic-bezier(0.4, 0, 1, 1)",
  };

  var KEN_BURNS = {
    name: "Ken Burns",
    windUp: 0,
    punchIn: 3.4,
    hold: 1,
    punchOut: 0.45,
    windDown: 0,
    zoomMin: 0.93,
    zoomMax: 1,
  };

  var SLIDESHOW = {
    name: "Slideshow",
    windUp: 0,
    punchIn: 3.4,
    hold: 1,
    punchOut: 0.45,
    windDown: 0,
    zoomMin: 1,
    zoomMax: 1,
  };

  var ENCORE = {
    name: "Encore",
    windUp: 0,
    punchIn: 3.4,
    hold: 1,
    punchOut: 0.45,
    windDown: 0,
    zoomMin: 1,
    zoomMax: 1,
    zoomTo: 1.24,
    veilInMult: 0.5,
    holdMult: 0.5,
    /** Punch-In pinch ÷ camera punch-in. 1 = lock to zoom (Pass 1). */
    pinchInMult: 0.5,
    holePinchLive: 40,
    holeRefLive: 160,
    holeFrac: 0.42,
    holeMin: 70,
    crowdN0: 5,
    crowdN1: 15,
    crowdBoost: 1.25,
    shadow: { x: 18, y: 22, blur: 2, opacity: 0.5 },
  };

  var OPACITY_DUR = 0.45;

  function styleByMode(mode) {
    var m = String(mode || "slideshow").toLowerCase();
    if (m === "encore") return ENCORE;
    if (m === "kenburns" || m.indexOf("ken") !== -1) return KEN_BURNS;
    return SLIDESHOW;
  }

  function usesZoom(style) {
    return String((style && style.name) || "").toLowerCase() === "ken burns";
  }

  function isEncore(style) {
    return String((style && style.name) || "").toLowerCase() === "encore";
  }

  function motionCell(row, idx) {
    if (!row || idx == null || idx < 0 || idx >= row.length) return "";
    var v = row[idx];
    return v == null ? "" : String(v).trim();
  }

  function parseMotionSeconds(raw, fallback) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return fallback;
    }
    var n = Number(raw);
    if (!isFinite(n) || n < 0) return fallback;
    return n;
  }

  /**
   * Beta Features → Motion table. Same columns the live board reads.
   * Wind-up / Wind-down empty or 0 = no override (use Punch-In / Punch-Out).
   */
  function parseMotionStylesTable(rows) {
    var styles = {};
    if (!rows || !rows.length) return styles;
    var motionIdx = -1;
    var i;
    for (i = 0; i < rows.length; i++) {
      if (motionCell(rows[i], 0).toLowerCase() === "motion") {
        motionIdx = i;
        break;
      }
    }
    if (motionIdx < 0) return styles;
    var headerIdx = -1;
    for (i = motionIdx + 1; i < Math.min(motionIdx + 8, rows.length); i++) {
      if (motionCell(rows[i], 0).toLowerCase().indexOf("motion style") !== -1) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return styles;
    for (i = headerIdx + 1; i < rows.length; i++) {
      var name = motionCell(rows[i], 0);
      if (!name) continue;
      var lower = name.toLowerCase();
      if (
        lower === "boards" ||
        lower === "style and theme" ||
        lower === "swipe up" ||
        lower === "veil shadow settings" ||
        lower.indexOf("name of motion") === 0
      ) {
        if (lower.indexOf("name of motion") === 0) continue;
        break;
      }
      if (
        !motionCell(rows[i], 2) &&
        !motionCell(rows[i], 3) &&
        lower !== "ken burns" &&
        lower !== "encore"
      ) {
        if (lower === "herotext" || lower.indexOf("include footer") === 0) {
          break;
        }
      }
      styles[name] = {
        name: name,
        explanation: motionCell(rows[i], 1),
        windUp: parseMotionSeconds(motionCell(rows[i], 2), 0),
        punchIn: parseMotionSeconds(motionCell(rows[i], 3), 3.4),
        hold: parseMotionSeconds(motionCell(rows[i], 4), 1),
        punchOut: parseMotionSeconds(motionCell(rows[i], 5), 0.45),
        windDown: parseMotionSeconds(motionCell(rows[i], 6), 0),
        notes: motionCell(rows[i], 7),
      };
    }
    return styles;
  }

  function lookupSheetStyle(map, name) {
    if (!map || !name) return null;
    if (map[name]) return map[name];
    var want = String(name).toLowerCase();
    var keys = Object.keys(map);
    var i;
    for (i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === want) return map[keys[i]];
    }
    return null;
  }

  /** Presentation Speed tile 3 = medium = 1× Beta Motion digits. */
  var PRESENTATION_TEMPO_MED = 3;

  /**
   * Duration multiplier for a Presentation Speed tile.
   * 0 → parked. 3 → 1×. Each step is a half-stop (×√2):
   * 1 crawl 2×, 2 slow √2×, 3 medium 1×, 4 fast 1/√2×, 5 very fast ½×.
   */
  function presentationTempo(speed) {
    var n = Number(speed);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.pow(2, (PRESENTATION_TEMPO_MED - n) / 2);
  }

  function scaleDuration(sec, tempo) {
    var s = Number(sec);
    var t = Number(tempo);
    if (!(s > 0) || !(t > 0)) return 0;
    return s * t;
  }

  function scaleStyleTimes(style, speed) {
    var tempo = presentationTempo(speed);
    if (!style || !(tempo > 0) || tempo === 1) return style;
    var out = {};
    var k;
    for (k in style) {
      if (Object.prototype.hasOwnProperty.call(style, k)) out[k] = style[k];
    }
    out.punchIn = scaleDuration(style.punchIn, tempo);
    out.hold = scaleDuration(style.hold, tempo);
    out.punchOut = scaleDuration(style.punchOut, tempo);
    out.windUp = scaleDuration(style.windUp, tempo);
    out.windDown = scaleDuration(style.windDown, tempo);
    return out;
  }

  /**
   * One slide clock for every Presentation Style (Slideshow / Ken Burns / Encore).
   * Digits come from the Slideshow row (Ken Burns fallback). Treatments stay
   * on the style — only Punch/Hold/Out (and wind) are shared.
   */
  function presentationClock(sheetMap) {
    var row =
      lookupSheetStyle(sheetMap, "Slideshow") ||
      lookupSheetStyle(sheetMap, "Ken Burns");
    return {
      windUp: row && row.windUp != null ? row.windUp : 0,
      punchIn: row && row.punchIn != null ? row.punchIn : 3.4,
      hold: row && row.hold != null ? row.hold : 1,
      punchOut: row && row.punchOut != null ? row.punchOut : 0.45,
      windDown: row && row.windDown != null ? row.windDown : 0,
    };
  }

  function withPresentationClock(style, sheetMap) {
    var clock = presentationClock(sheetMap);
    var out = {};
    var k;
    if (style) {
      for (k in style) {
        if (Object.prototype.hasOwnProperty.call(style, k)) out[k] = style[k];
      }
    }
    out.windUp = clock.windUp;
    out.punchIn = clock.punchIn;
    out.hold = clock.hold;
    out.punchOut = clock.punchOut;
    out.windDown = clock.windDown;
    return out;
  }

  /** Base runner style (zoom/chrome) + shared presentation clock. */
  function styleForMode(mode, sheetMap) {
    var base = styleByMode(mode);
    var sheet = lookupSheetStyle(sheetMap, base.name);
    var out = {};
    var k;
    for (k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    }
    if (sheet) {
      out.windUp = sheet.windUp;
      out.punchIn = sheet.punchIn;
      out.hold = sheet.hold;
      out.punchOut = sheet.punchOut;
      out.windDown = sheet.windDown;
    }
    return withPresentationClock(out, sheetMap);
  }

  function encoreVeilIn(punchIn) {
    var p = Number(punchIn);
    var base = p > 0 ? p : OPACITY_DUR;
    return Math.max(0.05, base * ENCORE.veilInMult);
  }

  function encoreHold(sheetHold) {
    var h = Number(sheetHold);
    var base = h > 0 ? h : 0;
    return Math.max(0, base * ENCORE.holdMult);
  }

  function scaledHolePinch(previewHoleR) {
    var r = Number(previewHoleR) || ENCORE.holeRefLive;
    return ENCORE.holePinchLive * (r / ENCORE.holeRefLive);
  }

  function scaledShadow(previewW, liveW) {
    var s = (Number(previewW) || 400) / (Number(liveW) || 1920);
    var sh = ENCORE.shadow;
    return {
      x: sh.x * s,
      y: sh.y * s,
      blur: sh.blur * s,
      opacity: sh.opacity,
    };
  }

  /** Set CSS transition durations from sheet digits for this phase. */
  function applyCssDurations(entranceSec, exitSec) {
    var root = document.documentElement;
    if (!root || !root.style) return;
    var opIn = Math.min(0.45, entranceSec > 0 ? entranceSec : 0.45);
    var opOut = Math.min(0.45, exitSec > 0 ? exitSec : 0.45);
    root.style.setProperty("--motion-punch-in", String(entranceSec) + "s");
    root.style.setProperty("--motion-punch-out", String(exitSec) + "s");
    root.style.setProperty("--motion-opacity-in", String(opIn) + "s");
    root.style.setProperty("--motion-opacity-out", String(opOut) + "s");
  }

  /**
   * Live motionRunEntrance hero path — park then punch-in.
   * plate must be #hero-plate with a .hero-anim child.
   */
  function heroPunchIn(plate, style, entranceSec, hooks) {
    if (!plate) return;
    hooks = hooks || {};
    var useZoom = usesZoom(style);
    var zMin = useZoom
      ? style.zoomMin != null
        ? style.zoomMin
        : 0.93
      : 1;
    var zMax = useZoom
      ? style.zoomMax != null
        ? style.zoomMax
        : 1
      : 1;
    applyCssDurations(entranceSec, style.punchOut != null ? style.punchOut : 0.45);

    var anim = plate.querySelector ? plate.querySelector(".hero-anim") : null;
    // Park: Ken Burns at zoomMin; Slideshow stays at 1×
    plate.style.transition = "none";
    if (anim) anim.style.transition = "none";
    plate.style.setProperty("--hero-zoom", String(zMin));
    plate.style.opacity = "0";
    plate.classList.add("visible");
    plate.hidden = false;
    void plate.offsetWidth;

    var opSec = Math.min(0.45, entranceSec > 0 ? entranceSec : 0.45);
    plate.style.transition =
      "opacity " + opSec + "s var(--ease-fade, ease)";
    if (useZoom && anim) {
      anim.style.transition =
        "transform " + entranceSec + "s var(--ease-out, ease-out)";
      plate.classList.add("is-kb-in");
      plate.style.setProperty("--hero-zoom", String(zMax));
      if (hooks.onFeature) hooks.onFeature("kenBurns", true, "engine punch-in");
    } else {
      plate.classList.remove("is-kb-in");
      plate.style.setProperty("--hero-zoom", "1");
      if (anim) anim.style.transition = "none";
      if (hooks.onFeature) hooks.onFeature("kenBurns", false, "slideshow opacity-only");
    }
    plate.style.opacity = "1";
  }

  /**
   * Live motionRunExit hero path — punch-out fade (+ zoom back on Ken Burns).
   */
  function heroPunchOut(plate, style, exitSec, hooks) {
    if (!plate) return;
    hooks = hooks || {};
    var useZoom = usesZoom(style);
    var zMin = useZoom
      ? style.zoomMin != null
        ? style.zoomMin
        : 0.93
      : 1;
    applyCssDurations(style.punchIn != null ? style.punchIn : 3.4, exitSec);

    var anim = plate.querySelector ? plate.querySelector(".hero-anim") : null;
    var opSec = Math.min(0.45, exitSec > 0 ? exitSec : 0.45);
    plate.classList.remove("is-kb-in");
    plate.style.transition =
      "opacity " + opSec + "s var(--ease-fade, ease)";
    if (useZoom && anim) {
      anim.style.transition =
        "transform " + exitSec + "s var(--ease-fade, ease)";
      plate.style.setProperty("--hero-zoom", String(zMin));
    } else {
      if (anim) anim.style.transition = "none";
      plate.style.setProperty("--hero-zoom", "1");
    }
    plate.style.opacity = "0";
    if (hooks.onFeature) hooks.onFeature("kenBurns", false, "engine punch-out");
  }

  /** Instant park (speed 0 / static). Same snap as live setHeroZoom(..., "snap"). */
  function heroSnap(plate, opacity, zoom) {
    if (!plate) return;
    var anim = plate.querySelector ? plate.querySelector(".hero-anim") : null;
    var z = Number(zoom);
    if (!isFinite(z)) z = 1;
    plate.style.transition = "none";
    if (anim) anim.style.transition = "none";
    plate.style.setProperty("--hero-zoom", String(z));
    plate.style.opacity = String(opacity);
    plate.classList.add("visible");
    plate.hidden = false;
    plate.classList.remove("is-kb-in");
    if (anim) void anim.offsetWidth;
    void plate.offsetWidth;
    plate.style.transition = "";
    if (anim) anim.style.transition = "";
  }

  /**
   * One hero Animation Block: Punch-in → Hold → Punch-out → onDone.
   * hooks.afterMs(ms, fn) must honour the host generation token.
   */
  function runHeroBlock(plate, style, hooks) {
    hooks = hooks || {};
    style = style || KEN_BURNS;
    var afterMs = hooks.afterMs || function (ms, fn) {
      setTimeout(fn, ms);
    };
    var speed = hooks.speed;
    if (speed != null) {
      if (!(presentationTempo(speed) > 0)) {
        if (hooks.onParked) hooks.onParked();
        return;
      }
      style = scaleStyleTimes(style, speed) || style;
    }
    var entranceSec =
      hooks.first && style.windUp > 0
        ? style.windUp
        : style.punchIn != null
          ? style.punchIn
          : 3.4;
    var holdSec = style.hold != null ? style.hold : 1;
    var exitSec =
      hooks.last && style.windDown > 0
        ? style.windDown
        : style.punchOut != null
          ? style.punchOut
          : 0.45;
    if (hooks.onEntrance) hooks.onEntrance();
    heroPunchIn(plate, style, entranceSec, hooks);
    afterMs(entranceSec * 1000, function () {
      var anim = plate && plate.querySelector && plate.querySelector(".hero-anim");
      if (anim) anim.style.transition = "";
      if (plate) plate.style.transition = "";
      if (hooks.onHold) hooks.onHold();
      afterMs(holdSec * 1000, function () {
        if (hooks.onExit) hooks.onExit();
        heroPunchOut(plate, style, exitSec, hooks);
        afterMs(exitSec * 1000, function () {
          if (anim) anim.style.transition = "";
          if (plate) {
            plate.style.transition = "";
            plate.classList.remove("visible");
          }
          if (hooks.onDone) hooks.onDone();
        });
      });
    });
  }

  var ENCORE_HOLE_PINCH_OUT = false;
  var PORTRAIT_STAGE_W = 848.1;
  var PORTRAIT_STAGE_H = 1080;
  var _encoreZoomRaf = 0;
  var _encoreZoomGen = 0;

  /**
   * Default Encore: Spotlight Veil is a sibling of the camera rig, not a child.
   * ?encore=old parks the veil on the rig (nested scale). ?encore=new is kept
   * as an alias for the default.
   */
  function readEncoreParam(raw) {
    try {
      return String(new URLSearchParams(raw || "").get("encore") || "")
        .trim()
        .toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function readEncoreVeilDetachedFlag() {
    var v = readEncoreParam(
      typeof location !== "undefined" ? location.search : ""
    );
    if (!v) {
      try {
        var hash = typeof location !== "undefined" ? location.hash : "";
        var qi = hash.indexOf("?");
        if (qi >= 0) v = readEncoreParam(hash.slice(qi + 1));
      } catch (e) {}
    }
    if (v === "old" || v === "legacy" || v === "0") return false;
    return true;
  }

  var _encoreVeilDetached = readEncoreVeilDetachedFlag();

  function encoreVeilDetached() {
    return !!_encoreVeilDetached;
  }

  function applyEncoreVeilDetachedClass() {
    try {
      var on = encoreVeilDetached();
      if (document.documentElement) {
        document.documentElement.classList.toggle("encore-veil-detached", on);
      }
      if (document.body) {
        document.body.classList.toggle("encore-veil-detached", on);
      }
    } catch (e) {}
  }

  if (_encoreVeilDetached) {
    console.info(
      "[TokiMenu] Encore Spotlight Veil detached from camera rig (default). ?encore=old for nested-scale veil."
    );
  } else {
    console.info(
      "[TokiMenu] encore=old — Spotlight Veil on camera rig (nested scale)"
    );
  }
  if (typeof document !== "undefined") {
    applyEncoreVeilDetachedClass();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applyEncoreVeilDetachedClass);
    }
  }

  /** Park the veil on the stage (default) or on the rig (?encore=old). */
  function attachEncoreVeil(stage, rig) {
    if (!stage) return null;
    var veil = stage.querySelector(".family-portrait-veil");
    if (!veil) {
      veil = document.createElement("div");
      veil.className = "family-portrait-veil";
      veil.setAttribute("aria-hidden", "true");
    }
    var detached = encoreVeilDetached();
    var home =
      detached
        ? stage
        : rig || stage.querySelector(".family-portrait-rig") || stage;
    if (veil.parentNode !== home) home.appendChild(veil);
    stage.classList.toggle("encore-veil-detached", detached);
    return veil;
  }

  function encorePinchNode(stage) {
    if (!stage) return null;
    return (
      stage.querySelector(".family-portrait-veil") ||
      stage.querySelector(".family-portrait-rig") ||
      stage
    );
  }

  function setEncoreZoomOrigin(stage, latticeX, latticeY) {
    if (!stage) return;
    stage.style.setProperty("--encore-hole-x", latticeX + "px");
    stage.style.setProperty("--encore-hole-y", latticeY + "px");
  }

  function setPlaneCenterOrigin(stage) {
    if (!stage) return;
    stage.style.setProperty("--encore-hole-x", PORTRAIT_STAGE_W * 0.5 + "px");
    stage.style.setProperty("--encore-hole-y", PORTRAIT_STAGE_H * 0.5 + "px");
  }

  function pinchTargets(stage) {
    var out = [];
    if (!stage) return out;
    out.push(stage);
    var rig = stage.querySelector(".family-portrait-rig");
    var veil = stage.querySelector(".family-portrait-veil");
    if (rig) out.push(rig);
    if (veil) out.push(veil);
    return out;
  }

  function readEncoreHoleR(stage) {
    if (!stage) return 160;
    var n = parseFloat(stage.style.getPropertyValue("--encore-hole-r"));
    if (!(n > 0)) {
      try {
        n = parseFloat(getComputedStyle(stage).getPropertyValue("--encore-hole-r"));
      } catch (e) {
        n = 0;
      }
    }
    return n > 0 ? n : 160;
  }

  function readEncoreHoleXY(stage) {
    if (!stage) return { x: PORTRAIT_STAGE_W * 0.5, y: PORTRAIT_STAGE_H * 0.5 };
    var x = parseFloat(stage.style.getPropertyValue("--encore-hole-x"));
    var y = parseFloat(stage.style.getPropertyValue("--encore-hole-y"));
    return {
      x: isFinite(x) ? x : PORTRAIT_STAGE_W * 0.5,
      y: isFinite(y) ? y : PORTRAIT_STAGE_H * 0.5,
    };
  }

  /**
   * Detached veil does not inherit camera scale. Paint the hole at the same
   * screen radius the old nested transform produced: (holeR − pinch) × zoom.
   * Expand the veil box so a near-edge circle + Hard Shadow drop-shadow
   * still have opaque surface (old scale pushed the box out from the hole).
   * CSS stroke/border cannot do this: it is a rectangle around the box,
   * and the hole is a radial-gradient in the background.
   */
  function syncEncoreDetachedHole(stage) {
    if (!stage || !encoreVeilDetached()) return;
    var zoom = readEncoreZoomNow(stage);
    var pinch = readEncorePinchNow(stage);
    var holeR = readEncoreHoleR(stage);
    var hardR = Math.max(40, (holeR - pinch) * zoom);
    var softR = holeR * 1.85 * zoom;
    var xy = readEncoreHoleXY(stage);
    var over = Math.max(
      0,
      hardR - xy.x,
      hardR - (PORTRAIT_STAGE_W - xy.x),
      hardR - xy.y,
      hardR - (PORTRAIT_STAGE_H - xy.y)
    );
    var sh = ENCORE.shadow;
    var pad = 0;
    var hardShadow = stage.classList.contains("encore-spot-hard-shadow");
    try {
      hardShadow =
        hardShadow ||
        document.documentElement.classList.contains("encore-hard-shadow");
    } catch (e) {}
    if (hardShadow) {
      pad = Math.max(sh.x, sh.y) + sh.blur;
    }
    var extend = Math.max(20, Math.ceil(over + pad));
    stage.style.setProperty("--encore-hole-paint-r", hardR + "px");
    stage.style.setProperty("--encore-hole-soft-r", softR + "px");
    stage.style.setProperty("--veil-extend", extend + "px");
  }

  function setEncoreHolePinch(stage, px) {
    var v = Math.max(0, px) + "px";
    var nodes = pinchTargets(stage);
    var i;
    for (i = 0; i < nodes.length; i++) {
      nodes[i].style.setProperty("--encore-hole-pinch", v);
    }
    syncEncoreDetachedHole(stage);
  }

  function snapEncoreHolePinch(stage, px) {
    var nodes = pinchTargets(stage);
    var prev = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      prev[i] = nodes[i].style.transition;
      nodes[i].style.transition = "none";
    }
    setEncoreHolePinch(stage, px);
    for (i = 0; i < nodes.length; i++) void nodes[i].offsetWidth;
    for (i = 0; i < nodes.length; i++) nodes[i].style.transition = prev[i];
    parkEncorePinchCss(stage);
  }

  /** Pinch is JS-owned (same easeUnit as camera). Do not CSS-ease the hole. */
  function parkEncorePinchCss(stage) {
    var veil = stage && stage.querySelector(".family-portrait-veil");
    if (!veil) return;
    veil.style.transition =
      "opacity var(--motion-veil, 1.7s) var(--ease-fade, ease)";
  }

  function encoreHolePinchPx(spotlightType) {
    if (String(spotlightType || "") === "soft") return 0;
    return 40;
  }

  /** 1 at Handhelds density (n≤5), 1.25 at Munchies (n≥15), lerp between. */
  function encoreCrowdBoost(n) {
    var count = Number(n) || 0;
    var n0 = ENCORE.crowdN0;
    var n1 = ENCORE.crowdN1;
    var b = ENCORE.crowdBoost;
    if (count <= n0) return 1;
    if (count >= n1) return b;
    return 1 + (b - 1) * ((count - n0) / (n1 - n0));
  }

  function encoreHoleRadius(plateW, n) {
    var w = Number(plateW) || 0;
    var r = w * ENCORE.holeFrac * encoreCrowdBoost(n);
    return Math.max(ENCORE.holeMin, r);
  }

  function encoreStickerScale(photoScale, n) {
    var s = Number(photoScale) || 1;
    return Math.max(0.16, Math.min(0.55, s * 0.9 * encoreCrowdBoost(n)));
  }

  function encoreCameraRigs(stage) {
    var out = [];
    if (!stage) return out;
    var photo = stage.querySelector(".family-portrait-rig");
    var stick = stage.querySelector(".family-portrait-sticker-rig");
    if (photo) out.push(photo);
    if (stick) out.push(stick);
    return out;
  }

  function setEncoreCameraTransition(stage, value) {
    var rigs = encoreCameraRigs(stage);
    var i;
    for (i = 0; i < rigs.length; i++) rigs[i].style.transition = value;
  }

  function encoreFpsCap(spotlightType, limitOn) {
    if (limitOn === false) return 0;
    return String(spotlightType || "") === "hard_shadow" ? 30 : 0;
  }

  function readEncoreZoomTo(stage) {
    var zoomTo = ENCORE.zoomTo;
    try {
      var el = stage || document.documentElement;
      var raw = getComputedStyle(el).getPropertyValue("--encore-zoom-to").trim();
      var n = parseFloat(raw);
      if (isFinite(n) && n > 1) zoomTo = n;
    } catch (e) {}
    return zoomTo;
  }

  function encoreRigTransition(sec, easeVar, easeFallback, _includePinch, fpsCap) {
    if (fpsCap) return "none";
    return "transform " + sec + "s var(" + easeVar + ", " + easeFallback + ")";
  }

  function cancelEncoreZoomStepper() {
    _encoreZoomGen += 1;
    if (_encoreZoomRaf) {
      cancelAnimationFrame(_encoreZoomRaf);
      _encoreZoomRaf = 0;
    }
  }

  function snapPortraitZoom(stage, scale) {
    cancelEncoreZoomStepper();
    if (!stage) return;
    var rigs = encoreCameraRigs(stage);
    var i;
    for (i = 0; i < rigs.length; i++) rigs[i].style.transition = "none";
    stage.style.setProperty("--encore-zoom", String(scale));
    if (rigs[0]) void rigs[0].offsetWidth;
    for (i = 0; i < rigs.length; i++) rigs[i].style.transition = "";
    syncEncoreDetachedHole(stage);
  }

  function readEncoreZoomNow(stage) {
    if (!stage) return 1;
    var n = parseFloat(stage.style.getPropertyValue("--encore-zoom"));
    return isFinite(n) && n > 0 ? n : 1;
  }

  function readEncorePinchNow(stage) {
    var node = encorePinchNode(stage);
    if (!node) return 0;
    var n = parseFloat(node.style.getPropertyValue("--encore-hole-pinch"));
    return isFinite(n) ? n : 0;
  }

  function easeUnit(easeVar, t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    var out = easeVar === "--ease-out";
    var p1x = out ? 0.22 : 0.4;
    var p1y = out ? 1 : 0;
    var p2x = out ? 0.36 : 0.2;
    var p2y = out ? 1 : 1;
    var x = t;
    var i;
    for (i = 0; i < 5; i++) {
      var cx = 3 * p1x;
      var bx = 3 * (p2x - p1x) - cx;
      var ax = 1 - cx - bx;
      var yo = ((ax * x + bx) * x + cx) * x - t;
      var d = (3 * ax * x + 2 * bx) * x + cx;
      if (Math.abs(d) < 1e-5) break;
      x -= yo / d;
    }
    var cy = 3 * p1y;
    var by = 3 * (p2y - p1y) - cy;
    var ay = 1 - cy - by;
    return ((ay * x + by) * x + cy) * x;
  }

  /**
   * Camera + Hard hole pinch share this stepper (same easeUnit).
   * fpsCap > 0 = Hard_Shadow 30fps. Pinch still runs when fpsCap is 0 so Hard
   * keeps the aperture (CSS @property cannot ease radial-gradient circle size).
   * pinchSec defaults to punch-in × ENCORE.pinchInMult (hole settles
   * halfway through the zoom). Pass pinchSec === durationSec to lock them.
   * ?encore=new also uses this stepper so --encore-zoom eases (hole paint
   * tracks it) instead of snapping the custom property while transform CSS-eases.
   */
  function tryEncoreFpsZoom(stage, toScale, durationSec, easeVar, pinchTo, fpsCap, pinchSec) {
    var cap = Number(fpsCap) || 0;
    var wantPinch = pinchTo != null && isFinite(Number(pinchTo));
    var bakeHole = encoreVeilDetached();
    if (!stage || !(durationSec > 0)) return false;
    if (!cap && !wantPinch && !bakeHole) return false;
    cancelEncoreZoomStepper();
    setEncoreCameraTransition(stage, "none");
    parkEncorePinchCss(stage);
    var from = readEncoreZoomNow(stage);
    var pinchFrom = readEncorePinchNow(stage);
    var gen = ++_encoreZoomGen;
    var t0 = performance.now();
    var dur = durationSec * 1000;
    var pSec = Number(pinchSec);
    if (!(pSec > 0)) pSec = durationSec * ENCORE.pinchInMult;
    var pinchDur = wantPinch ? pSec * 1000 : dur;
    var pinchDone = !wantPinch;
    var minDt = cap > 0 ? 1000 / cap : 0;
    var lastPaint = -1e9;
    function paint(now) {
      var elapsed = now - t0;
      var u = elapsed / dur;
      if (u >= 1) u = 1;
      var e = easeUnit(easeVar, u);
      stage.style.setProperty("--encore-zoom", String(from + (toScale - from) * e));
      if (wantPinch && !pinchDone) {
        var uP = pinchDur > 0 ? elapsed / pinchDur : 1;
        if (uP >= 1) {
          uP = 1;
          pinchDone = true;
        }
        var eP = easeUnit(easeVar, uP);
        setEncoreHolePinch(stage, pinchFrom + (Number(pinchTo) - pinchFrom) * eP);
      }
      if (bakeHole) syncEncoreDetachedHole(stage);
      return u >= 1;
    }
    function frame(now) {
      if (gen !== _encoreZoomGen) return;
      if (minDt && now - lastPaint < minDt - 1) {
        _encoreZoomRaf = requestAnimationFrame(frame);
        return;
      }
      lastPaint = now;
      if (paint(now)) {
        _encoreZoomGen += 1;
        _encoreZoomRaf = 0;
        return;
      }
      _encoreZoomRaf = requestAnimationFrame(frame);
    }
    paint(t0);
    lastPaint = t0;
    _encoreZoomRaf = requestAnimationFrame(frame);
    return true;
  }

  function setEncoreVeilDimmed(stage, on) {
    if (!stage) return;
    if (on) {
      stage.classList.remove("veil-filter-parked");
      stage.classList.add("is-dimmed");
      return;
    }
    var wasOn = stage.classList.contains("is-dimmed");
    stage.classList.remove("is-dimmed");
    if (!wasOn) return;
    var veil = stage.querySelector(".family-portrait-veil");
    var settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      if (stage.classList.contains("is-dimmed")) return;
      stage.classList.add("veil-filter-parked");
      if (veil) veil.removeEventListener("transitionend", onEnd);
    }
    function onEnd(e) {
      if (e.target !== veil) return;
      if (e.propertyName && e.propertyName !== "opacity") return;
      finish();
    }
    if (veil) veil.addEventListener("transitionend", onEnd);
    setTimeout(finish, 1110);
  }

  /**
   * Live encoreRunEntrance camera — first = Wind-up (grid fade + veil + zoom);
   * mid-run = veil + camera only.
   */
  function encorePunchIn(stage, opts) {
    if (!stage) return;
    opts = opts || {};
    var first = !!opts.first;
    var entranceSec = opts.entranceSec != null ? opts.entranceSec : 3.4;
    var zoomTo = opts.zoomTo != null ? opts.zoomTo : ENCORE.zoomTo;
    var origin = opts.origin || null;
    var pinchPx = Number(opts.pinchPx) || 0;
    var fpsCap = Number(opts.fpsCap) || 0;
    var punchOut = opts.punchOut != null ? opts.punchOut : 0.45;
    var opSec = Math.min(0.45, entranceSec > 0 ? entranceSec : 0.45);
    var doPinch = pinchPx > 0;
    var camEase = encoreRigTransition(
      entranceSec,
      "--ease-out",
      "ease-out",
      doPinch,
      fpsCap
    );

    stage.style.setProperty("--motion-veil", String(encoreVeilIn(entranceSec)) + "s");
    applyCssDurations(entranceSec, punchOut);
    stage.hidden = false;
    stage.setAttribute("aria-hidden", "false");

    if (first) {
      setPlaneCenterOrigin(stage);
      setEncoreCameraTransition(stage, "none");
      stage.style.transition = "none";
      snapPortraitZoom(stage, 1);
      snapEncoreHolePinch(stage, 0);
      stage.classList.remove("is-dimmed", "is-zoom-out");
      stage.style.opacity = "0";
      stage.classList.add("visible");
      void stage.offsetWidth;

      setEncoreCameraTransition(stage, camEase);
      stage.style.transition = "opacity " + opSec + "s var(--ease-fade, ease)";
      stage.classList.remove("is-zoom-out");
      if (origin) setEncoreZoomOrigin(stage, origin.x, origin.y);
      parkEncorePinchCss(stage);
      if (
        !tryEncoreFpsZoom(
          stage,
          zoomTo,
          entranceSec,
          "--ease-out",
          doPinch ? pinchPx : null,
          fpsCap
        )
      ) {
        stage.style.setProperty("--encore-zoom", String(zoomTo));
        if (doPinch) setEncoreHolePinch(stage, pinchPx);
        else syncEncoreDetachedHole(stage);
      }
      setEncoreVeilDimmed(stage, true);
      stage.style.opacity = "1";
      setEncoreActiveSticker(stage, opts.itemIndex);
      return;
    }

    stage.style.opacity = "1";
    stage.classList.add("visible");
    stage.classList.remove("is-dimmed", "is-zoom-out");
    setEncoreCameraTransition(stage, "none");
    snapEncoreHolePinch(stage, 0);
    if (origin) setEncoreZoomOrigin(stage, origin.x, origin.y);
    void stage.offsetWidth;
    setEncoreCameraTransition(stage, camEase);
    parkEncorePinchCss(stage);
    if (
      !tryEncoreFpsZoom(
        stage,
        zoomTo,
        entranceSec,
        "--ease-out",
        doPinch ? pinchPx : null,
        fpsCap
      )
    ) {
      stage.style.setProperty("--encore-zoom", String(zoomTo));
      if (doPinch) setEncoreHolePinch(stage, pinchPx);
      else syncEncoreDetachedHole(stage);
    }
    setEncoreVeilDimmed(stage, true);
    setEncoreActiveSticker(stage, opts.itemIndex);
  }

  /**
   * Live encoreRunExit camera. last = Wind-down (grid opacity out).
   */
  function encorePunchOut(stage, opts) {
    if (!stage) return;
    opts = opts || {};
    var exitSec = opts.exitSec != null ? opts.exitSec : 0.45;
    var last = !!opts.last;
    var pinchOut = opts.pinchOut != null ? !!opts.pinchOut : ENCORE_HOLE_PINCH_OUT;
    var fpsCap = Number(opts.fpsCap) || 0;
    var punchIn = opts.punchIn != null ? opts.punchIn : 3.4;
    var rig = stage.querySelector(".family-portrait-rig");
    var opSec = Math.min(0.45, exitSec > 0 ? exitSec : 0.45);

    stage.style.setProperty("--motion-veil", String(exitSec) + "s");
    applyCssDurations(punchIn, exitSec);
    parkEncorePinchCss(stage);

    setEncoreVeilDimmed(stage, false);
    stage.classList.add("is-zoom-out");
    setEncoreCameraTransition(
      stage,
      encoreRigTransition(exitSec, "--ease-fade", "ease", pinchOut, fpsCap)
    );
    if (
      !tryEncoreFpsZoom(stage, 1, exitSec, "--ease-fade", pinchOut ? 0 : null, fpsCap)
    ) {
      stage.style.setProperty("--encore-zoom", "1");
      if (pinchOut) setEncoreHolePinch(stage, 0);
      else syncEncoreDetachedHole(stage);
    }

    if (last) {
      stage.style.transition = "opacity " + opSec + "s var(--ease-fade, ease)";
      stage.style.opacity = "0";
    } else {
      stage.style.opacity = "1";
    }
  }

  function encoreSnap(stage, opts) {
    if (!stage) return;
    opts = opts || {};
    var zoom = opts.zoom != null ? opts.zoom : 1;
    var pinch = opts.pinch != null ? opts.pinch : 0;
    var dimmed = !!opts.dimmed;
    var opacity = opts.opacity != null ? opts.opacity : 1;
    cancelEncoreZoomStepper();
    var rig = stage.querySelector(".family-portrait-rig");
    setEncoreCameraTransition(stage, "none");
    stage.style.transition = "none";
    stage.hidden = false;
    stage.setAttribute("aria-hidden", "false");
    stage.classList.add("visible");
    if (opts.itemIndex != null) setEncoreActiveSticker(stage, opts.itemIndex);
    stage.style.setProperty("--encore-zoom", String(zoom));
    snapEncoreHolePinch(stage, pinch);
    syncEncoreDetachedHole(stage);
    setEncoreVeilDimmed(stage, dimmed);
    stage.style.opacity = String(opacity);
    void (rig && rig.offsetWidth);
    void stage.offsetWidth;
    setEncoreCameraTransition(stage, "");
    stage.style.transition = "";
  }

  function encoreFinishExit(stage, last) {
    if (!stage) return;
    setEncoreCameraTransition(stage, "");
    stage.style.transition = "";
    stage.classList.remove("is-zoom-out");
    if (last) {
      stage.classList.remove("visible");
      stage.hidden = true;
    }
  }

  function encoreSlotOrigin(stage, itemIndex) {
    if (!stage || itemIndex == null || itemIndex < 0) return null;
    var slot = stage.querySelector(
      '.family-portrait-plates .family-portrait-slot[data-item-index="' +
        itemIndex +
        '"]'
    );
    if (!slot) return null;
    return {
      x: parseFloat(slot.style.left) || 0,
      y: parseFloat(slot.style.top) || 0,
    };
  }

  function ensureEncoreDom(stage) {
    if (!stage) return null;
    var rig = stage.querySelector(".family-portrait-rig");
    if (!rig) {
      rig = document.createElement("div");
      rig.className = "family-portrait-rig";
      stage.appendChild(rig);
    }
    var plates = rig.querySelector(".family-portrait-plates");
    if (!plates) {
      plates = document.createElement("div");
      plates.className = "family-portrait-plates";
      rig.appendChild(plates);
    }
    attachEncoreVeil(stage, rig);
    ensureEncoreStickerRig(stage);
    return stage;
  }

  function appendEncoreSticker(slotEl, photoScale, sticker, n) {
    if (!slotEl || !sticker) return;
    var el = document.createElement("div");
    el.className = "family-portrait-sticker";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<img class="new-sticker-shadow" alt="" draggable="false" src="' +
      (sticker.shadow || "") +
      '">' +
      '<div class="new-sticker-body">' +
      '<img class="new-sticker-body-img" alt="" draggable="false" src="' +
      (sticker.body || "") +
      '">' +
      '<span class="new-sticker-tint"></span></div>' +
      '<span class="new-sticker-label">New!</span>';
    var ox = 280 * photoScale;
    var oy = 160 * photoScale;
    el.style.left = "calc(50% + " + ox + "px)";
    el.style.top = "calc(50% + " + oy + "px)";
    var stickScale = encoreStickerScale(photoScale, n);
    el.style.transform = "translate(-50%, -50%) scale(" + stickScale + ")";
    slotEl.appendChild(el);
    if (typeof sticker.onCreated === "function") sticker.onCreated(el, photoScale);
  }

  function setEncoreActiveSticker(stage, itemIndex) {
    if (!stage) return;
    var slots = stage.querySelectorAll(
      ".family-portrait-sticker-rig .family-portrait-slot"
    );
    var i;
    var idx;
    var any = false;
    var want = itemIndex == null || itemIndex === "" ? NaN : Number(itemIndex);
    for (i = 0; i < slots.length; i++) {
      idx = parseInt(slots[i].getAttribute("data-item-index"), 10);
      var on = isFinite(want) && idx === want;
      slots[i].classList.toggle("is-active", on);
      if (on) any = true;
    }
    if (any || !slots.length) return;
    var hx = parseFloat(stage.style.getPropertyValue("--encore-hole-x")) || 0;
    var hy = parseFloat(stage.style.getPropertyValue("--encore-hole-y")) || 0;
    var best = 0;
    var bestD = 1e15;
    var d;
    var x;
    var y;
    for (i = 0; i < slots.length; i++) {
      x = parseFloat(slots[i].style.left) || 0;
      y = parseFloat(slots[i].style.top) || 0;
      d = (x - hx) * (x - hx) + (y - hy) * (y - hy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    slots[best].classList.add("is-active");
  }

  function ensureEncoreStickerRig(stage) {
    if (!stage) return null;
    var rig = stage.querySelector(".family-portrait-sticker-rig");
    if (!rig) {
      rig = document.createElement("div");
      rig.className = "family-portrait-sticker-rig";
      rig.setAttribute("aria-hidden", "true");
      stage.appendChild(rig);
    }
    return rig;
  }

  /**
   * One lattice fill for live board and Menu Manager.
   * host = #family-portrait-stage or a .family-portrait-plates node.
   * items: [{ src, isNew, itemIndex }]
   */
  function fillEncorePlates(host, items, opts) {
    opts = opts || {};
    if (!host) return null;
    var stage = null;
    var plates = host;
    if (host.classList && host.classList.contains("family-portrait-plates")) {
      plates = host;
      stage = host.closest("#family-portrait-stage");
    } else {
      stage = host;
      ensureEncoreDom(stage);
      plates = stage.querySelector(".family-portrait-plates");
    }
    if (!plates) return null;
    var L = global.TOKI_LATTICE;
    var n = (items && items.length) || 0;
    var layout = L
      ? L.buildPortraitLayout(n, PORTRAIT_STAGE_W, PORTRAIT_STAGE_H)
      : { slots: [], scale: 1 };
    plates.innerHTML = "";
    var overlay = opts.stickerOverlay || null;
    var stickerOnPlate = overlay ? null : opts.sticker;
    var stickerRig = null;
    if (overlay && stage) {
      stickerRig = ensureEncoreStickerRig(stage);
      stickerRig.innerHTML = "";
    } else if (stage) {
      var leftover = stage.querySelector(".family-portrait-sticker-rig");
      if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
    }
    var i;
    for (i = 0; i < n; i++) {
      var slot = layout.slots[i];
      var it = items[i];
      if (!slot || !it || !it.src) continue;
      var wrap = document.createElement("div");
      wrap.className = "family-portrait-slot";
      wrap.setAttribute(
        "data-item-index",
        String(it.itemIndex != null ? it.itemIndex : i)
      );
      wrap.style.left = slot.x + "px";
      wrap.style.top = slot.y + "px";
      wrap.style.zIndex = String(slot.zIndex);
      var img = document.createElement("img");
      img.className = "family-portrait-item";
      img.alt = "";
      img.draggable = false;
      img.src = it.src;
      img.style.transform =
        "translate(-50%, -50%) scale(" + layout.scale + ")";
      wrap.appendChild(img);
      if (typeof opts.onImage === "function") opts.onImage(img, it, layout);
      if (it.isNew && stickerOnPlate) {
        appendEncoreSticker(wrap, layout.scale, stickerOnPlate, n);
      }
      plates.appendChild(wrap);
      if (stickerRig) {
        var sWrap = document.createElement("div");
        sWrap.className = "family-portrait-slot";
        sWrap.setAttribute(
          "data-item-index",
          String(it.itemIndex != null ? it.itemIndex : i)
        );
        sWrap.style.left = slot.x + "px";
        sWrap.style.top = slot.y + "px";
        sWrap.style.zIndex = String(slot.zIndex);
        if (it.isNew) {
          appendEncoreSticker(sWrap, layout.scale, overlay, n);
        }
        stickerRig.appendChild(sWrap);
      }
    }
    var plateW = 1500 * (layout.scale || 1);
    var holeR = encoreHoleRadius(plateW, n);
    if (stage) {
      attachEncoreVeil(stage, stage.querySelector(".family-portrait-rig"));
      if (stickerRig) {
        var veil = stage.querySelector(".family-portrait-veil");
        if (veil && veil.nextSibling !== stickerRig) {
          stage.appendChild(stickerRig);
        }
      }
      stage.style.setProperty("--encore-hole-r", holeR + "px");
      syncEncoreDetachedHole(stage);
    }
    return layout;
  }

  function applyEncoreChrome(stage, spec) {
    spec = spec || {};
    if (!stage) return;
    if (spec.forceClear) {
      stage.classList.remove(
        "encore-spot-hard",
        "encore-spot-hard-shadow",
        "encore-spot-soft",
        "encore-spot-color-highlight",
        "encore-spot-color-black"
      );
      if (spec.clearVars) {
        stage.style.removeProperty("--encore-veil-color");
      }
      return;
    }
    var type = spec.type || "hard";
    var colorMode = spec.colorMode === "highlight" ? "highlight" : "black";
    var hard = type === "hard" || type === "hard_shadow";
    stage.classList.toggle("encore-spot-hard", hard);
    stage.classList.toggle("encore-spot-hard-shadow", type === "hard_shadow");
    stage.classList.toggle("encore-spot-soft", type === "soft");
    stage.classList.toggle("encore-spot-color-highlight", colorMode === "highlight");
    stage.classList.toggle("encore-spot-color-black", colorMode === "black");
    if (colorMode === "highlight") {
      if (spec.veilHex) {
        stage.style.setProperty("--encore-veil-color", spec.veilHex);
      } else if (!spec.preserveVeil || !stage.style.getPropertyValue("--encore-veil-color")) {
        stage.style.setProperty(
          "--encore-veil-color",
          spec.fallbackHex || "#26bbcb"
        );
      }
    } else {
      stage.style.setProperty("--encore-veil-color", "#000000");
    }
  }

  function runEncoreBlock(stage, opts, hooks) {
    hooks = hooks || {};
    opts = opts || {};
    var afterMs = hooks.afterMs || function (ms, fn) {
      setTimeout(fn, ms);
    };
    var style = opts.style || ENCORE;
    var speed = opts.speed != null ? opts.speed : hooks.speed;
    if (speed != null) {
      if (!(presentationTempo(speed) > 0)) {
        if (hooks.onParked) hooks.onParked();
        return;
      }
      style = scaleStyleTimes(style, speed) || style;
    }
    var first = opts.first !== false;
    var last = !!opts.last;
    var entranceSec =
      first && style.windUp > 0
        ? style.windUp
        : style.punchIn != null
          ? style.punchIn
          : 3.4;
    var holdSec = style.hold != null ? style.hold : 1;
    var exitSec =
      last && style.windDown > 0
        ? style.windDown
        : style.punchOut != null
          ? style.punchOut
          : 0.45;
    if (hooks.onEntrance) hooks.onEntrance();
    encorePunchIn(stage, {
      first: first,
      entranceSec: entranceSec,
      zoomTo: opts.zoomTo != null ? opts.zoomTo : ENCORE.zoomTo,
      origin: opts.origin,
      pinchPx: opts.pinchPx,
      punchOut: exitSec,
      fpsCap: opts.fpsCap,
      itemIndex: opts.itemIndex,
    });
    afterMs(entranceSec * 1000, function () {
      setEncoreCameraTransition(stage, "");
      if (stage) stage.style.transition = "";
      if (hooks.onHold) hooks.onHold();
      afterMs(holdSec * 1000, function () {
        if (hooks.onExit) hooks.onExit();
        encorePunchOut(stage, {
          exitSec: exitSec,
          last: !!opts.last,
          pinchOut: ENCORE_HOLE_PINCH_OUT,
          punchIn: entranceSec,
          fpsCap: opts.fpsCap,
        });
        afterMs(exitSec * 1000, function () {
          encoreFinishExit(stage, !!opts.last);
          if (hooks.onDone) hooks.onDone();
        });
      });
    });
  }

  global.TOKI_MOTION = {
    EASE: EASE,
    KEN_BURNS: KEN_BURNS,
    SLIDESHOW: SLIDESHOW,
    ENCORE: ENCORE,
    OPACITY_DUR: OPACITY_DUR,
    PORTRAIT_STAGE_W: PORTRAIT_STAGE_W,
    PORTRAIT_STAGE_H: PORTRAIT_STAGE_H,
    ENCORE_HOLE_PINCH_OUT: ENCORE_HOLE_PINCH_OUT,
    ENCORE_HOLE_PINCH_IN_MULT: ENCORE.pinchInMult,
    styleByMode: styleByMode,
    parseMotionSeconds: parseMotionSeconds,
    parseMotionStylesTable: parseMotionStylesTable,
    lookupSheetStyle: lookupSheetStyle,
    styleForMode: styleForMode,
    presentationClock: presentationClock,
    withPresentationClock: withPresentationClock,
    PRESENTATION_TEMPO_MED: PRESENTATION_TEMPO_MED,
    presentationTempo: presentationTempo,
    scaleDuration: scaleDuration,
    scaleStyleTimes: scaleStyleTimes,
    usesZoom: usesZoom,
    isEncore: isEncore,
    encoreVeilIn: encoreVeilIn,
    encoreHold: encoreHold,
    scaledHolePinch: scaledHolePinch,
    scaledShadow: scaledShadow,
    applyCssDurations: applyCssDurations,
    heroPunchIn: heroPunchIn,
    heroPunchOut: heroPunchOut,
    heroSnap: heroSnap,
    runHeroBlock: runHeroBlock,
    encorePunchIn: encorePunchIn,
    encorePunchOut: encorePunchOut,
    encoreSnap: encoreSnap,
    encoreFinishExit: encoreFinishExit,
    encoreSlotOrigin: encoreSlotOrigin,
    setEncoreZoomOrigin: setEncoreZoomOrigin,
    setPlaneCenterOrigin: setPlaneCenterOrigin,
    snapPortraitZoom: snapPortraitZoom,
    snapEncoreHolePinch: snapEncoreHolePinch,
    setEncoreHolePinch: setEncoreHolePinch,
    setEncoreVeilDimmed: setEncoreVeilDimmed,
    tryEncoreFpsZoom: tryEncoreFpsZoom,
    cancelEncoreZoomStepper: cancelEncoreZoomStepper,
    readEncoreZoomTo: readEncoreZoomTo,
    encoreHolePinchPx: encoreHolePinchPx,
    encoreFpsCap: encoreFpsCap,
    encoreVeilDetached: encoreVeilDetached,
    syncEncoreDetachedHole: syncEncoreDetachedHole,
    encoreCrowdBoost: encoreCrowdBoost,
    encoreHoleRadius: encoreHoleRadius,
    encoreStickerScale: encoreStickerScale,
    setEncoreActiveSticker: setEncoreActiveSticker,
    setEncoreCameraTransition: setEncoreCameraTransition,
    attachEncoreVeil: attachEncoreVeil,
    applyEncoreChrome: applyEncoreChrome,
    fillEncorePlates: fillEncorePlates,
    ensureEncoreDom: ensureEncoreDom,
    runEncoreBlock: runEncoreBlock,
  };
})(window);

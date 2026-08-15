/**
 * Shared motion building blocks — Menu Manager preview and live boards.
 * Times are seconds. Zoom factors are relative. Pixel sizes scale with form.
 *
 * Source of truth for names/phases: docs/UI_NOMENCLATURE.md §4
 * Live digits: js/menu.js MOTION_DEFAULTS_* / ENCORE_*
 *
 * Do not invent preview-only timings. Change a preset here, not in callers.
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
    holePinchLive: 40,
    holeRefLive: 160,
    shadow: { x: 18, y: 22, blur: 2, opacity: 0.5 },
  };

  var OPACITY_DUR = 0.45;

  function styleByMode(mode) {
    var m = String(mode || "slideshow").toLowerCase();
    if (m === "encore") return ENCORE;
    if (m === "kenburns" || m.indexOf("ken") !== -1) return KEN_BURNS;
    return SLIDESHOW;
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

  /** Pixel pinch for this preview hole, from the live 40px @ 160px hole. */
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

  global.TOKI_MOTION = {
    EASE: EASE,
    KEN_BURNS: KEN_BURNS,
    SLIDESHOW: SLIDESHOW,
    ENCORE: ENCORE,
    OPACITY_DUR: OPACITY_DUR,
    styleByMode: styleByMode,
    encoreVeilIn: encoreVeilIn,
    encoreHold: encoreHold,
    scaledHolePinch: scaledHolePinch,
    scaledShadow: scaledShadow,
  };
})(window);

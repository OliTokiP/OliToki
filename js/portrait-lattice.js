/**
 * Family Portrait / Encore lattice — same algorithm as js/menu.js
 * buildPortraitLayout. See docs/FAMILY_PORTRAIT_LATTICE.md.
 *
 * Plane = photo wedge. Divide into a scored cols×rows grid. Place each
 * plate at a slot CENTER (intersection of the cell). Encore zooms this
 * whole scaffold; the veil hole sits on the active slot.
 */
(function (global) {
  "use strict";

  var PORTRAIT_CUTOUT_X0 = 1071.9;
  var PORTRAIT_CUTOUT_SLOPE = 0.078335;
  var PORTRAIT_STAGE_W = 1920 - PORTRAIT_CUTOUT_X0;
  var PORTRAIT_STAGE_H = 1080;
  var PORTRAIT_IMG_W = 1500;
  var PORTRAIT_IMG_H = 1000;

  function portraitCutoutLocalX(y) {
    return PORTRAIT_CUTOUT_SLOPE * Math.max(0, Math.min(PORTRAIT_STAGE_H, y));
  }

  function buildPortraitLayout(n, stageW, stageH, opts) {
    opts = opts || {};
    var useCutout = opts.useCutout !== false;
    var photoLeft = !!opts.photoLeft;
    stageW = stageW || PORTRAIT_STAGE_W;
    stageH = stageH || PORTRAIT_STAGE_H;
    if (n <= 0) {
      return { slots: [], cols: 0, rows: 0, scale: 1, stageW: stageW, stageH: stageH };
    }

    var midInset = portraitCutoutLocalX(stageH * 0.5);
    var midW = Math.max(1, stageW - midInset);
    var targetAspect = midW / stageH;
    var ideal = Math.sqrt(n);
    var best = null;
    var candidates = [];
    var nPad;
    var cols;
    for (nPad = n; nPad <= n + 3; nPad++) {
      for (cols = 1; cols <= nPad; cols++) {
        var rows = Math.ceil(nPad / cols);
        if (rows * cols < n) continue;
        candidates.push({ cols: cols, rows: rows, capacity: rows * cols });
      }
    }
    candidates.forEach(function (c) {
      var empty = c.cols * c.rows - n;
      var latticeAspect = c.cols / c.rows;
      var aspectErr = Math.abs(Math.log((latticeAspect || 1) / targetAspect));
      var balance = Math.abs(c.cols - ideal) + Math.abs(c.rows - ideal);
      var score =
        empty * 8 +
        aspectErr * 3 +
        balance * 1.4 +
        Math.abs(c.rows - c.cols) * 0.25;
      if (c.cols === 1 && n > 3) score += 25;
      if (c.rows === 1 && n > 3) score += 18;
      if (c.rows >= c.cols) score -= 0.2;
      if (!best || score < best.score) {
        best = { cols: c.cols, rows: c.rows, empty: empty, score: score };
      }
    });

    cols = best.cols;
    var rows = best.rows;
    var padY = stageH * (n <= 3 ? 0.065 : 0.05);
    var padXFrac = n <= 3 ? 0.075 : 0.06;
    var innerH = Math.max(1, stageH - 2 * padY);
    var cellH = innerH / rows;
    var slots = [];
    var placed = 0;
    var minCellW = Infinity;
    var r;
    for (r = 0; r < rows && placed < n; r++) {
      var remaining = n - placed;
      var inRow = r === rows - 1 ? remaining : Math.min(cols, remaining);
      var incomplete = inRow < cols;
      var y = padY + (r + 0.5) * cellH;
      var inset = useCutout ? portraitCutoutLocalX(y) : 0;
      var xLeftEdge = useCutout && !photoLeft ? inset : 0;
      var xRightInset = useCutout && photoLeft ? inset : 0;
      var rowW = Math.max(1, stageW - xLeftEdge - xRightInset);
      var padX = rowW * padXFrac;
      var innerW = Math.max(1, rowW - 2 * padX);
      var cellW = innerW / cols;
      if (cellW < minCellW) minCellW = cellW;
      var k;
      for (k = 0; k < inRow; k++) {
        var x;
        if (incomplete) {
          var blockW = inRow * cellW;
          var blockLeft = xLeftEdge + padX + (innerW - blockW) / 2;
          x = blockLeft + (k + 0.5) * cellW;
        } else {
          x = xLeftEdge + padX + (k + 0.5) * cellW;
        }
        var colIndex = incomplete ? Math.floor((cols - inRow) / 2 + k) : k;
        slots.push({
          x: x,
          y: y,
          row: r,
          col: colIndex,
          zIndex: 10 + r * 20 + colIndex,
        });
        placed++;
      }
    }

    var overlap =
      n <= 2 ? 1.28 : n <= 3 ? 1.32 : n <= 4 ? 1.36 : n <= 6 ? 1.4 : 1.42;
    var refCellW = Number.isFinite(minCellW) ? minCellW : midW / cols;
    var scale = Math.min(
      (refCellW * overlap) / PORTRAIT_IMG_W,
      (cellH * overlap) / PORTRAIT_IMG_H
    );
    scale *= Math.min(1.15, 1.05 / Math.sqrt(Math.max(1, n) / 6));
    if (n <= 2) scale *= 0.9;
    else if (n <= 3) scale *= 0.93;
    scale = Math.max(0.2, Math.min(0.7, scale));

    return {
      slots: slots,
      cols: cols,
      rows: rows,
      scale: scale,
      stageW: stageW,
      stageH: stageH,
    };
  }

  global.TOKI_LATTICE = {
    PORTRAIT_CUTOUT_X0: PORTRAIT_CUTOUT_X0,
    PORTRAIT_CUTOUT_SLOPE: PORTRAIT_CUTOUT_SLOPE,
    PORTRAIT_STAGE_W: PORTRAIT_STAGE_W,
    PORTRAIT_STAGE_H: PORTRAIT_STAGE_H,
    PORTRAIT_IMG_W: PORTRAIT_IMG_W,
    PORTRAIT_IMG_H: PORTRAIT_IMG_H,
    portraitCutoutLocalX: portraitCutoutLocalX,
    buildPortraitLayout: buildPortraitLayout,
  };
})(window);

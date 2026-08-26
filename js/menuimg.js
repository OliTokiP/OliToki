/**
 * .menuimg — Plate Image package (1500×1000).
 * Source webp + config.txt live in ItemName.menuimg/; display.webp is the
 * flattened bitmap boards paint (same 3:2 as today's food-pics webp).
 */
(function (global) {
  "use strict";

  var CANVAS_W = 1500;
  var CANVAS_H = 1000;
  var RED_SIDE = 780;
  var GREY_FIT = 1.15;
  var OPAQUE_MIN = 12;
  var TRANS_MAX = 250;
  var ANALYZE_MAX = 900;
  var SOURCE_MAX = 2000;
  var SIZE_MIN = 70;
  var SIZE_MAX = 130;
  var X_MIN = -240;
  var X_MAX = 240;
  var Y_MIN = -160;
  var Y_MAX = 160;

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) return lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function isMenuimgName(raw) {
    var s = String(raw || "").trim();
    if (!s) return false;
    return /\.menuimg(?:\/|$)/i.test(s);
  }

  function packageStem(raw) {
    var s = String(raw || "").trim().replace(/\\/g, "/");
    if (!s) return "";
    var m = s.match(/([^/]+)\.menuimg(?:\/.*)?$/i);
    if (m) return m[1];
    s = s.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
    return s;
  }

  function resolveDisplayPath(raw, folder) {
    var s = String(raw || "").trim().replace(/^\/+/, "");
    if (!s) return "";
    if (/^https?:/i.test(s) || /^\/?api\/media\//i.test(s)) return s;
    var file = "display.webp";
    if (/display-sm\.webp$/i.test(s)) file = "display-sm.webp";
    else if (/display\.webp$/i.test(s)) file = "display.webp";
    var stem = packageStem(s);
    var dir = "";
    if (/^food-pics\//i.test(s)) {
      dir = s.replace(/\.menuimg(?:\/.*)?$/i, ".menuimg");
      if (!/\.menuimg$/i.test(dir)) dir = dir.replace(/\/[^/]+$/, "") + "/" + stem + ".menuimg";
    } else {
      var base = String(folder || "food-pics").replace(/\/+$/, "");
      dir = base + "/" + stem + ".menuimg";
    }
    return dir + "/" + file;
  }

  function parseConfig(text) {
    var out = {
      filename_1: "",
      scale_1: 100,
      x_1: 0,
      y_1: 0,
    };
    String(text || "")
      .split(/\r?\n/)
      .forEach(function (line) {
        var m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/);
        if (!m) return;
        var key = m[1].toLowerCase();
        var val = m[2];
        if (key === "filename_1") out.filename_1 = val;
        else if (key === "scale_1") out.scale_1 = clamp(parseInt(val, 10), SIZE_MIN, SIZE_MAX);
        else if (key === "x_1") out.x_1 = clamp(parseInt(val, 10), X_MIN, X_MAX);
        else if (key === "y_1") out.y_1 = clamp(parseInt(val, 10), Y_MIN, Y_MAX);
      });
    if (!isFinite(out.scale_1) || out.scale_1 <= 0) out.scale_1 = 100;
    return out;
  }

  function serializeConfig(cfg) {
    cfg = cfg || {};
    var name = String(cfg.filename_1 || cfg.fileName || "image.webp").replace(/^.*\//, "");
    if (!/\.webp$/i.test(name)) {
      name = name.replace(/\.[^.]+$/, "") + ".webp";
    }
    return (
      "Filename_1: " +
      name +
      "\nScale_1: " +
      Math.round(clamp(cfg.scale_1 != null ? cfg.scale_1 : cfg.scale, SIZE_MIN, SIZE_MAX) || 100) +
      "\nX_1: " +
      Math.round(clamp(cfg.x_1 != null ? cfg.x_1 : cfg.x, X_MIN, X_MAX) || 0) +
      "\nY_1: " +
      Math.round(clamp(cfg.y_1 != null ? cfg.y_1 : cfg.y, Y_MIN, Y_MAX) || 0) +
      "\n"
    );
  }

  function itemStem(itemName, filename) {
    var file = String(filename || "").replace(/^.*\//, "");
    var base = file.replace(/\.[^.]+$/, "");
    var raw = base || String(itemName || "Item");
    var parts = raw.match(/[A-Za-z0-9]+/g);
    if (!parts || !parts.length) return "Item";
    var s = parts
      .map(function (p) {
        return p.charAt(0).toUpperCase() + p.slice(1);
      })
      .join("");
    return s.slice(0, 80) || "Item";
  }

  function canvasSrcFor(url) {
    var s = String(url || "").trim();
    if (!s) return s;
    var m = s.match(/lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]+)/);
    if (m) return "/api/media/" + m[1];
    m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]+)/);
    if (m) return "/api/media/" + m[1];
    m = s.match(/\/api\/media\/([A-Za-z0-9_-]+)/);
    if (m) return "/api/media/" + m[1];
    return s;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      if (!src) {
        reject(new Error("no image"));
        return;
      }
      var img = new Image();
      if (!/^data:|^blob:/i.test(String(src))) img.crossOrigin = "anonymous";
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("image load failed"));
      };
      img.src = src;
    });
  }

  function analyzeImage(img) {
    var w = img.naturalWidth || img.width || 0;
    var h = img.naturalHeight || img.height || 0;
    if (!w || !h) {
      return {
        width: 0,
        height: 0,
        hasTransparency: false,
        bbox: { x: 0, y: 0, w: 0, h: 0 },
        greySide: 1,
        greyCx: 0,
        greyCy: 0,
      };
    }
    var scale = Math.min(1, ANALYZE_MAX / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    var data;
    try {
      data = ctx.getImageData(0, 0, cw, ch).data;
    } catch (err) {
      return {
        width: w,
        height: h,
        hasTransparency: false,
        tainted: true,
        bbox: { x: 0, y: 0, w: w, h: h },
        greySide: Math.max(w, h),
        greyCx: w / 2,
        greyCy: h / 2,
      };
    }
    var minX = cw;
    var minY = ch;
    var maxX = -1;
    var maxY = -1;
    var hasTrans = false;
    var i;
    var n = data.length;
    for (i = 3; i < n; i += 4) {
      var a = data[i];
      if (a < TRANS_MAX) hasTrans = true;
      if (a <= OPAQUE_MIN) continue;
      var p = (i - 3) / 4;
      var x = p % cw;
      var y = (p - x) / cw;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    var bbox;
    if (maxX < minX) {
      bbox = { x: 0, y: 0, w: w, h: h };
      hasTrans = false;
    } else {
      var inv = scale > 0 ? 1 / scale : 1;
      bbox = {
        x: minX * inv,
        y: minY * inv,
        w: (maxX - minX + 1) * inv,
        h: (maxY - minY + 1) * inv,
      };
    }
    var greySide = Math.max(bbox.w, bbox.h, 1);
    return {
      width: w,
      height: h,
      hasTransparency: hasTrans,
      bbox: bbox,
      greySide: greySide,
      greyCx: bbox.x + bbox.w / 2,
      greyCy: bbox.y + bbox.h / 2,
    };
  }

  function looksLikePlate(img) {
    var w = (img && (img.naturalWidth || img.width)) || 0;
    var h = (img && (img.naturalHeight || img.height)) || 0;
    if (!w || !h) return false;
    return Math.abs(w / h - CANVAS_W / CANVAS_H) < 0.08 && Math.max(w, h) >= 700;
  }

  function autoScale(analysis) {
    if (analysis && analysis.fit === "canvas") {
      var w = analysis.width || 1;
      return CANVAS_W / w;
    }
    var grey = (analysis && analysis.greySide) || 1;
    return (RED_SIDE * GREY_FIT) / grey;
  }

  function layout(analysis, scalePct, x, y) {
    analysis = analysis || {};
    var imgW = analysis.width || 0;
    var imgH = analysis.height || 0;
    var s = autoScale(analysis) * (clamp(scalePct, SIZE_MIN, SIZE_MAX) / 100);
    var ox = clamp(x, X_MIN, X_MAX);
    var oy = clamp(y, Y_MIN, Y_MAX);
    if (analysis.fit === "canvas") {
      return {
        scale: s,
        left: (CANVAS_W - imgW * s) / 2 + ox,
        top: (CANVAS_H - imgH * s) / 2 + oy,
        width: imgW * s,
        height: imgH * s,
      };
    }
    var greyCx = analysis.greyCx != null ? analysis.greyCx : imgW / 2;
    var greyCy = analysis.greyCy != null ? analysis.greyCy : imgH / 2;
    var destCx = CANVAS_W / 2 + ox;
    var destCy = CANVAS_H / 2 + oy;
    return {
      scale: s,
      left: destCx - greyCx * s,
      top: destCy - greyCy * s,
      width: imgW * s,
      height: imgH * s,
    };
  }

  function layoutCss(analysis, scalePct, x, y) {
    var lay = layout(analysis, scalePct, x, y);
    return {
      left: ((lay.left / CANVAS_W) * 100).toFixed(3) + "%",
      top: ((lay.top / CANVAS_H) * 100).toFixed(3) + "%",
      width: ((lay.width / CANVAS_W) * 100).toFixed(3) + "%",
      height: ((lay.height / CANVAS_H) * 100).toFixed(3) + "%",
    };
  }

  function compositeDataURL(img, analysis, scalePct, x, y, mime) {
    var canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    var lay = layout(analysis, scalePct, x, y);
    ctx.drawImage(img, lay.left, lay.top, lay.width, lay.height);
    var type = mime || "image/webp";
    try {
      var url = canvas.toDataURL(type, 0.86);
      if (url && url.indexOf("data:image") === 0) return url;
    } catch (err) {}
    if (type !== "image/png") {
      try {
        return canvas.toDataURL("image/png");
      } catch (err2) {}
    }
    return "";
  }

  function blobFromDataURL(dataUrl) {
    var s = String(dataUrl || "");
    var m = s.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) return null;
    var bin = atob(m[2]);
    var arr = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] || "image/webp" });
  }

  global.TOKI_MENUIMG = {
    CANVAS_W: CANVAS_W,
    CANVAS_H: CANVAS_H,
    RED_SIDE: RED_SIDE,
    GREY_FIT: GREY_FIT,
    SIZE_MIN: SIZE_MIN,
    SIZE_MAX: SIZE_MAX,
    X_MIN: X_MIN,
    X_MAX: X_MAX,
    Y_MIN: Y_MIN,
    Y_MAX: Y_MAX,
    SOURCE_MAX: SOURCE_MAX,
    isMenuimgName: isMenuimgName,
    packageStem: packageStem,
    resolveDisplayPath: resolveDisplayPath,
    parseConfig: parseConfig,
    serializeConfig: serializeConfig,
    itemStem: itemStem,
    canvasSrcFor: canvasSrcFor,
    loadImage: loadImage,
    analyzeImage: analyzeImage,
    autoScale: autoScale,
    layout: layout,
    layoutCss: layoutCss,
    compositeDataURL: compositeDataURL,
    blobFromDataURL: blobFromDataURL,
    looksLikePlate: looksLikePlate,
  };
})(typeof window !== "undefined" ? window : this);

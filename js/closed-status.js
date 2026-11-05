/**
 * TokiMenu — Closed Status overlay (all four boards).
 *
 * Mockup: vault Mockups/Closed Status Mockup (Closed 1–4.svg + Closed Status.pdf;
 * Halloween: Closed Status H 1–4 + Closed Status H.pdf).
 * Christmas: Dropbox Toki Holidays/Mockups/Closed Status Xmas.pdf.
 * When Store Hours say the shop is closed, each board paints its static SVG
 * (CL / OS / ED / bunny+hours) and asks the menu runtime to halt galaxy pan,
 * presentation, stripes, and weather work. Halloween Theme swaps Board 4’s
 * bunny for Toki Ghost (`closed-h-4.svg`). Christmas Theme swaps in the
 * holiday art (`closed-x-*`) and runs the same three-layer circle snow as
 * Holiday Roulette. Opens again on the next service window. Independent of
 * the catalog Google load.
 *
 * QA: ?closed=1 force on, ?closed=0 force off, ?wxNow= / ?hoursAt= freeze
 * America/New_York (same codes as the Weather Widget).
 * ?theme=Christmas&closed=1 shows the holiday plate.
 * ?snow=0 is a small flurry, ?snow=100 is a blizzard. Omitted snow uses 40
 * until a ship number is chosen.
 * ?lightshow=1 runs the CLOSED-letter lights (Highlight Special, Highlight,
 * Secondary). Omitted or 0 leaves the PDF gold. Boards 1–3 only.
 */
(function (root) {
  "use strict";

  var TZ = "America/New_York";
  var HOURS_MS = 10 * 60 * 1000;
  var CHECK_CAP_MS = 5000;
  var WEEK_MIN = 7 * 1440;
  var STORE_HOURS_GID = "1732597216";
  var ART_BASE = "assets/closed/closed-";
  var ART_VER = "20260924closed2";
  var XMAS_VER = "20261105cx1";
  // Stand-in until Feedback picks a ship number. ?snow= overrides it.
  var SNOW_DEFAULT = 40;
  // Christmas closed letters, ?lightshow=1. One clock for the whole wall.
  // 25s of solid color (5s yellow, 5s red, 5s white, repeat), then 5s of
  // scramble. Yellow / red / white are Highlight Special, Highlight, Secondary.
  var LIGHT_PERIOD_MS = 30000;
  var LIGHT_SCRAMBLE_MS = 5000;
  var LIGHT_HOLD_MS = 5000;
  var LIGHT_STEP_MS = 200;
  // C L O S E D. 0 yellow, 1 red, 2 white. Each color twice, and the same
  // color never sits on touching letters, including across a board seam.
  var LIGHT_PATTERNS = [
    "010212",
    "102021",
    "021210",
    "102102",
    "021021",
    "210102",
    "121020",
    "012102",
    "120210",
    "202101",
    "021012",
    "102120",
    "021201",
    "102012",
    "020121",
    "201210",
    "120201",
    "212010",
    "201201",
    "210120",
    "210201",
    "210210",
    "012012",
    "120120",
    "201012",
    "012120",
    "101202",
    "012021",
    "120102",
    "201021",
  ];
  var BOARD_W = 1920;
  var WALL_W = 7680;
  var STAGE_H = 1080;
  // Same classes as Holiday Roulette: small behind the type, medium in the
  // middle, large in front. perBoard is a 1920-wide screen at snow scale 1.
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
  var closed = false;
  var hoursTimer = 0;
  var checkTimer = 0;
  var frozenNow = null;
  var hoursSchedule = defaultHours();
  var overlay = null;
  var art = null;
  var front = null;
  var lastClosed = null;
  var slot = 1;
  var snowLayers = [];
  var snowRaf = 0;
  var snowWanted = false;
  var themeWhite = "#FFF8F0";
  var snowLevelCached = null;
  var lightSvg = null;
  var lightPaths = null;
  var lightReq = 0;
  var lightHoldMs = null;
  var lightColorCache = null;
  var lightColorKey = "";

  function $(id) {
    return document.getElementById(id);
  }

  function nowDate() {
    return frozenNow || new Date();
  }

  function readFrozenNow() {
    try {
      var q = new URLSearchParams(location.search);
      var raw = q.get("wxNow") || q.get("hoursAt");
      if (!raw) return null;
      var d = new Date(raw);
      if (isNaN(d.getTime())) return null;
      return d;
    } catch (e) {
      return null;
    }
  }

  function readForceClosed() {
    try {
      var raw = new URLSearchParams(location.search).get("closed");
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

  function settingsSheetId() {
    var fromWin =
      root.TOKI_SETTINGS_SHEET_ID && String(root.TOKI_SETTINGS_SHEET_ID).trim();
    return fromWin || "1OwNKHzjP46xKJBW8sTm4IOWhIzf0lENdZ8rv_GY37fY";
  }

  function boardSlot() {
    var layout =
      (root.TOKI_CONFIG && String(root.TOKI_CONFIG.layout || "").toLowerCase()) ||
      "";
    if (layout === "bowls") return 1;
    if (layout === "handhelds") return 2;
    if (layout === "munchies") return 3;
    if (layout === "drinks") return 4;
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

  function weekdayIndex(name) {
    var n = String(name || "")
      .trim()
      .toLowerCase();
    if (n.indexOf("sun") === 0) return 0;
    if (n.indexOf("mon") === 0) return 1;
    if (n.indexOf("tue") === 0) return 2;
    if (n.indexOf("wed") === 0) return 3;
    if (n.indexOf("thu") === 0) return 4;
    if (n.indexOf("fri") === 0) return 5;
    if (n.indexOf("sat") === 0) return 6;
    return -1;
  }

  function defaultHours() {
    var earlyOpen = 11 * 60;
    var earlyClose = 22 * 60 + 30;
    var lateClose = 25 * 60 + 30;
    var days = [];
    var i;
    for (i = 0; i < 7; i++) {
      days.push({
        day: i,
        openMin: earlyOpen,
        closeMin: i === 4 || i === 5 || i === 6 ? lateClose : earlyClose,
      });
    }
    return days;
  }

  function parseClockToMinutes(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    var m = s.match(/^(\d{1,3})(?::(\d{1,2}))(?::\d{1,2})?\s*$/);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) return null;
    return h * 60 + min;
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = "";
    var i = 0;
    var inQuotes = false;
    var s = String(text || "").replace(/^\uFEFF/, "");
    var ch;
    while (i < s.length) {
      ch = s.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') {
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
        if (
          row.some(function (c) {
            return String(c).trim() !== "";
          })
        ) {
          rows.push(row);
        }
        row = [];
        if (ch === "\r" && s.charAt(i + 1) === "\n") i++;
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    row.push(field);
    if (
      row.some(function (c) {
        return String(c).trim() !== "";
      })
    ) {
      rows.push(row);
    }
    return rows;
  }

  function parseHoursRows(rows) {
    if (!rows || !rows.length) return null;
    var header = rows[0] || [];
    var dayCol = 0;
    var openCol = 1;
    var closeCol = 2;
    var start = 0;
    var i;
    if (weekdayIndex(header[0]) < 0) {
      for (i = 0; i < header.length; i++) {
        var h = String(header[i] || "")
          .toLowerCase()
          .replace(/^\s+|\s+$/g, "");
        if (h === "day" || h.indexOf("day") === 0) dayCol = i;
        if (h === "opens" || h.indexOf("open") === 0) openCol = i;
        if (h === "closes" || h.indexOf("close") === 0) closeCol = i;
      }
      start = 1;
    }
    var byDay = {};
    for (i = start; i < rows.length; i++) {
      var rec = rows[i] || [];
      var d = weekdayIndex(rec[dayCol]);
      if (d < 0) continue;
      var openMin = parseClockToMinutes(rec[openCol]);
      var closeMin = parseClockToMinutes(rec[closeCol]);
      if (openMin == null || closeMin == null) continue;
      if (closeMin <= openMin) continue;
      byDay[d] = { day: d, openMin: openMin, closeMin: closeMin };
    }
    var out = defaultHours();
    var found = 0;
    for (i = 0; i < 7; i++) {
      if (byDay[i]) {
        out[i] = byDay[i];
        found++;
      }
    }
    return found ? out : null;
  }

  function partsNow() {
    var now = nowDate();
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      second: "numeric",
      hour12: true,
      hourCycle: "h12",
    }).formatToParts(now);
    var map = {};
    for (var i = 0; i < parts.length; i++) {
      map[parts[i].type] = parts[i].value;
    }
    return map;
  }

  function hour24FromParts(map) {
    var h = parseInt(map.hour, 10);
    var p = String(map.dayPeriod || "")
      .toLowerCase()
      .replace(/\./g, "");
    if (!Number.isFinite(h)) return 0;
    if (h === 24) return 0;
    if (p.indexOf("am") !== -1) return h === 12 ? 0 : h;
    if (p.indexOf("pm") !== -1) return h === 12 ? 12 : h + 12;
    return h;
  }

  function inServiceWindow(nowMin, start, end) {
    return (
      (nowMin >= start && nowMin < end) ||
      (nowMin + WEEK_MIN >= start && nowMin + WEEK_MIN < end)
    );
  }

  function isOpenAt(hours, weekday, hour24, minute, second) {
    var list = hours && hours.length ? hours : defaultHours();
    var nowMin =
      weekday * 1440 + hour24 * 60 + minute + (Number(second) || 0) / 60;
    var i;
    var row;
    for (i = 0; i < list.length; i++) {
      row = list[i];
      if (
        inServiceWindow(
          nowMin,
          row.day * 1440 + row.openMin,
          row.day * 1440 + row.closeMin
        )
      ) {
        return true;
      }
    }
    return false;
  }

  function storeIsOpen() {
    var p = partsNow();
    var weekday = weekdayIndex(p.weekday);
    if (weekday < 0) weekday = 0;
    var hour24 = hour24FromParts(p);
    var minute = parseInt(p.minute, 10);
    if (!Number.isFinite(minute)) minute = 0;
    var second = parseInt(p.second, 10);
    if (!Number.isFinite(second)) second = 0;
    return isOpenAt(hoursSchedule, weekday, hour24, minute, second);
  }

  function msUntilBoundary() {
    var p = partsNow();
    var weekday = weekdayIndex(p.weekday);
    if (weekday < 0) weekday = 0;
    var hour24 = hour24FromParts(p);
    var minute = parseInt(p.minute, 10);
    if (!Number.isFinite(minute)) minute = 0;
    var second = parseInt(p.second, 10);
    if (!Number.isFinite(second)) second = 0;
    var nowMin =
      weekday * 1440 + hour24 * 60 + minute + second / 60;
    var list = hoursSchedule && hoursSchedule.length ? hoursSchedule : defaultHours();
    var best = Infinity;
    var i;
    var row;
    var edges;
    var e;
    var wait;
    for (i = 0; i < list.length; i++) {
      row = list[i];
      edges = [row.openMin, row.closeMin];
      for (e = 0; e < edges.length; e++) {
        wait = row.day * 1440 + edges[e] - nowMin;
        if (wait <= 0) wait += WEEK_MIN;
        if (wait < best) best = wait;
      }
    }
    if (!Number.isFinite(best) || best === Infinity) return CHECK_CAP_MS;
    return Math.max(250, Math.min(CHECK_CAP_MS, best * 60 * 1000));
  }

  function hoursCsvUrl() {
    return (
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(settingsSheetId()) +
      "/export?format=csv&gid=" +
      encodeURIComponent(STORE_HOURS_GID) +
      "&cachebust=" +
      Date.now()
    );
  }

  function applyHours(next) {
    if (!next || !next.length) return false;
    hoursSchedule = next;
    return true;
  }

  function fetchHours() {
    return fetch(hoursCsvUrl(), { cache: "no-store", mode: "cors" })
      .then(function (res) {
        if (!res.ok) throw new Error("hours " + res.status);
        return res.text();
      })
      .then(function (text) {
        if (/^\s*</.test(text)) throw new Error("hours HTML");
        var parsed = parseHoursRows(parseCsv(text));
        if (!parsed) throw new Error("hours empty");
        applyHours(parsed);
        tickClosed();
      })
      .catch(function (err) {
        console.warn("[TokiMenu closed] Store Hours", err);
      });
  }

  function readSnowLevel() {
    try {
      var raw = new URLSearchParams(location.search).get("snow");
      if (raw == null || String(raw).trim() === "") return SNOW_DEFAULT;
      var n = Number(String(raw).trim());
      if (!isFinite(n)) return SNOW_DEFAULT;
      if (n < 0) n = 0;
      if (n > 100) n = 100;
      return n;
    } catch (e) {
      return SNOW_DEFAULT;
    }
  }

  function snowLevel() {
    if (snowLevelCached == null) snowLevelCached = readSnowLevel();
    return snowLevelCached;
  }

  // 0 = small flurry, 100 = blizzard. Scale 1 matches Holiday Roulette’s
  // full field. Count, size, and speed move together.
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

  function ensureSnow() {
    if (!overlay || !art || snowLayers.length) return;
    var wall = isWallPreview();
    var mul = snowMul();
    var countScale = (wall ? 0.55 : 1) * mul.count;
    var resScale = wall ? 0.7 : 1;
    var i;
    for (i = 0; i < SNOW_SPECS.length; i++) {
      var spec = SNOW_SPECS[i];
      var canvas = document.createElement("canvas");
      canvas.className = "closed-snow is-" + spec.name;
      canvas.setAttribute("aria-hidden", "true");
      var bw = Math.max(160, Math.round(spec.bw * resScale));
      var bh = Math.max(90, Math.round(spec.bh * resScale));
      canvas.width = bw;
      canvas.height = bh;
      var count = Math.round(spec.perBoard * 4 * countScale);
      var floor = spec.name === "front" ? 4 : spec.name === "mid" ? 8 : 20;
      if (wall) floor = spec.name === "front" ? 2 : 4;
      if (count < floor) count = floor;
      var list = [];
      var n;
      for (n = 0; n < count; n++) {
        var sizeT = hash01(n, i * 17 + 2);
        if (spec.name !== "front") sizeT = sizeT * sizeT;
        list.push({
          x0: ((n + hash01(n, i * 17 + 1)) / count) * WALL_W,
          r: (spec.r0 + (spec.r1 - spec.r0) * sizeT) * mul.radius,
          speed: (spec.s0 + (spec.s1 - spec.s0) * hash01(n, i * 17 + 4)) * mul.speed,
          drift: (spec.d0 + (spec.d1 - spec.d0) * hash01(n, i * 17 + 5)) * mul.speed,
          alpha: spec.a0 + (spec.a1 - spec.a0) * hash01(n, i * 17 + 6),
          sway: spec.sway * (0.55 + 0.9 * hash01(n, i * 17 + 8)),
          swayHz: 0.35 + 0.7 * hash01(n, i * 17 + 9),
          phase: hash01(n, i * 17 + 7) * Math.PI * 2,
        });
      }
      snowLayers.push({
        spec: spec,
        canvas: canvas,
        ctx: canvas.getContext("2d"),
        flakes: list,
      });
    }
    // Small flakes < big text < medium flakes < small text & Santa < large flakes.
    var back = snowLayers[0].canvas;
    var mid = snowLayers[1].canvas;
    var frontSnow = snowLayers[2].canvas;
    overlay.insertBefore(back, art);
    if (front && front.parentNode === overlay) {
      overlay.insertBefore(mid, front);
      overlay.appendChild(frontSnow);
    } else {
      overlay.appendChild(mid);
      overlay.appendChild(frontSnow);
    }
  }

  function drawSnow(nowMs) {
    if (!snowLayers.length) return;
    var origin = (slot - 1) * BOARD_W;
    var t = nowMs / 1000;
    var li;
    for (li = 0; li < snowLayers.length; li++) {
      var layer = snowLayers[li];
      var ctx = layer.ctx;
      var canvas = layer.canvas;
      if (!ctx) continue;
      var sx = canvas.width / BOARD_W;
      var sy = canvas.height / STAGE_H;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = themeWhite;
      var flakes = layer.flakes;
      var n;
      for (n = 0; n < flakes.length; n++) {
        var f = flakes[n];
        var world =
          f.x0 +
          f.drift * t +
          Math.sin(t * f.swayHz + f.phase) * f.sway;
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
      }
      ctx.globalAlpha = 1;
    }
  }

  function snowFrame() {
    if (!snowWanted) return;
    snowRaf = window.requestAnimationFrame(snowFrame);
    var now = lightHoldMs != null ? lightHoldMs : Date.now();
    drawSnow(now);
    paintLights(now);
  }

  function startSnow() {
    if (!overlay || !art) return;
    ensureSnow();
    refreshSnowColor();
    var i;
    for (i = 0; i < snowLayers.length; i++) {
      snowLayers[i].canvas.classList.add("is-on");
    }
    if (snowWanted) return;
    snowWanted = true;
    console.info("[TokiMenu closed] holiday snow", snowLevel());
    snowRaf = window.requestAnimationFrame(snowFrame);
  }

  function stopSnow() {
    snowWanted = false;
    if (snowRaf) window.cancelAnimationFrame(snowRaf);
    snowRaf = 0;
    var i;
    for (i = 0; i < snowLayers.length; i++) {
      var layer = snowLayers[i];
      layer.canvas.classList.remove("is-on");
      if (layer.ctx) {
        layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      }
    }
  }

  function readLightshow() {
    try {
      var raw = new URLSearchParams(location.search).get("lightshow");
      if (raw == null) return false;
      var s = String(raw).trim().toLowerCase();
      if (!s || s === "0" || s === "off" || s === "false" || s === "no") return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function cssColor(name) {
    try {
      return String(
        getComputedStyle(document.documentElement).getPropertyValue(name) || ""
      ).trim();
    } catch (e) {
      return "";
    }
  }

  // Theme tokens. Before menu.js paints Christmas, fall back to the
  // Christmas palette so the first frames are not Toki Default cyan.
  function themeLightColors() {
    var keyed =
      document.body && document.body.classList.contains("theme-christmas")
        ? "on"
        : "off";
    if (lightColorCache && lightColorKey === keyed) return lightColorCache;
    lightColorKey = keyed;
    var C = root.TOKI_CHRISTMAS;
    var P = (C && C.PALETTE) || {};
    var yellow = P.special || "#F5D76E";
    var red = P.highlight || "#C41E3A";
    var white = P.secondary || "#FFF8F0";
    if (keyed === "on") {
      var y = cssColor("--highlight-special");
      var r = cssColor("--highlight");
      var w = cssColor("--secondary-color");
      if (y) yellow = y;
      if (r) red = r;
      if (w && !isPureWhite(w)) white = w;
    }
    lightColorCache = [yellow, red, white];
    return lightColorCache;
  }

  function describeLights(nowMs) {
    var phase = nowMs % LIGHT_PERIOD_MS;
    if (phase < 0) phase += LIGHT_PERIOD_MS;
    var colors = themeLightColors();
    var pattern;
    var mode;
    var i;
    if (phase >= LIGHT_PERIOD_MS - LIGHT_SCRAMBLE_MS) {
      mode = "scramble";
      var tick = Math.floor(
        (phase - (LIGHT_PERIOD_MS - LIGHT_SCRAMBLE_MS)) / LIGHT_STEP_MS
      );
      var raw = LIGHT_PATTERNS[tick % LIGHT_PATTERNS.length];
      pattern = [];
      for (i = 0; i < 6; i++) pattern.push(Number(raw.charAt(i)));
    } else {
      mode = "solid";
      var idx = Math.floor(phase / LIGHT_HOLD_MS) % 3;
      pattern = [idx, idx, idx, idx, idx, idx];
    }
    var six = [];
    for (i = 0; i < 6; i++) six.push(colors[pattern[i]]);
    return { mode: mode, phase: phase, pattern: pattern, colors: six };
  }

  function paintLights(nowMs) {
    if (!lightPaths || lightPaths.length < 2) return null;
    var state = describeLights(nowMs);
    var base = (slot - 1) * 2;
    if (base < 0 || base > 4) return state;
    var a = state.colors[base];
    var b = state.colors[base + 1];
    if (lightPaths[0].getAttribute("fill") !== a) {
      lightPaths[0].setAttribute("fill", a);
    }
    if (lightPaths[1].getAttribute("fill") !== b) {
      lightPaths[1].setAttribute("fill", b);
    }
    return state;
  }

  function removeLights() {
    lightReq++;
    if (lightSvg && lightSvg.parentNode) lightSvg.parentNode.removeChild(lightSvg);
    lightSvg = null;
    lightPaths = null;
    if (overlay) overlay.classList.remove("is-lightshow");
  }

  function mountLights(text) {
    removeLights();
    var doc;
    try {
      doc = new DOMParser().parseFromString(text, "image/svg+xml");
    } catch (e) {
      return;
    }
    var svg = doc.querySelector("svg");
    if (!svg || !overlay) return;
    var node = document.importNode(svg, true);
    node.id = "closed-status-lights";
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("data-slot", String(slot));
    var paths = node.querySelectorAll("path");
    if (!paths || paths.length < 2) return;
    lightPaths = [paths[0], paths[1]];
    if (art && art.parentNode === overlay) overlay.insertBefore(node, art.nextSibling);
    else overlay.appendChild(node);
    lightSvg = node;
    overlay.classList.add("is-lightshow");
  }

  function syncLights() {
    var want = !!(christmasOn() && closed && readLightshow() && slot >= 1 && slot <= 3);
    if (!want) {
      removeLights();
      return;
    }
    if (lightSvg && lightSvg.getAttribute("data-slot") === String(slot)) {
      paintLights(lightHoldMs != null ? lightHoldMs : Date.now());
      return;
    }
    var req = ++lightReq;
    var src = xmasBigSrc();
    fetch(src, { cache: "force-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("lights " + res.status);
        return res.text();
      })
      .then(function (text) {
        if (req !== lightReq) return;
        if (!(christmasOn() && closed && readLightshow())) return;
        mountLights(text);
        paintLights(lightHoldMs != null ? lightHoldMs : Date.now());
        console.info("[TokiMenu closed] lightshow", slot);
      })
      .catch(function (err) {
        console.warn("[TokiMenu closed] lightshow", err);
      });
  }

  function ensureOverlay() {
    var stage = $("stage");
    if (!stage) return null;
    overlay = $("closed-status");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "closed-status";
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("role", "img");
      overlay.setAttribute("aria-label", "Closed");
      art = document.createElement("img");
      art.id = "closed-status-art";
      art.alt = "Closed";
      art.draggable = false;
      overlay.appendChild(art);
      stage.appendChild(overlay);
    } else {
      art = $("closed-status-art") || overlay.querySelector("img");
    }
    if (slot === 4 && !front) {
      front = document.createElement("img");
      front.id = "closed-status-front";
      front.alt = "";
      front.draggable = false;
      front.hidden = true;
      overlay.appendChild(front);
    }
    overlay.setAttribute("data-board", String(slot));
    syncArt();
    return overlay;
  }

  function halloweenOn() {
    var H = root.TOKI_HALLOWEEN;
    if (H && typeof H.urlThemeOverride === "function" && H.isHalloween(H.urlThemeOverride())) {
      return true;
    }
    if (document.body && document.body.classList.contains("theme-halloween")) {
      return true;
    }
    try {
      var raw = localStorage.getItem("tokiLastPaint");
      var lp = raw ? JSON.parse(raw) : null;
      if (H && lp && H.isHalloween(lp.themeName)) return true;
    } catch (e) {}
    return false;
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
    try {
      var raw = localStorage.getItem("tokiLastPaint");
      var lp = raw ? JSON.parse(raw) : null;
      if (lp && C.isChristmas(lp.themeName)) return true;
    } catch (e) {}
    return false;
  }

  function xmasBigSrc() {
    if (slot === 4) return "assets/closed/closed-x-4-big.svg?v=" + XMAS_VER;
    return "assets/closed/closed-x-" + slot + ".svg?v=" + XMAS_VER;
  }

  function xmasFrontSrc() {
    return "assets/closed/closed-x-4-front.svg?v=" + XMAS_VER;
  }

  function artSrc() {
    if (christmasOn()) return xmasBigSrc();
    var H = root.TOKI_HALLOWEEN;
    if (H && typeof H.closedArtUrl === "function") {
      return H.closedArtUrl(slot, halloweenOn());
    }
    return ART_BASE + slot + ".svg?v=" + ART_VER;
  }

  function syncArt() {
    if (!art) return;
    var xmas = christmasOn();
    if (overlay) overlay.classList.toggle("is-xmas", xmas);
    var next = artSrc();
    if (art.getAttribute("src") !== next) art.src = next;
    if (front) {
      if (xmas) {
        var fsrc = xmasFrontSrc();
        if (front.getAttribute("src") !== fsrc) front.src = fsrc;
        front.hidden = false;
      } else {
        front.hidden = true;
      }
    }
    if (xmas && closed) startSnow();
    else stopSnow();
    syncLights();
  }

  function setWeatherRunning(on) {
    var wx = root.TOKI_WEATHER_WIDGET;
    if (!wx) return;
    try {
      if (on) {
        if (typeof wx.start === "function") wx.start();
      } else if (typeof wx.stop === "function") {
        wx.stop();
      }
    } catch (e) {}
  }

  function emitClosed(next) {
    try {
      window.dispatchEvent(
        new CustomEvent("toki:closed-change", {
          detail: { closed: next, board: slot },
        })
      );
    } catch (e) {}
  }

  function applyClosed(next) {
    next = !!next;
    closed = next;
    root.TOKI_STORE_CLOSED = next;
    if (document.body) {
      document.body.classList.toggle("store-closed", next);
    }
    if (!overlay) ensureOverlay();
    if (overlay) {
      overlay.hidden = !next;
      overlay.setAttribute("aria-hidden", next ? "false" : "true");
    }
    setWeatherRunning(!next);
    syncArt();
    if (lastClosed === next) return;
    lastClosed = next;
    console.info(
      "[TokiMenu closed] board",
      slot,
      next ? "CLOSED overlay on" : "open — overlay off"
    );
    emitClosed(next);
  }

  function desiredClosed() {
    var force = readForceClosed();
    if (force != null) return force;
    return !storeIsOpen();
  }

  function tickClosed() {
    applyClosed(desiredClosed());
    scheduleCheck();
  }

  function scheduleCheck() {
    if (checkTimer) window.clearTimeout(checkTimer);
    var wait = readForceClosed() != null ? HOURS_MS : msUntilBoundary();
    checkTimer = window.setTimeout(function () {
      checkTimer = 0;
      tickClosed();
    }, wait);
  }

  function start() {
    if (started) return;
    if (!$("stage")) return;
    started = true;
    slot = boardSlot();
    frozenNow = readFrozenNow();
    ensureOverlay();
    tickClosed();
    fetchHours();
    hoursTimer = window.setInterval(function () {
      fetchHours();
    }, HOURS_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      tickClosed();
      fetchHours();
    });
    window.addEventListener("toki:theme-change", function () {
      lightColorCache = null;
      lightColorKey = "";
      syncArt();
    });
  }

  function stop() {
    if (hoursTimer) window.clearInterval(hoursTimer);
    if (checkTimer) window.clearTimeout(checkTimer);
    hoursTimer = 0;
    checkTimer = 0;
    started = false;
  }

  root.TOKI_CLOSED_STATUS = {
    start: start,
    stop: stop,
    isClosed: function () {
      return !!closed;
    },
    boardSlot: function () {
      return slot;
    },
    refreshHours: fetchHours,
    syncArt: syncArt,
    lightshowOn: readLightshow,
    lightState: function (nowMs) {
      return describeLights(nowMs == null ? Date.now() : nowMs);
    },
    holdLights: function (nowMs) {
      lightHoldMs = nowMs;
      paintLights(nowMs);
      return describeLights(nowMs);
    },
    releaseLights: function () {
      lightHoldMs = null;
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

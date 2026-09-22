/**
 * TokiMenu — Closed Status overlay (all four boards).
 *
 * Mockup: vault Mockups/Closed Status Mockup (Closed 1–4.svg + Closed Status.pdf).
 * When Store Hours say the shop is closed, each board paints its static SVG
 * (CL / OS / ED / bunny+hours) and asks the menu runtime to halt galaxy pan,
 * presentation, stripes, and weather work. Opens again on the next service
 * window. Independent of the catalog Google load.
 *
 * QA: ?closed=1 force on, ?closed=0 force off, ?wxNow= / ?hoursAt= freeze
 * America/New_York (same codes as the Weather Widget).
 */
(function (root) {
  "use strict";

  var TZ = "America/New_York";
  var HOURS_MS = 10 * 60 * 1000;
  var CHECK_CAP_MS = 5000;
  var WEEK_MIN = 7 * 1440;
  var STORE_HOURS_GID = "1732597216";
  var ART_BASE = "assets/closed/closed-";

  var started = false;
  var closed = false;
  var hoursTimer = 0;
  var checkTimer = 0;
  var frozenNow = null;
  var hoursSchedule = defaultHours();
  var overlay = null;
  var art = null;
  var lastClosed = null;
  var slot = 1;

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
    var earlyOpen = 11 * 60 + 30;
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
        var h = String(header[i] || "").toLowerCase();
        if (h.indexOf("day") !== -1) dayCol = i;
        if (h.indexOf("open") !== -1) openCol = i;
        if (h.indexOf("close") !== -1) closeCol = i;
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
    overlay.setAttribute("data-board", String(slot));
    if (art && !art.getAttribute("src")) {
      art.src = ART_BASE + slot + ".svg";
    }
    return overlay;
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
  };

  if ($("stage")) {
    start();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(window);

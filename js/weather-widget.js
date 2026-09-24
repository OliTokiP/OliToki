/**
 * TokiMenu — Board 4 Weather Widget (photo-side HUD).
 *
 * Mockup: vault Mockups/Weather Widget Mockup.pdf @ 1920×1080.
 * Live clock + hours in America/New_York. Hours come from OliToki Menu
 * Settings → Store Hours (close past 24:00 stays on that service day until
 * that close). Current °F + animated amCharts SVG from Open-Meteo.
 *
 * Attribution: weather data © Open-Meteo (https://open-meteo.com).
 * Icons © amCharts, CC BY 4.0 (assets/amcharts_weather_icons_1.0.0/LICENSE).
 */
(function (root) {
  "use strict";

  var TZ = "America/New_York";
  var LAT = 42.353;
  var LON = -71.133;
  var WEATHER_MS = 10 * 60 * 1000;
  var HOURS_MS = 10 * 60 * 1000;
  var CLOCK_MS = 1000;
  var WEEK_MIN = 7 * 1440;
  var STORE_HOURS_GID = "1732597216";
  var ICON_BASE = "assets/amcharts_weather_icons_1.0.0/";
  var API =
    "https://api.open-meteo.com/v1/forecast" +
    "?latitude=" +
    LAT +
    "&longitude=" +
    LON +
    "&current=temperature_2m,weather_code,is_day" +
    "&temperature_unit=fahrenheit" +
    "&timezone=" +
    encodeURIComponent(TZ);

  var els = {};
  var clockTimer = 0;
  var weatherTimer = 0;
  var hoursTimer = 0;
  var lastDateKey = "";
  var lastTimeKey = "";
  var lastIcon = "";
  var svgCache = {};
  var started = false;
  var frozenNow = null;
  var hoursSchedule = defaultHours();

  function $(id) {
    return document.getElementById(id);
  }

  function isPreviewWall() {
    try {
      if (
        document.body &&
        document.body.classList.contains("preview-wall")
      ) {
        return true;
      }
      return (
        new URLSearchParams(location.search).get("preview") === "all"
      );
    } catch (e) {
      return false;
    }
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

  function settingsSheetId() {
    var fromWin =
      root.TOKI_SETTINGS_SHEET_ID && String(root.TOKI_SETTINGS_SHEET_ID).trim();
    return fromWin || "1OwNKHzjP46xKJBW8sTm4IOWhIzf0lENdZ8rv_GY37fY";
  }

  function partsNow() {
    var now = nowDate();
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      hourCycle: "h12",
    }).formatToParts(now);
    var map = {};
    for (var i = 0; i < parts.length; i++) {
      map[parts[i].type] = parts[i].value;
    }
    return map;
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
        if (row.some(function (c) {
          return String(c).trim() !== "";
        })) {
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
    if (row.some(function (c) {
      return String(c).trim() !== "";
    })) {
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

  function formatUntil(closeMin) {
    var m = ((closeMin % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60);
    var min = m % 60;
    var period = h >= 12 ? "PM" : "AM";
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ":" + (min < 10 ? "0" : "") + min + " " + period;
  }

  function hour24FromParts(map) {
    var h = parseInt(map.hour, 10);
    var p = String(map.dayPeriod || "").toLowerCase().replace(/\./g, "");
    if (!Number.isFinite(h)) return 0;
    if (h === 24) return 0;
    if (p.indexOf("am") !== -1) return h === 12 ? 0 : h;
    if (p.indexOf("pm") !== -1) return h === 12 ? 12 : h + 12;
    return h;
  }

  function inServiceWindow(nowMin, start, end) {
    return (
      (nowMin >= start && nowMin <= end) ||
      (nowMin + WEEK_MIN >= start && nowMin + WEEK_MIN <= end)
    );
  }

  function activeHours(hours, weekday, hour24, minute) {
    var list = hours && hours.length ? hours : defaultHours();
    var nowMin = weekday * 1440 + hour24 * 60 + minute;
    var i;
    var row;
    var start;
    var end;
    for (i = 0; i < list.length; i++) {
      row = list[i];
      start = row.day * 1440 + row.openMin;
      end = row.day * 1440 + row.closeMin;
      if (inServiceWindow(nowMin, start, end)) return row;
    }
    var best = null;
    var bestWait = Infinity;
    var wait;
    for (i = 0; i < list.length; i++) {
      row = list[i];
      start = row.day * 1440 + row.openMin;
      wait = start - nowMin;
      if (wait < 0) wait += WEEK_MIN;
      if (wait < bestWait) {
        bestWait = wait;
        best = row;
      }
    }
    return best;
  }

  function openUntil(p) {
    var weekday = weekdayIndex(p.weekday);
    if (weekday < 0) weekday = 0;
    var hour24 = hour24FromParts(p);
    var minute = parseInt(p.minute, 10);
    if (!Number.isFinite(minute)) minute = 0;
    var row = activeHours(hoursSchedule, weekday, hour24, minute);
    if (!row) return "10:30 PM";
    return formatUntil(row.closeMin);
  }

  function paintDate(p) {
    var dateLine =
      p.weekday + ", " + p.month + " " + p.day + ", " + p.year;
    var until = openUntil(p);
    var key = dateLine + "|" + until;
    if (key === lastDateKey) return;
    lastDateKey = key;
    var host = els.date;
    if (!host) return;
    host.textContent = "";
    host.appendChild(document.createTextNode(dateLine + " "));
    var open = document.createElement("span");
    open.className = "weather-open";
    var l = document.createElement("span");
    l.className = "weather-paren";
    l.textContent = "(";
    var r = document.createElement("span");
    r.className = "weather-paren";
    r.textContent = ")";
    open.appendChild(l);
    open.appendChild(document.createTextNode("Open until " + until));
    open.appendChild(r);
    host.appendChild(open);
  }

  function paintTime(p) {
    var t = (p.hour || "") + ":" + (p.minute || "00") + " " + (p.dayPeriod || "");
    t = t.replace(/\s+/g, " ").trim();
    if (t === lastTimeKey) return;
    lastTimeKey = t;
    if (els.time) els.time.textContent = t;
  }

  function tickClock() {
    var p = partsNow();
    paintDate(p);
    paintTime(p);
  }

  function iconName(code, isDay) {
    var n = Number(code);
    var day = Number(isDay) === 1;
    if (n === 0) return day ? "day" : "night";
    if (n === 1) return day ? "cloudy-day-1" : "cloudy-night-1";
    if (n === 2) return day ? "cloudy-day-2" : "cloudy-night-2";
    if (n === 3 || n === 45 || n === 48) return "cloudy";
    if (n === 51 || n === 53 || n === 56) return "rainy-1";
    if (n === 55 || n === 57) return "rainy-2";
    if (n === 61 || n === 80) return "rainy-3";
    if (n === 63 || n === 81) return "rainy-4";
    if (n === 65 || n === 82) return "rainy-6";
    if (n === 66 || n === 67) return "rainy-7";
    if (n === 71 || n === 85) return "snowy-1";
    if (n === 73) return "snowy-3";
    if (n === 75 || n === 77 || n === 86) return "snowy-5";
    if (n === 95 || n === 96 || n === 99) return "thunder";
    return day ? "day" : "night";
  }

  function uniqueSvgIds(svgText) {
    var prefix = "wx-" + Math.random().toString(36).slice(2, 8) + "-";
    return String(svgText)
      .replace(/\sviewbox=/gi, " viewBox=")
      .replace(/\sid="([^"]+)"/g, function (_, id) {
        return ' id="' + prefix + id + '"';
      })
      .replace(/url\(#([^)]+)\)/g, function (_, id) {
        return "url(#" + prefix + id + ")";
      });
  }

  function loadSvg(name) {
    var folder = isPreviewWall() ? "static" : "animated";
    var url = ICON_BASE + folder + "/" + name + ".svg";
    if (svgCache[url]) return svgCache[url];
    svgCache[url] = fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("icon " + res.status);
        return res.text();
      })
      .catch(function () {
        if (folder === "animated") {
          var fallback = ICON_BASE + "static/" + name + ".svg";
          return fetch(fallback).then(function (res) {
            if (!res.ok) throw new Error("icon fallback " + res.status);
            return res.text();
          });
        }
        throw new Error("icon missing");
      });
    return svgCache[url];
  }

  function paintIcon(name) {
    if (!els.icon) return;
    if (name === lastIcon && els.icon.childNodes.length) return;
    lastIcon = name;
    loadSvg(name)
      .then(function (text) {
        if (lastIcon !== name) return;
        els.icon.innerHTML = uniqueSvgIds(text);
        var svg = els.icon.querySelector("svg");
        if (svg) {
          svg.removeAttribute("width");
          svg.removeAttribute("height");
          svg.setAttribute("aria-hidden", "true");
        }
      })
      .catch(function (err) {
        console.warn("[TokiMenu weather] icon", name, err);
      });
  }

  function paintWeather(tempF, code, isDay) {
    var rounded = Math.round(Number(tempF));
    if (els.temp) {
      els.temp.textContent =
        (Number.isFinite(rounded) ? String(rounded) : "—") + "°F";
    }
    if (els.weather) els.weather.hidden = false;
    if (Number.isFinite(Number(code))) paintIcon(iconName(code, isDay));
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
    lastDateKey = "";
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
      })
      .catch(function (err) {
        console.warn("[TokiMenu weather] Store Hours", err);
      });
  }

  function fetchWeather() {
    return fetch(API, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("weather " + res.status);
        return res.json();
      })
      .then(function (data) {
        var cur = data && data.current ? data.current : {};
        paintWeather(cur.temperature_2m, cur.weather_code, cur.is_day);
      })
      .catch(function (err) {
        console.warn("[TokiMenu weather] Open-Meteo", err);
      });
  }

  function cacheEls() {
    els.root = $("weather-widget");
    els.date = $("weather-date");
    els.time = $("weather-time");
    els.weather = $("weather-conditions");
    els.icon = $("weather-icon");
    els.temp = $("weather-temp");
    return !!(els.root && els.date && els.time);
  }

  function start() {
    if (started) return;
    if (!cacheEls()) return;
    started = true;
    frozenNow = readFrozenNow();
    els.root.hidden = false;
    tickClock();
    fetchHours().then(function () {
      tickClock();
    });
    fetchWeather();
    clockTimer = window.setInterval(tickClock, CLOCK_MS);
    weatherTimer = window.setInterval(fetchWeather, WEATHER_MS);
    hoursTimer = window.setInterval(function () {
      fetchHours().then(function () {
        tickClock();
      });
    }, HOURS_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      tickClock();
      fetchHours().then(function () {
        tickClock();
      });
      fetchWeather();
    });
  }

  function stop() {
    if (clockTimer) window.clearInterval(clockTimer);
    if (weatherTimer) window.clearInterval(weatherTimer);
    if (hoursTimer) window.clearInterval(hoursTimer);
    clockTimer = 0;
    weatherTimer = 0;
    hoursTimer = 0;
    started = false;
  }

  root.TOKI_WEATHER_WIDGET = {
    start: start,
    stop: stop,
    refresh: fetchWeather,
    refreshHours: fetchHours,
    activeUntilFor: function (date) {
      var prev = frozenNow;
      frozenNow = date ? new Date(date) : null;
      var until = openUntil(partsNow());
      frozenNow = prev;
      return until;
    },
  };

  if (document.getElementById("weather-widget")) {
    start();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  }
})(window);

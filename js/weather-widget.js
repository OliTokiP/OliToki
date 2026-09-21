/**
 * TokiMenu — Board 4 Weather Widget (photo-side HUD).
 *
 * Mockup: vault Mockups/Weather Widget Mockup.pdf @ 1920×1080.
 * Live clock + hours in America/New_York. Current °F + animated amCharts SVG
 * from Open-Meteo (no API key; CC weather icons in assets/).
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
  var CLOCK_MS = 1000;
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
  var lastDateKey = "";
  var lastTimeKey = "";
  var lastIcon = "";
  var svgCache = {};
  var started = false;

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

  function partsNow() {
    var now = new Date();
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
    var n = (name || "").toLowerCase();
    if (n.indexOf("sun") === 0) return 0;
    if (n.indexOf("mon") === 0) return 1;
    if (n.indexOf("tue") === 0) return 2;
    if (n.indexOf("wed") === 0) return 3;
    if (n.indexOf("thu") === 0) return 4;
    if (n.indexOf("fri") === 0) return 5;
    if (n.indexOf("sat") === 0) return 6;
    return 0;
  }

  /** Thu / Fri / Sat close 1:30 AM; Sun–Wed close 10:30 PM (mockup). */
  function openUntil(weekdayName) {
    var d = weekdayIndex(weekdayName);
    return d === 4 || d === 5 || d === 6 ? "1:30 AM" : "10:30 PM";
  }

  function paintDate(p) {
    var dateLine =
      p.weekday + ", " + p.month + " " + p.day + ", " + p.year;
    var until = openUntil(p.weekday);
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
    els.root.hidden = false;
    tickClock();
    fetchWeather();
    clockTimer = window.setInterval(tickClock, CLOCK_MS);
    weatherTimer = window.setInterval(fetchWeather, WEATHER_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      tickClock();
      fetchWeather();
    });
  }

  function stop() {
    if (clockTimer) window.clearInterval(clockTimer);
    if (weatherTimer) window.clearInterval(weatherTimer);
    clockTimer = 0;
    weatherTimer = 0;
    started = false;
  }

  root.TOKI_WEATHER_WIDGET = {
    start: start,
    stop: stop,
    refresh: fetchWeather,
  };

  if (document.getElementById("weather-widget")) {
    start();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  }
})(window);

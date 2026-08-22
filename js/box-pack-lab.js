/**
 * Inquiry lab for footer wrap packing. Snapshot of the live scorer in menu.js
 * (balanceItemsIntoLines / packLptLines / packGreedyByWidth) plus a side-by-side
 * width compare. Does not drive the TV boards unless you open this page.
 */
(function () {
  "use strict";

  var VEGGIES_FALLBACK = [
    { name: "Veggie Stirfry Mix" },
    { name: "Fresh Broccoli" },
    { name: "Mixed Greens" },
    { name: "Lettuce" },
    { name: "Shredded Carrot" },
    { name: "Tangy Cucumbers" },
    { name: "Vegan Kimchi" },
    { name: "Onion-Cilantro Mix" },
    { name: "Corn" },
    { name: "Crispy Corn", subtitle: "Seasoned" },
    { name: "Black Beans" },
  ];

  var WIDTHS = [
    { id: "one", label: "One box · 1082", width: 1082, className: "footer-one" },
    { id: "major", label: "Two-box major · 768", width: 768, className: "footer-two-major" },
    { id: "third", label: "Three-box third · 351", width: 351, className: "footer-three" },
    { id: "minor", label: "Two-box minor · 299", width: 299, className: "footer-two-minor" },
  ];

  var _probe = null;
  var _items = VEGGIES_FALLBACK.slice();
  var _count = VEGGIES_FALLBACK.length;
  var _mode = "auto";
  var _overlay = true;

  function measureTextPx(text, font) {
    var str = String(text || "");
    var fontStr = font || "700 32px Poppins, Roboto, sans-serif";
    if (!_probe) {
      _probe = document.createElement("span");
      _probe.setAttribute("aria-hidden", "true");
      _probe.style.cssText =
        "position:absolute;left:-99999px;top:0;white-space:nowrap;" +
        "visibility:hidden;pointer-events:none;margin:0;padding:0;border:0;" +
        "letter-spacing:-0.015em;";
      document.body.appendChild(_probe);
    }
    _probe.style.font = fontStr;
    _probe.textContent = str;
    var w = _probe.offsetWidth;
    return w > 0 ? w : str.length * 10;
  }

  function packLptLines(items, lineCount, sepW) {
    var lines = [];
    var i;
    for (i = 0; i < lineCount; i++) lines.push({ items: [], width: 0 });
    var sorted = items.slice().sort(function (a, b) {
      if (b.width !== a.width) return b.width - a.width;
      return a.idx - b.idx;
    });
    for (var s = 0; s < sorted.length; s++) {
      var it = sorted[s];
      var best = lines[0];
      for (i = 1; i < lines.length; i++) {
        if (lines[i].width < best.width) best = lines[i];
      }
      best.width += it.width + (best.items.length ? sepW : 0);
      best.items.push(it);
    }
    lines.forEach(function (line) {
      line.items.sort(function (a, b) {
        return a.idx - b.idx;
      });
      line.width = 0;
      for (i = 0; i < line.items.length; i++) {
        line.width += line.items[i].width + (i ? sepW : 0);
      }
    });
    sortPackedLinesFullestFirst(lines);
    return lines.filter(function (ln) {
      return ln.items.length > 0;
    });
  }

  function sortPackedLinesFullestFirst(lines) {
    lines.sort(function (a, b) {
      if (!a.items.length) return 1;
      if (!b.items.length) return -1;
      if (Math.abs(b.width - a.width) > 0.5) return b.width - a.width;
      return a.items[0].idx - b.items[0].idx;
    });
    return lines;
  }

  function packGreedyByWidth(items, sepW, boxW) {
    var lines = [];
    var cur = { items: [], width: 0 };
    var limit = Math.max(1, boxW);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var add = it.width + (cur.items.length ? sepW : 0);
      if (cur.items.length && cur.width + add > limit) {
        lines.push(cur);
        cur = { items: [], width: 0 };
      }
      cur.width += (cur.items.length ? sepW : 0) + it.width;
      cur.items.push(it);
    }
    if (cur.items.length) lines.push(cur);
    sortPackedLinesFullestFirst(lines);
    return lines;
  }

  function balanceItemsIntoLines(rawItems, opts) {
    var list = rawItems || [];
    var n = list.length;
    if (!n) return { lines: [], meta: {}, candidates: [] };
    if (n === 1) {
      return {
        lines: [list.slice()],
        meta: { tag: "single", L: 1, fill: 1, typeScore: 1 },
        candidates: [],
      };
    }
    var o = opts || {};
    var font = o.font || "700 29.44px Poppins, Roboto, sans-serif";
    var sepText = o.sepText != null ? o.sepText : " · ";
    var sepW = measureTextPx(sepText, font);
    var boxW = Math.max(1, o.containerWidth || 280);
    var boxH = Math.max(1, o.containerHeight || 119);
    var lineH = Math.max(8, o.lineHeight || 37);
    var maxLines = Math.min(n, Math.max(1, o.maxLines || 8));
    var WIDTH_PAD = 1.08;
    var items = list.map(function (it, idx) {
      var label = it.name || "";
      if (it.subtitle) label += " (" + it.subtitle + ")";
      return {
        idx: idx,
        width: Math.max(1, measureTextPx(label, font) * WIDTH_PAD),
        raw: it,
      };
    });
    var bestLines = null;
    var bestScore = -Infinity;
    var bestType = -Infinity;
    var bestTag = "";
    var bestFill = 0;
    var candidates = [];
    var forceL =
      o.forceLines > 0
        ? Math.min(maxLines, Math.max(1, Math.round(Number(o.forceLines))))
        : 0;

    function considerPacked(packed, tag) {
      if (!packed || !packed.length) return;
      var maxW = 0;
      var minW = Infinity;
      var sumW = 0;
      var i;
      for (i = 0; i < packed.length; i++) {
        if (packed[i].width > maxW) maxW = packed[i].width;
        if (packed[i].width < minW) minW = packed[i].width;
        sumW += packed[i].width;
      }
      if (maxW < 1) maxW = 1;
      if (minW === Infinity) minW = maxW;
      var scaleW = boxW / maxW;
      var scaleH = boxH / (packed.length * lineH);
      var balance = minW / maxW;
      var fill = Math.min(1, maxW / boxW);
      var avgFill = Math.min(1, sumW / (packed.length * boxW));
      var typeScore = Math.min(scaleW, scaleH);
      var L = packed.length;
      var score =
        typeScore * (0.58 + 0.12 * balance + 0.3 * fill) - L * 0.008;
      var lines = packed.map(function (ln) {
        return ln.items.map(function (it) {
          return it.raw;
        });
      });
      candidates.push({
        tag: tag,
        L: L,
        score: score,
        typeScore: typeScore,
        fill: fill,
        avgFill: avgFill,
        balance: balance,
        maxW: maxW,
        minW: minW,
        lines: lines,
      });
      if (score > bestScore) {
        bestScore = score;
        bestType = typeScore;
        bestLines = lines;
        bestTag = tag;
        bestFill = fill;
      }
    }

    if (forceL) {
      considerPacked(packLptLines(items, forceL, sepW), "lpt-" + forceL);
    } else {
      for (var L = 1; L <= maxLines; L++) {
        considerPacked(packLptLines(items, L, sepW), "lpt-" + L);
      }
      considerPacked(packGreedyByWidth(items, sepW, boxW * 0.96), "greedy");
      considerPacked(packGreedyByWidth(items, sepW, boxW * 0.88), "greedy-tight");
      if (candidates.length && bestType > 0) {
        var pick = null;
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (c.typeScore < bestType * 0.92) continue;
          if (
            !pick ||
            c.fill > pick.fill + 0.03 ||
            (Math.abs(c.fill - pick.fill) <= 0.03 && c.L < pick.L) ||
            (Math.abs(c.fill - pick.fill) <= 0.03 &&
              c.L === pick.L &&
              c.score > pick.score)
          ) {
            pick = c;
          }
        }
        if (pick) {
          bestLines = pick.lines;
          bestScore = pick.score;
          bestTag = (pick.tag || "?") + "*";
          bestFill = pick.fill;
          bestType = pick.typeScore;
        }
      }
    }

    if (!bestLines) bestLines = [list.slice()];
    return {
      lines: bestLines,
      meta: {
        tag: bestTag,
        L: bestLines.length,
        fill: bestFill,
        typeScore: bestType,
        score: bestScore,
        boxW: Math.round(boxW),
      },
      candidates: candidates,
    };
  }

  function parsePadXY(cs) {
    return {
      x: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0),
      y: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0),
    };
  }

  function fitBoxScale(el, minS, maxS) {
    function fits(scale) {
      el.style.setProperty("--box-scale", String(scale));
      void el.offsetHeight;
      if (el.scrollHeight > el.clientHeight + 1) return false;
      var pad = parsePadXY(getComputedStyle(el));
      var contentW = Math.max(1, el.clientWidth - pad.x);
      for (var i = 0; i < el.children.length; i++) {
        var child = el.children[i];
        if (child.classList.contains("box-pack-lab-waste")) continue;
        if (child.classList.contains("wrap-line-break")) continue;
        if (child.offsetWidth > contentW + 1) return false;
      }
      return true;
    }
    var lo = minS;
    var hi = maxS;
    var best = minS;
    if (!fits(lo)) {
      var s = lo;
      while (s > 0.3 && !fits(s)) s -= 0.02;
      best = Math.max(0.3, s);
      el.style.setProperty("--box-scale", String(best));
      return best;
    }
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      if (fits(mid)) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    best = Math.max(minS, best * 0.97);
    var guard = 0;
    while (!fits(best) && best > minS && guard < 40) {
      best -= 0.015;
      guard++;
    }
    fits(best);
    return best;
  }

  function paintWaste(body) {
    body.querySelectorAll(".box-pack-lab-waste").forEach(function (n) {
      n.remove();
    });
    if (!_overlay) return;
    var cs = getComputedStyle(body);
    var pl = parseFloat(cs.paddingLeft) || 0;
    var pr = parseFloat(cs.paddingRight) || 0;
    var contentW = Math.max(1, body.clientWidth - pl - pr);
    var kids = Array.prototype.slice.call(body.children).filter(function (el) {
      return !el.classList.contains("box-pack-lab-waste");
    });
    var line = [];
    var lines = [];
    function flush() {
      if (line.length) lines.push(line);
      line = [];
    }
    kids.forEach(function (el) {
      if (el.classList.contains("wrap-line-break")) {
        flush();
        return;
      }
      line.push(el);
    });
    flush();
    var bodyRect = body.getBoundingClientRect();
    lines.forEach(function (elsLine) {
      if (!elsLine.length) return;
      var lineW = 0;
      var top = Infinity;
      var bottom = -Infinity;
      elsLine.forEach(function (el) {
        lineW += el.offsetWidth;
        var r = el.getBoundingClientRect();
        if (r.top < top) top = r.top;
        if (r.bottom > bottom) bottom = r.bottom;
      });
      var leftover = contentW - lineW;
      if (leftover < 8) return;
      var each = leftover / 2;
      var localTop = Math.max(0, top - bodyRect.top);
      var h = Math.max(8, bottom - top);
      function waste(x, w) {
        if (w < 6) return;
        var d = document.createElement("div");
        d.className = "box-pack-lab-waste";
        d.style.cssText =
          "position:absolute;z-index:4;pointer-events:none;" +
          "background:rgba(220,32,32,0.38);left:" +
          Math.round(x) +
          "px;top:" +
          Math.round(localTop) +
          "px;width:" +
          Math.round(w) +
          "px;height:" +
          Math.round(h) +
          "px;";
        body.appendChild(d);
      }
      waste(pl, each);
      waste(pl + each + lineW, each);
    });
  }

  function renderBox(slot, items, packed) {
    var body = slot.querySelector(".info-box-body");
    body.innerHTML = "";
    body.style.setProperty("--box-scale", "1");
    body.classList.remove("lines-1", "lines-2", "lines-3", "lines-4", "lines-many");
    var lc = packed.lines.length || 1;
    body.classList.add(lc >= 5 ? "lines-many" : "lines-" + lc);
    packed.lines.forEach(function (line, li) {
      line.forEach(function (it, i) {
        var span = document.createElement("span");
        span.className = "veggie-item wrap-item";
        var name = document.createElement("span");
        name.className = "box-item-name";
        name.textContent = it.name || "";
        span.appendChild(name);
        if (it.subtitle) {
          var sub = document.createElement("span");
          sub.className = "item-paren-sub box-item-sub";
          sub.textContent = " (" + it.subtitle + ")";
          span.appendChild(sub);
        }
        body.appendChild(span);
        if (i < line.length - 1) {
          var sep = document.createElement("span");
          sep.className = "veggie-sep wrap-sep";
          sep.textContent = " · ";
          sep.setAttribute("aria-hidden", "true");
          body.appendChild(sep);
        }
      });
      if (li < packed.lines.length - 1) {
        var br = document.createElement("span");
        br.className = "veggie-line-break wrap-line-break";
        br.setAttribute("aria-hidden", "true");
        body.appendChild(br);
      }
    });
    var scale = fitBoxScale(body, 0.5, 2.2);
    paintWaste(body);
    var meta = packed.meta || {};
    var cap = slot.querySelector(".lab-meta");
    cap.textContent =
      meta.L +
      " lines · " +
      (meta.tag || "?") +
      " · scale " +
      scale.toFixed(3) +
      " · longest-row fill " +
      (meta.fill ? Math.round(meta.fill * 100) + "%" : "?");
    return packed.candidates;
  }

  function currentFont() {
    return "700 29.44px Poppins, Roboto, sans-serif";
  }

  function packForWidth(items, widthPx) {
    var padX = 20; // wrap padding 6/10/8 → 10+10
    var boxW = Math.max(1, (widthPx - padX) * 0.98);
    var force =
      _mode === "3" ? 3 : _mode === "4" ? 4 : 0;
    return balanceItemsIntoLines(items, {
      font: currentFont(),
      sepText: " · ",
      containerWidth: boxW,
      containerHeight: 119,
      lineHeight: 32 * 0.92 * 1.1 + 2,
      maxLines: 8,
      forceLines: force,
    });
  }

  function renderAll() {
    var items = _items.slice(0, _count);
    var tableHost = document.getElementById("lab-table");
    WIDTHS.forEach(function (w) {
      var slot = document.getElementById("slot-" + w.id);
      var packed = packForWidth(items, w.width);
      var cands = renderBox(slot, items, packed);
      if (w.id === "major") {
        renderTable(tableHost, cands, packed.meta);
      }
    });
    document.getElementById("lab-count-n").textContent = String(_count);
  }

  function renderTable(host, candidates, picked) {
    if (!host) return;
    var rows = (candidates || [])
      .slice()
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .map(function (c) {
        var on = c.tag === String(picked.tag || "").replace(/\*$/, "") ||
          c.tag + "*" === picked.tag;
        return (
          "<tr class=\"" +
          (on ? "is-pick" : "") +
          "\"><td>" +
          c.tag +
          "</td><td>" +
          c.L +
          "</td><td>" +
          c.typeScore.toFixed(3) +
          "</td><td>" +
          Math.round(c.fill * 100) +
          "%</td><td>" +
          Math.round(c.avgFill * 100) +
          "%</td><td>" +
          Math.round(c.balance * 100) +
          "%</td><td>" +
          c.score.toFixed(3) +
          "</td></tr>"
        );
      });
    host.innerHTML =
      "<table><thead><tr><th>pack</th><th>L</th><th>type</th><th>longest fill</th><th>avg fill</th><th>even</th><th>score</th></tr></thead><tbody>" +
      rows.join("") +
      "</tbody></table>" +
      "<p class=\"note\">Table is the 768 major slot (Handhelds Veggies today). Starred tag = live 8% re-pick. type = min(width scale, height scale). even = shortest/longest row.</p>";
  }

  function parseVeggiesCsv(text) {
    var lines = String(text || "").split(/\r?\n/);
    var start = -1;
    var i;
    for (i = 0; i < lines.length; i++) {
      if (/^item,/i.test(lines[i]) || /^item\t/i.test(lines[i])) {
        start = i + 1;
        break;
      }
    }
    if (start < 0) return null;
    var out = [];
    for (i = start; i < lines.length; i++) {
      var raw = lines[i];
      if (!raw || /^settings$/i.test(raw) || /^inventory$/i.test(raw)) continue;
      var cols = raw.split(",");
      var name = String(cols[0] || "").trim();
      if (!name) continue;
      var include = String(cols[5] != null ? cols[5] : cols[cols.length - 1] || "1").trim();
      if (include === "0" || /^false$/i.test(include)) continue;
      var sub = String(cols[1] || "").trim();
      out.push(sub ? { name: name, subtitle: sub } : { name: name });
    }
    return out.length ? out : null;
  }

  function bind() {
    var slider = document.getElementById("lab-count");
    slider.max = String(_items.length);
    slider.value = String(_count);
    slider.addEventListener("input", function () {
      _count = Number(slider.value) || 1;
      renderAll();
    });
    document.querySelectorAll("[data-mode]").forEach(function (b) {
      b.addEventListener("click", function () {
        _mode = b.getAttribute("data-mode") || "auto";
        document.querySelectorAll("[data-mode]").forEach(function (x) {
          x.classList.toggle("on", x === b);
        });
        renderAll();
      });
    });
    document.getElementById("lab-overlay").addEventListener("change", function (e) {
      _overlay = !!e.target.checked;
      renderAll();
    });
  }

  async function boot() {
    var nQ = 0;
    var scrollTo = "";
    try {
      var q = new URLSearchParams(location.search || "");
      if (q.get("packLines") === "3" || q.get("packLines") === "4") {
        _mode = q.get("packLines");
      }
      nQ = Number(q.get("n") || 0);
      scrollTo = String(q.get("scroll") || "").trim().toLowerCase();
    } catch (err) {}
    bind();
    document.querySelectorAll("[data-mode]").forEach(function (x) {
      x.classList.toggle("on", x.getAttribute("data-mode") === _mode);
    });
    try {
      var res = await fetch("/api/sheets/csv?gid=640368705");
      if (res.ok) {
        var parsed = parseVeggiesCsv(await res.text());
        if (parsed && parsed.length) {
          _items = parsed;
          document.getElementById("lab-source").textContent =
            "Live Veggies sheet · " + parsed.length + " items";
        }
      }
    } catch (e) {
      document.getElementById("lab-source").textContent =
        "Sheet unreachable — using the 11-item fallback from the ticket";
    }
    _count =
      nQ > 0 ? Math.min(_items.length, Math.max(1, nQ)) : _items.length;
    var slider = document.getElementById("lab-count");
    slider.max = String(_items.length);
    slider.value = String(_count);
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    renderAll();
    if (scrollTo) {
      window.setTimeout(function () {
        var target =
          scrollTo === "table"
            ? document.getElementById("lab-table")
            : document.getElementById("slot-" + scrollTo) ||
              document.getElementById(scrollTo);
        if (target && typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ block: "start" });
        } else if (scrollTo === "bottom") {
          window.scrollTo(0, document.documentElement.scrollHeight);
        }
      }, 80);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

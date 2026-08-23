/**
 * Inquiry lab UI for footer wrap packing.
 * Packing / fit live in js/box-pack.js (same module the TV boards load).
 */
(function () {
  "use strict";

  var Pack = window.TOKI_BOX_PACK;
  if (!Pack) {
    console.error("TOKI_BOX_PACK missing — load js/box-pack.js first");
    return;
  }

  var KINDS = {
    protein: {
      id: "protein",
      label: "Proteins",
      gid: "1420775786",
      boxId: "protein-box",
      bodyId: "protein-body",
      wrapItemClass: "protein-wrap-item",
      sepClass: "protein-wrap-sep",
      breakClass: "protein-line-break",
      fallback: [
        { name: "Soy Garlic Chicken", price: "0.50" },
        { name: "Bulgogi Beef", price: "2.95" },
        { name: "Fried Spam", price: "1.75" },
        { name: "Chipotle Pulled Pork", price: "1.75" },
        { name: "Crispy Tofu", price: "0.45" },
        { name: "Fried Egg", price: "1.99" },
      ],
    },
    sauces: {
      id: "sauces",
      label: "Sauces",
      gid: "1630545949",
      boxId: "sauces-box",
      bodyId: "sauces-body",
      wrapItemClass: "sauce-item",
      sepClass: "sauce-sep",
      breakClass: "sauce-line-break",
      fallback: [
        { name: "BBQ" },
        { name: "Soy Vinegar" },
        { name: "House Teriyaki" },
        { name: "Ketchup" },
        { name: "Ranch" },
        { name: "Sriracha" },
        { name: "Guacamole", subtitle: "Ramen Seasoned" },
        { name: "Ai-Oli" },
        { name: "Spicy Toki" },
        { name: "GF Creamy Sesame" },
      ],
    },
    drinks: {
      id: "drinks",
      label: "Drinks",
      gid: "1145721787",
      boxId: "footer-drinks-box",
      bodyId: "footer-drinks-body",
      wrapItemClass: "footer-drink-item",
      sepClass: "footer-drink-sep",
      breakClass: "footer-drink-line-break",
      fallback: [
        { name: "Coca-Cola" },
        { name: "Diet Coke" },
        { name: "Sprite" },
        { name: "Fanta" },
        { name: "Shikye" },
        { name: "Soy Milk" },
        { name: "Ramune" },
      ],
    },
    veggies: {
      id: "veggies",
      label: "Veggies",
      gid: "640368705",
      boxId: "veggies-box",
      bodyId: "veggies-body",
      wrapItemClass: "veggie-item",
      sepClass: "veggie-sep",
      breakClass: "veggie-line-break",
      fallback: [
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
      ],
    },
  };

  var WIDTHS = [
    { id: "one", label: "One box · 1082", width: 1082, className: "footer-one" },
    { id: "major", label: "Two-box major · 768", width: 768, className: "footer-two-major" },
    { id: "third", label: "Three-box third · 351", width: 351, className: "footer-three" },
    { id: "minor", label: "Two-box minor · 299", width: 299, className: "footer-two-minor" },
  ];

  var _catalog = {
    protein: { items: KINDS.protein.fallback.slice(), title: "Proteins", source: "fallback" },
    sauces: { items: KINDS.sauces.fallback.slice(), title: "Sauces", source: "fallback" },
    drinks: { items: KINDS.drinks.fallback.slice(), title: "Drinks", source: "fallback" },
    veggies: { items: KINDS.veggies.fallback.slice(), title: "Veggies", source: "fallback" },
  };
  var _kind = "veggies";
  var _font = "poppins";
  var _count = 11;
  var _mode = "auto";
  var _overlay = true;

  function applyFont(name) {
    _font = name === "roboto" ? "roboto" : "poppins";
    document.documentElement.setAttribute("data-system-font", _font);
    document.body.setAttribute("data-system-font", _font);
  }

  function currentKind() {
    return KINDS[_kind] || KINDS.veggies;
  }

  function currentItems(kindId) {
    var cat = _catalog[kindId || _kind];
    var list = (cat && cat.items) || [];
    return list.slice(0, Math.max(1, Math.min(list.length, _count)));
  }

  function sliderMax() {
    if (_kind === "all") {
      return Math.max(
        1,
        _catalog.protein.items.length,
        _catalog.sauces.items.length,
        _catalog.drinks.items.length,
        _catalog.veggies.items.length
      );
    }
    return Math.max(1, (_catalog[_kind] && _catalog[_kind].items.length) || 1);
  }

  function footerPriceClean(price) {
    if (price == null || price === "") return "";
    return String(price).replace(/^\+\s*/, "").replace(/^\$/, "").trim();
  }

  function typoModeClass(items) {
    var list = items || [];
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || !it.name) continue;
      var hasSub = !!(it.subtitle && String(it.subtitle).trim());
      var hasPrice = !!footerPriceClean(it.price);
      var score = 1 + (hasSub ? 1 : 0) + (hasPrice ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { hasSub: hasSub, hasPrice: hasPrice };
      }
    }
    if (!best || bestScore <= 1) return "typo-name";
    if (best.hasSub && best.hasPrice) return "typo-name-sub-price";
    if (best.hasPrice) return "typo-name-price";
    if (best.hasSub) return "typo-name-sub";
    return "typo-name";
  }

  function appendItemParts(parent, it) {
    var nameEl = document.createElement("span");
    nameEl.className = "box-item-name";
    nameEl.textContent = it.name || "";
    parent.appendChild(nameEl);
    if (it.subtitle) {
      var sub = document.createElement("span");
      sub.className = "item-paren-sub box-item-sub";
      sub.textContent = " (" + it.subtitle + ")";
      parent.appendChild(sub);
    }
    var cleaned = footerPriceClean(it.price);
    if (cleaned) {
      var price = document.createElement("span");
      price.className = "box-item-price";
      price.textContent = " + $" + cleaned;
      parent.appendChild(price);
    }
  }

  function paintWrapBody(body, kind, items, packed) {
    body.innerHTML = "";
    body.style.setProperty("--box-scale", "1");
    body.classList.remove(
      "lines-1",
      "lines-2",
      "lines-3",
      "lines-4",
      "lines-many",
      "typo-name",
      "typo-name-price",
      "typo-name-sub",
      "typo-name-sub-price"
    );
    body.classList.add("layout-wrap", "align-center", typoModeClass(items));
    var lc = packed.lines.length || 1;
    body.classList.add(lc >= 5 ? "lines-many" : "lines-" + lc);
    body.dataset.lineCount = String(lc);
    packed.lines.forEach(function (line, li) {
      var row = document.createElement("span");
      row.className = "wrap-line-row";
      row.setAttribute("data-line", String(li));
      line.forEach(function (it, i) {
        var span = document.createElement("span");
        span.className = kind.wrapItemClass + " wrap-item";
        appendItemParts(span, it);
        row.appendChild(span);
        if (i < line.length - 1) {
          var sep = document.createElement("span");
          sep.className = kind.sepClass + " wrap-sep";
          sep.textContent = " · ";
          sep.setAttribute("aria-hidden", "true");
          row.appendChild(sep);
        }
      });
      body.appendChild(row);
      if (li < packed.lines.length - 1) {
        var br = document.createElement("span");
        br.className = kind.breakClass + " wrap-line-break";
        br.setAttribute("aria-hidden", "true");
        body.appendChild(br);
      }
    });
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
      if (el.classList.contains("wrap-line-row")) {
        flush();
        line.push(el);
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
        if (el.classList.contains("wrap-line-row")) {
          for (var k = 0; k < el.children.length; k++) {
            lineW += el.children[k].offsetWidth;
          }
        } else {
          lineW += el.offsetWidth;
        }
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

  function syncMeasureShell(widthPx) {
    var strip = document.getElementById("footer-boxes");
    var keys = Object.keys(KINDS);
    keys.forEach(function (id) {
      var conf = KINDS[id];
      var box = document.getElementById(conf.boxId);
      if (!box) return;
      box.classList.toggle("footer-major", widthPx === 768);
      box.classList.toggle("footer-minor", widthPx === 299);
      var svg = box.querySelector(".info-box-shell");
      if (svg) {
        svg.setAttribute("viewBox", "0 0 " + widthPx + " 197");
        var outer = svg.querySelector(".shell-outer");
        var inner = svg.querySelector(".shell-body");
        if (outer) outer.setAttribute("width", String(widthPx));
        if (inner) inner.setAttribute("width", String(Math.max(1, widthPx - 8)));
      }
    });
    strip.style.width = widthPx + "px";
    strip.style.minWidth = widthPx + "px";
    strip.style.maxWidth = "none";
    strip.className = "footer-one";
    void strip.offsetWidth;
  }

  function showMeasureKind(kindId) {
    Object.keys(KINDS).forEach(function (id) {
      var box = document.getElementById(KINDS[id].boxId);
      if (box) box.hidden = id !== kindId;
    });
  }

  function buildDisplayBox(kind, widthPx, title) {
    var wrap = document.createElement("div");
    wrap.className = "info-box";
    wrap.setAttribute("data-box-kind", kind.id);
    if (widthPx === 768) wrap.classList.add("footer-major");
    if (widthPx === 299) wrap.classList.add("footer-minor");
    wrap.innerHTML =
      '<svg class="info-box-shell" viewBox="0 0 ' +
      widthPx +
      ' 197" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect class="shell-outer" width="' +
      widthPx +
      '" height="197" />' +
      '<rect class="shell-body" x="4" y="64" width="' +
      (widthPx - 8) +
      '" height="129" /></svg>' +
      '<div class="info-box-header"><span class="info-box-title"></span></div>' +
      '<div class="info-box-body layout-wrap align-center"></div>';
    wrap.querySelector(".info-box-title").textContent = title || kind.label;
    return wrap;
  }

  function packKindAtWidth(kindId, widthPx, items) {
    var kind = KINDS[kindId];
    var liveBox = document.getElementById(kind.boxId);
    var liveBody = document.getElementById(kind.bodyId);
    showMeasureKind(kindId);
    syncMeasureShell(widthPx);
    liveBody.style.setProperty("--box-scale", "1");
    void liveBody.offsetWidth;
    var measured = items.map(function (it) {
      return Object.assign({ label: Pack.itemMeasureLabel(it) }, it);
    });
    Pack.setMeasureHost(liveBody);
    var packed;
    try {
      var opts = Pack.balanceOptsFromBox(liveBody, {
        sepText: " · ",
        maxLines: 8,
        forceLines: _mode === "3" ? 3 : _mode === "4" ? 4 : 0,
      });
      var lines = Pack.balanceItemsIntoLines(measured, opts);
      packed = {
        lines: lines,
        meta: Pack.balanceItemsIntoLines.lastMeta || {},
        candidates: [],
      };
    } finally {
      Pack.setMeasureHost(null);
      Pack.detachProbe();
    }
    paintWrapBody(liveBody, kind, items, packed);
    var isDense = kindId === "sauces" || kindId === "drinks";
    var scale = Pack.fitBoxScale(liveBody, isDense ? 0.45 : 0.5, isDense ? 2.4 : 2.2, {
      checkChildWidth: true,
      shrinkFactor: isDense ? 0.995 : 0.97,
      returnScale: true,
    });
    packed.scale = scale;
    packed.liveBox = liveBox;
    packed.liveBody = liveBody;
    return packed;
  }

  function copyPackedToSlot(slot, packed, kind, widthPx, title) {
    var strip = slot.querySelector(".lab-strip");
    strip.innerHTML = "";
    var display = buildDisplayBox(kind, widthPx, title);
    var displayBody = display.querySelector(".info-box-body");
    displayBody.className = packed.liveBody.className;
    displayBody.style.cssText = packed.liveBody.style.cssText;
    displayBody.innerHTML = packed.liveBody.innerHTML;
    strip.appendChild(display);
    paintWaste(displayBody);
    var meta = packed.meta || {};
    var cap = slot.querySelector(".lab-meta");
    cap.textContent =
      (meta.L || packed.lines.length) +
      " lines · " +
      (meta.tag || "?") +
      " · scale " +
      (packed.scale != null ? Number(packed.scale).toFixed(3) : "?") +
      " · longest-row fill " +
      (meta.fill ? Math.round(meta.fill * 100) + "%" : "?") +
      " · boxW " +
      (meta.boxW || widthPx);
    return packed;
  }

  function renderTable(host, packed, kindLabel, widthPx) {
    if (!host) return;
    var kind = currentKind();
    var liveBody = document.getElementById(kind.bodyId);
    var items = currentItems(_kind === "all" ? "veggies" : _kind);
    showMeasureKind(kind.id);
    syncMeasureShell(widthPx);
    liveBody.style.setProperty("--box-scale", "1");
    void liveBody.offsetWidth;
    var measured = items.map(function (it) {
      return Object.assign({ label: Pack.itemMeasureLabel(it) }, it);
    });
    var candidates = [];
    Pack.setMeasureHost(liveBody);
    try {
      var opts = Pack.balanceOptsFromBox(liveBody, {
        sepText: " · ",
        maxLines: 8,
        forceLines: 0,
      });
      Pack.balanceItemsIntoLines(measured, opts);
      // Re-run consider list: packer doesn't export candidates. Rebuild via force L.
      var L;
      for (L = 1; L <= Math.min(8, items.length); L++) {
        var forced = Pack.balanceOptsFromBox(liveBody, {
          sepText: " · ",
          maxLines: 8,
          forceLines: L,
        });
        Pack.balanceItemsIntoLines(measured, forced);
        var m = Pack.balanceItemsIntoLines.lastMeta || {};
        candidates.push({
          tag: "lpt-" + L,
          L: m.L,
          typeScore: m.typeScore || 0,
          fill: m.fill || 0,
          score: m.score || 0,
        });
      }
    } finally {
      Pack.setMeasureHost(null);
      Pack.detachProbe();
    }
    var picked = packed.meta || {};
    var rows = candidates
      .slice()
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .map(function (c) {
        var on =
          c.tag === String(picked.tag || "").replace(/\*$/, "") ||
          c.tag + "*" === picked.tag;
        return (
          '<tr class="' +
          (on ? "is-pick" : "") +
          '"><td>' +
          c.tag +
          "</td><td>" +
          c.L +
          "</td><td>" +
          Number(c.typeScore).toFixed(3) +
          "</td><td>" +
          Math.round(c.fill * 100) +
          "%</td><td>" +
          Number(c.score).toFixed(3) +
          "</td></tr>"
        );
      });
    host.innerHTML =
      "<table><thead><tr><th>pack</th><th>L</th><th>type</th><th>longest fill</th><th>score</th></tr></thead><tbody>" +
      rows.join("") +
      "</tbody></table>" +
      '<p class="note">Table is LPT line-counts for ' +
      kindLabel +
      " at " +
      widthPx +
      "px, using js/box-pack.js (same as the boards). Starred Auto pick may be greedy*. type = min(width scale, height scale).</p>";
  }

  function renderAll() {
    document.getElementById("lab-count-n").textContent = String(_count);
    var widths = document.getElementById("view-widths");
    var kinds = document.getElementById("view-kinds");
    if (_kind === "all") {
      widths.hidden = true;
      kinds.hidden = false;
      ["protein", "sauces", "drinks", "veggies"].forEach(function (id) {
        var slot = document.getElementById("slot-kind-" + id);
        var packed = packKindAtWidth(id, 768, currentItems(id));
        copyPackedToSlot(slot, packed, KINDS[id], 768, _catalog[id].title);
      });
      var vegPacked = packKindAtWidth("veggies", 768, currentItems("veggies"));
      renderTable(document.getElementById("lab-table"), vegPacked, "Veggies", 768);
      return;
    }
    widths.hidden = false;
    kinds.hidden = true;
    var kind = currentKind();
    var items = currentItems(kind.id);
    var tablePacked = null;
    WIDTHS.forEach(function (w) {
      var slot = document.getElementById("slot-" + w.id);
      var packed = packKindAtWidth(kind.id, w.width, items);
      copyPackedToSlot(slot, packed, kind, w.width, _catalog[kind.id].title);
      if (w.id === "major") tablePacked = packed;
    });
    renderTable(
      document.getElementById("lab-table"),
      tablePacked || { meta: {} },
      kind.label,
      768
    );
  }

  function parseRevisedBoxCsv(text) {
    var lines = String(text || "").split(/\r?\n/);
    var title = "";
    var items = [];
    var i;
    var mode = "";
    for (i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (!raw) continue;
      if (/^settings$/i.test(raw)) {
        mode = "settings-h";
        continue;
      }
      if (/^inventory$/i.test(raw)) {
        mode = "inv-h";
        continue;
      }
      var cols = raw.split(",");
      if (mode === "settings-h") {
        mode = "settings";
        continue;
      }
      if (mode === "settings") {
        title = String(cols[0] || "").trim();
        mode = "";
        continue;
      }
      if (mode === "inv-h") {
        mode = "inv";
        continue;
      }
      if (mode !== "inv") continue;
      var name = String(cols[0] || "").trim();
      if (!name) continue;
      var include = String(cols[5] != null ? cols[5] : "1").trim();
      if (include === "0" || /^false$/i.test(include)) continue;
      var sub = String(cols[1] || "").trim();
      var price = String(cols[2] || "").trim();
      items.push({
        name: name,
        subtitle: sub || undefined,
        price: price || undefined,
      });
    }
    return items.length ? { title: title, items: items } : null;
  }

  function bind() {
    var slider = document.getElementById("lab-count");
    slider.addEventListener("input", function () {
      _count = Number(slider.value) || 1;
      renderAll();
    });
    document.querySelectorAll("[data-kind]").forEach(function (b) {
      b.addEventListener("click", function () {
        _kind = b.getAttribute("data-kind") || "veggies";
        document.querySelectorAll("[data-kind]").forEach(function (x) {
          x.classList.toggle("on", x === b);
        });
        var sliderEl = document.getElementById("lab-count");
        sliderEl.max = String(sliderMax());
        if (_count > sliderMax()) _count = sliderMax();
        sliderEl.value = String(_count);
        renderAll();
      });
    });
    document.querySelectorAll("[data-font]").forEach(function (b) {
      b.addEventListener("click", function () {
        applyFont(b.getAttribute("data-font") || "poppins");
        document.querySelectorAll("[data-font]").forEach(function (x) {
          x.classList.toggle("on", x === b);
        });
        renderAll();
      });
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
      var boxQ = String(q.get("box") || "").toLowerCase();
      if (boxQ === "protein" || boxQ === "proteins") _kind = "protein";
      else if (boxQ === "sauces" || boxQ === "sauce") _kind = "sauces";
      else if (boxQ === "drinks" || boxQ === "drink") _kind = "drinks";
      else if (boxQ === "veggies" || boxQ === "veggie") _kind = "veggies";
      else if (boxQ === "all" || boxQ === "four") _kind = "all";
      var fontQ = String(q.get("font") || "").toLowerCase();
      if (fontQ === "roboto" || fontQ === "poppins") applyFont(fontQ);
    } catch (err) {}
    bind();
    document.querySelectorAll("[data-kind]").forEach(function (x) {
      x.classList.toggle("on", x.getAttribute("data-kind") === _kind);
    });
    document.querySelectorAll("[data-mode]").forEach(function (x) {
      x.classList.toggle("on", x.getAttribute("data-mode") === _mode);
    });
    document.querySelectorAll("[data-font]").forEach(function (x) {
      x.classList.toggle("on", x.getAttribute("data-font") === _font);
    });

    try {
      var settings = await fetch("/api/settings");
      if (settings.ok) {
        var sj = await settings.json();
        var liveFont = String((sj && sj.systemFont) || "").toLowerCase();
        if (!_font || !new URLSearchParams(location.search || "").get("font")) {
          applyFont(liveFont.indexOf("poppin") !== -1 ? "poppins" : "roboto");
          document.querySelectorAll("[data-font]").forEach(function (x) {
            x.classList.toggle("on", x.getAttribute("data-font") === _font);
          });
        }
      }
    } catch (e) {}

    var notes = [];
    await Promise.all(
      Object.keys(KINDS).map(function (id) {
        var conf = KINDS[id];
        return fetch("/api/sheets/csv?gid=" + conf.gid)
          .then(function (res) {
            if (!res.ok) throw new Error(String(res.status));
            return res.text();
          })
          .then(function (text) {
            var parsed = parseRevisedBoxCsv(text);
            if (parsed && parsed.items.length) {
              _catalog[id] = {
                items: parsed.items,
                title: parsed.title || conf.label,
                source: "sheet",
              };
              notes.push(conf.label + " " + parsed.items.length);
            }
          })
          .catch(function () {
            notes.push(conf.label + " fallback");
          });
      })
    );
    var src = document.getElementById("lab-source");
    src.textContent =
      notes.length
        ? "Live sheets · " + notes.join(" · ") + " · packer js/box-pack.js"
        : "Sheets unreachable — using ticket fallbacks · packer js/box-pack.js";

    _count = nQ > 0 ? Math.max(1, nQ) : sliderMax();
    var slider = document.getElementById("lab-count");
    slider.max = String(sliderMax());
    if (_count > sliderMax()) _count = sliderMax();
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

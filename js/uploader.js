/**
 * Item Uploader — separate operator URL (merge into Menu Manager later).
 * POST /api/manager/item appends one Inventory row and optionally uploads a photo.
 */
(function () {
  "use strict";

  var LTP_DEFAULTS = ["S", "M", "L"];
  var MAX_TIERS = 3;
  var USD = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    useGrouping: false,
  });

  var FALLBACK_MENUS = [
    { id: "board1", label: "Board 1 · Bowls", kind: "board", hasDescription: true, priceSlots: 3 },
    { id: "board2", label: "Board 2 · Handhelds", kind: "board", hasDescription: true, priceSlots: 3 },
    { id: "board3", label: "Board 3 · Munchies", kind: "board", hasDescription: true, priceSlots: 3 },
    { id: "proteins", label: "Proteins", kind: "box", hasDescription: false, priceSlots: 1 },
    { id: "sauces", label: "Sauces", kind: "box", hasDescription: false, priceSlots: 1 },
    { id: "drinks", label: "Drinks · Sodas", kind: "box", hasDescription: false, priceSlots: 1 },
    { id: "veggies", label: "Veggies", kind: "box", hasDescription: false, priceSlots: 1 },
  ];
  var FALLBACK_CATALOGS = [
    {
      name: "Restaurant Copy",
      sheetId: "1dXnhfxd9kzAkKNz4oVwTZHHK8focy6GW-twpC8B11gM",
    },
    {
      name: "Beta (Development) Copy",
      sheetId: "1Bh5pbaBUT5kzANZg_r_ELGxEkphOty4uNyg92ZDBMs8",
    },
  ];

  var _proxyBase = "";
  var _proxy = null;
  var _menus = FALLBACK_MENUS.slice();

  function wantsBeta() {
    try {
      return new URLSearchParams(location.search).has("beta");
    } catch (e) {
      return false;
    }
  }

  function query() {
    try {
      return new URLSearchParams(location.search);
    } catch (e) {
      return new URLSearchParams();
    }
  }

  function apiUrl(path) {
    var p = path.charAt(0) === "/" ? path : "/" + path;
    if (_proxy && !_proxyBase) return p;
    var base = _proxyBase || String(window.TOKI_API_BASE || "").replace(/\/$/, "");
    return base ? base + p : p;
  }

  function fetchWithTimeout(url, init, ms) {
    ms = ms || 20000;
    if (typeof AbortController === "undefined") return fetch(url, init);
    var ctrl = new AbortController();
    var t = setTimeout(function () {
      try {
        ctrl.abort();
      } catch (e) {}
    }, ms);
    return fetch(url, Object.assign({}, init || {}, { signal: ctrl.signal })).then(
      function (res) {
        clearTimeout(t);
        return res;
      },
      function (err) {
        clearTimeout(t);
        throw err;
      }
    );
  }

  async function detectProxy() {
    if (_proxy === true) return true;
    var configured = String(window.TOKI_API_BASE || "").replace(/\/$/, "");
    var candidates = ["/api/health"];
    if (configured) candidates.push(configured + "/api/health");
    var i;
    for (i = 0; i < candidates.length; i++) {
      try {
        var res = await fetchWithTimeout(candidates[i], { cache: "no-store" }, 8000);
        if (!res.ok) continue;
        var j = await res.json();
        if (j && j.sheetsApi) {
          _proxy = true;
          try {
            _proxyBase = new URL(candidates[i], location.href).origin;
            if (_proxyBase === location.origin) _proxyBase = "";
          } catch (e) {
            _proxyBase = "";
          }
          return true;
        }
      } catch (e) {}
    }
    _proxy = false;
    return false;
  }

  function fillSelect(sel, items, valueKey, labelKey, selected) {
    sel.innerHTML = "";
    var i;
    for (i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var opt = document.createElement("option");
      opt.value = it[valueKey] || "";
      opt.textContent = it[labelKey] || opt.value;
      if (selected && opt.value === selected) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function catalogId(c) {
    return String((c && (c.sheetId || c.id)) || "");
  }

  function pickDefaultCatalog(catalogs) {
    var i;
    var wantBeta = wantsBeta();
    var restaurant = "";
    for (i = 0; i < catalogs.length; i++) {
      var name = String(catalogs[i].name || "").toLowerCase();
      var id = catalogId(catalogs[i]);
      if (wantBeta && name.indexOf("beta") >= 0) return id;
      if (!restaurant && name.indexOf("restaurant") >= 0) restaurant = id;
    }
    if (!wantBeta && restaurant) return restaurant;
    return catalogs[0] ? catalogId(catalogs[0]) : "";
  }

  function setStatus(kind, html) {
    var el = document.getElementById("status");
    el.hidden = false;
    el.className = "status" + (kind ? " " + kind : "");
    el.innerHTML = html;
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        resolve("");
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("could not read image"));
      };
      reader.readAsDataURL(file);
    });
  }

  function menuSpec(id) {
    var i;
    for (i = 0; i < _menus.length; i++) {
      if (_menus[i].id === id) return _menus[i];
    }
    return { id: id, kind: "board", hasDescription: true, priceSlots: 3 };
  }

  function priceSlotsFor(spec) {
    var n = Number(spec && spec.priceSlots);
    if (n === 1 || n === 3) return n;
    return (spec && spec.kind) === "box" ? 1 : 3;
  }

  function hasDescription(spec) {
    if (spec && typeof spec.hasDescription === "boolean") return spec.hasDescription;
    return (spec && spec.kind) !== "box";
  }

  function selectedModel() {
    var el = document.querySelector('input[name="priceModel"]:checked');
    return (el && el.value) || "fixed";
  }

  function setModel(value) {
    var el = document.querySelector('input[name="priceModel"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  function parseMoney(raw) {
    var s = String(raw || "").replace(/[^0-9.]/g, "");
    if (!s) return null;
    var first = s.indexOf(".");
    if (first >= 0) {
      s = s.slice(0, first + 1) + s.slice(first + 1).replace(/\./g, "");
    }
    var n = Number(s);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function formatUsd(n) {
    return USD.format(n);
  }

  function moneyDigits(raw) {
    var n = parseMoney(raw);
    if (n == null) return "";
    return n.toFixed(2);
  }

  function sanitizeMoneyTyping(raw) {
    var s = String(raw || "").replace(/[^0-9.]/g, "");
    var first = s.indexOf(".");
    if (first >= 0) {
      s = s.slice(0, first + 1) + s.slice(first + 1).replace(/\./g, "");
    }
    return s;
  }

  function bindMoneyInput(el) {
    if (!el || el._tokiMoney) return;
    el._tokiMoney = true;
    el.addEventListener("input", function () {
      var next = sanitizeMoneyTyping(el.value);
      if (next !== el.value) el.value = next;
    });
    el.addEventListener("blur", function () {
      var digits = moneyDigits(el.value);
      if (digits) el.value = digits;
    });
    el.addEventListener("paste", function () {
      setTimeout(function () {
        var next = sanitizeMoneyTyping(el.value);
        if (next !== el.value) el.value = next;
      }, 0);
    });
  }

  function tierCount() {
    return document.querySelectorAll("#tier-rows .tier-row").length;
  }

  function syncTierChrome() {
    var n = tierCount();
    document.getElementById("add-tier").hidden = n >= MAX_TIERS;
    document.querySelectorAll("#tier-rows .tier-remove").forEach(function (btn, i) {
      btn.classList.toggle("is-off", n < 2 || i === 0);
    });
  }

  function addTierRow(tierValue, priceValue) {
    if (tierCount() >= MAX_TIERS) return;
    var model = selectedModel();
    var row = document.createElement("div");
    row.className = "tier-row";
    var tier = document.createElement("input");
    tier.type = "text";
    tier.className = "tier-name";
    tier.setAttribute("aria-label", "Tier");
    tier.autocomplete = "off";
    if (model === "vb") {
      tier.inputMode = "numeric";
      tier.maxLength = 3;
      tier.placeholder = "#";
      tier.addEventListener("input", function () {
        var next = String(tier.value || "").replace(/\D/g, "").slice(0, 3);
        if (next !== tier.value) tier.value = next;
      });
    } else {
      tier.maxLength = 8;
      tier.placeholder = LTP_DEFAULTS[tierCount()] || "";
    }
    if (tierValue) tier.value = tierValue;
    var money = document.createElement("div");
    money.className = "money";
    var sign = document.createElement("span");
    sign.className = "money-sign";
    sign.textContent = "$";
    var price = document.createElement("input");
    price.type = "text";
    price.className = "tier-price";
    price.inputMode = "decimal";
    price.autocomplete = "off";
    price.setAttribute("aria-label", "Price");
    if (priceValue) price.value = priceValue;
    bindMoneyInput(price);
    money.appendChild(sign);
    money.appendChild(price);
    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tier-remove";
    remove.setAttribute("aria-label", "Remove tier");
    remove.textContent = "×";
    remove.addEventListener("click", function () {
      row.remove();
      syncTierChrome();
    });
    row.appendChild(tier);
    row.appendChild(money);
    row.appendChild(remove);
    document.getElementById("tier-rows").appendChild(row);
    syncTierChrome();
  }

  function resetTiers(keepFirstPrice) {
    var firstPrice = keepFirstPrice || "";
    document.getElementById("tier-rows").innerHTML = "";
    var model = selectedModel();
    if (model === "ltp") addTierRow(LTP_DEFAULTS[0], firstPrice);
    else if (model === "vb") addTierRow("", firstPrice);
  }

  function nextLtpLabel() {
    var used = {};
    document.querySelectorAll("#tier-rows .tier-name").forEach(function (el) {
      used[String(el.value || "").trim().toUpperCase()] = true;
    });
    var i;
    for (i = 0; i < LTP_DEFAULTS.length; i++) {
      if (!used[LTP_DEFAULTS[i]]) return LTP_DEFAULTS[i];
    }
    return "";
  }

  function firstFilledPrice() {
    var fixed = document.getElementById("price1").value;
    if (parseMoney(fixed) != null) return moneyDigits(fixed);
    var el = document.querySelector("#tier-rows .tier-price");
    if (el && parseMoney(el.value) != null) return moneyDigits(el.value);
    return "";
  }

  function syncPricingUi() {
    var spec = menuSpec(document.getElementById("menu").value);
    var slots = priceSlotsFor(spec);
    var multi = slots > 1;
    var keep = firstFilledPrice();
    document.getElementById("model-lab").hidden = !multi;
    document.getElementById("model-picks").hidden = !multi;
    if (!multi) {
      setModel("fixed");
      if (keep && !document.getElementById("price1").value) {
        document.getElementById("price1").value = keep;
      }
    }
    var model = selectedModel();
    var showTiers = multi && model !== "fixed";
    document.getElementById("price-fixed").hidden = showTiers;
    document.getElementById("price-tiers").hidden = !showTiers;
    if (showTiers && tierCount() === 0) resetTiers(keep);
    document.getElementById("description-wrap").hidden = !hasDescription(spec);
  }

  function collectPrices(spec) {
    var slots = priceSlotsFor(spec);
    var out = ["", "", ""];
    var model = slots > 1 ? selectedModel() : "fixed";
    var tokens = [];
    if (model === "fixed") {
      var n = parseMoney(document.getElementById("price1").value);
      if (n != null) tokens.push(formatUsd(n));
    } else {
      document.querySelectorAll("#tier-rows .tier-row").forEach(function (row) {
        if (tokens.length >= slots) return;
        var tier = String((row.querySelector(".tier-name") || {}).value || "").trim();
        var n = parseMoney((row.querySelector(".tier-price") || {}).value);
        if (n == null) return;
        if (model === "vb") {
          var qty = tier.replace(/\D/g, "").slice(0, 3);
          if (!qty) return;
          tokens.push(qty + "/" + formatUsd(n));
        } else if (tier) {
          tokens.push(tier + " " + formatUsd(n));
        }
      });
    }
    var i;
    for (i = 0; i < Math.min(slots, tokens.length); i++) out[i] = tokens[i];
    return out;
  }

  function hasAnyPrice(prices) {
    var i;
    for (i = 0; i < prices.length; i++) {
      if (String(prices[i] || "").trim()) return true;
    }
    return false;
  }

  function missingSoftFeatures(spec) {
    var missing = [];
    if (!document.getElementById("subtitle").value.trim()) missing.push("Subtitle");
    if (hasDescription(spec) && !document.getElementById("description").value.trim()) {
      missing.push("Description");
    }
    var file = (document.getElementById("photo").files || [])[0];
    if (!file) missing.push("Image");
    return missing;
  }

  function showDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var root = document.getElementById("dlg");
      var form = document.getElementById("form");
      var title = document.getElementById("dlg-title");
      var list = document.getElementById("dlg-list");
      var actions = document.getElementById("dlg-actions");
      title.textContent = opts.title || "";
      list.innerHTML = "";
      if (opts.list && opts.list.length) {
        opts.list.forEach(function (label) {
          var li = document.createElement("li");
          li.textContent = label;
          list.appendChild(li);
        });
        list.hidden = false;
      } else {
        list.hidden = true;
      }
      actions.innerHTML = "";
      function finish(value) {
        root.hidden = true;
        form.removeAttribute("inert");
        document.removeEventListener("keydown", onKey, true);
        resolve(value);
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }
      document.addEventListener("keydown", onKey, true);
      form.setAttribute("inert", "");
      if (opts.confirm) {
        var yes = document.createElement("button");
        yes.type = "button";
        yes.className = "dlg-btn dlg-btn-go";
        yes.textContent = opts.confirm;
        yes.addEventListener("click", function () {
          finish(true);
        });
        var no = document.createElement("button");
        no.type = "button";
        no.className = "dlg-btn";
        no.textContent = opts.cancel || "Keep editing";
        no.addEventListener("click", function () {
          finish(false);
        });
        actions.appendChild(yes);
        actions.appendChild(no);
      } else {
        var ok = document.createElement("button");
        ok.type = "button";
        ok.className = "dlg-btn dlg-btn-go";
        ok.textContent = opts.ok || "OK";
        ok.addEventListener("click", function () {
          finish(true);
        });
        actions.appendChild(ok);
      }
      root.hidden = false;
      var first = actions.querySelector("button");
      if (first) first.focus();
    });
  }

  async function loadMenus() {
    await detectProxy();
    var catalogs = FALLBACK_CATALOGS.slice();
    var menus = FALLBACK_MENUS.slice();
    try {
      var res = await fetchWithTimeout(
        apiUrl("/api/manager/menus"),
        { cache: "no-store" },
        15000
      );
      if (res.ok) {
        var j = await res.json();
        if (j && j.ok) {
          if (Array.isArray(j.menus) && j.menus.length) menus = j.menus;
          if (Array.isArray(j.catalogs) && j.catalogs.length) catalogs = j.catalogs;
        }
      }
    } catch (e) {}
    _menus = menus;
    var q = query();
    var wantMenu = q.get("menu") || "board2";
    fillSelect(document.getElementById("menu"), menus, "id", "label", wantMenu);
    fillSelect(
      document.getElementById("catalog"),
      catalogs,
      "sheetId",
      "name",
      pickDefaultCatalog(catalogs)
    );
    document.getElementById("menu").dispatchEvent(new Event("change"));
  }

  function applyQueryUi() {
    var q = query();
    var model = String(q.get("model") || "").toLowerCase();
    if (model === "ltp" || model === "linear") setModel("ltp");
    else if (model === "vb" || model === "bundle") setModel("vb");
    else if (model === "fixed") setModel("fixed");
    syncPricingUi();
    var wantTiers = Number(q.get("tiers") || "0");
    if ((selectedModel() === "ltp" || selectedModel() === "vb") && wantTiers > 1) {
      while (tierCount() < Math.min(MAX_TIERS, wantTiers)) {
        if (selectedModel() === "ltp") addTierRow(nextLtpLabel(), "");
        else addTierRow("", "");
      }
    }
  }

  function wirePreview() {
    var input = document.getElementById("photo");
    var img = document.getElementById("preview");
    input.addEventListener("change", function () {
      var f = input.files && input.files[0];
      if (!f) {
        img.removeAttribute("src");
        img.classList.remove("is-on");
        return;
      }
      var url = URL.createObjectURL(f);
      img.onload = function () {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      };
      img.src = url;
      img.classList.add("is-on");
    });
  }

  function resetItemFields() {
    document.getElementById("item").value = "";
    document.getElementById("subtitle").value = "";
    document.getElementById("description").value = "";
    document.getElementById("price1").value = "";
    document.getElementById("photo").value = "";
    document.getElementById("preview").classList.remove("is-on");
    setModel("fixed");
    resetTiers("");
    syncPricingUi();
  }

  async function onSubmit(ev) {
    if (ev) ev.preventDefault();
    var btn = document.getElementById("submit");
    if (btn.disabled) return;
    var item = document.getElementById("item").value.trim();
    var menu = document.getElementById("menu").value;
    var sheetId = document.getElementById("catalog").value;
    var spec = menuSpec(menu);
    var prices = collectPrices(spec);
    if (!item || !hasAnyPrice(prices)) {
      await showDialog({
        title: "New items must have a title and at least one price.",
        ok: "OK",
      });
      if (!item) document.getElementById("item").focus();
      else if (selectedModel() === "fixed") document.getElementById("price1").focus();
      return;
    }
    if (!menu) {
      setStatus("bad", "Pick a menu.");
      return;
    }
    var missing = missingSoftFeatures(spec);
    if (missing.length) {
      var go = await showDialog({
        title: "Are you sure you want to add this item without the following features?",
        list: missing,
        confirm: "Add anyway",
        cancel: "Keep editing",
      });
      if (!go) return;
    }
    btn.disabled = true;
    setStatus("", "Saving…");
    try {
      await detectProxy();
      var file = (document.getElementById("photo").files || [])[0];
      var imageData = await fileToDataUrl(file);
      var payload = {
        sheetId: sheetId,
        menu: menu,
        item: item,
        price1: prices[0],
        price2: priceSlotsFor(spec) > 1 ? prices[1] : "",
        price3: priceSlotsFor(spec) > 1 ? prices[2] : "",
        subtitle: document.getElementById("subtitle").value.trim(),
        description: hasDescription(spec)
          ? document.getElementById("description").value.trim()
          : "",
        isNew: (document.querySelector('input[name="isNew"]:checked') || {}).value,
        include: (document.querySelector('input[name="include"]:checked') || {}).value,
        imageName: file ? file.name : "",
        imageData: imageData,
      };
      var res = await fetchWithTimeout(
        apiUrl("/api/manager/item"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        60000
      );
      var j = {};
      try {
        j = await res.json();
      } catch (e) {
        j = {};
      }
      if (!res.ok || !j.ok) {
        throw new Error((j && j.error) || ("HTTP " + res.status));
      }
      var bits = [];
      bits.push("Added <b>" + item.replace(/</g, "&lt;") + "</b> to " + (j.label || menu) + ".");
      if (j.sourceName) bits.push("Catalog: " + j.sourceName + ".");
      if (j.image && j.image.driveUrl) {
        bits.push("Photo is on Drive. TVs load it from the sheet — no git push for this item.");
      } else if (j.image && j.image.path) {
        bits.push("Photo saved to " + j.image.path + " (local boards see it now).");
        if (j.image.driveError) {
          bits.push(
            "Drive is not set yet. Local boards already show the photo. Share a folder and set TOKI_UPLOAD_FOLDER_ID so TVs can load it without a git push."
          );
        }
      }
      var page = j.page || "";
      if (page) {
        var href = page;
        try {
          if (wantsBeta() || /beta/i.test(j.sourceName || "")) {
            href = page + (page.indexOf("?") >= 0 ? "&" : "?") + "beta";
          }
        } catch (e) {}
        bits.push('<a href="' + href + '">Open board</a>');
      }
      setStatus("ok", bits.join(" "));
      resetItemFields();
    } catch (err) {
      setStatus("bad", "Could not add item: " + String((err && err.message) || err));
    }
    btn.disabled = false;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var html = window.tokiSuiteNavHtml && window.tokiSuiteNavHtml("Item Uploader");
    if (html) document.getElementById("nav").innerHTML = html;
    bindMoneyInput(document.getElementById("price1"));
    wirePreview();
    var form = document.getElementById("form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
    });
    form.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var tag = ((e.target && e.target.tagName) || "").toUpperCase();
      if (tag === "TEXTAREA") return;
      e.preventDefault();
    });
    document.getElementById("submit").addEventListener("click", onSubmit);
    document.getElementById("menu").addEventListener("change", function () {
      syncPricingUi();
    });
    document.querySelectorAll('input[name="priceModel"]').forEach(function (el) {
      el.addEventListener("change", function () {
        var keep = firstFilledPrice();
        if (selectedModel() === "fixed") {
          if (keep && !document.getElementById("price1").value) {
            document.getElementById("price1").value = keep;
          }
        } else {
          resetTiers(keep);
        }
        syncPricingUi();
      });
    });
    document.getElementById("add-tier").addEventListener("click", function () {
      if (selectedModel() === "ltp") addTierRow(nextLtpLabel(), "");
      else addTierRow("", "");
    });
    loadMenus().then(function () {
      applyQueryUi();
    });
  });
})();

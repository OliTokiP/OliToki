/**
 * Item Uploader — separate operator URL (merge into Menu Manager later).
 * POST /api/manager/item appends one Inventory row and optionally uploads a photo.
 */
(function () {
  "use strict";

  var FALLBACK_MENUS = [
    { id: "board1", label: "Board 1 · Bowls" },
    { id: "board2", label: "Board 2 · Handhelds" },
    { id: "board3", label: "Board 3 · Munchies" },
    { id: "proteins", label: "Proteins" },
    { id: "sauces", label: "Sauces" },
    { id: "drinks", label: "Drinks · Sodas" },
    { id: "veggies", label: "Veggies" },
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
    fillSelect(document.getElementById("menu"), menus, "id", "label", "board2");
    fillSelect(
      document.getElementById("catalog"),
      catalogs,
      "sheetId",
      "name",
      pickDefaultCatalog(catalogs)
    );
  }

  function menuKind(id) {
    var i;
    for (i = 0; i < _menus.length; i++) {
      if (_menus[i].id === id) return _menus[i].kind || "";
    }
    return "";
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

  async function onSubmit(ev) {
    ev.preventDefault();
    var btn = document.getElementById("submit");
    var item = document.getElementById("item").value.trim();
    var menu = document.getElementById("menu").value;
    var sheetId = document.getElementById("catalog").value;
    if (!item) {
      setStatus("bad", "Item name is required.");
      return;
    }
    if (!menu) {
      setStatus("bad", "Pick a menu.");
      return;
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
        price1: document.getElementById("price1").value.trim(),
        price2: document.getElementById("price2").value.trim(),
        price3: document.getElementById("price3").value.trim(),
        subtitle: document.getElementById("subtitle").value.trim(),
        description: document.getElementById("description").value.trim(),
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
      if (j.image && j.image.driveUrl) bits.push("Photo is on Drive (TVs can load it without git).");
      else if (j.image && j.image.path) {
        bits.push("Photo saved to " + j.image.path + " (local boards see it now).");
        if (j.image.driveError) {
          bits.push("Drive skipped — share a folder and set TOKI_UPLOAD_FOLDER_ID for TVs without a git ship.");
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
      document.getElementById("item").value = "";
      document.getElementById("price1").value = "";
      document.getElementById("price2").value = "";
      document.getElementById("price3").value = "";
      document.getElementById("subtitle").value = "";
      document.getElementById("description").value = "";
      document.getElementById("photo").value = "";
      document.getElementById("preview").classList.remove("is-on");
    } catch (err) {
      setStatus("bad", "Could not add item: " + String((err && err.message) || err));
    }
    btn.disabled = false;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var html = window.tokiSuiteNavHtml && window.tokiSuiteNavHtml("Item Uploader");
    if (html) document.getElementById("nav").innerHTML = html;
    wirePreview();
    document.getElementById("form").addEventListener("submit", onSubmit);
    document.getElementById("menu").addEventListener("change", function () {
      var box = menuKind(document.getElementById("menu").value) === "box";
      document.querySelectorAll(".board-only").forEach(function (el) {
        el.hidden = box;
      });
    });
    loadMenus().then(function () {
      document.getElementById("menu").dispatchEvent(new Event("change"));
    });
  });
})();

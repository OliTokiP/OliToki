/* Single registry for operator surfaces.
 *
 * Add a surface: one object in "surfaces" (name + page).
 * Listener reads this file and creates QA/<name> + FEATURE REQUESTS/<name>
 * plus Queue pages. Tickets nav is Listener home (local panel). Creation is
 * Listener /new only — there is no GitHub ticketer. "surfaces" for form.
 * suite.html lists "tools". Launcher.md rows come from "launcher".
 * Screens under Menu Screens come from "screens".
 *
 * Keep this helper *above* TOKI_SUITE — Listener parses that object with a
 * greedy `{...};` match and would swallow a function that follows it.
 */
window.tokiSuiteNavHtml = function (currentName) {
  var nav = ((window.TOKI_SUITE || {}).nav) || [];
  var parts = [];
  var i;
  var item;
  var label;
  var href;
  currentName = currentName || "";
  if (currentName === "Listener") currentName = "Tickets";
  for (i = 0; i < nav.length; i++) {
    item = nav[i] || {};
    label = item.name || "";
    href = item.page || "";
    if (label === "Tickets") {
      href = tokiListenerHomeUrl();
    }
    if (!label) continue;
    if (label === currentName) {
      parts.push('<span class="is-current">' + label + "</span>");
    } else {
      if (label !== "Tickets") href = tokiBustOperatorHref(href);
      parts.push("<a " + window.tokiSuiteInAppAttrs(href) + ">" + label + "</a>");
    }
  }
  return parts.join(" · ");
};

window.tokiOpensOutsideSuite = function (href) {
  if (!href) return false;
  try {
    var u = new URL(href, location.href);
    var p = String(u.port);
    // Local operator ports (Suite app on 8765, Listener/portal on 18765) count as inside the Suite surface.
    if (p === "8765" || p === "18765") return false;
    // Same-origin operator pages stay in Suite (Manager, boards, Deployer).
    // Only GitHub / Live / other hosts open a Chrome window.
    return u.origin !== location.origin;
  } catch (e) {
    return true;
  }
};

window.tokiSuiteAttrEscape = function (s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
};

// In-app destinations must not be real hyperlinks. Chrome --app (Suite.app)
// sends <a href> clicks to a real Chrome window, and preventDefault races that.
window.tokiSuiteInAppAttrs = function (href) {
  href = String(href || "");
  if (window.tokiOpensOutsideSuite && window.tokiOpensOutsideSuite(href)) {
    return (
      'href="' +
      window.tokiSuiteAttrEscape(href) +
      '" target="_blank" rel="noopener"'
    );
  }
  return (
    'role="link" tabindex="0" data-suite-href="' +
    window.tokiSuiteAttrEscape(href) +
    '"'
  );
};

window.tokiSuiteNavigate = function (href) {
  if (!href) return;
  var abs = href;
  try {
    abs = new URL(href, location.href).href;
  } catch (e) {}
  try {
    location.assign(abs);
  } catch (err) {
    location.href = abs;
  }
};

// Force in-window navigation for the Suite bar, hub cards, and Open-a-copy table.
(function tokiEnforceSuiteNav() {
  if (window.__tokiSuiteNavBound) return;
  window.__tokiSuiteNavBound = true;

  function stayHref(el) {
    if (!el || !el.getAttribute) return "";
    if (el.getAttribute("download") != null) return "";
    var href = el.getAttribute("data-suite-href") || "";
    if (href) return href;
    if (!el.closest) return "";
    if (
      !el.closest(".suite-nav") &&
      !el.closest("#tools") &&
      !el.closest("#table-wrap")
    ) {
      return "";
    }
    href = el.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#") return "";
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return "";
    if (window.tokiOpensOutsideSuite && window.tokiOpensOutsideSuite(href)) {
      return "";
    }
    return href;
  }

  function go(e) {
    var el =
      e.target && e.target.closest
        ? e.target.closest("[data-suite-href], a")
        : null;
    var href = stayHref(el);
    if (!href) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    else e.stopPropagation();
    window.tokiSuiteNavigate(href);
  }

  document.addEventListener(
    "click",
    function (e) {
      if (e.button) return;
      go(e);
    },
    true
  );
  document.addEventListener(
    "keydown",
    function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var el =
        e.target && e.target.closest
          ? e.target.closest("[data-suite-href]")
          : null;
      if (!el) return;
      go(e);
    },
    true
  );
})();

function isLiveHost() {
  try { return /github\.io/i.test(location.host); } catch (e) { return false; }
}
function tokiListenerHomeUrl() {
  // Same-origin Tickets page. Hopping Suite.app (:8765) to Listener (:18765)
  // leaves Chrome --app and every later nav click opens a Chrome window.
  return "tickets.html";
}
function tokiListenerPanelUrl() {
  if (isLiveHost()) return "";
  try {
    var u = new URL(location.href);
    u.port = "18765";
    u.pathname = "/";
    u.search = "";
    u.hash = "";
    return u.href;
  } catch (e) {
    return "http://127.0.0.1:18765/";
  }
}
window.tokiGetTicketsUrl = tokiListenerHomeUrl;
window.tokiListenerPanelUrl = tokiListenerPanelUrl;

function tokiBustOperatorHref(href) {
  if (!href) return href;
  try {
    var u = new URL(href, location.href);
    if (u.origin !== location.origin) return href;
    var name = (u.pathname.split("/").pop() || "").toLowerCase();
    if (name !== "deploy.html") return href;
    u.searchParams.set("_toki", String(Date.now()));
    return u.pathname + u.search + u.hash;
  } catch (e) {
    return href;
  }
}
window.tokiBustOperatorHref = tokiBustOperatorHref;

window.TOKI_GITHUB_REPO = "OliTokiP/OliToki";
window.TOKI_PAGES = "https://olitokip.github.io/OliToki";

window.tokiStatusDot = function (kind) {
  var fill =
    kind === "ok" ? "#16a34a" : kind === "bad" ? "#dc2626" : kind === "warn" ? "#ca8a04" : "#9ca3af";
  return (
    '<svg class="status-dot" viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">' +
    '<circle cx="4" cy="4" r="3.5" fill="' +
    fill +
    '"/>' +
    "</svg>"
  );
};

window.tokiShortHash = function (raw) {
  return String(raw || "")
    .replace(/^#/, "")
    .slice(0, 7)
    .toLowerCase();
};

window.tokiHashFromStampText = function (text) {
  var m = String(text || "").match(/"hash"\s*:\s*"([0-9a-fA-F]+)"/);
  return window.tokiShortHash(m ? m[1] : "");
};

window.tokiFetchStampHash = async function (url) {
  try {
    var sep = String(url).indexOf("?") >= 0 ? "&" : "?";
    var res = await fetch(url + sep + "t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return "";
    return window.tokiHashFromStampText(await res.text());
  } catch (e) {
    return "";
  }
};

window.tokiPagesStamp = function () {
  var pages = String(window.TOKI_PAGES || "https://olitokip.github.io/OliToki").replace(
    /\/$/,
    ""
  );
  return window.tokiFetchStampHash(pages + "/js/live-stamp.js");
};

window.tokiBranchStamp = function (branch) {
  var repo = window.TOKI_GITHUB_REPO || "OliTokiP/OliToki";
  return window.tokiFetchStampHash(
    "https://raw.githubusercontent.com/" +
      repo +
      "/" +
      encodeURIComponent(branch) +
      "/js/live-stamp.js"
  );
};

window.tokiBranchBuild = function (branch) {
  var repo = window.TOKI_GITHUB_REPO || "OliTokiP/OliToki";
  return window.tokiFetchStampHash(
    "https://raw.githubusercontent.com/" +
      repo +
      "/" +
      encodeURIComponent(branch) +
      "/js/build-info.js"
  );
};

window.tokiSameHash = function (a, b) {
  a = window.tokiShortHash(a);
  b = window.tokiShortHash(b);
  return !!(a && b && a === b);
};

window.tokiMainHead = async function () {
  var now = Date.now();
  var mem = window._tokiMainHeadCache;
  if (mem && mem.hash && now - mem.at < 45000) return mem.hash;
  try {
    var stored = sessionStorage.getItem("tokiMainHead");
    var parsed = stored ? JSON.parse(stored) : null;
    if (parsed && parsed.hash && now - parsed.at < 45000) {
      window._tokiMainHeadCache = parsed;
      return parsed.hash;
    }
  } catch (e) {}

  var hash = "";
  try {
    var local = await fetch("/api/build?t=" + now, { cache: "no-store" });
    if (local.ok) {
      var info = await local.json();
      hash = window.tokiShortHash(info && (info.hashFull || info.hash));
    }
  } catch (e) {}

  var blockedUntil = Number(window._tokiGhHeadUntil || 0);
  if (!hash && now >= blockedUntil) {
    try {
      var repo = window.TOKI_GITHUB_REPO || "OliTokiP/OliToki";
      var res = await fetch(
        "https://api.github.com/repos/" + repo + "/commits/main",
        {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
        }
      );
      if (res.status === 403) {
        var reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
        window._tokiGhHeadUntil = reset > now ? reset : now + 300000;
      } else if (res.ok) {
        var body = await res.json();
        hash = window.tokiShortHash(body && body.sha);
      }
    } catch (e) {}
  }

  if (hash) {
    var next = { hash: hash, at: now };
    window._tokiMainHeadCache = next;
    try {
      sessionStorage.setItem("tokiMainHead", JSON.stringify(next));
    } catch (e) {}
    return hash;
  }
  if (mem && mem.hash) return mem.hash;
  return "";
};

window.tokiLiveClass = function (kind) {
  if (kind === "ok") return "live ok";
  if (kind === "bad") return "live bad";
  if (kind === "warn") return "live warn";
  return "live";
};

window.tokiTvVerdict = function (pageHash, restaurantHash, mainHash) {
  var p = window.tokiShortHash(pageHash);
  var r = window.tokiShortHash(restaurantHash);
  var m = window.tokiShortHash(mainHash);
  var hashes =
    "live `" +
    (p || "?") +
    "` · last restaurant ship `" +
    (r || "?") +
    "` · main `" +
    (m || "?") +
    "`";
  var tvsHaveShip = !!(p && r && p === r);
  var shipIsMain = !!(r && m && r === m);

  // Dining room truth: Pages matches last restaurant ship.
  // main ahead of that ship is unpublished work, not a TV outage.
  if (tvsHaveShip && shipIsMain) {
    return { kind: "ok", text: "TVs have last restaurant ship · " + hashes };
  }
  if (tvsHaveShip && m && !shipIsMain) {
    return {
      kind: "warn",
      text:
        "TVs have last restaurant ship `" +
        p +
        "`. main `" +
        m +
        "` is not on TVs — ship Restaurant only if that work belongs in the dining room.",
    };
  }
  if (tvsHaveShip) {
    return { kind: "ok", text: "TVs have last restaurant ship · " + hashes };
  }
  if (p && r && p !== r) {
    return {
      kind: "bad",
      text:
        "TVs do not have last restaurant ship · " +
        hashes +
        ". Pages is still publishing.",
    };
  }
  return {
    kind: "off",
    text: "Could not read TVs vs last restaurant ship · " + hashes,
  };
};

window.tokiReloadIfBuildMoved = async function () {
  var h = "";
  try {
    var r = await fetch("/api/build?t=" + Date.now(), { cache: "no-store" });
    if (r.ok) {
      var info = await r.json();
      h = window.tokiShortHash(info && (info.hashFull || info.hash));
    }
  } catch (e) {}
  if (!h) {
    h = await window.tokiFetchStampHash("js/build-info.js");
  }
  if (!h) return;
  var key = "tokiOperatorBuildSeen";
  var prev = "";
  try {
    prev = sessionStorage.getItem(key) || "";
  } catch (e) {}
  if (prev && prev !== h) {
    try {
      sessionStorage.setItem(key, h);
    } catch (e) {}
    try {
      var u = new URL(location.href);
      u.searchParams.set("_toki", String(Date.now()));
      location.replace(u.href);
    } catch (e) {
      location.reload();
    }
    return;
  }
  try {
    sessionStorage.setItem(key, h);
  } catch (e) {}
};

window.tokiTestingVerdict = function (testingHash, mainHash) {
  var t = window.tokiShortHash(testingHash);
  var m = window.tokiShortHash(mainHash);
  if (m && t && t === m) {
    return {
      kind: "ok",
      text: "Testing has today’s work · `" + t + "`",
    };
  }
  if (m && t && t !== m) {
    return {
      kind: "bad",
      text:
        "Testing does not have today’s work · testing `" +
        t +
        "` · main `" +
        m +
        "`",
    };
  }
  if (t) {
    return { kind: "off", text: "testing stamp: `" + t + "`" };
  }
  return { kind: "off", text: "testing stamp: can't read" };
};

window.TOKI_SUITE = {
  "surfaces": [
    { "name": "Listener", "page": "", "label": "Listener" },
    { "name": "Menu Manager", "page": "manager.html", "label": "Menu Manager" },
    { "name": "Menu Screens", "page": "", "label": "Menu Screens", "screens": true, "preview": "preview-all.html" },
    { "name": "Deployer", "page": "deploy.html", "label": "Deployer" },
    { "name": "Suite", "page": "suite.html", "label": "Suite" }
  ],
  "screens": [
    { "page": "index.html", "label": "1 · Bowls" },
    { "page": "index2.html", "label": "2 · Handhelds" },
    { "page": "index3.html", "label": "3 · Munchies" },
    { "page": "index4.html", "label": "4 · Drinks" },
    { "page": "preview-all.html", "label": "Wall" }
  ],
  "launcher": [
    { "label": "Suite", "page": "portal" },
    { "label": "1 · Bowls", "page": "index.html" },
    { "label": "2 · Handhelds", "page": "index2.html" },
    { "label": "3 · Munchies", "page": "index3.html" },
    { "label": "4 · Drinks", "page": "index4.html" },
    { "label": "Menu Manager", "page": "manager.html" },
    { "label": "Deployer", "page": "deploy.html" }
  ],
  "tools": [
    { "name": "Suite", "page": "suite.html", "blurb": "Local portal — bookmark /portal, not a Wi-Fi IP." },
    { "name": "Deployer", "page": "deploy.html", "blurb": "Ship testing or restaurant." },
    { "name": "Tickets", "page": "tickets.html", "blurb": "Queues and new tickets on this Mac." },
    { "name": "Menu Manager", "page": "manager.html", "blurb": "Edit the menu on your phone." },
    { "name": "Item Uploader", "page": "uploader.html", "blurb": "Add a menu item and photo without a git push." },
    { "name": "Brightness", "page": "brightness.html", "blurb": "Screen + keyboard backlight (+/− buttons, hold to repeat)" }
  ],
  "nav": [
    { "name": "Suite", "page": "suite.html" },
    { "name": "Deployer", "page": "deploy.html" },
    { "name": "Tickets", "page": "tickets.html" },
    { "name": "Menu Manager", "page": "manager.html" },
    { "name": "Item Uploader", "page": "uploader.html" },
    { "name": "Brightness", "page": "brightness.html" }
  ]
};

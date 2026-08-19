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
    } else if (label === "Menu Manager") {
      parts.push(
        '<a href="' + href + '" target="_blank" rel="noopener">Menu Manager</a>'
      );
    } else {
      parts.push('<a href="' + href + '">' + label + "</a>");
    }
  }
  return parts.join(" · ");
};

function isLiveHost() {
  try { return /github\.io/i.test(location.host); } catch (e) { return false; }
}
function tokiListenerHomeUrl() {
  if (isLiveHost()) {
    return "tickets.html";
  }
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

window.TOKI_GITHUB_REPO = "OliTokiP/OliToki";
window.TOKI_PAGES = "https://olitokip.github.io/OliToki";

window.tokiStatusDot = function (kind) {
  var fill = kind === "ok" ? "#16a34a" : kind === "bad" ? "#dc2626" : "#9ca3af";
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
    var res = await fetch(url + sep + "t=" + Date.now());
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
    { "label": "Suite", "page": "suite.html" },
    { "label": "1 · Bowls", "page": "index.html" },
    { "label": "2 · Handhelds", "page": "index2.html" },
    { "label": "3 · Munchies", "page": "index3.html" },
    { "label": "4 · Drinks", "page": "index4.html" },
    { "label": "Menu Manager", "page": "manager.html" },
    { "label": "Deployer", "page": "deploy.html" }
  ],
  "tools": [
    { "name": "Suite", "page": "suite.html", "blurb": "This page — all the operator tools." },
    { "name": "Deployer", "page": "deploy.html", "blurb": "Ship testing or restaurant." },
    { "name": "Tickets", "page": "tickets.html", "blurb": "Queues and new tickets on this Mac." },
    { "name": "Menu Manager", "page": "manager.html", "blurb": "Edit the menu on your phone." }
  ],
  "nav": [
    { "name": "Suite", "page": "suite.html" },
    { "name": "Deployer", "page": "deploy.html" },
    { "name": "Tickets", "page": "tickets.html" },
    { "name": "Menu Manager", "page": "manager.html" }
  ]
};

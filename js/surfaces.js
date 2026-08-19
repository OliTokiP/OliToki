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

window.TOKI_SUITE = {
  "surfaces": [
    { "name": "Listener", "page": "", "label": "Listener" },
    { "name": "Menu Manager", "page": "manager.html", "label": "Menu Manager" },
    { "name": "Menu Screens", "page": "", "label": "Menu Screens", "screens": true },
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

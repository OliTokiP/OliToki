/* Single registry for operator surfaces.
 *
 * Add a surface: one object in "surfaces" (name + page).
 * Listener reads this file and creates QA/<name> + FEATURE REQUESTS/<name>
 * plus Queue pages. Tickets (new-bug.html and the Listener /new form)
 * pick from "surfaces". suite.html lists "tools". Launcher.md rows come
 * from "launcher". Screens under Menu Screens come from "screens".
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
  for (i = 0; i < nav.length; i++) {
    item = nav[i] || {};
    label = item.name || "";
    href = item.page || "";
    if (!label) continue;
    if (label === currentName) {
      parts.push(label);
    } else if (label === "Suite") {
      parts.push('<a href="' + href + '">← Suite</a>');
    } else {
      parts.push('<a href="' + href + '">' + label + "</a>");
    }
  }
  return parts.join(" · ");
};

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
    { "name": "Tickets", "page": "new-bug.html", "blurb": "Log a bug or a feature request." },
    { "name": "Menu Manager", "page": "manager.html", "blurb": "Edit the menu on your phone." }
  ],
  "nav": [
    { "name": "Suite", "page": "suite.html" },
    { "name": "Deployer", "page": "deploy.html" },
    { "name": "Tickets", "page": "new-bug.html" },
    { "name": "Menu Manager", "page": "manager.html" }
  ]
};

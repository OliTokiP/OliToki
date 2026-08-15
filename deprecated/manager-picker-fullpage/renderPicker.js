/* Archived 2026-08-15 — markup for the full-page picker (pre QA1). */

function renderPicker() {
  var spec = state.picker ? pickerSpec(state.picker) : null;
  if (!spec) {
    els.picker.hidden = true;
    els.picker.innerHTML = "";
    return;
  }
  var current = spec.get();
  var note = spec.note
    ? '<p class="picker-note">' + escapeHtml(spec.note) + "</p>"
    : "";
  var opts = spec.options
    .map(function (o) {
      var on = String(o.id) === String(current);
      return (
        '<button class="picker-option' +
        (on ? " is-on" : "") +
        '" type="button" data-act="choose" data-id="' +
        escapeHtml(o.id) +
        '"><span class="picker-label">' +
        escapeHtml(o.label) +
        "</span></button>"
      );
    })
    .join("");
  els.picker.hidden = false;
  els.picker.innerHTML =
    '<div class="picker-panel">' +
    "<h2 class=\"picker-title\">" +
    escapeHtml(spec.title) +
    "</h2>" +
    note +
    '<div class="picker-list">' +
    opts +
    "</div></div>";
  applyTheme();
}

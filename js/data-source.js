/**
 * TokiMenu — data source switch
 *
 * "google" → live Google Sheet via local toki_server.py API proxy when available
 *            (/api/sheets/csv + service account = private sheet OK).
 *            Falls back to public CSV export if the proxy is not running.
 *            Drive xlsx (fills / rich text) is quarantined — see
 *            deprecated/sheet-styles/.
 * "local"  → Menu.xlsx in this folder (cell values only; no fills/fonts)
 *
 * Flip DATA_SOURCE, hard-refresh the boards. Stress tests / offline work use "local".
 * Re-pull a fresh copy anytime:
 *   python3 scripts/pull-menu-xlsx.py
 * API server:
 *   python3 scripts/toki_server.py
 */
(function () {
  "use strict";

  /** @type {"google"|"local"} */
  var DATA_SOURCE = "google";

  /** Local workbook path (relative to the HTML board). */
  var LOCAL_XLSX = "Menu.xlsx";

  window.TOKI_DATA_SOURCE = DATA_SOURCE;
  window.TOKI_LOCAL_XLSX = LOCAL_XLSX;
})();

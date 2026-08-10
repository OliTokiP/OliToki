/**
 * TokiMenu Color Tools (bound Apps Script)
 *
 * Makes working with color cells friendly:
 *
 * - TYPE a hex (#rgb or #rrggbb) → onEdit auto-sets the cell BACKGROUND
 *   to that color + chooses black/white text for contrast.
 *
 * - PAINT with the Sheets color picker / Fill color, then run the capture
 *   command → the cell's VALUE is set to the hex of the current fill.
 *   Also forces readable text and normalizes the background.
 *
 * Why? The color picker is nicer for most people than typing hex codes.
 * But we still want an explicit hex string stored in the cell value
 * (for CSV/values reads, xlsx exports, the menu runtime that prefers
 * text hex first, and for clarity).
 *
 * INSTALL
 * 1. In your TokiMenu Google Sheet: Extensions → Apps Script.
 * 2. Paste this whole file into a .gs file (or Code.gs).
 * 3. Save (Ctrl/Cmd+S).
 * 4. Reload the spreadsheet. You should see a new "Toki Colors" menu.
 *
 * USAGE
 * - Just type or paste hex codes. The onEdit trigger handles it live.
 * - To capture fills: select the painted cell(s), then
 *   Toki Colors → "Capture fills → write hex into selected cells"
 * - "Apply hex values → set backgrounds" is useful after bulk pasting hexes
 *   or to force a refresh.
 */

function onEdit(e) {
  if (!e) return; // safety when run from editor
  const range = e.range;
  const sheet = range.getSheet();

  // Optional: lock to a particular sheet name
  // if (sheet.getName() !== 'Style and Theme') return;

  const numRows = range.getNumRows();
  const numCols = range.getNumColumns();

  for (let r = 1; r <= numRows; r++) {
    for (let c = 1; c <= numCols; c++) {
      const cell = range.getCell(r, c);
      const value = String(cell.getValue() || '').trim();

      if (isValidHex(value)) {
        const hex = normalizeHex(value) || value;
        cell.setBackground(hex);
        cell.setFontColor(getContrastColor(hex));
      }
    }
  }
}

/** Accepts #RGB or #RRGGBB (case-insensitive) */
function isValidHex(str) {
  return /^#([0-9A-Fa-f]{3}){1,2}$/.test(str);
}

/**
 * Normalizes any valid input to lowercase 6-digit form (#rrggbb).
 * Returns null for invalid input.
 */
function normalizeHex(str) {
  if (typeof str !== 'string') return null;
  let hex = str.trim();
  if (!hex) return null;
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (!isValidHex(hex)) return null;
  if (hex.length === 4) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex.toLowerCase();
}

/** Returns '#000000' or '#ffffff' for best readability on the bg */
function getContrastColor(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return '#000000';

  const r = parseInt(normalized.substr(1, 2), 16);
  const g = parseInt(normalized.substr(3, 2), 16);
  const b = parseInt(normalized.substr(5, 2), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000000' : '#ffffff';
}

/**
 * Applies backgrounds (and readable text) for any cells in the given range
 * whose current VALUE is a valid hex color.
 * Safe to run on large ranges — only hex-containing cells are modified.
 */
function applyHexColorsToRange() {
  const sheet = SpreadsheetApp.getActiveSheet();
  let range = sheet.getActiveRange();
  if (!range) {
    range = sheet.getRange('A1:Z100');
  }
  _applyHexToBackgrounds(range);
}

/** Force the classic full-grid behavior (A1:Z100) */
function applyHexOnFullGrid() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const range = sheet.getRange('A1:Z100');
  _applyHexToBackgrounds(range);
}

function _applyHexToBackgrounds(range) {
  const numRows = range.getNumRows();
  const numCols = range.getNumColumns();

  for (let r = 1; r <= numRows; r++) {
    for (let c = 1; c <= numCols; c++) {
      const cell = range.getCell(r, c);
      const value = String(cell.getValue() || '').trim();
      if (isValidHex(value)) {
        const hex = normalizeHex(value) || value;
        cell.setBackground(hex);
        cell.setFontColor(getContrastColor(hex));
      }
    }
  }
}

/**
 * NEW BEHAVIOR REQUESTED:
 * For the currently selected range, read each cell's background fill color,
 * write that color's hex code into the cell's VALUE (overriding whatever
 * was there), set high-contrast font color, and normalize the background
 * to the clean hex.
 *
 * How to use:
 *   1. Select one or more cells.
 *   2. Use the normal Sheets fill color tool to paint them.
 *   3. Run Toki Colors → "Capture fills → write hex into selected cells"
 *      (or call applyFillsToHexValues() directly).
 */
function applyFillsToHexValues() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const range = sheet.getActiveRange();

  if (!range) {
    SpreadsheetApp.getUi().alert(
      'Select the cell(s) first.\n\n' +
      'Paint them with Fill color, then run this again.\n' +
      'It will replace each cell\'s content with the hex of its current fill.'
    );
    return;
  }

  _applyBackgroundsToHex(range);
}

function _applyBackgroundsToHex(range) {
  const numRows = range.getNumRows();
  const numCols = range.getNumColumns();

  for (let r = 1; r <= numRows; r++) {
    for (let c = 1; c <= numCols; c++) {
      const cell = range.getCell(r, c);
      const bg = cell.getBackground();
      const hex = normalizeHex(bg);
      if (hex) {
        cell.setValue(hex);
        cell.setFontColor(getContrastColor(hex));
        cell.setBackground(hex);
      }
    }
  }
}

/** Creates / updates the custom menu on spreadsheet open. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Toki Colors')
    .addItem('Apply hex values → set backgrounds + readable text', 'applyHexColorsToRange')
    .addItem('Capture fills → write hex into selected cells', 'applyFillsToHexValues')
    .addSeparator()
    .addItem('Apply hex on entire A1:Z100 grid', 'applyHexOnFullGrid')
    .addToUi();
}

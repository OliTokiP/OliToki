/**
 * TokiMenu — Board 1 (presentation layout: bowls)
 *
 * Sheet tab: "Board 1 Revised" (gid=1058015863). Restructured:
 *   - Settings block (label → headers → single data row) at top for Menu Title, Family Portrait, Presentation Mode, Include*?, Columns?
 *   - Inventory (expanding glossary): label → headers below → items (Item, Prices, New, Image, Include, etc.)
 * Title from Settings row. Items from Inventory section.
 *
 * Theme / speeds / highlights: Style tab (styleThemeGid).
 * Debug Menu (master + per-feature switches): debugMenuGid.
 * Protein/Sauces/Drinks content: shared revised sheets (Settings top + Inventory).
 * Footer boxes now selected via Beta Features "Include Footer Boxes" (comma list of titles; max 3 by Priority asc; others exiled).
 * Per-box tabs (Proteins/Sauces/Drinks/Veggies) use: Settings (Title, Subtitle, BG, Create Cols?, Align, Priority) + Inventory.
 * Priority lower number = higher (1 leftmost). Board Settings includes are overridden by Beta for boards 1-3.
 */
window.TOKI_CONFIG = {
  // Fallback only. Live workbook comes from OliToki Menu Settings → Data Source.
  googleSheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  googleSheetGid: "1058015863", // Board 1 Revised (restructured: Settings at top, Inventory headers below)
  styleThemeGid: "183083022", // Style and Theme (revised)
  debugMenuGid: "1793812854",
  proteinSheetGid: "1420775786", // Proteins tab (Settings + Inventory; archive: Proteins (old))
  saucesSheetGid: "1630545949", // Sauces tab (Settings + Inventory; archive: Sauces (old))
  drinksSheetGid: "1145721787", // Drinks tab (Settings + Inventory; archive: Drinks (old))
  veggiesSheetGid: "640368705", // Veggies tab (new 4th footer box)

  layout: "bowls",
  showHero: true,
  showSticker: true,
  imageFolder: "food-pics/bowls",

  refreshSeconds: 30,
  fallbacks: ["xlsx", "embedded"],
  forceIncludeAll: false,
  extraItems: [],

  columns: {
    // For revised Board 1, item parsing uses Inventory section cols (title/settings from top Settings block)
    title: 0,
    item: 0,
    price: null,
    price1: 1,
    price2: 2,
    price3: 3,
    subtitle: 4,
    description: 5,
    isNew: 6,
    image: 7,
    include: 8,
    // Settings block (top) provides: familyPortrait, presentationMode, include*Box, menuColumns, title
    // (see parse logic)
    familyPortrait: null,
    presentationMode: null,
    includeProteinBox: null,
    includeSaucesBox: null,
    includeDrinksBox: null,
    includeDescriptions: null,
    bgScrollSpeed: null,
    slideshowSpeed: null,
    highlight: null,
    highlightSpecial: null,
  },
};

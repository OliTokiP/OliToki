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
 * Protein/Sauces content: shared sheets (proteinSheetGid / saucesSheetGid).
 */
window.TOKI_CONFIG = {
  googleSheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  googleSheetGid: "1058015863", // Board 1 Revised (restructured: Settings at top, Inventory headers below)
  styleThemeGid: "183083022", // Style and Theme (revised)
  debugMenuGid: "1793812854",
  proteinSheetGid: "1191392779",
  saucesSheetGid: "1780619208",
  drinksSheetGid: "628145419",

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

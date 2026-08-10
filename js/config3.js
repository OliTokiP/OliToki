/**
 * TokiMenu — Board 3 (presentation layout: munchies)
 *
 * Sheet tab: "Board 3 Revised" (gid=1684494006). Restructured like Board 1:
 *   - Settings block (label → headers → single data row) at top.
 *   - Inventory (headers below) for items.
 *
 * Theme / speeds / highlights from Style tab (revised).
 * Protein/Sauces content: shared sheets.
 */
window.TOKI_CONFIG = {
  googleSheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  googleSheetGid: "1684494006", // Board 3 Revised (restructured)
  styleThemeGid: "183083022", // Style and Theme (revised)
  debugMenuGid: "1793812854",
  proteinSheetGid: "1191392779",
  saucesSheetGid: "1780619208",
  drinksSheetGid: "628145419",

  layout: "munchies",
  showHero: true,
  showSticker: true,
  imageFolder: "food-pics/munchies",

  refreshSeconds: 30,
  fallbacks: ["embedded"],
  forceIncludeAll: false,
  extraItems: [],

  columns: {
    // For revised, item parsing uses Inventory section (0-based); title/settings from top Settings block
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
    // Settings block provides familyPortrait, presentationMode, include*?, menuColumns
    familyPortrait: null,
    presentationMode: null,
    includeProteinBox: null,
    includeSaucesBox: null,
    includeDrinksBox: null,
    includeDescriptions: null,
    menuColumns: null,
    bgScrollSpeed: null,
    slideshowSpeed: null,
    highlight: null,
    highlightSpecial: null,
  },
};
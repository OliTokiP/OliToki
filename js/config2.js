/**
 * TokiMenu — Board 2 (presentation layout: handhelds)
 *
 * Sheet tab: "Board 2 Revised" (gid=314919644). Restructured like Board 1:
 *   - Settings block (label → headers → single data row) at top.
 *   - Inventory (headers below) for items.
 *
 * Theme / speeds / highlights from Style tab (revised).
 * Footer boxes (Proteins/Sauces/Drinks/Veggies) selected via Beta Features tab (comma-separated titles, Priority ranked, max 3).
 * Per-box tabs use Settings (Title|Subtitle|BG|Cols?|Align|Priority) + Inventory. Beta overrides board flags.
 */
window.TOKI_CONFIG = {
  googleSheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  googleSheetGid: "314919644", // Board 2 Revised (restructured)
  styleThemeGid: "183083022", // Style and Theme (revised)
  debugMenuGid: "1793812854",
  proteinSheetGid: "1420775786", // Proteins (restructured: Settings + Inventory)
  saucesSheetGid: "1630545949", // Sauces (restructured: Settings + Inventory; uniform cols)
  drinksSheetGid: "1145721787", // Drinks (restructured: Settings + Inventory; uniform cols)
  veggiesSheetGid: "640368705", // Veggies (new 4th footer box)

  layout: "handhelds",
  showHero: true,
  showSticker: true,
  imageFolder: "food-pics/handhelds",

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

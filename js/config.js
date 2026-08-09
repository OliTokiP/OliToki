/**
 * TokiMenu — Board 1 (presentation layout: bowls)
 *
 * Sheet tab: "Board 1" (gid=0). Display title lives in Menu Title cell.
 * Theme / speeds / highlights: Style tab (styleThemeGid).
 * Debug Menu (master + per-feature switches): debugMenuGid.
 * Protein/Sauces content: shared sheets (proteinSheetGid / saucesSheetGid).
 *
 * Board 1 column schema (Family Portrait inserted at K):
 *   A Menu Title | B Item | C–E Price 1–3 | F Subtitle | G Description |
 *   H New | I Image | J Include | K Family Portrait | L Presentation Mode |
 *   M Include Protein Box? | N Sauces? | O Drinks? | P Descriptions?
 */
window.TOKI_CONFIG = {
  googleSheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  googleSheetGid: "0",
  styleThemeGid: "183083022", // Style and Theme Revised
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
    title: 0,
    item: 1,
    price: null,
    price1: 2,
    price2: 3,
    price3: 4,
    subtitle: 5,
    description: 6,
    isNew: 7,
    image: 8,
    include: 9,
    familyPortrait: 10,
    presentationMode: 11,
    includeProteinBox: 12,
    includeSaucesBox: 13,
    includeDrinksBox: 14,
    includeDescriptions: 15,
    bgScrollSpeed: null,
    slideshowSpeed: null,
    highlight: null,
    highlightSpecial: null,
  },
};

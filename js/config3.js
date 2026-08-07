/**
 * TokiMenu — Board 3 (presentation layout: munchies)
 *
 * Sheet tab: "Board 3" (gid=1427118423). Display title lives in Menu Title cell.
 * Theme / speeds / highlights from Style tab.
 * Protein/Sauces content: shared sheets.
 *
 * Schema + optional: N Include Descriptions? | O Columns? (Auto|1|2|3).
 */
window.TOKI_CONFIG = {
  googleSheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  googleSheetGid: "1427118423",
  styleThemeGid: "1076652078",
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
    includeProteinBox: 10,
    includeSaucesBox: 11,
    includeDrinksBox: 12,
    includeDescriptions: 13,
    menuColumns: 14,
    bgScrollSpeed: null,
    slideshowSpeed: null,
    highlight: null,
    highlightSpecial: null,
  },
};

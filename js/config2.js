/**
 * TokiMenu — Board 2 (presentation layout: handhelds)
 *
 * Sheet tab: "Board 2" (gid=1959901693). Display title lives in Menu Title cell.
 * Theme / speeds / highlights from Style tab.
 * Protein/Sauces content: shared sheets (not this tab).
 *
 * Same column schema as Board 1 / Board 3 — fill only what you need.
 */
window.TOKI_CONFIG = {
  googleSheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  googleSheetGid: "1959901693",
  styleThemeGid: "1076652078",
  proteinSheetGid: "1191392779",
  saucesSheetGid: "1780619208",

  layout: "handhelds",
  showHero: true,
  showSticker: true,
  imageFolder: "food-pics/handhelds",

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
    bgScrollSpeed: null,
    slideshowSpeed: null,
    highlight: null,
    highlightSpecial: null,
  },
};

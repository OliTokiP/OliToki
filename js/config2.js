/**
 * TokiMenu — Board 2 (presentation layout: handhelds)
 *
 * Sheet tab: "Board 2" (gid=1959901693). Display title lives in Menu Title cell.
 * Theme / speeds / highlights from Style tab.
 * Protein/Sauces content: shared sheets (not this tab).
 *
 * Same schema as Board 1:
 *   … | K Family Portrait | L Presentation Mode (Slideshow|Encore) |
 *   M Protein? | N Sauces? | O Drinks? | P Descriptions? | Q Columns?
 */
window.TOKI_CONFIG = {
  googleSheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  googleSheetGid: "1959901693",
  styleThemeGid: "1076652078",
  proteinSheetGid: "1191392779",
  saucesSheetGid: "1780619208",
  drinksSheetGid: "628145419",

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
    familyPortrait: 10,
    presentationMode: 11,
    includeProteinBox: 12,
    includeSaucesBox: 13,
    includeDrinksBox: 14,
    includeDescriptions: 15,
    menuColumns: 16,
    bgScrollSpeed: null,
    slideshowSpeed: null,
    highlight: null,
    highlightSpecial: null,
  },
};

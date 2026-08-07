/**
 * TokiMenu — Board 4 (Drinks & Deals)
 * Google Sheet tab: "Board 4" (gid=1962117802; legacy names: Announcements / Drinks Deals)
 *
 * Theme / speeds / highlights from Style tab.
 * Announcement + stripes: this board tab.
 * Drink box items / title / overview: shared drinks sheet (drinksSheetGid).
 * Stripe / box colors: Color Picker labels → theme hex (or Override fill).
 * Include Stripes: 1 = animate stripes, 0 = hide completely.
 */
window.TOKI_CONFIG = {
  googleSheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  googleSheetGid: "1962117802",
  styleThemeGid: "1076652078",
  /** Dedicated drink-box content (items, overview, box title/color) */
  drinksSheetGid: "628145419",

  layout: "drinks",
  showHero: true,
  showSticker: true,
  showDisclaimer: true,
  imageFolder: "food-pics/drinks",
  overviewImageDefault: null,

  refreshSeconds: 30,
  fallbacks: [],
  forceIncludeAll: false,
  extraItems: [],

  /**
   * Board tab (announcement + chrome only once drinksSheetGid is set):
   * A title | B include stripes | C stripe1 | D stripe2 |
   * E ann title | F ann subtitle | G ann copy | H ann color |
   * I–S legacy drink columns (ignored when drinksSheetGid loads successfully)
   */
  columns: {
    title: 0,
    includeStripes: 1,
    stripeColor1: 2,
    stripeColor2: 3,
    announcementTitle: 4,
    announcementSubtitle: 5,
    announcementCopy: 6,
    announcementColor: 7,
    // Legacy fallback if drinks sheet fails to load:
    drinkBoxTitle: 8,
    drinkBoxSubtitle: 9,
    drinkBoxColor: 10,
    drinksOverview: 11,
    overviewImage: 12,
    drinksIndividual: 13,
    item: 14,
    subtitle: 15,
    isNew: 16,
    image: 17,
    include: 18,
    price: null,
    description: null,
    bgScrollSpeed: null,
    slideshowSpeed: null,
    highlight: null,
    highlightSpecial: null,
  },

  /**
   * Drinks content sheet (gid=628145419):
   * A title | B subtitle | C color | D overview | E overview image |
   * F individual | G item | H item subtitle | I new | J image | K include |
   * L Create Columns? | M Text Align (Left / Center / Right)
   */
  drinksSheetColumns: {
    drinkBoxTitle: 0,
    drinkBoxSubtitle: 1,
    drinkBoxColor: 2,
    drinksOverview: 3,
    overviewImage: 4,
    drinksIndividual: 5,
    item: 6,
    subtitle: 7,
    isNew: 8,
    image: 9,
    include: 10,
    createColumns: 11,
    textAlign: 12,
  },
};

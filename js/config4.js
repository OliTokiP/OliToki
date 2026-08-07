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
   * E Announcement Title | F Announcement Subtitle | G Announcement Text |
   * H Announcement Box Color | I Announcement Speed (seconds; inherit blanks) |
   * J–T legacy drink columns (ignored when drinksSheetGid loads successfully)
   *
   * Each non-empty G cell is one message-board slide. Blank E/F/I inherit the
   * previous message’s resolved title/subtitle/speed.
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
    announcementSpeed: 8,
    // Legacy fallback if drinks sheet fails to load:
    drinkBoxTitle: 9,
    drinkBoxSubtitle: 10,
    drinkBoxColor: 11,
    drinksOverview: 12,
    overviewImage: 13,
    drinksIndividual: 14,
    item: 15,
    subtitle: 16,
    isNew: 17,
    image: 18,
    include: 19,
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

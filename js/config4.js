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
  styleThemeGid: "183083022", // Style and Theme (revised)
  debugMenuGid: "1793812854",
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
   * J Shout (1/0; inherit blanks — Roboto Black + max fill + text earthquake) |
   * K Shout Shake Intensity (0–1+; inherit blanks; baked baseline = 0.75) |
   * Legacy drink columns below are unused when drinksSheetGid loads.
   *
   * Each non-empty G cell is one message-board slide.
   * Blank E/I/J/K inherit previous title/speed/shout/intensity; blank F clears
   * subtitle only when E sets a new title (married title/subtitle).
   * Body text align + rich bold-color come from the G cell itself (Sheets formatting).
   * Titles keep default alignment (not driven by G).
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
    announcementShout: 9,
    /** K — rightmost; no column shift needed for announcements */
    announcementShakeIntensity: 10,
    // Legacy fallback if drinks sheet fails (drinksSheetGid normally owns drinks):
    drinkBoxTitle: 11,
    drinkBoxSubtitle: 12,
    drinkBoxColor: 13,
    drinksOverview: 14,
    overviewImage: 15,
    drinksIndividual: 16,
    item: 17,
    subtitle: 18,
    isNew: 19,
    image: 20,
    include: 21,
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

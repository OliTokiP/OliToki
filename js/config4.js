/**
 * TokiMenu — Board 4 (Drinks & Deals / Announcements)
 *
 * Sheet tab: "Announcements" (gid=149404218) — revised Settings + Inventory.
 *   Settings: Title | Include Footer Box (singular) | BG Color |
 *             BG Pattern | Pattern Color 1 | Pattern Color 2
 *   Inventory (under settings): Announcement Title | Subtitle | Text |
 *             Box Color | Speed | Motion Style | Motion Setting
 *
 * Footer box content (single selection): Proteins / Sauces / Drinks / Veggies
 * sheets — each keeps its own Settings (color, columns, align, CF).
 * Theme / speeds: Style and Theme (revised).
 * Panel pattern (#stripes) is FOREGROUND at full opacity; Style BG Pattern
 * remains atmospheric (lower opacity) on #bg-pattern.
 *
 * Legacy Board 4 chrome tab gid=1962117802 kept as archive only.
 */
window.TOKI_CONFIG = {
  googleSheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
  googleSheetGid: "149404218", // Announcements (revised)
  styleThemeGid: "183083022", // Style and Theme (revised)
  debugMenuGid: "1793812854",
  /** Shared box content sheets (same as boards 1–3) for Include Footer Box */
  proteinSheetGid: "1420775786",
  saucesSheetGid: "1630545949",
  drinksSheetGid: "1145721787", // Drinks (Settings + Inventory)
  veggiesSheetGid: "640368705",

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
   * Revised Announcements tab uses ANN_REVISED_* maps in menu.js.
   * Column map below is legacy Board 4 chrome (gid 1962117802) fallback only.
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
    announcementShakeIntensity: 10,
    // Legacy drink columns (unused when drinksSheetGid loads)
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
   * Drinks content sheet (gid=1145721787) — Settings + Inventory.
   * Legacy flat indices kept for archive sheet fallback.
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

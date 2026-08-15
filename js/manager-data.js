/**
 * OliToki Menu Manager — catalogs and defaults.
 * Theme palettes stand in for the Style and Theme tab until sheet load is wired.
 * Toki Default matches STYLE_GUIDE tokens (source of truth).
 */
(function (global) {
  "use strict";

  var SETTINGS_SHEET_ID = "1OwNKHzjP46xKJBW8sTm4IOWhIzf0lENdZ8rv_GY37fY";

  var DATA_SOURCES = [
    {
      id: "restaurant",
      name: "Restaurant Copy",
      sheetId: "1dXnhfxd9kzAkKNz4oVwTZHHK8focy6GW-twpC8B11gM",
    },
    {
      id: "alpha",
      name: "Alpha Copy",
      sheetId: "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10",
    },
  ];

  var THEMES = [
    { name: "Toki Default", main: "#000000", secondary: "#FFFFFF", highlight: "#26BBCB", special: "#FFF900" },
    { name: "Ocean Punch", main: "#0B3D5C", secondary: "#E8F6FF", highlight: "#00C2FF", special: "#FFB703" },
    { name: "Sunset Market", main: "#5C1A1A", secondary: "#FFF0E6", highlight: "#FF6B35", special: "#FFD166" },
    { name: "Matcha Cream", main: "#1F4D3A", secondary: "#F3F7E8", highlight: "#7CB342", special: "#F4A261" },
    { name: "Grape Neon", main: "#2A1248", secondary: "#F3E8FF", highlight: "#C77DFF", special: "#39FF14" },
    { name: "Indigo Paper", main: "#1A237E", secondary: "#FFF8E7", highlight: "#FF6F61", special: "#FFD54F" },
    { name: "Summer", main: "#0E3D4A", secondary: "#FFF6E0", highlight: "#FF8A3D", special: "#FFE566" },
    { name: "Fourth of July", main: "#1B2A4A", secondary: "#F4F7FB", highlight: "#C41E3A", special: "#F2C94C" },
    { name: "Halloween", main: "#2B1545", secondary: "#F3E2C8", highlight: "#F07812", special: "#3CB54A" },
    { name: "Thanksgiving", main: "#3D1F0F", secondary: "#FFF4E5", highlight: "#D35400", special: "#F4D03F" },
    { name: "Christmas", main: "#1A3C2A", secondary: "#FFF8F0", highlight: "#C41E3A", special: "#F5D76E" },
    { name: "Easter", main: "#3D2C5A", secondary: "#FFF5FB", highlight: "#E8A0BF", special: "#B8E986" },
  ];

  var COLOR_ROLES = [
    { id: "main", label: "Main Color" },
    { id: "secondary", label: "Secondary Color" },
    { id: "highlight", label: "Highlight Color" },
    { id: "special", label: "Highlight Color (Special)" },
  ];

  var BACKGROUND_OPTIONS = COLOR_ROLES.concat([
    { id: "pattern", label: "Pattern" },
    { id: "wallpaper", label: "Wallpaper" },
  ]);

  var PATTERN_TYPES = [{ id: "stripes", label: "Stripes" }];

  var WALLPAPERS = [
    { id: "galaxy", label: "Galaxy", src: "assets/bgs/galaxy-bg.webp" },
    { id: "film", label: "Film", src: "assets/bgs/film.webp" },
    { id: "upload", label: "Upload" },
  ];

  var PRESENTATION_STYLES = [
    { id: "slideshow", label: "Slideshow" },
    { id: "kenburns", label: "Ken Burns" },
    { id: "encore", label: "Encore" },
  ];

  var ENCORE_STYLES = [
    { id: "hard", label: "Hard" },
    { id: "hard_shadow", label: "Hard (with shadow)" },
    { id: "soft", label: "Soft" },
  ];

  var ENCORE_SPOT_COLORS = [
    { id: "highlight", label: "Highlight" },
    { id: "black", label: "Black" },
  ];

  var FONTS = [
    { id: "poppins", label: "Poppins" },
    { id: "roboto", label: "Roboto" },
  ];

  var YES_NO = [
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" },
  ];

  var ZERO_ONE = [
    { id: "1", label: "On" },
    { id: "0", label: "Off" },
  ];

  /* Sheet boolean chrome (manager picks the control from how the cell is stored):
     trueFalse — cell accepts TRUE/FALSE → two-button popup
     zeroOne   — cell accepts 0/1       → inline checkbox (look TBD) */

  var BOARDS = [
    { id: "1", title: "Board 1", menuTitle: "Bowls & Salads" },
    { id: "2", title: "Board 2", menuTitle: "Handhelds" },
    { id: "3", title: "Board 3", menuTitle: "Munchies" },
    { id: "announcements", title: "Announcements", menuTitle: "Drinks & Deals" },
  ];

  var COMING_SOON_FEATURES = [
    "Toast Imports",
    "Live Price Updates",
    "Image Uploader",
    "Sort by popularity",
    "… and more!",
  ];

  var PREVIEW_ITEMS = [
    {
      src: "food-pics/handhelds/KaliforniaBurrito-sm.webp",
      isNew: true,
      name: "California Burrito",
    },
    { src: "food-pics/bowls/packedbowlorsalad-sm.webp", isNew: false },
    { src: "food-pics/bowls/alohaspameggbowl-sm.webp", isNew: false },
  ];

  /* Number tiles (0–N) only when a sheet cell has BOTH a lower and upper
     bound. Unbounded fields must not become an infinite pill strip. */
  var SPEED_TILES = {
    scroll: { min: 0, max: 5 },
    presentation: { min: 0, max: 7 },
  };

  /* Live Motion table defaults (Ken Burns / Slideshow). Preview scales these
     down for the small hero. Higher Presentation Speed = faster (1/speed). */
  var MOTION_DEFAULTS = {
    punchIn: 3.4,
    hold: 1,
    punchOut: 0.45,
    zoomMin: 0.93,
    zoomMax: 1,
    previewScale: 0.7,
  };

  var STICKER = {
    body: "assets/stickers/Sticker-Body.webp",
    shadow: "assets/stickers/Sticker-Shadow.webp",
  };

  var DEFAULT_DRAFT = {
    themeName: "Toki Default",
    background: "main",
    patternType: "stripes",
    patternColor1: "special",
    patternColor2: "highlight",
    wallpaper: "galaxy",
    scrollSpeed: 1,
    presentation: "slideshow",
    encoreStyle: "hard_shadow",
    encoreSpot: "black",
    encoreBg: "secondary",
    presentationSpeed: 1,
    dataSource: "restaurant",
    requireRestart: "yes",
    systemFont: "poppins",
  };

  global.TOKI_MANAGER_DATA = {
    version: "1.0",
    settingsSheetId: SETTINGS_SHEET_ID,
    settingsSheetUrl:
      "https://docs.google.com/spreadsheets/d/" + SETTINGS_SHEET_ID + "/edit",
    dataSources: DATA_SOURCES,
    themes: THEMES,
    colorRoles: COLOR_ROLES,
    backgroundOptions: BACKGROUND_OPTIONS,
    patternTypes: PATTERN_TYPES,
    wallpapers: WALLPAPERS,
    presentationStyles: PRESENTATION_STYLES,
    encoreStyles: ENCORE_STYLES,
    encoreSpotColors: ENCORE_SPOT_COLORS,
    fonts: FONTS,
    yesNo: YES_NO,
    zeroOne: ZERO_ONE,
    boards: BOARDS,
    comingSoonFeatures: COMING_SOON_FEATURES,
    previewItems: PREVIEW_ITEMS,
    speedTiles: SPEED_TILES,
    motionDefaults: MOTION_DEFAULTS,
    sticker: STICKER,
    defaultDraft: DEFAULT_DRAFT,
  };
})(window);

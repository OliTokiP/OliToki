/* QUARANTINED — not loaded by boards.
 * Snapshot taken 2026-08-13 when live boards went API-only.
 * Restore path: see README.md in this folder.
 */

/* loadSheetStylesByName / loadSheetFillsByName / loadBoardSheetStyles */

  /**
   * Styles for one sheet name from the cached workbook xlsx (single download).
   */
  async function loadSheetStylesByName(sheetNameMatch, opts) {
    opts = opts || {};
    // Wall: no xlsx unless allowInWall (drinks rich text)
    if (isPreviewWall() && !opts.allowInWall) {
      return { fills: {}, fonts: {}, rich: {} };
    }
    const id = (cfg.googleSheetId || "").trim();
    if (!id) return { fills: {}, fonts: {}, rich: {} };
    const cacheKey = String(sheetNameMatch || "").toLowerCase();
    if (
      _workbookXlsxCache.sheetId === id &&
      _workbookXlsxCache.stylesByMatch[cacheKey]
    ) {
      return _workbookXlsxCache.stylesByMatch[cacheKey];
    }
    const buf = await fetchWorkbookXlsxBuffer(false, opts);
    // Re-check after await (another caller may have filled the cache)
    if (
      _workbookXlsxCache.sheetId === id &&
      _workbookXlsxCache.stylesByMatch[cacheKey]
    ) {
      return _workbookXlsxCache.stylesByMatch[cacheKey];
    }
    const meta = await extractSheetStylesFromXlsx(buf, sheetNameMatch);
    if (_workbookXlsxCache.sheetId === id) {
      _workbookXlsxCache.stylesByMatch[cacheKey] = meta;
    }
    return meta;
  }

  async function loadSheetFillsByName(sheetNameMatch, opts) {
    const meta = await loadSheetStylesByName(sheetNameMatch, opts);
    return meta.fills || {};
  }

  /**
   * Board-tab fills/fonts/rich text (announcement copy colors, stripe fills, …).
   * Drinks layout: chrome lives on "Board 4" (renamed from Announcements /
   * Drinks Deals). NOT the dedicated "Drinks" items sheet — matching "Drinks"
   * would pull the wrong tab and drop intentional G-sheet font colors.
   * One xlsx buffer; try name candidates without re-downloading.
   * @param {object} [opts] { allowInWall } for Board 4 rich text in multi-board
   */
  async function loadBoardSheetStyles(opts) {
    opts = opts || {};
    // Drinks: allow xlsx even in wall so announcement rich text works
    if (isDrinks) opts = Object.assign({ allowInWall: true }, opts);
    if (isHandhelds) return loadSheetStylesByName("Handhelds", opts);
    if (!isDrinks) return { fills: {}, fonts: {}, rich: {} };

    // Prefer live Announcements tab (gid 149404218); Board 4 is archive chrome
    const candidates = [
      "Announcements",
      "Board 4",
      "Drinks Deals",
      "Deals",
      "Announcement",
    ];
    let lastErr = null;
    // Ensure buffer is warm once, then extract each candidate from it
    try {
      await fetchWorkbookXlsxBuffer(false, opts);
    } catch (err) {
      throw err;
    }
    for (let i = 0; i < candidates.length; i++) {
      try {
        const meta = await loadSheetStylesByName(candidates[i], opts);
        const fonts = meta.fonts || {};
        const rich = meta.rich || {};
        const fills = meta.fills || {};
        if (
          Object.keys(fonts).length ||
          Object.keys(rich).length ||
          Object.keys(fills).length
        ) {
          tokiInfo("Board styles sheet:", candidates[i]);
          return meta;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    return { fills: {}, fonts: {}, rich: {} };
  }


/* loadMenuFromGoogleSheet — xlsx warm + board styles */

    if (opts.forceXlsxRefresh) invalidateWorkbookXlsxCache();

    // Wall embeds: skip full xlsx/SheetJS inflate (×4 kills low-RAM WebViews)
    const needXlsx =
      !isPreviewWall() &&
      (isDrinks ||
        isHandhelds ||
        !!(cfg.proteinSheetGid || cfg.saucesSheetGid || cfg.styleThemeGid));

    // Overlap one workbook download with all CSV hops
    const xlsxWarm = needXlsx
      ? fetchWorkbookXlsxBuffer(!!opts.forceXlsxRefresh).catch(function (err) {
          console.warn("Workbook xlsx unavailable:", err);
          return null;
        })
      : Promise.resolve(null);

    const csvJobs = {
      main: fetchSheetRows(cfg.googleSheetGid || "0"),
    };
    if (cfg.proteinSheetGid != null && cfg.proteinSheetGid !== "") {
      csvJobs.protein = fetchSheetRows(cfg.proteinSheetGid);
    }
    if (cfg.saucesSheetGid != null && cfg.saucesSheetGid !== "") {
      csvJobs.sauces = fetchSheetRows(cfg.saucesSheetGid);
    }
    if (cfg.drinksSheetGid != null && cfg.drinksSheetGid !== "") {
      // Board 4 content and/or boards 1–3 footer drinks box
      csvJobs.drinks = fetchSheetRows(cfg.drinksSheetGid);
    }
    if (cfg.veggiesSheetGid != null && cfg.veggiesSheetGid !== "") {
      // Boards 1–3 footer + Board 4 Include Footer Box=Veggies
      csvJobs.veggies = fetchSheetRows(cfg.veggiesSheetGid);
    }
    // Beta Features on EVERY board — Motion table drives Punch/Hold/Out digits
    // (Board 4 previously skipped this → hardcoded defaults → different timing).
    // Boards 1–3 also use Include Footer Boxes fallback from the same tab.
    csvJobs.beta = fetchSheetRows(BETA_FEATURES_GID);
    if (cfg.styleThemeGid != null && cfg.styleThemeGid !== "") {
      csvJobs.style = fetchSheetRows(cfg.styleThemeGid);
    }
    if (cfg.debugMenuGid != null && cfg.debugMenuGid !== "") {
      csvJobs.debug = fetchSheetRows(cfg.debugMenuGid);
    }

    const csvKeys = Object.keys(csvJobs);
    const csvSettled = await Promise.all(
      csvKeys.map(function (k) {
        return csvJobs[k].then(
          function (rows) {
            return { key: k, rows: rows, err: null };
          },
          function (err) {
            return { key: k, rows: null, err: err };
          }
        );
      })
    );
    const csv = {};
    csvSettled.forEach(function (r) {
      if (r.err) {
        tokiWarn("CSV fetch failed (" + r.key + "):", r.err);
      }
      csv[r.key] = r.rows;
    });

    // Soft refresh: any missing tab ⇒ abort (keep last good UI; no partial apply)
    if (opts.soft) {
      const failed = csvSettled.filter(function (r) {
        return r.err;
      });
      if (failed.length) {
        throw (
          failed[0].err ||
          new Error("soft refresh: sheet fetch incomplete (offline?)")
        );
      }
    }

    if (!csv.main) {
      const mainFail = csvSettled.filter(function (r) {
        return r.key === "main" && r.err;
      })[0];
      throw (
        (mainFail && mainFail.err) ||
        new Error("Board sheet CSV failed to load")
      );
    }

    // Change detection for soft refresh (and baseline for next soft)
    const dataFingerprint = fingerprintSheetPayload({
      main: csv.main,
      protein: csv.protein || null,
      sauces: csv.sauces || null,
      drinks: csv.drinks || null,
      veggies: csv.veggies || null,
      beta: csv.beta || null,
      style: csv.style || null,
    });
    if (
      opts.soft &&
      _lastDataFingerprint != null &&
      dataFingerprint === _lastDataFingerprint
    ) {
      tokiInfo("refresh: sheet unchanged — skip re-render");
      const unchanged = { __tokiUnchanged: true, _fingerprint: dataFingerprint };
      return unchanged;
    }

    await xlsxWarm;

    // Cell fills + fonts + rich text for announcements.
    // Wall: skip handhelds xlsx; drinks still load Board 4 styles (rich text).
    const loadBoardStyles =
      isDrinks || (!isPreviewWall() && isHandhelds);
    if (loadBoardStyles) {
      try {
        const meta = await loadBoardSheetStyles();
        sheetFills = meta.fills || {};
        sheetFonts = meta.fonts || {};
        sheetRich = meta.rich || {};
        if (isDrinks && Object.keys(sheetRich).length) {
          tokiInfo(
            "announcement rich-text runs loaded",
            Object.keys(sheetRich).length
          );
        }
      } catch (err) {
        tokiWarn("Could not load sheet styles (typed hex still works):", err);
        sheetFills = {};
        sheetFonts = {};
        sheetRich = {};
      }
    } else {
      if (isPreviewWall() && isHandhelds) {
        tokiInfo("sheet styles skipped (preview-wall handhelds)");
      }
      sheetFills = {};
      sheetFonts = {};
      sheetRich = {};
    }


/* loadMenuFromXlsx — local style extract */

    // Cell fills / fonts / rich text for this board (drinks + handhelds)
    if (isDrinks || isHandhelds) {
      try {
        let meta = { fills: {}, fonts: {}, rich: {} };
        if (isHandhelds) {
          meta = await extractSheetStylesFromXlsx(buf, "Handhelds");
        } else {
          // Prefer Board 4 / Announcements over "Drinks" (items sheet)
          const localMatches = [
            "Board 4",
            "Announcements",
            "Drinks Deals",
            "Deals",
            "Announcement",
          ];
          for (let i = 0; i < localMatches.length; i++) {
            try {
              const m = await extractSheetStylesFromXlsx(buf, localMatches[i]);
              if (
                Object.keys(m.fonts || {}).length ||
                Object.keys(m.rich || {}).length ||
                Object.keys(m.fills || {}).length
              ) {
                meta = m;
                break;
              }
            } catch (e) {
              /* try next */
            }
          }
        }
        sheetFills = meta.fills || {};
        sheetFonts = meta.fonts || {};
        sheetRich = meta.rich || {};
      } catch (err) {
        console.warn("Local xlsx board styles unavailable:", err);
        sheetFills = {};
        sheetFonts = {};
        sheetRich = {};
      }
    } else {
      sheetFills = {};
      sheetFonts = {};
      sheetRich = {};
    }


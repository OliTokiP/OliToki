/* QUARANTINED — not loaded by boards.
 * Snapshot taken 2026-08-13 when live boards went API-only.
 * Restore path: see README.md in this folder.
 */

  async function inflateRaw(data) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("DecompressionStream not available");
    }
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([data]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  /**
   * Minimal ZIP reader via end-of-central-directory (handles data descriptors).
   * Only extracts paths we care about for fill parsing.
   */
  async function readZipEntries(arrayBuffer, wantedPrefixes) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const entries = {};
    const prefixes = wantedPrefixes || ["xl/"];

    // Find EOCD (search last 64KB)
    let eocd = -1;
    const searchFrom = Math.max(0, bytes.length - 65536);
    for (let i = bytes.length - 22; i >= searchFrom; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("ZIP EOCD not found");

    const cdOffset = view.getUint32(eocd + 16, true);
    const cdEntries = view.getUint16(eocd + 10, true);
    let offset = cdOffset;

    for (let n = 0; n < cdEntries && offset + 46 <= bytes.length; n++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      const method = view.getUint16(offset + 10, true);
      const compSize = view.getUint32(offset + 20, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLen);
      const name = new TextDecoder("utf-8").decode(nameBytes);
      offset += 46 + nameLen + extraLen + commentLen;

      const wanted = prefixes.some(
        (p) => name === p || name.indexOf(p) === 0
      );
      if (!wanted) continue;
      // Skip bulky media
      if (/\.(png|jpe?g|gif|emf|wmf)$/i.test(name)) continue;

      // Local file header
      if (view.getUint32(localOffset, true) !== 0x04034b50) continue;
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const comp = bytes.subarray(dataStart, dataStart + compSize);

      if (method === 0) {
        entries[name] = comp;
      } else if (method === 8) {
        try {
          entries[name] = await inflateRaw(comp);
        } catch (err) {
          console.warn("inflate failed for", name, err);
        }
      }
    }
    return entries;
  }

  function xmlLocal(name) {
    const i = name.indexOf("}");
    return i >= 0 ? name.slice(i + 1) : name;
  }

  function parseXlsxRgb(colorEl) {
    if (!colorEl) return null;
    const rgb = colorEl.getAttribute("rgb");
    if (rgb) {
      const s = rgb.length === 8 ? rgb.slice(2) : rgb;
      return normalizeHex(s);
    }
    // theme colors: treat theme 0/1 carefully; skip unresolved themes
    return null;
  }

  /**
   * Google workbook xlsx cache — one network download serves every
   * loadSheetStylesByName / fills request (Protein, Style, Announcements, …).
   * Soft reloads reuse the buffer until TTL so periodic refresh stays snappy.
   */
  const XLSX_CACHE_TTL_MS = 5 * 60 * 1000;
  let _workbookXlsxCache = {
    buffer: null,
    entries: null,
    fetchedAt: 0,
    sheetId: "",
    stylesByMatch: {}, // lowercased sheet name match → { fills, fonts, rich }
  };

  function invalidateWorkbookXlsxCache() {
    _workbookXlsxCache = {
      buffer: null,
      entries: null,
      fetchedAt: 0,
      sheetId: "",
      stylesByMatch: {},
    };
  }

  /**
   * @param {boolean} forceRefresh
   * @param {object} [opts]
   * @param {boolean} [opts.allowInWall] Board 4 rich text may load xlsx even in wall
   */
  async function fetchWorkbookXlsxBuffer(forceRefresh, opts) {
    opts = opts || {};
    // Wall: skip xlsx unless explicitly allowed (drinks announcement rich text)
    if (isPreviewWall() && !opts.allowInWall) {
      throw new Error("preview-wall: xlsx disabled");
    }
    const id = (cfg.googleSheetId || "").trim();
    if (!id) throw new Error("No googleSheetId in config");
    const now = Date.now();
    if (
      !forceRefresh &&
      _workbookXlsxCache.buffer &&
      _workbookXlsxCache.sheetId === id &&
      now - _workbookXlsxCache.fetchedAt < XLSX_CACHE_TTL_MS
    ) {
      return _workbookXlsxCache.buffer;
    }
    const useProxy = await detectSheetsApiProxy();
    const url = useProxy
      ? "/api/sheets/xlsx?t=" +
        now +
        (forceRefresh ? "&force=1" : "")
      : "https://docs.google.com/spreadsheets/d/" +
        encodeURIComponent(id) +
        "/export?format=xlsx&cachebust=" +
        now;
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const res = await fetch(url, { cache: "no-store", mode: "cors" });
    if (!res.ok) {
      throw new Error(
        "Xlsx export failed (" +
          res.status +
          ")" +
          (useProxy
            ? " via API proxy — enable Drive API + share sheet with service account"
            : "")
      );
    }
    const buf = await res.arrayBuffer();
    // Detect HTML error pages masquerading as xlsx
    const head = new Uint8Array(buf.slice(0, 4));
    const isZip = head[0] === 0x50 && head[1] === 0x4b; // PK
    if (!isZip) {
      throw new Error(
        "Xlsx response was not a workbook (sheet private or API misconfigured)"
      );
    }
    const ms =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      t0;
    _workbookXlsxCache = {
      buffer: buf,
      entries: null,
      fetchedAt: now,
      sheetId: id,
      stylesByMatch: {},
    };
    console.info(
      "Workbook xlsx:",
      (buf.byteLength / 1024).toFixed(1) + "KB in " + Math.round(ms) + "ms",
      useProxy ? "(API proxy)" : "(public export)"
    );
    return buf;
  }

  async function getWorkbookZipEntries(arrayBuffer) {
    if (
      _workbookXlsxCache.buffer === arrayBuffer &&
      _workbookXlsxCache.entries
    ) {
      return _workbookXlsxCache.entries;
    }
    const entries = await readZipEntries(arrayBuffer, [
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/sharedStrings.xml",
      "xl/_rels/",
      "xl/worksheets/",
    ]);
    if (_workbookXlsxCache.buffer === arrayBuffer) {
      _workbookXlsxCache.entries = entries;
    }
    return entries;
  }

  /**
   * True for archived tabs like "Proteins (old)", "Board 1 (old)".
   * Live renamed sheets use bare titles (Proteins / Sauces / Drinks / Board N).
   */
  function isLegacySheetName(name) {
    return /\(\s*old\s*\)/i.test(String(name || ""));
  }

  /**
   * Choose the best workbook tab for a needle or predicate.
   * Prefer non-(old) exact/near-exact titles so "Proteins" wins over "Proteins (old)".
   *
   * @param {string[]} names
   * @param {object} opts
   * @param {string|string[]} [opts.exact] preferred exact titles (case-insensitive)
   * @param {RegExp|function} [opts.match] fallback matcher
   * @param {string} [opts.contains] substring needle (xlsx fill path)
   * @param {boolean} [opts.allowLegacy=true] last-resort match including (old)
   * @returns {string|null}
   */
  function pickBestSheetName(names, opts) {
    opts = opts || {};
    const list = names || [];
    if (!list.length) return null;
    const allowLegacy = opts.allowLegacy !== false;

    const exactList = []
      .concat(opts.exact || [])
      .map(function (s) {
        return String(s || "")
          .trim()
          .toLowerCase();
      })
      .filter(Boolean);

    function tryExact(skipLegacy) {
      for (let e = 0; e < exactList.length; e++) {
        const want = exactList[e];
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          if (skipLegacy && isLegacySheetName(n)) continue;
          if (String(n || "").trim().toLowerCase() === want) return n;
        }
      }
      return null;
    }

    function tryMatch(skipLegacy) {
      const m = opts.match;
      if (!m) return null;
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (skipLegacy && isLegacySheetName(n)) continue;
        if (typeof m === "function" ? m(n) : m.test(String(n || ""))) return n;
      }
      return null;
    }

    function tryContains(skipLegacy) {
      const needle = String(opts.contains || "")
        .trim()
        .toLowerCase();
      if (!needle) return null;
      let best = null;
      let bestScore = -1;
      for (let i = 0; i < list.length; i++) {
        const n = String(list[i] || "");
        if (skipLegacy && isLegacySheetName(n)) continue;
        const low = n.trim().toLowerCase();
        if (low.indexOf(needle) === -1) continue;
        // Higher = better. Exact / plural of needle beat partial + (old).
        let score = 10;
        if (low === needle) score = 100;
        else if (low === needle + "s" || low === needle.replace(/s$/, ""))
          score = 90;
        else if (low.indexOf(needle) === 0 && low.indexOf("(") === -1)
          score = 50;
        if (isLegacySheetName(n)) score -= 80;
        if (score > bestScore) {
          bestScore = score;
          best = list[i];
        }
      }
      return best;
    }

    return (
      tryExact(true) ||
      tryMatch(true) ||
      tryContains(true) ||
      (allowLegacy && (tryExact(false) || tryMatch(false) || tryContains(false))) ||
      null
    );
  }

  /**
   * Extract fills + font styles (+ rich text) from a workbook sheet.
   * Returns { fills, fonts, rich } keyed by cell ref (e.g. "F2").
   */
  async function extractSheetStylesFromXlsx(arrayBuffer, sheetNameMatch) {
    const empty = { fills: {}, fonts: {}, rich: {} };
    const entries = await getWorkbookZipEntries(arrayBuffer);
    const dec = new TextDecoder("utf-8");
    const parser = new DOMParser();

    const stylesXml = entries["xl/styles.xml"];
    if (!stylesXml) return empty;
    const stylesDoc = parser.parseFromString(dec.decode(stylesXml), "text/xml");
    const fillNodes = [];
    const fontStyles = []; // { bold, italic, color }

    for (const el of stylesDoc.getElementsByTagName("*")) {
      if (xmlLocal(el.tagName) === "fills") {
        for (const child of el.children || []) {
          if (xmlLocal(child.tagName) === "fill") fillNodes.push(child);
        }
      }
      if (xmlLocal(el.tagName) === "fonts") {
        for (const child of el.children || []) {
          if (xmlLocal(child.tagName) !== "font") continue;
          let bold = false;
          let italic = false;
          let col = null;
          for (const f of child.children || []) {
            const n = xmlLocal(f.tagName);
            if (n === "b") bold = true;
            if (n === "i") italic = true;
            if (n === "color") col = parseXlsxRgb(f);
          }
          fontStyles.push({ bold: bold, italic: italic, color: col });
        }
      }
    }

    const fillColors = fillNodes.map((fill) => {
      let pattern = null;
      for (const ch of fill.children || []) {
        if (xmlLocal(ch.tagName) === "patternFill") pattern = ch;
      }
      if (!pattern) return null;
      if (pattern.getAttribute("patternType") !== "solid") return null;
      for (const ch of pattern.children || []) {
        if (xmlLocal(ch.tagName) === "fgColor") return parseXlsxRgb(ch);
      }
      return null;
    });

    const cellXfs = [];
    const cellStyleXfs = [];
    for (const el of stylesDoc.getElementsByTagName("*")) {
      const tag = xmlLocal(el.tagName);
      if (tag === "cellXfs") {
        for (const xf of el.children || []) {
          if (xmlLocal(xf.tagName) === "xf") cellXfs.push(xf);
        }
      }
      if (tag === "cellStyleXfs") {
        for (const xf of el.children || []) {
          if (xmlLocal(xf.tagName) === "xf") cellStyleXfs.push(xf);
        }
      }
    }

    /** Horizontal align from xf / style chain → "left"|"center"|"right"|null */
    function xfTextAlign(xf, allowStyleLookup) {
      if (!xf) return null;
      for (const ch of xf.children || []) {
        if (xmlLocal(ch.tagName) !== "alignment") continue;
        const h = String(ch.getAttribute("horizontal") || "")
          .trim()
          .toLowerCase();
        if (h === "left" || h === "right" || h === "center") return h;
        if (h === "justify" || h === "distributed" || h === "fill") {
          return "center";
        }
        // "general" / empty → no explicit align
        return null;
      }
      if (allowStyleLookup === false) return null;
      const apply = xf.getAttribute("applyAlignment");
      if (apply === "0") return null;
      const styleId = xf.getAttribute("xfId");
      if (styleId != null && styleId !== "" && cellStyleXfs[Number(styleId)]) {
        return xfTextAlign(cellStyleXfs[Number(styleId)], false);
      }
      return null;
    }

    // Rich text shared strings (index → runs)
    const richBySs = {};
    const ssXml = entries["xl/sharedStrings.xml"];
    if (ssXml) {
      const ssDoc = parser.parseFromString(dec.decode(ssXml), "text/xml");
      let ssIndex = 0;
      for (const el of ssDoc.getElementsByTagName("*")) {
        if (xmlLocal(el.tagName) !== "si") continue;
        const runs = [];
        let hasRich = false;
        for (const child of el.children || []) {
          if (xmlLocal(child.tagName) === "r") {
            hasRich = true;
            let bold = false;
            let italic = false;
            let col = null;
            let text = "";
            for (const part of child.children || []) {
              const pn = xmlLocal(part.tagName);
              if (pn === "rPr") {
                for (const rp of part.children || []) {
                  const rn = xmlLocal(rp.tagName);
                  // Google/Excel: <b/> or <b val="1"/> = bold; <b val="0"/> = not bold
                  if (rn === "b") {
                    const bv = rp.getAttribute("val");
                    bold =
                      bv == null ||
                      bv === "" ||
                      bv === "1" ||
                      bv === "true" ||
                      bv === "on";
                  }
                  if (rn === "i") {
                    const iv = rp.getAttribute("val");
                    italic =
                      iv == null ||
                      iv === "" ||
                      iv === "1" ||
                      iv === "true" ||
                      iv === "on";
                  }
                  if (rn === "color") col = parseXlsxRgb(rp);
                }
              }
              if (pn === "t") text = part.textContent || "";
            }
            runs.push({
              text: text,
              bold: bold,
              italic: italic,
              color: col,
            });
          }
        }
        if (hasRich && runs.length) richBySs[ssIndex] = runs;
        ssIndex++;
      }
    }

    // Find worksheet path
    const wbXml = entries["xl/workbook.xml"];
    const relsXml = entries["xl/_rels/workbook.xml.rels"];
    if (!wbXml || !relsXml) return empty;
    const wbDoc = parser.parseFromString(dec.decode(wbXml), "text/xml");
    const relsDoc = parser.parseFromString(dec.decode(relsXml), "text/xml");
    const ridToTarget = {};
    for (const rel of relsDoc.getElementsByTagName("*")) {
      if (xmlLocal(rel.tagName) !== "Relationship") continue;
      let t = rel.getAttribute("Target") || "";
      if (t && t.indexOf("xl/") !== 0) t = "xl/" + t.replace(/^\//, "");
      ridToTarget[rel.getAttribute("Id")] = t;
    }

    let sheetPath = null;
    // Collect tab names first so we can prefer "Proteins" over "Proteins (old)".
    const sheetEls = [];
    for (const sh of wbDoc.getElementsByTagName("*")) {
      if (xmlLocal(sh.tagName) !== "sheet") continue;
      sheetEls.push(sh);
    }
    const tabNames = sheetEls.map(function (sh) {
      return sh.getAttribute("name") || "";
    });
    const chosenName = sheetNameMatch
      ? pickBestSheetName(tabNames, { contains: String(sheetNameMatch) })
      : null;
    if (chosenName) {
      for (let si = 0; si < sheetEls.length; si++) {
        const sh = sheetEls[si];
        if ((sh.getAttribute("name") || "") !== chosenName) continue;
        const rid =
          sh.getAttribute("r:id") ||
          sh.getAttributeNS(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "id"
          );
        sheetPath = ridToTarget[rid];
        break;
      }
    }
    if (!sheetPath) {
      const sheets = [];
      for (const sh of wbDoc.getElementsByTagName("*")) {
        if (xmlLocal(sh.tagName) === "sheet") sheets.push(sh);
      }
      if (sheets.length >= 4) {
        const sh = sheets[3];
        const rid =
          sh.getAttribute("r:id") ||
          sh.getAttributeNS(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "id"
          );
        sheetPath = ridToTarget[rid];
      }
    }
    if (!sheetPath || !entries[sheetPath]) return empty;

    const sheetDoc = parser.parseFromString(
      dec.decode(entries[sheetPath]),
      "text/xml"
    );
    const fills = {};
    const fonts = {};
    const rich = {};
    for (const c of sheetDoc.getElementsByTagName("*")) {
      if (xmlLocal(c.tagName) !== "c") continue;
      const ref = c.getAttribute("r");
      if (!ref) continue;
      const s = c.getAttribute("s");
      const t = c.getAttribute("t");
      let vText = null;
      for (const ch of c.children || []) {
        if (xmlLocal(ch.tagName) === "v") vText = ch.textContent;
      }

      if (s != null) {
        const xf = cellXfs[Number(s)];
        if (xf) {
          const fillId = Number(xf.getAttribute("fillId") || 0);
          const fontId = Number(xf.getAttribute("fontId") || 0);
          const fillColor = fillColors[fillId];
          if (fillColor) fills[ref] = fillColor;
          const fs = fontStyles[fontId];
          const align = xfTextAlign(xf, true);
          if (fs || align) {
            fonts[ref] = {
              bold: !!(fs && fs.bold),
              italic: !!(fs && fs.italic),
              color: (fs && fs.color) || null,
              align: align || null,
            };
          }
        }
      }

      // Rich text: shared string index with multiple runs
      if (t === "s" && vText != null && richBySs[Number(vText)]) {
        rich[ref] = richBySs[Number(vText)];
      }
    }
    return { fills: fills, fonts: fonts, rich: rich };
  }

  /** Back-compat: fills only */
  async function extractSheetFillsFromXlsx(arrayBuffer, sheetNameMatch) {
    const meta = await extractSheetStylesFromXlsx(
      arrayBuffer,
      sheetNameMatch
    );
    return meta.fills || {};
  }


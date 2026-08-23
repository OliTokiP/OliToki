/**
 * Shared Footer Box wrap packer.
 * Live boards (menu.js) and the inquiry lab (box-pack-lab.html) both call this.
 * Scorer is unchanged: LPT + greedy, type size / longest-row fill / evenness,
 * then rows stack fullest → shortest.
 */
(function (root) {
  "use strict";

  let _measureCanvas = null;
  let _measureProbe = null;
  let _measureHost = null;

  function setMeasureHost(el) {
    _measureHost = el || null;
  }

  function getMeasureHost() {
    return _measureHost;
  }

  function detachProbe() {
    if (_measureProbe && _measureProbe.parentNode) {
      _measureProbe.parentNode.removeChild(_measureProbe);
    }
  }

  /**
   * Measure text width for packing. Prefer a DOM probe (matches Roboto
   * Condensed + letter-spacing); canvas is a fallback only.
   */
  function measureTextPx(text, font) {
    const str = String(text || "");
    const face =
      (document.documentElement.getAttribute("data-system-font") || "") ===
      "poppins"
        ? "Poppins, Roboto, sans-serif"
        : "Roboto Condensed, Roboto, sans-serif";
    const fontStr = font || "700 30px " + face;
    try {
      const host = _measureHost || document.body;
      if (!_measureProbe) {
        _measureProbe = document.createElement("span");
        _measureProbe.setAttribute("aria-hidden", "true");
        _measureProbe.style.cssText =
          "position:absolute;left:-99999px;top:0;white-space:nowrap;" +
          "visibility:hidden;pointer-events:none;margin:0;padding:0;border:0;";
      }
      if (_measureProbe.parentNode !== host) {
        host.appendChild(_measureProbe);
      }
      if (_measureHost) {
        _measureProbe.style.font = "";
        _measureProbe.style.letterSpacing = "";
        if (
          (document.documentElement.getAttribute("data-system-font") || "") ===
          "poppins"
        ) {
          _measureProbe.style.fontFamily = "Poppins, Roboto, sans-serif";
        }
      } else {
        _measureProbe.style.font = fontStr;
        if (/condensed/i.test(fontStr)) {
          _measureProbe.style.letterSpacing = "-0.015em";
        } else {
          _measureProbe.style.letterSpacing = "normal";
        }
      }
      _measureProbe.textContent = str;
      const w = _measureProbe.offsetWidth;
      if (w > 0) return w;
    } catch (err) {
      /* fall through to canvas */
    }
    if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
    const ctx = _measureCanvas.getContext("2d");
    if (!ctx) return str.length * 10;
    ctx.font = fontStr;
    return ctx.measureText(str).width;
  }

  function parsePadXY(cs) {
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pt = parseFloat(cs.paddingTop) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
    return { x: pl + pr, y: pt + pb };
  }

  function balanceOptsFromBox(el, extra) {
    const cs = window.getComputedStyle(el);
    const pad = parsePadXY(cs);
    const fontSize = parseFloat(cs.fontSize) || 30;
    const lineHeight =
      cs.lineHeight && cs.lineHeight !== "normal"
        ? parseFloat(cs.lineHeight)
        : fontSize * 1.25;
    const rowGap = parseFloat(cs.rowGap) || 0;
    const innerW = Math.max(1, (el.clientWidth || 0) - pad.x);
    return Object.assign(
      {
        font:
          (cs.fontStyle !== "normal" ? cs.fontStyle + " " : "") +
          (cs.fontWeight || "700") +
          " " +
          cs.fontSize +
          " " +
          cs.fontFamily,
        containerWidth: Math.max(1, innerW * 0.98),
        containerHeight: Math.max(1, (el.clientHeight || 0) - pad.y),
        lineHeight: lineHeight + rowGap,
        maxLines: 8,
      },
      extra || {}
    );
  }

  function sortPackedLinesFullestFirst(lines) {
    lines.sort(function (a, b) {
      if (!a.items.length) return 1;
      if (!b.items.length) return -1;
      if (Math.abs(b.width - a.width) > 0.5) return b.width - a.width;
      return a.items[0].idx - b.items[0].idx;
    });
    return lines;
  }

  function packLptLines(items, lineCount, sepW) {
    const lines = [];
    for (let i = 0; i < lineCount; i++) {
      lines.push({ items: [], width: 0 });
    }
    const sorted = items.slice().sort(function (a, b) {
      if (b.width !== a.width) return b.width - a.width;
      return a.idx - b.idx;
    });
    for (let s = 0; s < sorted.length; s++) {
      const it = sorted[s];
      let best = lines[0];
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].width < best.width) best = lines[i];
      }
      best.width += it.width + (best.items.length ? sepW : 0);
      best.items.push(it);
    }
    lines.forEach(function (line) {
      line.items.sort(function (a, b) {
        return a.idx - b.idx;
      });
      line.width = 0;
      for (let i = 0; i < line.items.length; i++) {
        line.width += line.items[i].width + (i ? sepW : 0);
      }
    });
    sortPackedLinesFullestFirst(lines);
    return lines.filter(function (ln) {
      return ln.items.length > 0;
    });
  }

  function packGreedyByWidth(items, sepW, boxW) {
    const lines = [];
    let cur = { items: [], width: 0 };
    const limit = Math.max(1, boxW);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const add = it.width + (cur.items.length ? sepW : 0);
      if (cur.items.length && cur.width + add > limit) {
        lines.push(cur);
        cur = { items: [], width: 0 };
      }
      cur.width += (cur.items.length ? sepW : 0) + it.width;
      cur.items.push(it);
    }
    if (cur.items.length) lines.push(cur);
    sortPackedLinesFullestFirst(lines);
    return lines;
  }

  function balanceItemsIntoLines(rawItems, opts) {
    const list = Array.isArray(rawItems) ? rawItems : [];
    const n = list.length;
    if (n === 0) {
      balanceItemsIntoLines.lastMeta = {
        tag: "",
        L: 0,
        fill: 0,
        typeScore: 0,
        score: 0,
        boxW: 0,
      };
      return [];
    }
    if (n === 1) {
      balanceItemsIntoLines.lastMeta = {
        tag: "single",
        L: 1,
        fill: 1,
        typeScore: 1,
        score: 1,
        boxW: Math.round((opts && opts.containerWidth) || 0),
      };
      return [list.slice()];
    }

    const o = opts || {};
    const font = o.font || "700 30px sans-serif";
    const sepText = o.sepText != null ? o.sepText : " · ";
    const sepW = measureTextPx(sepText, font);
    const boxW = Math.max(1, o.containerWidth || 280);
    const boxH = Math.max(1, o.containerHeight || 120);
    const lineH = Math.max(8, o.lineHeight || 36);
    const maxLines = Math.min(n, Math.max(1, o.maxLines || 8));
    const measureLabel =
      typeof o.measureLabel === "function"
        ? o.measureLabel
        : function (it, f) {
            return measureTextPx(it.label, f);
          };

    const WIDTH_PAD = _measureHost ? 1.02 : 1.08;
    const items = list.map(function (it, idx) {
      return {
        idx: idx,
        width: Math.max(1, measureLabel(it, font) * WIDTH_PAD),
        raw: it,
      };
    });

    const unmeasured = boxW < 8 || boxH < 8;

    let bestLines = null;
    let bestScore = -Infinity;
    let bestType = -Infinity;
    let bestTag = "";
    let bestFill = 0;
    const candidates = [];
    const forceL =
      o.forceLines > 0
        ? Math.min(maxLines, Math.max(1, Math.round(Number(o.forceLines))))
        : 0;

    function considerPacked(packed, tag) {
      if (!packed || !packed.length) return;
      let maxW = 0;
      let minW = Infinity;
      let sumW = 0;
      for (let i = 0; i < packed.length; i++) {
        if (packed[i].width > maxW) maxW = packed[i].width;
        if (packed[i].width < minW) minW = packed[i].width;
        sumW += packed[i].width;
      }
      if (maxW < 1) maxW = 1;
      if (minW === Infinity) minW = maxW;

      const scaleW = unmeasured ? 1 / maxW : boxW / maxW;
      const scaleH = unmeasured
        ? 1 / packed.length
        : boxH / (packed.length * lineH);
      const balance = minW / maxW;
      const fill = unmeasured ? 0.85 : Math.min(1, maxW / boxW);
      const avgFill = unmeasured
        ? 0.85
        : Math.min(1, sumW / (packed.length * boxW));
      const typeScore = Math.min(scaleW, scaleH);
      const L = packed.length;
      const score =
        typeScore * (0.58 + 0.12 * balance + 0.3 * fill) - L * 0.008;

      const lines = packed.map(function (ln) {
        return ln.items.map(function (it) {
          return it.raw;
        });
      });
      candidates.push({
        tag: tag,
        L: L,
        score: score,
        typeScore: typeScore,
        fill: fill,
        avgFill: avgFill,
        balance: balance,
        maxW: maxW,
        minW: minW,
        lines: lines,
      });
      if (score > bestScore) {
        bestScore = score;
        bestType = typeScore;
        bestLines = lines;
        bestTag = tag;
        bestFill = fill;
      }
    }

    if (forceL) {
      considerPacked(packLptLines(items, forceL, sepW), "lpt-" + forceL);
    } else {
      for (let L = 1; L <= maxLines; L++) {
        considerPacked(packLptLines(items, L, sepW), "lpt-" + L);
      }
      if (!unmeasured) {
        considerPacked(packGreedyByWidth(items, sepW, boxW * 0.96), "greedy");
        considerPacked(
          packGreedyByWidth(items, sepW, boxW * 0.88),
          "greedy-tight"
        );
      }

      if (candidates.length && bestType > 0) {
        let pick = null;
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          if (c.typeScore < bestType * 0.92) continue;
          if (
            !pick ||
            c.fill > pick.fill + 0.03 ||
            (Math.abs(c.fill - pick.fill) <= 0.03 && c.L < pick.L) ||
            (Math.abs(c.fill - pick.fill) <= 0.03 &&
              c.L === pick.L &&
              c.score > pick.score)
          ) {
            pick = c;
          }
        }
        if (pick) {
          bestLines = pick.lines;
          bestScore = pick.score;
          bestTag = (pick.tag || "?") + "*";
          bestFill = pick.fill;
          bestType = pick.typeScore;
        }
      }
    }

    if (!bestLines) bestLines = [list.slice()];

    if (typeof console !== "undefined" && console.info) {
      const summary = bestLines
        .map(function (ln) {
          return ln
            .map(function (it) {
              return it.label || it.name || "?";
            })
            .join(" · ");
        })
        .join(" || ");
      console.info(
        "Balanced wrap (" + bestLines.length + " lines, " + bestTag + "):",
        summary,
        "boxW=" + Math.round(boxW)
      );
    }
    balanceItemsIntoLines.lastMeta = {
      tag: bestTag,
      L: bestLines.length,
      fill: bestFill,
      typeScore: bestType,
      score: bestScore,
      boxW: Math.round(boxW),
    };
    return bestLines;
  }

  function fitBoxScale(el, minS, maxS, opts) {
    opts = opts || {};
    if (!el || !el.children || !el.children.length)
      return opts.returnScale ? minS : undefined;
    if (el.clientHeight <= 0 || el.clientWidth <= 0) {
      return opts.returnScale ? minS : undefined;
    }

    const fits = function (scale) {
      el.style.setProperty("--box-scale", String(scale));
      if (opts.proteinRows) {
        el.style.alignContent = "start";
      }
      void el.offsetHeight;

      let heightOk = el.scrollHeight <= el.clientHeight + 1;
      if (opts.proteinRows) {
        const rows = el.querySelectorAll(
          ".protein-row, .box-col-item, .sauce-col-item, .drink-col-item"
        );
        if (rows.length) {
          const last = rows[rows.length - 1];
          const padBot =
            parseFloat(window.getComputedStyle(el).paddingBottom) || 0;
          let contentH = last.offsetHeight;
          Array.prototype.forEach.call(last.children, function (ch) {
            if (ch.offsetHeight > contentH) contentH = ch.offsetHeight;
          });
          const bottom = last.offsetTop + contentH;
          heightOk = bottom + padBot <= el.clientHeight + 1;
        }
      }
      if (!heightOk) return false;

      if (opts.checkChildWidth) {
        const padXY = parsePadXY(window.getComputedStyle(el));
        const contentW = Math.max(1, el.clientWidth - padXY.x);
        for (let i = 0; i < el.children.length; i++) {
          const child = el.children[i];
          const isColRow =
            opts.proteinRows &&
            (child.classList.contains("protein-row") ||
              child.classList.contains("box-col-item") ||
              child.classList.contains("sauce-col-item") ||
              child.classList.contains("drink-col-item"));
          if (isColRow) {
            let natural = 0;
            Array.prototype.forEach.call(child.children, function (ch) {
              natural += ch.offsetWidth;
            });
            if (natural < 1) {
              const prev = child.style.width;
              child.style.width = "max-content";
              natural = child.offsetWidth;
              child.style.width = prev;
            }
            if (natural > child.clientWidth + 1) return false;
          } else if (child.classList.contains("wrap-line-row")) {
            let natural = 0;
            Array.prototype.forEach.call(child.children, function (ch) {
              natural += ch.offsetWidth;
            });
            if (natural < 1) {
              natural = child.scrollWidth;
            }
            if (natural > contentW - 2) return false;
          } else if (child.classList.contains("box-pack-lab-waste")) {
            continue;
          } else if (child.classList.contains("wrap-line-break")) {
            continue;
          } else if (child.offsetWidth > contentW + 1) {
            return false;
          }
        }
      }
      return true;
    };

    let lo = minS;
    let hi = maxS;
    let best = minS;

    if (!fits(lo)) {
      let s = lo;
      while (s > 0.3 && !fits(s)) s -= 0.02;
      best = Math.max(0.3, s);
      el.style.setProperty("--box-scale", String(best));
      if (opts.proteinRows) el.style.alignContent = "";
      return opts.returnScale ? best : undefined;
    }

    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const shrink =
      opts.shrinkFactor != null && isFinite(opts.shrinkFactor)
        ? opts.shrinkFactor
        : 0.97;
    best = Math.max(minS, best * shrink);
    let guard = 0;
    while (!fits(best) && best > minS && guard < 40) {
      best -= 0.015;
      guard++;
    }
    fits(best);
    if (opts.proteinRows) el.style.alignContent = "";
    return opts.returnScale ? best : undefined;
  }

  /** Name + optional (sub) + optional + $price — same string the live wrap probe uses. */
  function itemMeasureLabel(it) {
    const name = String((it && it.name) || "").trim();
    if (!name) return "";
    let label = name;
    const sub = it && it.subtitle ? String(it.subtitle).trim() : "";
    if (sub) label += " (" + sub + ")";
    let price = it && it.price != null ? String(it.price) : "";
    price = price.replace(/^\+\s*/, "").replace(/^\$/, "").trim();
    if (price) label += " + $" + price;
    return label;
  }

  root.TOKI_BOX_PACK = {
    setMeasureHost: setMeasureHost,
    getMeasureHost: getMeasureHost,
    detachProbe: detachProbe,
    measureTextPx: measureTextPx,
    parsePadXY: parsePadXY,
    balanceOptsFromBox: balanceOptsFromBox,
    packLptLines: packLptLines,
    sortPackedLinesFullestFirst: sortPackedLinesFullestFirst,
    packGreedyByWidth: packGreedyByWidth,
    balanceItemsIntoLines: balanceItemsIntoLines,
    fitBoxScale: fitBoxScale,
    itemMeasureLabel: itemMeasureLabel,
  };
})(typeof window !== "undefined" ? window : this);

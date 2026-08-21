/**
 * TokiMenu — Announcement Panel markdown (Board 4).
 *
 * Sheet Text cells are plain CSV. xlsx rich runs stay quarantined.
 * This renderer turns markdown into a safe DOM (textContent only — never
 * innerHTML of author copy). Single newlines stay as line breaks (Google
 * Sheet Alt+Enter), unlike CommonMark's "join with a space" paragraphs.
 *
 * Subset: cheat-sheet basic + tables, fenced code, strikethrough, task lists,
 * highlight == ==, sub ~ ~, sup ^ ^. Images: alt only (no remote fetch).
 * Links: painted, not navigated (Fire Stick).
 * Color HTML (Editing Toolbar / Obsidian): <font color>, <mark style="background">,
 * <span style="color|background">. Other HTML stays literal — never innerHTML.
 *
 * Authoring cheat sheet + demo examples: docs/ANNOUNCEMENT_MARKDOWN.md
 * and announcement-markdown.html (demoMessages()).
 */
(function (root) {
  "use strict";

  var CLS = {
    p: "announcement-line",
    h1: "announcement-line announcement-md-h1",
    h2: "announcement-line announcement-md-h2",
    h3: "announcement-line announcement-md-h3",
    quote: "announcement-md-blockquote",
    ul: "announcement-md-ul",
    ol: "announcement-md-ol",
    li: "announcement-line announcement-md-li",
    hr: "announcement-md-hr",
    code: "announcement-md-code",
    pre: "announcement-md-pre",
    table: "announcement-md-table",
    th: "announcement-md-th",
    td: "announcement-md-td",
    link: "announcement-md-link",
    imgAlt: "announcement-md-img-alt",
    mark: "announcement-md-mark",
    hilite: "announcement-md-hilite",
    color: "announcement-md-color",
    strike: "announcement-md-strike",
    check: "announcement-md-check",
    task: "announcement-md-task",
  };

  var NAMED_COLORS = {
    aliceblue: 1, antiquewhite: 1, aqua: 1, aquamarine: 1, azure: 1,
    beige: 1, bisque: 1, black: 1, blanchedalmond: 1, blue: 1, blueviolet: 1,
    brown: 1, burlywood: 1, cadetblue: 1, chartreuse: 1, chocolate: 1,
    coral: 1, cornflowerblue: 1, cornsilk: 1, crimson: 1, cyan: 1,
    darkblue: 1, darkcyan: 1, darkgoldenrod: 1, darkgray: 1, darkgreen: 1,
    darkgrey: 1, darkkhaki: 1, darkmagenta: 1, darkolivegreen: 1, darkorange: 1,
    darkorchid: 1, darkred: 1, darksalmon: 1, darkseagreen: 1, darkslateblue: 1,
    darkslategray: 1, darkslategrey: 1, darkturquoise: 1, darkviolet: 1,
    deeppink: 1, deepskyblue: 1, dimgray: 1, dimgrey: 1, dodgerblue: 1,
    firebrick: 1, floralwhite: 1, forestgreen: 1, fuchsia: 1, gainsboro: 1,
    ghostwhite: 1, gold: 1, goldenrod: 1, gray: 1, green: 1, greenyellow: 1,
    grey: 1, honeydew: 1, hotpink: 1, indianred: 1, indigo: 1, ivory: 1,
    khaki: 1, lavender: 1, lavenderblush: 1, lawngreen: 1, lemonchiffon: 1,
    lightblue: 1, lightcoral: 1, lightcyan: 1, lightgoldenrodyellow: 1,
    lightgray: 1, lightgreen: 1, lightgrey: 1, lightpink: 1, lightsalmon: 1,
    lightseagreen: 1, lightskyblue: 1, lightslategray: 1, lightslategrey: 1,
    lightsteelblue: 1, lightyellow: 1, lime: 1, limegreen: 1, linen: 1,
    magenta: 1, maroon: 1, mediumaquamarine: 1, mediumblue: 1, mediumorchid: 1,
    mediumpurple: 1, mediumseagreen: 1, mediumslateblue: 1, mediumspringgreen: 1,
    mediumturquoise: 1, mediumvioletred: 1, midnightblue: 1, mintcream: 1,
    mistyrose: 1, moccasin: 1, navajowhite: 1, navy: 1, oldlace: 1, olive: 1,
    olivedrab: 1, orange: 1, orangered: 1, orchid: 1, palegoldenrod: 1,
    palegreen: 1, paleturquoise: 1, palevioletred: 1, papayawhip: 1, peachpuff: 1,
    peru: 1, pink: 1, plum: 1, powderblue: 1, purple: 1, rebeccapurple: 1,
    red: 1, rosybrown: 1, royalblue: 1, saddlebrown: 1, salmon: 1, sandybrown: 1,
    seagreen: 1, seashell: 1, sienna: 1, silver: 1, skyblue: 1, slateblue: 1,
    slategray: 1, slategrey: 1, snow: 1, springgreen: 1, steelblue: 1, tan: 1,
    teal: 1, thistle: 1, tomato: 1, turquoise: 1, transparent: 1, violet: 1,
    wheat: 1, white: 1, whitesmoke: 1, yellow: 1, yellowgreen: 1,
  };

  function sanitizeCssColor(raw) {
    var s = String(raw || "").trim();
    if (!s || /url\s*\(|expression\s*\(|javascript:|@import|var\s*\(/i.test(s)) {
      return "";
    }
    if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) {
      return s.toLowerCase();
    }
    if (
      /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(
        s
      )
    ) {
      return s.replace(/\s+/g, " ");
    }
    if (
      /^hsla?\(\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?%\s*,\s*\d{1,3}(?:\.\d+)?%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(
        s
      )
    ) {
      return s.replace(/\s+/g, " ");
    }
    var named = s.toLowerCase();
    return NAMED_COLORS[named] ? named : "";
  }

  function attrValue(attrs, name) {
    var re = new RegExp(
      "(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
      "i"
    );
    var m = String(attrs || "").match(re);
    if (!m) return "";
    return m[1] || m[2] || m[3] || "";
  }

  function parseStyleColorProps(styleRaw) {
    var color = "";
    var background = "";
    String(styleRaw || "")
      .split(";")
      .forEach(function (part) {
        var idx = part.indexOf(":");
        if (idx < 0) return;
        var key = part.slice(0, idx).trim().toLowerCase();
        var val = part.slice(idx + 1).trim();
        var safe = sanitizeCssColor(val);
        if (!safe) return;
        if (key === "color") color = safe;
        if (key === "background" || key === "background-color") background = safe;
      });
    return { color: color, background: background };
  }

  function parseColorOpenTag(src, i) {
    if (src.charAt(i) !== "<") return null;
    var m = src.slice(i).match(/^<(font|mark|span)(\s+[^>]*)?>/i);
    if (!m) return null;
    var tag = m[1].toLowerCase();
    var attrs = String(m[2] || "").replace(/^\s+|\s+$/g, "");
    var color = sanitizeCssColor(attrValue(attrs, "color"));
    var fromStyle = parseStyleColorProps(attrValue(attrs, "style"));
    if (fromStyle.color) color = fromStyle.color;
    var background = fromStyle.background;
    if (!color && !background && tag !== "mark") return null;
    return {
      tag: tag,
      color: color,
      background: background,
      len: m[0].length,
    };
  }

  function findMatchingCloseTag(src, from, tag) {
    var openPat = new RegExp("<" + tag + "\\b", "i");
    var closePat = new RegExp("</" + tag + "\\s*>", "i");
    var depth = 1;
    var i = from;
    while (i < src.length) {
      var rest = src.slice(i);
      var om = rest.search(openPat);
      var cm = rest.search(closePat);
      if (cm < 0) return null;
      if (om >= 0 && om < cm) {
        var gt = src.indexOf(">", i + om);
        if (gt < 0) return null;
        depth += 1;
        i = gt + 1;
        continue;
      }
      var closeMatch = rest.slice(cm).match(closePat);
      if (!closeMatch) return null;
      if (depth === 1) {
        return { start: i + cm, end: i + cm + closeMatch[0].length };
      }
      depth -= 1;
      i = i + cm + closeMatch[0].length;
    }
    return null;
  }

  function isWordChar(c) {
    return c != null && /[A-Za-z0-9]/.test(c);
  }

  function headingMatch(line) {
    var m = String(line || "").match(/^(#{1,6})\s+(.*)$/);
    if (!m) return null;
    var level = Math.min(3, m[1].length);
    return { level: level, text: m[2] };
  }

  function isHrLine(line) {
    return /^\s{0,3}((-\s*){3,}|(\*\s*){3,}|(_\s*){3,})\s*$/.test(line);
  }

  function ulMatch(line) {
    return String(line || "").match(/^(\s*)([-*+])\s+(?:\[([ xX])\]\s+)?(.*)$/);
  }

  function olMatch(line) {
    return String(line || "").match(/^(\s*)(\d+)[.)]\s+(?:\[([ xX])\]\s+)?(.*)$/);
  }

  function indentOf(s) {
    var m = String(s || "").match(/^[ \t]*/);
    var raw = m ? m[0] : "";
    var n = 0;
    for (var i = 0; i < raw.length; i++) n += raw[i] === "\t" ? 4 : 1;
    return n;
  }

  function fenceOpen(line) {
    var m = String(line || "").match(/^\s{0,3}(```|~~~)(.*)$/);
    return m ? { fence: m[1], info: String(m[2] || "").trim() } : null;
  }

  function isFenceClose(line, fence) {
    var m = String(line || "").match(/^\s{0,3}(```|~~~)\s*$/);
    return !!(m && m[1] === fence);
  }

  function isTableSep(line) {
    var s = String(line || "").trim();
    if (s.indexOf("|") === -1) return false;
    return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(s);
  }

  function splitTableRow(line) {
    var s = String(line || "").trim();
    if (s.charAt(0) === "|") s = s.slice(1);
    if (s.charAt(s.length - 1) === "|") s = s.slice(0, -1);
    return s.split("|").map(function (c) {
      return c.replace(/^\s+|\s+$/g, "");
    });
  }

  function tableAligns(sepLine) {
    return splitTableRow(sepLine).map(function (cell) {
      var t = cell.trim();
      var left = t.charAt(0) === ":";
      var right = t.charAt(t.length - 1) === ":";
      if (left && right) return "center";
      if (right) return "right";
      return "left";
    });
  }

  function quoteText(line) {
    var m = String(line || "").match(/^\s{0,3}>\s?(.*)$/);
    return m ? m[1] : null;
  }

  /* ---------- inline ---------- */

  function findClosing(src, from, delim, opts) {
    opts = opts || {};
    var i = from;
    while (i < src.length) {
      if (src.charAt(i) === "\\" && i + 1 < src.length) {
        i += 2;
        continue;
      }
      if (src.slice(i, i + delim.length) === delim) {
        if (opts.noWordAfter && isWordChar(src.charAt(i + delim.length))) {
          i += 1;
          continue;
        }
        return i;
      }
      i += 1;
    }
    return -1;
  }

  function tokenizeInline(src) {
    src = String(src || "");
    var out = [];
    var i = 0;
    var buf = "";

    function flush() {
      if (buf) {
        out.push({ t: "text", v: buf });
        buf = "";
      }
    }

    function takeDelim(delim, tag, cls, extra) {
      extra = extra || {};
      if (src.slice(i, i + delim.length) !== delim) return false;
      if (extra.noWordBefore && isWordChar(src.charAt(i - 1))) return false;
      var start = i + delim.length;
      if (start >= src.length) return false;
      if (extra.noSpaceAfter && src.charAt(start) === " ") return false;
      var end = findClosing(src, start, delim, {
        noWordAfter: extra.noWordAfter,
      });
      if (end < 0 || end === start) return false;
      var inner = src.slice(start, end);
      if (extra.noSpaceBefore && inner.charAt(inner.length - 1) === " ") {
        return false;
      }
      flush();
      out.push({ t: "el", tag: tag, cls: cls, kids: tokenizeInline(inner) });
      i = end + delim.length;
      return true;
    }

    while (i < src.length) {
      var ch = src.charAt(i);
      if (ch === "\\" && i + 1 < src.length) {
        buf += src.charAt(i + 1);
        i += 2;
        continue;
      }
      if (ch === "`") {
        var codeEnd = src.indexOf("`", i + 1);
        if (codeEnd > i + 1) {
          flush();
          out.push({
            t: "el",
            tag: "code",
            cls: CLS.code,
            kids: [{ t: "text", v: src.slice(i + 1, codeEnd) }],
          });
          i = codeEnd + 1;
          continue;
        }
      }
      if (ch === "<") {
        var openTag = parseColorOpenTag(src, i);
        if (openTag) {
          var closeTag = findMatchingCloseTag(src, i + openTag.len, openTag.tag);
          if (closeTag) {
            var innerHtml = src.slice(i + openTag.len, closeTag.start);
            var clsParts = [];
            var useMark =
              openTag.tag === "mark" && !openTag.background && !openTag.color;
            if (openTag.background) clsParts.push(CLS.hilite);
            else if (useMark) clsParts.push(CLS.mark);
            if (openTag.color) clsParts.push(CLS.color);
            flush();
            out.push({
              t: "el",
              tag: useMark ? "mark" : "span",
              cls: clsParts.join(" "),
              color: openTag.color || "",
              background: openTag.background || "",
              kids: tokenizeInline(innerHtml),
            });
            i = closeTag.end;
            continue;
          }
        }
      }
      if (ch === "!" && src.charAt(i + 1) === "[") {
        var imgClose = src.indexOf("](", i + 2);
        var imgEnd = imgClose >= 0 ? src.indexOf(")", imgClose + 2) : -1;
        if (imgClose > i && imgEnd > imgClose) {
          flush();
          var alt = src.slice(i + 2, imgClose);
          out.push({
            t: "el",
            tag: "span",
            cls: CLS.imgAlt,
            kids: [{ t: "text", v: alt || "image" }],
          });
          i = imgEnd + 1;
          continue;
        }
      }
      if (ch === "[") {
        var linkClose = src.indexOf("](", i + 1);
        var linkEnd = linkClose >= 0 ? src.indexOf(")", linkClose + 2) : -1;
        if (linkClose > i && linkEnd > linkClose) {
          flush();
          var label = src.slice(i + 1, linkClose);
          var href = src.slice(linkClose + 2, linkEnd);
          out.push({
            t: "el",
            tag: "span",
            cls: CLS.link,
            href: href,
            kids: tokenizeInline(label),
          });
          i = linkEnd + 1;
          continue;
        }
      }
      if (src.slice(i, i + 3) === "***" && takeDelim("***", "strong", "is-bold is-italic")) {
        continue;
      }
      if (src.slice(i, i + 3) === "___" && takeDelim("___", "strong", "is-bold is-italic")) {
        continue;
      }
      if (takeDelim("**", "strong", "is-bold")) continue;
      if (takeDelim("__", "strong", "is-bold", { noWordBefore: true, noWordAfter: true })) {
        continue;
      }
      if (takeDelim("~~", "s", CLS.strike)) continue;
      if (takeDelim("==", "mark", CLS.mark)) continue;
      if (ch === "*" && src.charAt(i + 1) !== "*") {
        if (
          takeDelim("*", "em", "is-italic", {
            noSpaceAfter: true,
            noSpaceBefore: true,
          })
        ) {
          continue;
        }
      }
      if (ch === "_" && src.charAt(i + 1) !== "_") {
        if (
          takeDelim("_", "em", "is-italic", {
            noWordBefore: true,
            noWordAfter: true,
            noSpaceAfter: true,
            noSpaceBefore: true,
          })
        ) {
          continue;
        }
      }
      if (ch === "~" && src.charAt(i + 1) !== "~") {
        if (
          takeDelim("~", "sub", "announcement-md-sub", {
            noSpaceAfter: true,
            noSpaceBefore: true,
          })
        ) {
          continue;
        }
      }
      if (ch === "^") {
        if (
          takeDelim("^", "sup", "announcement-md-sup", {
            noSpaceAfter: true,
            noSpaceBefore: true,
          })
        ) {
          continue;
        }
      }
      buf += ch;
      i += 1;
    }
    flush();
    return out;
  }

  function appendTokens(parent, tokens) {
    (tokens || []).forEach(function (tok) {
      if (!tok) return;
      if (tok.t === "text") {
        parent.appendChild(document.createTextNode(tok.v));
        return;
      }
      var el = document.createElement(tok.tag || "span");
      if (tok.cls) el.className = tok.cls;
      if (tok.color) el.style.color = tok.color;
      if (tok.background) el.style.backgroundColor = tok.background;
      if (tok.href) {
        el.setAttribute("data-url", String(tok.href).slice(0, 200));
        el.title = String(tok.href);
      }
      appendTokens(el, tok.kids);
      parent.appendChild(el);
    });
  }

  function appendInlineText(parent, text) {
    var parts = String(text || "").split("\n");
    parts.forEach(function (part, idx) {
      if (idx > 0) parent.appendChild(document.createElement("br"));
      appendTokens(parent, tokenizeInline(part));
    });
  }

  /* ---------- blocks ---------- */

  function makeP(text) {
    var p = document.createElement("p");
    p.className = CLS.p;
    appendInlineText(p, text);
    return p;
  }

  function makeHeading(level, text) {
    var el = document.createElement("h" + level);
    el.className = CLS["h" + level] || CLS.h3;
    appendInlineText(el, text);
    return el;
  }

  function makeHr() {
    var hr = document.createElement("hr");
    hr.className = CLS.hr;
    return hr;
  }

  function makePre(lines) {
    var pre = document.createElement("pre");
    pre.className = CLS.pre;
    var code = document.createElement("code");
    code.className = CLS.code;
    code.textContent = lines.join("\n");
    pre.appendChild(code);
    return pre;
  }

  function makeQuote(text) {
    var q = document.createElement("blockquote");
    q.className = CLS.quote;
    appendInlineText(q, text);
    return q;
  }

  function makeList(kind) {
    var el = document.createElement(kind === "ol" ? "ol" : "ul");
    el.className = kind === "ol" ? CLS.ol : CLS.ul;
    return el;
  }

  function makeLi(item) {
    var li = document.createElement("li");
    li.className = CLS.li;
    if (item.task) {
      li.className += " " + CLS.task;
      var box = document.createElement("span");
      box.className = CLS.check + (item.checked ? " is-checked" : "");
      box.setAttribute("aria-hidden", "true");
      li.appendChild(box);
    }
    appendInlineText(li, item.text);
    return li;
  }

  function parseList(lines, start) {
    var first = ulMatch(lines[start]) || olMatch(lines[start]);
    if (!first) return null;
    var ordered = !!olMatch(lines[start]);
    var baseIndent = indentOf(lines[start]);
    var items = [];
    var i = start;
    while (i < lines.length) {
      var line = lines[i];
      if (!String(line).trim()) {
        if (i + 1 < lines.length) {
          var nxt = lines[i + 1];
          var nm = ulMatch(nxt) || olMatch(nxt);
          if (nm && indentOf(nxt) >= baseIndent) {
            i += 1;
            continue;
          }
        }
        break;
      }
      var um = ulMatch(line);
      var om = olMatch(line);
      var m = ordered ? om : um;
      if (m && indentOf(line) <= baseIndent + 1) {
        var taskMark = m[3];
        items.push({
          text: m[4],
          task: taskMark != null,
          checked: taskMark != null && String(taskMark).toLowerCase() === "x",
        });
        i += 1;
        continue;
      }
      if ((um || om) && indentOf(line) > baseIndent + 1) {
        var last = items[items.length - 1];
        if (last) last.text += "\n" + String(line).replace(/^\s+/, "");
        i += 1;
        continue;
      }
      if (
        headingMatch(line) ||
        isHrLine(line) ||
        fenceOpen(line) ||
        quoteText(line) != null
      ) {
        break;
      }
      var lastItem = items[items.length - 1];
      if (lastItem && indentOf(line) > baseIndent) {
        lastItem.text += "\n" + String(line).replace(/^\s+/, "");
        i += 1;
        continue;
      }
      break;
    }
    return { ordered: ordered, items: items, end: i };
  }

  function parseTable(lines, start) {
    if (start + 1 >= lines.length) return null;
    if (lines[start].indexOf("|") === -1) return null;
    if (!isTableSep(lines[start + 1])) return null;
    var header = splitTableRow(lines[start]);
    var aligns = tableAligns(lines[start + 1]);
    var rows = [];
    var i = start + 2;
    while (i < lines.length) {
      var line = lines[i];
      if (!String(line).trim() || line.indexOf("|") === -1) break;
      if (headingMatch(line) || isHrLine(line) || fenceOpen(line)) break;
      rows.push(splitTableRow(line));
      i += 1;
    }
    return { header: header, aligns: aligns, rows: rows, end: i };
  }

  function makeTable(spec) {
    var table = document.createElement("table");
    table.className = CLS.table;
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    spec.header.forEach(function (cell, idx) {
      var th = document.createElement("th");
      th.className = CLS.th;
      var al = spec.aligns[idx] || "left";
      th.style.textAlign = al;
      appendInlineText(th, cell);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    spec.rows.forEach(function (row) {
      var tr = document.createElement("tr");
      spec.header.forEach(function (_, idx) {
        var td = document.createElement("td");
        td.className = CLS.td;
        var al = spec.aligns[idx] || "left";
        td.style.textAlign = al;
        appendInlineText(td, row[idx] != null ? row[idx] : "");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function parseBlocks(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    var nodes = [];
    var i = 0;
    var para = [];

    function flushPara() {
      if (!para.length) return;
      var joined = para.join("\n").replace(/[ \t]+$/gm, "");
      if (joined.trim() !== "") nodes.push(makeP(joined));
      para = [];
    }

    while (i < lines.length) {
      var line = lines[i];
      var fence = fenceOpen(line);
      if (fence) {
        flushPara();
        var body = [];
        i += 1;
        while (i < lines.length && !isFenceClose(lines[i], fence.fence)) {
          body.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        nodes.push(makePre(body));
        continue;
      }
      if (!String(line).trim()) {
        flushPara();
        i += 1;
        continue;
      }
      var h = headingMatch(line);
      if (h) {
        flushPara();
        nodes.push(makeHeading(h.level, h.text));
        i += 1;
        continue;
      }
      if (isHrLine(line)) {
        flushPara();
        nodes.push(makeHr());
        i += 1;
        continue;
      }
      var q = quoteText(line);
      if (q != null) {
        flushPara();
        var qLines = [q];
        i += 1;
        while (i < lines.length) {
          var nq = quoteText(lines[i]);
          if (nq == null) break;
          qLines.push(nq);
          i += 1;
        }
        nodes.push(makeQuote(qLines.join("\n")));
        continue;
      }
      var table = parseTable(lines, i);
      if (table) {
        flushPara();
        nodes.push(makeTable(table));
        i = table.end;
        continue;
      }
      var list = parseList(lines, i);
      if (list && list.items.length) {
        flushPara();
        var ul = makeList(list.ordered ? "ol" : "ul");
        list.items.forEach(function (item) {
          ul.appendChild(makeLi(item));
        });
        nodes.push(ul);
        i = list.end;
        continue;
      }
      para.push(line);
      i += 1;
    }
    flushPara();
    return nodes;
  }

  function render(text, parent) {
    if (!parent) return { blockCount: 0, hasChrome: false };
    parent.textContent = "";
    var nodes = parseBlocks(text);
    if (!nodes.length && String(text || "").length) {
      nodes = [makeP(String(text))];
    }
    nodes.forEach(function (n) {
      parent.appendChild(n);
    });
    var hasChrome = !!parent.querySelector(
      "ul, ol, table, h1, h2, h3, blockquote, pre, hr"
    );
    return { blockCount: nodes.length, hasChrome: hasChrome };
  }

  function looksLikeMarkdown(text) {
    var s = String(text || "");
    if (!s) return false;
    return (
      /(^|\n)\s{0,3}#{1,6}\s+\S/.test(s) ||
      /(^|\n)\s{0,3}>\s?/.test(s) ||
      /(^|\n)\s{0,3}([-*+]|\d+[.)])\s+\S/.test(s) ||
      /(^|\n)\s{0,3}(```|~~~)/.test(s) ||
      /(^|\n)\s{0,3}((-\s*){3,}|(\*\s*){3,}|(_\s*){3,})\s*(\n|$)/.test(s) ||
      /\[[^\]]+\]\([^)]+\)/.test(s) ||
      /(\*\*|__|~~|==)[^\s][\s\S]*?\1/.test(s) ||
      /(^|\n)\s*\|.+\|\s*\n\s*\|?\s*:?-+:?\s*\|/.test(s)
    );
  }

  function demoMessages() {
    return [
      {
        title: "Happy Hour",
        subtitle: "Markdown",
        textAlign: "left",
        speedSec: 8,
        text:
          "# Happy Hour\n" +
          "**3–6pm · daily**\n\n" +
          "- Draft beer **$4**\n" +
          "- House wine *$6*\n" +
          "- ~~Nacho platter~~ *sold out*\n\n" +
          "> ==Ask about the Super Cup.==",
      },
      {
        title: "Today’s Deals",
        subtitle: "Table",
        textAlign: "left",
        speedSec: 8,
        text:
          "## Today’s Deals\n\n" +
          "| Item | Price |\n" +
          "| --- | ---: |\n" +
          "| Super Cup | **$8** |\n" +
          "| Ramune | $3 |\n" +
          "| Rice Punch | $3 |\n\n" +
          "Sign up at [OliToki.com](https://olitoki.com).",
      },
      {
        title: "Fit test",
        subtitle: "Shrink + hyphens",
        textAlign: "left",
        speedSec: 8,
        text:
          "### Packed board copy\n\n" +
          "Please **do not** let this announcement spill the box. " +
          "Supercalifragilisticexpialidocious hyphenation plus a very long " +
          "unbroken token WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW should wrap " +
          "or hyphenate, then the type **shrinks** until every line sits inside " +
          "the Announcement Body.\n\n" +
          "1. First packed item with extra words so the list wraps\n" +
          "2. Second packed item — still inside the shell\n" +
          "3. Third packed item with **bold**, *italic*, and `code`\n" +
          "4. Fourth so fit has many blocks to measure\n" +
          "5. Fifth keeps shrinking rather than clipping",
      },
      {
        title: "Cheat sheet",
        subtitle: "Basics",
        textAlign: "left",
        speedSec: 8,
        text:
          "# Heading 1\n" +
          "## Heading 2\n" +
          "### Heading 3\n\n" +
          "This is **bold**, *italic*, ~~strike~~, ==highlight==, H~2~O, and 2^4^.\n\n" +
          "- [x] Task done\n" +
          "- [ ] Task open\n\n" +
          "---\n\n" +
          "> Blockquote on the Announcement Body\n\n" +
          "```\n" +
          "code fence\n" +
          "stays literal **not bold**\n" +
          "```",
      },
      {
        title: "New tenders",
        subtitle: "Color",
        textAlign: "center",
        speedSec: 8,
        text:
          '<font color="#ffffff">**Limited time**</font>\n\n' +
          '<mark style="background:#affad1"><font color="#ff0000">Try our all new *crispy chicken tenders!*</font></mark>\n\n' +
          '<font color="#ff3b30">Red</font> · ' +
          '<font color="#ffd60a">Gold</font> · ' +
          '<span style="color:#ffffff">White</span> · ' +
          '<mark style="background:#ffe08a">highlight</mark>',
      },
    ];
  }

  var api = {
    render: render,
    looksLikeMarkdown: looksLikeMarkdown,
    demoMessages: demoMessages,
    tokenizeInline: tokenizeInline,
    parseBlocks: parseBlocks,
    sanitizeCssColor: sanitizeCssColor,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.TOKI_ANNOUNCEMENT_MD = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);

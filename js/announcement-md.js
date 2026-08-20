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
    strike: "announcement-md-strike",
    check: "announcement-md-check",
    task: "announcement-md-task",
  };

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
    ];
  }

  var api = {
    render: render,
    looksLikeMarkdown: looksLikeMarkdown,
    demoMessages: demoMessages,
    tokenizeInline: tokenizeInline,
    parseBlocks: parseBlocks,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.TOKI_ANNOUNCEMENT_MD = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);

# Announcement markdown (Board 4)

**Last updated:** 2026-08-20 19:04  

How to style the **Announcement Body** from the Google Sheet.  
**Board:** `index4.html` · **Tab:** Announcements · **Column:** Inventory **Text**  
**On-screen:** Announcement Panel / Announcement Body ([[UI_NOMENCLATURE]] §5)  
**Browsable copy** (examples painted with the live renderer): [announcement-markdown.html](../announcement-markdown.html)

In-cell Google rich text / fills stay off. Type markdown in the **Text** cell. The board hyphenates long words and **shrinks** so copy never leaves the 976×452 shell.

Reference: [Markdown cheat sheet](https://www.markdownguide.org/cheat-sheet/) (we paint the useful TV subset below).

---

## 1. How to type it in the sheet

| Do | Do not |
|----|--------|
| One message per non-empty **Text** cell | Rely on Google bold / font color / cell fill |
| **Alt+Enter** (Windows: Ctrl+Enter) for a new line | Expect a single Return to make a new sheet row |
| Start lists with `- ` or `1. ` (space after the mark) | Start a cell with `=` (Sheets treats that as a formula) |
| `# Heading` with a space after the hashes | `#Heading` (no space) — that stays literal |
| Wrap the Text column so you can read the cell | Paste HTML tags — they show as plain text |

Plain sentences with no markdown look the same as before (centered). Headings, lists, tables, quotes, and code **left-align**.

Links paint as underlined type. They do **not** navigate on the Fire Stick. Images paint as *alt text* only (no remote fetch).

---

## 2. Cheat sheet (what the board paints)

### Basic

| You type | It paints |
|----------|-----------|
| `# Heading 1` | Large title |
| `## Heading 2` | Medium title |
| `### Heading 3` | Small title (`####` and up draw as H3) |
| `**bold**` or `__bold__` | **Bold** |
| `*italic*` or `_italic_` | *Italic* |
| `***bold italic***` | Bold italic |
| `> quote` | Left-bar blockquote |
| `- item` or `* item` or `+ item` | Bullet list |
| `1. item` or `1) item` | Numbered list |
| `` `code` `` | Inline code |
| `---` or `***` or `___` (alone on a line) | Horizontal rule |
| `[OliToki.com](https://olitoki.com)` | Underlined label (not a tap target) |
| `![photo](food-pics/drinks/Ramune.webp)` | Alt text only (`photo`) |

A single newline in the cell is a **line break** on the board (Sheet Alt+Enter). A blank line starts a new block.

### Extended

| You type | It paints |
|----------|-----------|
| `\| Item \| Price \|` + a `\| --- \| ---: \|` row | Table (alignment from the separator) |
| ` ``` ` fenced block | Literal preformatted lines |
| `~~sold out~~` | Strike |
| `- [x] done` / `- [ ] open` | Task list |
| `==highlight==` | Highlight color |
| `H~2~O` | Subscript |
| `2^4^` | Superscript |

**Not painted (stay literal or skipped):** footnotes, heading IDs, definition lists, emoji shortcodes like `:joy:`. HTML in the cell is **not** executed.

Escape a mark with a backslash: `\*not italic\*`.

---

## 3. Examples (paste into **Text**)

These are the four samples on `?annMdDemo=1`. Paste the **Text** block into one inventory row. Title / Subtitle are separate columns.

### Example 1 — Happy Hour (`?ann=0`)

**Title:** Happy Hour · **Subtitle:** Markdown

```markdown
# Happy Hour
**3–6pm · daily**

- Draft beer **$4**
- House wine *$6*
- ~~Nacho platter~~ *sold out*

> ==Ask about the Super Cup.==
```

Heading, bold, italic, bullets, strike, highlight, blockquote.

### Example 2 — Deals table (`?ann=1`)

**Title:** Today’s Deals · **Subtitle:** Table

```markdown
## Today’s Deals

| Item | Price |
| --- | ---: |
| Super Cup | **$8** |
| Ramune | $3 |
| Rice Punch | $3 |

Sign up at [OliToki.com](https://olitoki.com).
```

Heading, table (price column right-aligned), bold, link.

### Example 3 — Packed copy (`?ann=2`)

**Title:** Fit test · **Subtitle:** Shrink + hyphens

```markdown
### Packed board copy

Please **do not** let this announcement spill the box. Supercalifragilisticexpialidocious hyphenation plus a very long unbroken token WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW should wrap or hyphenate, then the type **shrinks** until every line sits inside the Announcement Body.

1. First packed item with extra words so the list wraps
2. Second packed item — still inside the shell
3. Third packed item with **bold**, *italic*, and `code`
4. Fourth so fit has many blocks to measure
5. Fifth keeps shrinking rather than clipping
```

Too much copy → type scales down. Long tokens wrap or hyphenate. Nothing leaves the box.

### Example 4 — Basics (`?ann=3`)

**Title:** Cheat sheet · **Subtitle:** Basics

````markdown
# Heading 1
## Heading 2
### Heading 3

This is **bold**, *italic*, ~~strike~~, ==highlight==, H~2~O, and 2^4^.

- [x] Task done
- [ ] Task open

---

> Blockquote on the Announcement Body

```
code fence
stays literal **not bold**
```
````

(The inner fence in the Text cell is three backticks on their own lines, same as any fenced block.)

### Plain (no markdown)

A cell with only `Sign up for our rewards program!` still paints as one centered sentence. No marks required.

---

## 4. Preview on the board

Does **not** write the sheet.

```text
http://Peters-Mac.local:8765/index4.html?annMdDemo=1&pause=1&ann=0
```

`ann=0` Happy Hour · `ann=1` table · `ann=2` packed fit · `ann=3` basics.

Browsable cheat sheet with the same four examples painted live: [announcement-markdown.html](../announcement-markdown.html)

---

## 5. Related

- [SHEET_MIGRATION.md](./SHEET_MIGRATION.md) — Announcements tab columns
- [DATA_MODEL.md](./DATA_MODEL.md) — legacy Board 4 copy column
- [URL_PARAMS.md](./URL_PARAMS.md) — `annMdDemo`, `ann`, `pause`
- [STYLE_GUIDE.md](./STYLE_GUIDE.md) — Announcement Panel 976×452
- Code: `js/announcement-md.js` (`demoMessages` = the four examples)

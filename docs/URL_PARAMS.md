# URL codes (display)

**Last updated:** 2026-08-20 19:04

Stick these on the end of a board URL. First one starts with `?`, more with `&`.

Example for the restaurant Fire Stick HD:

```text
https://olitokip.github.io/OliToki/index.html?w=1920&dpr=1
```

`dpr` is **device pixel ratio** — how many real pixels the browser pretends sit in one CSS pixel. `1` = honest 1080p. AbleSign often lies with `2`, which makes us load 4K art on a 1080p stick.

## Boards (`index.html` … `index4.html`)

| Code | What it does |
|------|----------------|
| **`dpr=1`** | Force 1× pixels. Use on Fire Stick / AbleSign so we do not load 4K bitmaps. |
| **`dpr=2`** | Force 2× (Retina-style). Rarely needed. Capped at 2. |
| **`w=1920`** | Pretend the stage is 1920 CSS pixels wide. Alias: `width`. |
| **`h=1080`** | Pretend the stage is 1080 CSS pixels tall. Alias: `height`. If only `w` or only `h` is set, the other is 16:9. |
| **`display=1920x1080`** | Same as `w=1920&h=1080` (dpr still defaults to 1 if you set display). |
| **`pause=1`** | Freeze slideshow / Ken Burns / announcements. Good for screenshots. |
| **`item=3`** | Start on that menu row (0-based). `#3` in the hash also works. |
| **`ann=0`** | Board 4: start on that announcement slide (0-based). |
| **`annMdDemo=1`** | Board 4 debug: paint markdown cheat-sheet sample slides (does not write the sheet). Authoring copy: [ANNOUNCEMENT_MARKDOWN.md](./ANNOUNCEMENT_MARKDOWN.md) / `announcement-markdown.html`. |
| **`preview=all`** | Lean wall path (used by the 4-up preview). Do not use on a TV. |
| **`wall=0`** … **`wall=3`** | Which cell you are in the 4-up wall (staggers refresh). Set by `preview-all.html`. |
| **`debug=1`** or **`tokiDebug=1`** | Dump the debug feature table to the console once. |
| **`portraitDebug=1`** | Draw the Family Portrait lattice outlines. |
| **`textBoxDebug=1`** | Draw text-box wireframes (Menu List, Footer Boxes, titles, prices, Board 4 announcement/drink boxes). Aliases: `textboxWireframes=1`, `drawTextBoxes=1`. Same overlay as Debugger **Show Textbox Wireframes**. |
| **`imgScale=0.25`** | Debug only: smash images down (looks terrible on purpose). Bare `?imgScale` = 1/100. |
| **`encore=old`** | Encore only: park the Spotlight Veil on the **camera rig** (nested `scale(--encore-zoom)`). Default (omit, or `encore=new`) keeps the veil as a stage sibling. |

Typical TV pin: **`?w=1920&dpr=1`**. After a hard refresh, Debug → Display should read **`1920×1080 dpr1`**.

## Menu Manager (`manager.html`)

These can sit on the query string or after the hash (`#/menu/style?pick=theme`).

| Code | What it does |
|------|----------------|
| **`pick=theme`** | Open that picker (`theme`, `background`, `presentation`, …). |
| **`bg=pattern`** / **`bg=wallpaper`** | Start with that background kind. |
| **`pres=encore`** | Start with that presentation style. |
| **`theme=Halloween`** | Start on that theme name. |
| **`spot=`** / **`ebg=`** | Encore spotlight / encore background. |
| **`speed=3`** | Presentation speed. |
| **`item=0`** | Preview item index. |
| **`confirm=1`** | Show the Yes/No save dialog. |
| **`newtheme=1`** | Show create-theme. |
| **`holdGrid=1`** | Encore grid held (speed 0). |
| **`encore=old`** | Same as the board flag: Spotlight Veil lives on `.family-portrait-rig` (nested scale). Default is detached. Use with `pres=encore`. |

## Combine

```text
index.html?w=1920&dpr=1&pause=1
index2.html?w=1920&dpr=1&item=0
index.html?encore=old
index.html?textBoxDebug=1&pause=1
index4.html?annMdDemo=1&pause=1&ann=0
manager.html?pres=encore&encore=old
```

Related: [[SUPPORTED_DEVICES]] · [[DEBUG_CONSOLE]]

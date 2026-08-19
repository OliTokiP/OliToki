# URL codes (display)

**Last updated:** 2026-08-19

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
| **`preview=all`** | Lean wall path (used by the 4-up preview). Do not use on a TV. |
| **`wall=0`** … **`wall=3`** | Which cell you are in the 4-up wall (staggers refresh). Set by `preview-all.html`. |
| **`debug=1`** or **`tokiDebug=1`** | Dump the debug feature table to the console once. |
| **`portraitDebug=1`** | Draw the Family Portrait lattice outlines. |
| **`imgScale=0.25`** | Debug only: smash images down (looks terrible on purpose). Bare `?imgScale` = 1/100. |

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

## Combine

```text
index.html?w=1920&dpr=1&pause=1
index2.html?w=1920&dpr=1&item=0
```

Related: [[SUPPORTED_DEVICES]] · [[DEBUG_CONSOLE]]

#!/usr/bin/env python3
"""Open 4 Toki Menu boards tiled 2×2 on the screen under the mouse.

One launch dialog:
  • Browser popup (Chrome / Firefox / Safari)
  • Checkbox: “Single window — all boards preview” → preview-all.html
  • Open / Cancel  (Cancel exits; no second dialog)

Skip UI with env:
  TOKI_BROWSER=chrome|firefox|safari
  TOKI_LAYOUT=tiled|single
"""

from __future__ import annotations

import os
import subprocess
import sys
import time

PORT = int(os.environ.get("TOKI_PORT", "8765"))
BASE = f"http://127.0.0.1:{PORT}"
# TL, TR, BL, BR — production boards (one window each)
URLS = [
    f"{BASE}/index.html",  # Board 1 — Bowls
    f"{BASE}/index2.html",  # Board 2 — Handhelds
    f"{BASE}/index3.html",  # Board 3 — Munchies
    f"{BASE}/index4.html",  # Board 4 — Drinks
]
# Single-window testing wall (2×2 iframes)
PREVIEW_ALL_URL = f"{BASE}/preview-all.html"

# Display name → internal key
BROWSER_CHOICES = (
    ("Google Chrome", "chrome"),
    ("Firefox", "firefox"),
    ("Safari", "safari"),
)


def screen_quads_appkit():
    """Cocoa: monitor under mouse → 4 quads in top-left global coords."""
    from AppKit import NSEvent, NSScreen  # type: ignore

    mouse = NSEvent.mouseLocation()
    screens = list(NSScreen.screens() or [])
    if not screens:
        raise RuntimeError("No screens")

    chosen = screens[0]
    for s in screens:
        f = s.frame()
        if (
            f.origin.x <= mouse.x <= f.origin.x + f.size.width
            and f.origin.y <= mouse.y <= f.origin.y + f.size.height
        ):
            chosen = s
            break

    vf = chosen.visibleFrame()
    primary = screens[0].frame()
    desktop_top = primary.origin.y + primary.size.height

    left = float(vf.origin.x)
    top = desktop_top - (vf.origin.y + vf.size.height)
    width = float(vf.size.width)
    height = float(vf.size.height)
    return _split(left, top, width, height)


def screen_quads_osascript():
    """
    JXA: mouse location + NSScreen via ObjC bridge in osascript.
    Works without Python PyObjC.
    """
    script = r'''
ObjC.import("AppKit");
function run() {
  var mouse = $.NSEvent.mouseLocation;
  var screens = $.NSScreen.screens;
  var count = screens.count;
  var primary = screens.objectAtIndex(0).frame;
  var desktopTop = primary.origin.y + primary.size.height;

  var chosen = screens.objectAtIndex(0).visibleFrame;
  for (var i = 0; i < count; i++) {
    var s = screens.objectAtIndex(i);
    var f = s.frame;
    if (mouse.x >= f.origin.x && mouse.x <= f.origin.x + f.size.width &&
        mouse.y >= f.origin.y && mouse.y <= f.origin.y + f.size.height) {
      chosen = s.visibleFrame;
      break;
    }
  }
  var left = chosen.origin.x;
  var top = desktopTop - (chosen.origin.y + chosen.size.height);
  var width = chosen.size.width;
  var height = chosen.size.height;
  return [left, top, width, height].join(",");
}
'''
    r = subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", script],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "osascript screen probe failed")
    parts = [float(x) for x in r.stdout.strip().split(",")]
    if len(parts) != 4:
        raise RuntimeError("bad screen probe: " + r.stdout)
    return _split(parts[0], parts[1], parts[2], parts[3])


def _split(left, top, width, height):
    mw = width / 2.0
    mh = height / 2.0
    return [
        (int(round(left)), int(round(top)), int(round(mw)), int(round(mh))),
        (
            int(round(left + mw)),
            int(round(top)),
            int(round(width - mw)),
            int(round(mh)),
        ),
        (
            int(round(left)),
            int(round(top + mh)),
            int(round(mw)),
            int(round(height - mh)),
        ),
        (
            int(round(left + mw)),
            int(round(top + mh)),
            int(round(width - mw)),
            int(round(height - mh)),
        ),
    ]


def screen_quads():
    try:
        return screen_quads_appkit()
    except Exception:
        pass
    try:
        return screen_quads_osascript()
    except Exception as err:
        print("screen probe failed:", err, flush=True)
        # Last resort: primary-ish 1920×1080 visible area
        return _split(0, 25, 1920, 1055)


def _first_existing(*paths: str) -> str | None:
    for p in paths:
        expanded = os.path.expanduser(p)
        if os.path.isfile(expanded) and os.access(expanded, os.X_OK):
            return expanded
    return None


def resolve_chrome():
    """Return (app_name, binary_or_None) for Google Chrome."""
    binary = _first_existing(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
    if binary or os.path.isdir("/Applications/Google Chrome.app"):
        return "Google Chrome", binary
    return None


def resolve_firefox():
    """Return (app_name, binary_or_None) for Firefox."""
    binary = _first_existing(
        "/Applications/Firefox.app/Contents/MacOS/firefox",
        "~/Applications/Firefox.app/Contents/MacOS/firefox",
    )
    if binary or os.path.isdir("/Applications/Firefox.app"):
        return "Firefox", binary
    return None


def resolve_safari():
    if os.path.isdir("/Applications/Safari.app"):
        return "Safari", None
    return None


def browser_installed(key: str) -> bool:
    if key == "chrome":
        return resolve_chrome() is not None
    if key == "firefox":
        return resolve_firefox() is not None
    if key == "safari":
        return resolve_safari() is not None
    return False


def resolve_browser(key: str):
    """Return (family, app_name, binary) or None if not installed.

    family is one of: chrome | firefox | safari
    """
    key = (key or "").strip().lower()
    aliases = {
        "chrome": "chrome",
        "google chrome": "chrome",
        "google-chrome": "chrome",
        "chromium": "chrome",
        "firefox": "firefox",
        "ff": "firefox",
        "safari": "safari",
    }
    key = aliases.get(key, key)
    if key == "chrome":
        r = resolve_chrome()
        return ("chrome", r[0], r[1]) if r else None
    if key == "firefox":
        r = resolve_firefox()
        return ("firefox", r[0], r[1]) if r else None
    if key == "safari":
        r = resolve_safari()
        return ("safari", r[0], r[1]) if r else None
    return None


def alert(message: str, title: str = "Toki Menus", stop: bool = False) -> None:
    icon = "stop" if stop else "note"
    # Escape for AppleScript string
    safe = (
        message.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
    )
    subprocess.run(
        [
            "osascript",
            "-e",
            f'display dialog "{safe}" buttons {{"OK"}} default button 1 '
            f'with icon {icon} with title "{title}"',
        ],
        check=False,
        capture_output=True,
    )


def _env_browser() -> str | None:
    """TOKI_BROWSER override → chrome|firefox|safari, or None if unset."""
    env = os.environ.get("TOKI_BROWSER", "").strip()
    if not env:
        return None
    resolved = resolve_browser(env)
    if resolved:
        return resolved[0]
    alert(
        f'Browser "{env}" from TOKI_BROWSER is not installed or not recognized.\n'
        "Use: chrome, firefox, or safari.",
        stop=True,
    )
    return None


def _env_layout() -> str | None:
    """TOKI_LAYOUT override → tiled|single, or None if unset."""
    env = os.environ.get("TOKI_LAYOUT", "").strip().lower()
    if env in ("single", "one", "preview", "all", "preview-all", "1"):
        return "single"
    if env in ("tiled", "quad", "4", "windows", "separate", "0"):
        return "tiled"
    return None


def prompt_browser_and_layout() -> tuple[str, str] | None:
    """
    One dialog: pick browser + optional single-window preview checkbox.

    Returns (browser_key, layout) where layout is "tiled"|"single",
    or None if cancelled.

    Env skips:
      TOKI_BROWSER=chrome|firefox|safari
      TOKI_LAYOUT=tiled|single
    If both are set, no UI. If only one is set, still show UI for the other
    (or use defaults: installed Chrome + tiled).
    """
    env_browser = _env_browser()
    env_layout = _env_layout()
    # Full non-interactive path
    if env_browser and env_layout:
        return env_browser, env_layout
    # Browser-only env: still need layout (default tiled if also non-interactive
    # is rare; show combined UI unless both set). If only browser env, use tiled
    # unless layout env set — if user set TOKI_BROWSER only, open without dialog.
    if env_browser and not env_layout:
        # Respect browser skip; layout defaults to tiled unless they set TOKI_LAYOUT
        return env_browser, "tiled"
    if env_layout and not env_browser:
        # Need a browser — fall through to UI with layout pre-applied after
        pass

    # Prefer a default that is actually installed
    default_label = "Google Chrome"
    for label, key in BROWSER_CHOICES:
        if browser_installed(key):
            default_label = label
            break

    # Escape default for JS string
    default_js = default_label.replace("\\", "\\\\").replace('"', '\\"')
    # Pre-check single-window if env already asked for it (browser still needs UI)
    single_default = "true" if env_layout == "single" else "false"

    # One NSAlert: browser popup + single-window checkbox in accessory view
    script = f'''
ObjC.import("AppKit");
function run() {{
  var alert = $.NSAlert.alloc.init;
  alert.setMessageText("Toki Menus");
  alert.setInformativeText("Choose a browser for the four menu boards.");
  alert.addButtonWithTitle("Open");
  alert.addButtonWithTitle("Cancel");

  var width = 320;
  var height = 64;
  var view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, width, height));

  // Browser popup (top)
  var popup = $.NSPopUpButton.alloc.initWithFrame($.NSMakeRect(0, 34, width, 26));
  var browsers = ["Google Chrome", "Firefox", "Safari"];
  for (var i = 0; i < browsers.length; i++) {{
    popup.addItemWithTitle(browsers[i]);
  }}
  popup.selectItemWithTitle("{default_js}");
  view.addSubview(popup);

  // Single-window checkbox (bottom)
  var box = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, 4, width, 24));
  try {{
    box.setButtonType($.NSButtonTypeSwitch);
  }} catch (e) {{
    box.setButtonType($.NSSwitchButton);
  }}
  box.setTitle("Single window — all boards preview");
  try {{
    box.setState({single_default} ? $.NSControlStateValueOn : $.NSControlStateValueOff);
  }} catch (e2) {{
    box.setState({single_default} ? 1 : 0);
  }}
  view.addSubview(box);

  alert.setAccessoryView(view);

  var resp = alert.runModal;
  // NSAlertFirstButtonReturn = 1000
  if (Number(resp) !== 1000) return "CANCEL";

  var browser = popup.titleOfSelectedItem.js;
  var on = Number(box.state) === 1;
  return browser + "|" + (on ? "single" : "tiled");
}}
'''
    r = subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", script],
        capture_output=True,
        text=True,
    )
    out = (r.stdout or "").strip()
    if r.returncode != 0:
        print("prompt UI failed:", (r.stderr or "").strip(), flush=True)
        # Minimal fallback: browser list only, tiled layout (no second layout dialog)
        return _prompt_browser_list_only()

    if not out or out == "CANCEL":
        return None

    if "|" not in out:
        # Unexpected — try as browser label alone
        resolved = resolve_browser(out)
        return (resolved[0], "tiled") if resolved else None

    label, layout = out.split("|", 1)
    layout = layout.strip()
    if layout not in ("tiled", "single"):
        layout = "tiled"

    browser_key = None
    for blabel, key in BROWSER_CHOICES:
        if label.strip() == blabel:
            browser_key = key
            break
    if not browser_key:
        resolved = resolve_browser(label)
        browser_key = resolved[0] if resolved else None
    if not browser_key:
        return None

    # Env layout wins if only layout was set and UI picked browser
    if env_layout:
        layout = env_layout
    return browser_key, layout


def _prompt_browser_list_only() -> tuple[str, str] | None:
    """Fallback if AppKit alert fails: list picker, always tiled. Cancel = exit."""
    default_label = "Google Chrome"
    for label, key in BROWSER_CHOICES:
        if browser_installed(key):
            default_label = label
            break
    labels = ", ".join(f'"{label}"' for label, _ in BROWSER_CHOICES)
    script = f'''
set browserList to {{{labels}}}
try
  set chosen to choose from list browserList with prompt ¬
    "Open the four Toki Menu boards in which browser?" ¬
    with title "Toki Menus" default items {{"{default_label}"}} ¬
    OK button name "Open" cancel button name "Cancel"
  if chosen is false then
    return "CANCEL"
  end if
  return item 1 of chosen as text
on error
  return "CANCEL"
end try
'''
    r = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
    )
    choice = (r.stdout or "").strip()
    if not choice or choice == "CANCEL":
        return None
    for label, key in BROWSER_CHOICES:
        if choice == label:
            return key, "tiled"
    resolved = resolve_browser(choice)
    return (resolved[0], "tiled") if resolved else None


def full_bounds_from_quads(quads):
    """Union of the 2×2 tile quads → full visible monitor rect (x, y, w, h)."""
    x0, y0, _w0, _h0 = quads[0]
    x3, y3, w3, h3 = quads[3]
    return (x0, y0, (x3 + w3) - x0, (y3 + h3) - y0)


def open_single_window(
    family: str, app_name: str, binary: str | None, bounds
):
    """Open preview-all.html in one window sized to the monitor under the mouse."""
    x, y, w, h = bounds
    url = PREVIEW_ALL_URL
    print("layout: single window", url, bounds, flush=True)

    if family == "chrome":
        if binary:
            subprocess.Popen(
                [
                    binary,
                    "--new-window",
                    f"--window-position={x},{y}",
                    f"--window-size={w},{h}",
                    url,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        else:
            subprocess.call(
                [
                    "open",
                    "-na",
                    app_name,
                    "--args",
                    "--new-window",
                    f"--window-position={x},{y}",
                    f"--window-size={w},{h}",
                    url,
                ]
            )
        time.sleep(0.8)
        # Nudge bounds via AppleScript (Chrome may ignore first size)
        script = f'''
tell application "{app_name}"
  activate
  delay 0.4
  try
    set bounds of front window to {{{x}, {y}, {x + w}, {y + h}}}
  end try
end tell
'''
        subprocess.run(["osascript", "-e", script], check=False)
        return

    if family == "safari":
        script = f'''
tell application "Safari"
  activate
  open location "{url}"
  delay 0.6
  try
    set bounds of front window to {{{x}, {y}, {x + w}, {y + h}}}
  end try
end tell
'''
        subprocess.run(["osascript", "-e", script], check=False)
        return

    # Firefox
    if binary:
        subprocess.Popen(
            [binary, "-new-window", url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    else:
        subprocess.call(
            ["open", "-na", "Firefox", "--args", "-new-window", url]
        )
    time.sleep(1.0)
    script = f'''
tell application "Firefox" to activate
delay 0.35
tell application "System Events"
  if exists process "Firefox" then
    tell process "Firefox"
      set frontmost to true
      try
        set position of window 1 to {{{x}, {y}}}
        set size of window 1 to {{{w}, {h}}}
      end try
    end tell
  end if
end tell
'''
    subprocess.run(["osascript", "-e", script], check=False)


def open_chromium_family(app_name: str, binary: str | None, quads):
    for url, (x, y, w, h) in zip(URLS, quads):
        if binary:
            subprocess.Popen(
                [
                    binary,
                    "--new-window",
                    f"--window-position={x},{y}",
                    f"--window-size={w},{h}",
                    url,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        else:
            subprocess.call(
                [
                    "open",
                    "-na",
                    app_name,
                    "--args",
                    "--new-window",
                    f"--window-position={x},{y}",
                    f"--window-size={w},{h}",
                    url,
                ]
            )
        time.sleep(0.4)

    time.sleep(1.2)
    bounds_list = ", ".join(
        "{%d, %d, %d, %d}" % (x, y, x + w, y + h) for x, y, w, h in quads
    )
    urls_list = ", ".join('"%s"' % u for u in URLS)
    script = f'''
tell application "{app_name}"
  activate
  set theURLs to {{{urls_list}}}
  set theBounds to {{{bounds_list}}}
  repeat with i from 1 to 4
    set targetURL to item i of theURLs
    set targetBounds to item i of theBounds
    set found to false
    repeat with wRef in windows
      try
        set tabURL to URL of active tab of wRef
        if tabURL starts with targetURL then
          set bounds of wRef to targetBounds
          set found to true
          exit repeat
        end if
      end try
    end repeat
    if found is false then
      set newWin to make new window
      set URL of active tab of newWin to targetURL
      delay 0.25
      set bounds of newWin to targetBounds
    end if
  end repeat
end tell
'''
    subprocess.run(["osascript", "-e", script], check=False)


def open_safari(quads):
    bounds_list = ", ".join(
        "{%d, %d, %d, %d}" % (x, y, x + w, y + h) for x, y, w, h in quads
    )
    script = f'''
tell application "Safari"
  activate
  open location "{URLS[0]}"
  delay 0.5
  make new document with properties {{URL:"{URLS[1]}"}}
  delay 0.35
  make new document with properties {{URL:"{URLS[2]}"}}
  delay 0.35
  make new document with properties {{URL:"{URLS[3]}"}}
  delay 0.7
  set bs to {{{bounds_list}}}
  set n to count of windows
  if n >= 4 then
    set bounds of window 4 to item 1 of bs
    set bounds of window 3 to item 2 of bs
    set bounds of window 2 to item 3 of bs
    set bounds of window 1 to item 4 of bs
  end if
end tell
'''
    subprocess.run(["osascript", "-e", script], check=False)


def open_firefox(binary: str | None, quads):
    """
    Firefox has weak AppleScript window APIs, so open four windows then
    place them with System Events (needs Accessibility permission once).
    """
    for url, _quad in zip(URLS, quads):
        if binary:
            subprocess.Popen(
                [binary, "-new-window", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        else:
            subprocess.call(
                [
                    "open",
                    "-na",
                    "Firefox",
                    "--args",
                    "-new-window",
                    url,
                ]
            )
        time.sleep(0.5)

    time.sleep(1.6)

    # Frontmost window is the last opened (BR). Map reverse: win1→quad4, …
    # System Events uses {x, y} position and {w, h} size (top-left origin).
    pos_list = ", ".join("{%d, %d}" % (x, y) for x, y, _w, _h in quads)
    size_list = ", ".join("{%d, %d}" % (w, h) for _x, _y, w, h in quads)
    script = f'''
tell application "Firefox" to activate
delay 0.35
tell application "System Events"
  if not (exists process "Firefox") then
    error "Firefox process not found"
  end if
  tell process "Firefox"
    set frontmost to true
    delay 0.2
    set thePositions to {{{pos_list}}}
    set theSizes to {{{size_list}}}
    set n to count of windows
    if n < 4 then
      -- fewer than 4: place whatever we have, front = last opened
      set startIdx to 5 - n
      repeat with i from 1 to n
        set qi to startIdx + i - 1
        try
          set position of window i to item qi of thePositions
          set size of window i to item qi of theSizes
        end try
      end repeat
    else
      -- windows 1..4 are newest→oldest ≈ quads 4..1
      repeat with i from 1 to 4
        set qi to 5 - i
        try
          set position of window i to item qi of thePositions
          set size of window i to item qi of theSizes
        end try
      end repeat
    end if
  end tell
end tell
'''
    r = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").strip()
        print("Firefox tile warning:", err, flush=True)
        # Still opened the pages; positioning may need Accessibility permission
        if "not allowed" in err.lower() or "assistive" in err.lower():
            alert(
                "Firefox windows opened, but macOS blocked window tiling.\n\n"
                "System Settings → Privacy & Security → Accessibility\n"
                "→ enable Open Toki Menus (or Terminal / Python).",
                stop=False,
            )


def main():
    quads = screen_quads()
    print("Toki Menus tile quads:", quads, flush=True)

    picked = prompt_browser_and_layout()
    if not picked:
        print("cancelled", flush=True)
        sys.exit(0)
    key, layout = picked

    resolved = resolve_browser(key)
    if not resolved:
        labels = {
            "chrome": "Google Chrome",
            "firefox": "Firefox",
            "safari": "Safari",
        }
        name = labels.get(key, key)
        alert(
            f"{name} is not installed.\n\n"
            f"Install it in /Applications, then try again.",
            stop=True,
        )
        sys.exit(1)

    family, app_name, binary = resolved
    print(
        "browser:",
        family,
        app_name,
        binary or "(open -a)",
        "layout:",
        layout,
        flush=True,
    )

    if layout == "single":
        open_single_window(family, app_name, binary, full_bounds_from_quads(quads))
        return

    if family == "safari":
        open_safari(quads)
    elif family == "firefox":
        open_firefox(binary, quads)
    else:
        open_chromium_family(app_name, binary, quads)


if __name__ == "__main__":
    main()

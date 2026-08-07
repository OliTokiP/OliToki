#!/usr/bin/env python3
"""Open 4 Toki Menu boards (tiled or single-window preview).

One launch dialog:
  • Browser (Chrome / Firefox / Safari)
  • Environment — Local (localhost + Sheets proxy) | Remote (GitHub Pages)
  • Single window — all boards preview
  • Show extra info — labels & zoom tips on the preview wall (default off)

Skip UI with env:
  TOKI_BROWSER=chrome|firefox|safari
  TOKI_LAYOUT=tiled|single
  TOKI_ENV=local|remote
  TOKI_CHROME=0|1
  TOKI_REMOTE_BASE=https://absrdst.github.io/TokiMenu
  TOKI_PORT=8765
  TOKI_PROJECT=/path/to/TokiMenu
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PORT = int(os.environ.get("TOKI_PORT", "8765"))
DEFAULT_REMOTE_BASE = os.environ.get(
    "TOKI_REMOTE_BASE", "https://absrdst.github.io/TokiMenu"
).rstrip("/")
LOG = Path(os.environ.get("TOKI_SERVER_LOG", "/tmp/toki-menu-server.log"))

# Filled after Environment is chosen
BASE = f"http://127.0.0.1:{PORT}"
URLS: list[str] = []
PREVIEW_ALL_URL = ""

# Display name → internal key
BROWSER_CHOICES = (
    ("Google Chrome", "chrome"),
    ("Firefox", "firefox"),
    ("Safari", "safari"),
)

ENV_CHOICES = (
    ("Local — this Mac (Sheets API)", "local"),
    ("Remote — GitHub Pages (static)", "remote"),
)


def project_root() -> Path:
    env = os.environ.get("TOKI_PROJECT", "").strip()
    if env:
        return Path(env)
    # Resources/tile_menus.py → Contents → .app → project parent
    here = Path(__file__).resolve()
    # …/TokiMenu/Open Toki Menus.app/Contents/Resources/tile_menus.py
    if here.parent.name == "Resources":
        return here.parents[3]
    return here.parents[1]


def python_bin() -> str:
    env = os.environ.get("TOKI_PYTHON", "").strip()
    if env and Path(env).is_file():
        return env
    fw = "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3"
    if Path(fw).is_file():
        return fw
    return sys.executable


def set_base_urls(env: str, show_chrome: bool) -> None:
    """Populate BASE, URLS, PREVIEW_ALL_URL for the chosen environment."""
    global BASE, URLS, PREVIEW_ALL_URL
    if env == "remote":
        BASE = DEFAULT_REMOTE_BASE
    else:
        BASE = f"http://127.0.0.1:{PORT}"
    URLS = [
        f"{BASE}/index.html",
        f"{BASE}/index2.html",
        f"{BASE}/index3.html",
        f"{BASE}/index4.html",
    ]
    chrome_q = "chrome=1" if show_chrome else "chrome=0"
    PREVIEW_ALL_URL = f"{BASE}/preview-all.html?{chrome_q}"


def alert(msg: str, stop: bool = False, title: str = "Toki Menus") -> None:
    icon = "stop" if stop else "caution"
    safe = (
        msg.replace("\\", "\\\\")
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
        return _split(0, 25, 1920, 1055)


def _first_existing(*paths: str) -> str | None:
    for p in paths:
        expanded = os.path.expanduser(p)
        if os.path.isfile(expanded) and os.access(expanded, os.X_OK):
            return expanded
    return None


def resolve_chrome():
    binary = _first_existing(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    )
    if binary or os.path.isdir("/Applications/Google Chrome.app"):
        return "Google Chrome", binary
    return None


def resolve_firefox():
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
    """Return (family, app_name, binary) or None."""
    key = (key or "").strip().lower()
    if key in ("chrome", "google chrome", "chromium"):
        r = resolve_chrome()
        return ("chrome", r[0], r[1]) if r else None
    if key in ("firefox", "ff", "mozilla firefox"):
        r = resolve_firefox()
        return ("firefox", r[0], r[1]) if r else None
    if key in ("safari",):
        r = resolve_safari()
        return ("safari", r[0], r[1]) if r else None
    # label match
    for label, k in BROWSER_CHOICES:
        if key == label.lower() or key == k:
            return resolve_browser(k)
    return None


# ── Server (Local environment) ──────────────────────────────────────────────

def api_health() -> dict | None:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{PORT}/api/health", timeout=2
        ) as res:
            import json

            return json.loads(res.read().decode("utf-8"))
    except Exception:
        return None


def ensure_local_server(root: Path) -> bool:
    """Start toki_server if needed. Returns True if healthy."""
    health = api_health()
    if health and health.get("ok") and health.get("sheetsApi"):
        return True
    if health and health.get("ok") and not health.get("sheetsApi"):
        # Wrong/old server on port — replace
        _kill_port(PORT)
        time.sleep(0.4)
    elif health and health.get("ok"):
        return True
    elif _port_in_use(PORT):
        # Something on port without /api/health
        _kill_port(PORT)
        time.sleep(0.4)

    server = root / "scripts" / "toki_server.py"
    if not server.is_file():
        alert(f"Missing scripts/toki_server.py in:\n{root}", stop=True)
        return False

    LOG.parent.mkdir(parents=True, exist_ok=True)
    py = python_bin()
    with LOG.open("a", encoding="utf-8") as logf:
        logf.write(f"\n==== start {time.strftime('%Y-%m-%d %H:%M:%S')} ====\n")
        logf.flush()
        subprocess.Popen(
            [py, str(server), "--port", str(PORT), "--bind", "127.0.0.1"],
            cwd=str(root),
            stdout=logf,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    for _ in range(25):
        h = api_health()
        if h and h.get("ok"):
            if not h.get("sheetsApi"):
                alert(
                    "Server is up but Sheets API is off.\n\n"
                    "Menus need either:\n"
                    "• secrets/google-service-account.json + sheet shared "
                    "with that email, and Drive API enabled\n"
                    "• or sheet General access = Anyone with the link (Viewer)\n\n"
                    f"See scripts/gsheet_api.md and {LOG}",
                    stop=False,
                )
            return True
        time.sleep(0.2)

    alert(
        f"Could not start Toki server on port {PORT}.\nSee {LOG}",
        stop=True,
    )
    return False


def _port_in_use(port: int) -> bool:
    r = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0 and bool(r.stdout.strip())


def _kill_port(port: int) -> None:
    r = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
        capture_output=True,
        text=True,
    )
    for pid in (r.stdout or "").split():
        try:
            os.kill(int(pid), 15)
        except Exception:
            pass


def remote_reachable(base: str) -> bool:
    url = base.rstrip("/") + "/index.html"
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=5) as res:
            return 200 <= res.status < 400
    except Exception:
        try:
            with urllib.request.urlopen(url, timeout=5) as res:
                return 200 <= res.status < 500
        except urllib.error.HTTPError as e:
            return e.code != 404
        except Exception:
            return False


def github_pages_status(owner: str = "absrdst", repo: str = "TokiMenu") -> dict:
    """Public API: whether the repo has Pages enabled (has_pages)."""
    out = {"ok": False, "private": None, "has_pages": None, "html_url": None}
    try:
        import json

        with urllib.request.urlopen(
            f"https://api.github.com/repos/{owner}/{repo}", timeout=5
        ) as res:
            d = json.loads(res.read().decode("utf-8"))
        out["ok"] = True
        out["private"] = bool(d.get("private"))
        out["has_pages"] = bool(d.get("has_pages"))
        out["html_url"] = d.get("html_url") or f"https://github.com/{owner}/{repo}"
    except Exception as e:
        out["error"] = str(e)
    return out


def remote_unavailable_message(base: str) -> str:
    """Human-readable reason Remote failed (Pages off vs other)."""
    st = github_pages_status()
    lines = [
        "Remote host is not available (HTTP 404 or unreachable):",
        "",
        base,
        "",
    ]
    if st.get("ok") and st.get("has_pages") is False:
        lines += [
            "Your repo is on GitHub, but GitHub Pages is NOT enabled yet.",
            "Making the repo public alone does not turn Pages on.",
            "",
            "Enable it once:",
            "  1. Open:  https://github.com/absrdst/TokiMenu/settings/pages",
            "  2. Build and deployment → Source: Deploy from a branch",
            "  3. Branch: main   Folder: / (root)   → Save",
            "  4. Wait 1–2 minutes, then try Remote again",
            "",
            f"(Repo public={not st.get('private')}, has_pages={st.get('has_pages')})",
        ]
    elif st.get("ok") and st.get("has_pages"):
        lines += [
            "Pages is enabled, but the site still 404s — often still deploying.",
            "Wait a minute, hard-refresh, or check Actions / Pages build log.",
            "",
            "  https://github.com/absrdst/TokiMenu/settings/pages",
        ]
    else:
        lines += [
            "GitHub Pages is not automatic after a git push or after making",
            "the repo public. Enable Pages under repo Settings → Pages:",
            "",
            "  https://github.com/absrdst/TokiMenu/settings/pages",
            "  Source: Deploy from a branch → main → / (root) → Save",
        ]
    lines += [
        "",
        "Use Environment → Local for private Google Sheets on this Mac.",
    ]
    return "\n".join(lines)


# ── Dialog ──────────────────────────────────────────────────────────────────

def _env_browser() -> str | None:
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
    env = os.environ.get("TOKI_LAYOUT", "").strip().lower()
    if env in ("single", "one", "preview", "all", "preview-all", "1"):
        return "single"
    if env in ("tiled", "quad", "4", "windows", "separate", "0"):
        return "tiled"
    return None


def _env_environment() -> str | None:
    env = os.environ.get("TOKI_ENV", "").strip().lower()
    if env in ("local", "localhost", "dev", "development"):
        return "local"
    if env in ("remote", "prod", "production", "pages", "github", "web"):
        return "remote"
    return None


def _env_chrome() -> bool | None:
    env = os.environ.get("TOKI_CHROME", "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        return True
    if env in ("0", "false", "no", "off"):
        return False
    return None


def prompt_launch_options() -> tuple[str, str, str, bool] | None:
    """
    One dialog: browser, environment, single-window, show chrome.

    Returns (browser_key, layout, env, show_chrome) or None if cancelled.
    layout: tiled|single   env: local|remote
    """
    env_browser = _env_browser()
    env_layout = _env_layout()
    env_env = _env_environment()
    env_chrome = _env_chrome()

    # Fully non-interactive
    if env_browser and env_layout and env_env is not None and env_chrome is not None:
        return env_browser, env_layout, env_env, env_chrome
    if env_browser and env_layout and env_env is not None and env_chrome is None:
        return env_browser, env_layout, env_env, False
    if env_browser and env_layout and env_env is None and env_chrome is not None:
        return env_browser, env_layout, "local", env_chrome
    if env_browser and env_layout and env_env is None and env_chrome is None:
        return env_browser, env_layout, "local", False

    default_label = "Google Chrome"
    for label, key in BROWSER_CHOICES:
        if browser_installed(key):
            default_label = label
            break
    default_js = default_label.replace("\\", "\\\\").replace('"', '\\"')

    single_default = "true" if env_layout == "single" else "false"
    chrome_default = "true" if env_chrome is True else "false"
    env_default = "Remote — GitHub Pages (static)" if env_env == "remote" else "Local — this Mac (Sheets API)"
    env_default_js = env_default.replace("\\", "\\\\").replace('"', '\\"')

    # One NSAlert: browser + environment + two checkboxes; force focus
    script = f'''
ObjC.import("AppKit");
function run() {{
  var app = $.NSApplication.sharedApplication;
  try {{
    app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
  }} catch (e0) {{}}
  try {{
    app.activateIgnoringOtherApps(true);
  }} catch (e1) {{
    try {{
      app.activateIgnoringOtherApps(true);
    }} catch (e2) {{}}
  }}

  var alert = $.NSAlert.alloc.init;
  alert.setMessageText("Toki Menus");
  alert.setInformativeText(
    "Local uses this Mac (private Sheets API). Remote opens GitHub Pages (static host only)."
  );
  alert.addButtonWithTitle("Open");
  alert.addButtonWithTitle("Cancel");

  var width = 360;
  var height = 132;
  var view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, width, height));

  // Browser
  var browserPopup = $.NSPopUpButton.alloc.initWithFrame($.NSMakeRect(0, 100, width, 26));
  var browsers = ["Google Chrome", "Firefox", "Safari"];
  for (var i = 0; i < browsers.length; i++) {{
    browserPopup.addItemWithTitle(browsers[i]);
  }}
  browserPopup.selectItemWithTitle("{default_js}");
  view.addSubview(browserPopup);

  // Environment
  var envPopup = $.NSPopUpButton.alloc.initWithFrame($.NSMakeRect(0, 68, width, 26));
  var envs = [
    "Local — this Mac (Sheets API)",
    "Remote — GitHub Pages (static)"
  ];
  for (var j = 0; j < envs.length; j++) {{
    envPopup.addItemWithTitle(envs[j]);
  }}
  envPopup.selectItemWithTitle("{env_default_js}");
  view.addSubview(envPopup);

  // Single-window checkbox
  var box = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, 36, width, 24));
  try {{ box.setButtonType($.NSButtonTypeSwitch); }}
  catch (e) {{ box.setButtonType($.NSSwitchButton); }}
  box.setTitle("Single window — all boards preview");
  try {{
    box.setState({single_default} ? $.NSControlStateValueOn : $.NSControlStateValueOff);
  }} catch (e2) {{
    box.setState({single_default} ? 1 : 0);
  }}
  view.addSubview(box);

  // Show chrome checkbox
  var chromeBox = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, 8, width, 24));
  try {{ chromeBox.setButtonType($.NSButtonTypeSwitch); }}
  catch (e3) {{ chromeBox.setButtonType($.NSSwitchButton); }}
  chromeBox.setTitle("Show extra info (labels & zoom tips)");
  try {{
    chromeBox.setState({chrome_default} ? $.NSControlStateValueOn : $.NSControlStateValueOff);
  }} catch (e4) {{
    chromeBox.setState({chrome_default} ? 1 : 0);
  }}
  view.addSubview(chromeBox);

  alert.setAccessoryView(view);

  // Bring alert to front again right before modal
  try {{ app.activateIgnoringOtherApps(true); }} catch (e5) {{}}

  var resp = alert.runModal;
  if (Number(resp) !== 1000) return "CANCEL";

  var browser = browserPopup.titleOfSelectedItem.js;
  var environment = envPopup.titleOfSelectedItem.js;
  var singleOn = Number(box.state) === 1;
  var chromeOn = Number(chromeBox.state) === 1;
  return browser + "|" + (singleOn ? "single" : "tiled") + "|" + environment + "|" + (chromeOn ? "1" : "0");
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
        return _prompt_fallback_list()

    if not out or out == "CANCEL":
        return None

    parts = out.split("|")
    if len(parts) < 2:
        resolved = resolve_browser(out)
        return (resolved[0], "tiled", "local", False) if resolved else None

    label = parts[0].strip()
    layout = parts[1].strip() if len(parts) > 1 else "tiled"
    env_label = parts[2].strip() if len(parts) > 2 else ""
    chrome_flag = parts[3].strip() if len(parts) > 3 else "0"

    if layout not in ("tiled", "single"):
        layout = "tiled"
    env = "remote" if env_label.lower().startswith("remote") else "local"
    show_chrome = chrome_flag in ("1", "true", "yes")

    browser_key = None
    for blabel, key in BROWSER_CHOICES:
        if label == blabel:
            browser_key = key
            break
    if not browser_key:
        resolved = resolve_browser(label)
        browser_key = resolved[0] if resolved else None
    if not browser_key:
        return None

    # Env overrides win when partially set
    if env_layout:
        layout = env_layout
    if env_env:
        env = env_env
    if env_chrome is not None:
        show_chrome = env_chrome
    if env_browser:
        browser_key = env_browser

    return browser_key, layout, env, show_chrome


def _prompt_fallback_list() -> tuple[str, str, str, bool] | None:
    """Minimal fallback: browser list only, local + tiled + no chrome."""
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
            return key, "tiled", "local", False
    resolved = resolve_browser(choice)
    return (resolved[0], "tiled", "local", False) if resolved else None


def full_bounds_from_quads(quads):
    x0, y0, _w0, _h0 = quads[0]
    x3, y3, w3, h3 = quads[3]
    return (x0, y0, (x3 + w3) - x0, (y3 + h3) - y0)


def open_single_window(family: str, app_name: str, binary: str | None, bounds):
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
      set startIdx to 5 - n
      repeat with i from 1 to n
        set qi to startIdx + i - 1
        try
          set position of window i to item qi of thePositions
          set size of window i to item qi of theSizes
        end try
      end repeat
    else
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
        if "not allowed" in err.lower() or "assistive" in err.lower():
            alert(
                "Firefox windows opened, but macOS blocked window tiling.\n\n"
                "System Settings → Privacy & Security → Accessibility\n"
                "→ enable Open Toki Menus (or Terminal / Python).",
                stop=False,
            )


def main():
    root = project_root()
    os.environ.setdefault("TOKI_PROJECT", str(root))

    for f in (
        "index.html",
        "index2.html",
        "index3.html",
        "index4.html",
        "preview-all.html",
        "scripts/toki_server.py",
    ):
        if not (root / f).is_file():
            alert(f"Missing {f} in:\n{root}", stop=True)
            sys.exit(1)

    quads = screen_quads()
    print("Toki Menus tile quads:", quads, flush=True)

    picked = prompt_launch_options()
    if not picked:
        print("cancelled", flush=True)
        sys.exit(0)
    key, layout, env, show_chrome = picked
    print(
        "choice:",
        key,
        "layout=",
        layout,
        "env=",
        env,
        "chrome=",
        show_chrome,
        flush=True,
    )

    if env == "local":
        if not ensure_local_server(root):
            sys.exit(1)
    else:
        if not remote_reachable(DEFAULT_REMOTE_BASE):
            alert(remote_unavailable_message(DEFAULT_REMOTE_BASE), stop=True)
            sys.exit(1)

    set_base_urls(env, show_chrome)
    print("BASE=", BASE, "PREVIEW=", PREVIEW_ALL_URL, flush=True)

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

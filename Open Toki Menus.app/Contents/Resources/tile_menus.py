#!/usr/bin/env python3
"""Open Toki Menu boards (tiled or single-window preview).

One launch dialog:
  • Browser / Environment
  • Boards 1–4 checkboxes (default all on)
  • Single window — all boards preview (default off)
  • Show extra info (default off)
  • Hard refresh — cache-bust query on URLs (default on)
  • Private browser — incognito / private window (default on)

Local server runs in a visible Terminal window titled “Toki Menu Server”
(Ctrl+C or close the window to stop it).

Skip UI with env:
  TOKI_BROWSER=chrome|firefox|safari
  TOKI_LAYOUT=tiled|single
  TOKI_ENV=local|remote
  TOKI_CHROME=0|1
  TOKI_HARD_REFRESH=0|1
  TOKI_PRIVATE=0|1
  TOKI_BOARDS=1,2,3,4
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
from typing import Any

PORT = int(os.environ.get("TOKI_PORT", "8765"))
DEFAULT_REMOTE_BASE = os.environ.get(
    "TOKI_REMOTE_BASE", "https://absrdst.github.io/TokiMenu"
).rstrip("/")
LOG = Path(os.environ.get("TOKI_SERVER_LOG", "/tmp/toki-menu-server.log"))

# Filled after Environment is chosen
BASE = f"http://127.0.0.1:{PORT}"
URLS: list[str] = []
# Parallel to URLS: which screen quadrant index (0..3) each URL uses
URL_QUAD_INDICES: list[int] = []
PREVIEW_ALL_URL = ""
# Last launch flags (used by open_* helpers)
LAUNCH_PRIVATE = True
LAUNCH_HARD_REFRESH = True

BOARD_PATHS = (
    "index.html",
    "index2.html",
    "index3.html",
    "index4.html",
)
BOARD_LABELS = (
    "1 · Bowls",
    "2 · Handhelds",
    "3 · Munchies",
    "4 · Drinks",
)

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


def set_base_urls(
    env: str,
    show_chrome: bool,
    boards: list[bool] | None = None,
    hard_refresh: bool = True,
) -> None:
    """Populate BASE, URLS, PREVIEW_ALL_URL for the chosen environment."""
    global BASE, URLS, URL_QUAD_INDICES, PREVIEW_ALL_URL, LAUNCH_HARD_REFRESH
    LAUNCH_HARD_REFRESH = bool(hard_refresh)
    if env == "remote":
        BASE = DEFAULT_REMOTE_BASE
    else:
        BASE = f"http://127.0.0.1:{PORT}"

    if boards is None or len(boards) != 4:
        boards = [True, True, True, True]
    if not any(boards):
        boards = [True, True, True, True]

    bust = f"_toki={int(time.time())}" if hard_refresh else ""

    def with_q(path: str, *parts: str) -> str:
        qs = [p for p in parts if p]
        if bust:
            qs.append(bust)
        if not qs:
            return path
        return path + "?" + "&".join(qs)

    URLS = []
    URL_QUAD_INDICES = []
    for i, on in enumerate(boards):
        if not on:
            continue
        URLS.append(with_q(f"{BASE}/{BOARD_PATHS[i]}"))
        URL_QUAD_INDICES.append(i)

    chrome_q = "chrome=1" if show_chrome else "chrome=0"
    board_ids = ",".join(str(i + 1) for i, on in enumerate(boards) if on)
    boards_q = f"boards={board_ids}" if board_ids else "boards=1,2,3,4"
    PREVIEW_ALL_URL = with_q(f"{BASE}/preview-all.html", chrome_q, boards_q)


def chromium_extra_args(private: bool, hard_refresh: bool) -> list[str]:
    args: list[str] = []
    if private:
        args.append("--incognito")
    if hard_refresh:
        # Prefer fresh network fetch when supported
        args.append("--disable-http-cache")
    return args


def firefox_extra_args(private: bool) -> list[str]:
    if private:
        return ["-private-window"]
    return ["-new-window"]


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


def _shell_quote(s: str) -> str:
    """Single-quote for bash / AppleScript string embedding."""
    return "'" + s.replace("'", "'\"'\"'") + "'"


def start_server_in_terminal(root: Path, server: Path, py: str) -> bool:
    """
    Open a visible Terminal window running toki_server.
    Close that window (or Ctrl+C) to stop the server.
    """
    intro = "Toki Menu local server — close this window or Ctrl+C to stop."
    bye = "Server stopped. You can close this window."
    # Title the tab, cd to project, run server in foreground so close = stop
    cmd = " ".join(
        [
            f"printf '\\e]0;Toki Menu Server :{PORT}\\a';",
            f"cd {_shell_quote(str(root))} &&",
            f"echo {_shell_quote(intro)} &&",
            "echo &&",
            f"{_shell_quote(py)} {_shell_quote(str(server))}",
            f"--port {PORT} --bind 127.0.0.1;",
            "echo;",
            f"echo {_shell_quote(bye)};",
            "exec bash",
        ]
    )
    # Escape for AppleScript double-quoted string
    as_cmd = cmd.replace("\\", "\\\\").replace('"', '\\"')
    script = f'''
tell application "Terminal"
  activate
  do script "{as_cmd}"
  delay 0.2
  try
    set custom title of front window to "Toki Menu Server"
  end try
end tell
'''
    try:
        r = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            check=False,
        )
        if r.returncode != 0:
            print(
                "Terminal launch failed:",
                (r.stderr or r.stdout or "").strip(),
                flush=True,
            )
            return False
        print("Started toki_server in Terminal window", flush=True)
        return True
    except Exception as e:
        print("Terminal launch error:", e, flush=True)
        return False


def ensure_local_server(root: Path) -> bool:
    """Start toki_server in a Terminal window if needed. Returns True if healthy."""
    health = api_health()
    if health and health.get("ok") and health.get("sheetsApi"):
        print(
            f"toki_server already healthy on :{PORT} "
            "(close its Terminal window to stop)",
            flush=True,
        )
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
    try:
        with LOG.open("a", encoding="utf-8") as logf:
            logf.write(
                f"\n==== start {time.strftime('%Y-%m-%d %H:%M:%S')} "
                f"(Terminal window) ====\n"
            )
    except Exception:
        pass

    if not start_server_in_terminal(root, server, py):
        # Last resort: background process (hard to stop — avoid if possible)
        print("Falling back to background server (no Terminal)", flush=True)
        with LOG.open("a", encoding="utf-8") as logf:
            subprocess.Popen(
                [py, str(server), "--port", str(PORT), "--bind", "127.0.0.1"],
                cwd=str(root),
                stdout=logf,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )

    for _ in range(40):
        h = api_health()
        if h and h.get("ok"):
            if not h.get("sheetsApi"):
                alert(
                    "Server is up but Sheets API is off.\n\n"
                    "Menus need either:\n"
                    "• secrets/google-service-account.json + sheet shared "
                    "with that email, and Drive API enabled\n"
                    "• or sheet General access = Anyone with the link (Viewer)\n\n"
                    f"See scripts/gsheet_api.md\n"
                    f"Server log: {LOG}",
                    stop=False,
                )
            return True
        time.sleep(0.25)

    alert(
        f"Could not start Toki server on port {PORT}.\n\n"
        "Look for a Terminal window titled “Toki Menu Server”.\n"
        f"Also check: {LOG}",
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


def _env_bool(name: str) -> bool | None:
    env = os.environ.get(name, "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        return True
    if env in ("0", "false", "no", "off"):
        return False
    return None


def _env_chrome() -> bool | None:
    return _env_bool("TOKI_CHROME")


def _env_hard_refresh() -> bool | None:
    return _env_bool("TOKI_HARD_REFRESH")


def _env_private() -> bool | None:
    return _env_bool("TOKI_PRIVATE")


def _env_boards() -> list[bool] | None:
    raw = os.environ.get("TOKI_BOARDS", "").strip()
    if not raw:
        return None
    on = [False, False, False, False]
    for part in raw.replace(" ", "").split(","):
        if not part:
            continue
        try:
            n = int(part)
        except ValueError:
            continue
        if 1 <= n <= 4:
            on[n - 1] = True
    return on if any(on) else None


def _default_launch_opts() -> dict[str, Any]:
    return {
        "browser": "chrome",
        "layout": "tiled",
        "env": "local",
        "show_chrome": False,
        "boards": [True, True, True, True],
        "hard_refresh": True,
        "private": True,
    }


def prompt_launch_options() -> dict[str, Any] | None:
    """
    Dedicated Toki Menus window: browser, env, boards, layout, chrome,
    hard refresh, private.

    Returns options dict or None if cancelled.
    """
    env_browser = _env_browser()
    env_layout = _env_layout()
    env_env = _env_environment()
    env_chrome = _env_chrome()
    env_hard = _env_hard_refresh()
    env_private = _env_private()
    env_boards = _env_boards()

    # Fully non-interactive when browser + layout forced
    if env_browser and env_layout:
        opts = _default_launch_opts()
        opts["browser"] = env_browser
        opts["layout"] = env_layout
        opts["env"] = env_env or "local"
        if env_chrome is not None:
            opts["show_chrome"] = env_chrome
        if env_hard is not None:
            opts["hard_refresh"] = env_hard
        if env_private is not None:
            opts["private"] = env_private
        if env_boards is not None:
            opts["boards"] = env_boards
        return opts

    default_label = "Google Chrome"
    for label, key in BROWSER_CHOICES:
        if browser_installed(key):
            default_label = label
            break
    default_js = default_label.replace("\\", "\\\\").replace('"', '\\"')

    single_default = "true" if env_layout == "single" else "false"
    chrome_default = "true" if env_chrome is True else "false"
    hard_default = "false" if env_hard is False else "true"
    private_default = "false" if env_private is False else "true"
    boards = env_boards or [True, True, True, True]
    bdefs = ["true" if b else "false" for b in boards]
    env_default = (
        "Remote — GitHub Pages (static)"
        if env_env == "remote"
        else "Local — this Mac (Sheets API)"
    )
    env_default_js = env_default.replace("\\", "\\\\").replace('"', '\\"')

    # NSAlert + invisible key window so the launcher owns focus (not buried)
    out = _prompt_nsalert_dialog(
        default_js,
        env_default_js,
        single_default,
        chrome_default,
        hard_default,
        private_default,
        bdefs,
    )
    if out is None:
        return _prompt_fallback_list()

    if not out or out == "CANCEL":
        return None

    return _parse_launch_result(
        out,
        env_browser=env_browser,
        env_layout=env_layout,
        env_env=env_env,
        env_chrome=env_chrome,
        env_hard=env_hard,
        env_private=env_private,
        env_boards=env_boards,
    )


def _prompt_nsalert_dialog(
    default_js: str,
    env_default_js: str,
    single_default: str,
    chrome_default: str,
    hard_default: str,
    private_default: str,
    bdefs: list[str],
) -> str | None:
    """NSAlert accessory fallback if dedicated window JSObjC fails."""
    script = f'''
ObjC.import("AppKit");
function makeSwitch(title, x, y, w, on) {{
  var box = $.NSButton.alloc.initWithFrame($.NSMakeRect(x, y, w, 22));
  try {{ box.setButtonType($.NSButtonTypeSwitch); }}
  catch (e) {{ box.setButtonType($.NSSwitchButton); }}
  box.setTitle(title);
  try {{
    box.setState(on ? $.NSControlStateValueOn : $.NSControlStateValueOff);
  }} catch (e2) {{ box.setState(on ? 1 : 0); }}
  return box;
}}
function run() {{
  var app = $.NSApplication.sharedApplication;
  try {{ app.setActivationPolicy($.NSApplicationActivationPolicyRegular); }} catch (e0) {{}}
  try {{ app.activateIgnoringOtherApps(true); }} catch (e1) {{}}

  // Own a tiny key window so osascript isn't headless-unfocused
  var keyWin = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
    $.NSMakeRect(0, 0, 2, 2),
    $.NSWindowStyleMaskBorderless,
    $.NSBackingStoreBuffered,
    false
  );
  keyWin.setAlphaValue(0.01);
  keyWin.makeKeyAndOrderFront(null);
  try {{ app.activateIgnoringOtherApps(true); }} catch (e2) {{}}

  var alert = $.NSAlert.alloc.init;
  alert.setMessageText("Toki Menus");
  alert.setInformativeText(
    "Local = this Mac (Sheets API). Remote = GitHub Pages. Private + hard refresh default on."
  );
  alert.addButtonWithTitle("Open");
  alert.addButtonWithTitle("Cancel");

  var width = 380;
  var height = 250;
  var view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, width, height));
  var y = height - 28;

  var browserPopup = $.NSPopUpButton.alloc.initWithFrame($.NSMakeRect(0, y, width, 26));
  ["Google Chrome", "Firefox", "Safari"].forEach(function (t) {{ browserPopup.addItemWithTitle(t); }});
  browserPopup.selectItemWithTitle("{default_js}");
  view.addSubview(browserPopup);
  y -= 30;

  var envPopup = $.NSPopUpButton.alloc.initWithFrame($.NSMakeRect(0, y, width, 26));
  ["Local — this Mac (Sheets API)", "Remote — GitHub Pages (static)"].forEach(function (t) {{
    envPopup.addItemWithTitle(t);
  }});
  envPopup.selectItemWithTitle("{env_default_js}");
  view.addSubview(envPopup);
  y -= 28;

  var half = Math.floor((width - 8) / 2);
  var b1 = makeSwitch("1 · Bowls", 0, y, half, {bdefs[0]});
  var b2 = makeSwitch("2 · Handhelds", half + 8, y, half, {bdefs[1]});
  view.addSubview(b1); view.addSubview(b2);
  y -= 24;
  var b3 = makeSwitch("3 · Munchies", 0, y, half, {bdefs[2]});
  var b4 = makeSwitch("4 · Drinks", half + 8, y, half, {bdefs[3]});
  view.addSubview(b3); view.addSubview(b4);
  y -= 28;

  var singleBox = makeSwitch("Single window — all boards preview", 0, y, width, {single_default});
  view.addSubview(singleBox); y -= 24;
  var chromeBox = makeSwitch("Show extra info (labels & zoom tips)", 0, y, width, {chrome_default});
  view.addSubview(chromeBox); y -= 24;
  var hardBox = makeSwitch("Hard refresh (cache-bust URLs)", 0, y, width, {hard_default});
  view.addSubview(hardBox); y -= 24;
  var privateBox = makeSwitch("Private browser (incognito)", 0, y, width, {private_default});
  view.addSubview(privateBox);

  alert.setAccessoryView(view);
  try {{ app.activateIgnoringOtherApps(true); }} catch (e3) {{}}
  var resp = alert.runModal;
  try {{ keyWin.orderOut(null); }} catch (e4) {{}}
  if (Number(resp) !== 1000) return "CANCEL";

  var boardsBits =
    (Number(b1.state) === 1 ? "1" : "0") +
    (Number(b2.state) === 1 ? "1" : "0") +
    (Number(b3.state) === 1 ? "1" : "0") +
    (Number(b4.state) === 1 ? "1" : "0");
  return browserPopup.titleOfSelectedItem.js + "|" +
    (Number(singleBox.state) === 1 ? "single" : "tiled") + "|" +
    envPopup.titleOfSelectedItem.js + "|" +
    (Number(chromeBox.state) === 1 ? "1" : "0") + "|" +
    boardsBits + "|" +
    (Number(hardBox.state) === 1 ? "1" : "0") + "|" +
    (Number(privateBox.state) === 1 ? "1" : "0");
}}
'''
    r = subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", script],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        print("alert dialog failed:", (r.stderr or "").strip(), flush=True)
        return None
    return (r.stdout or "").strip() or None


def _parse_launch_result(
    out: str,
    *,
    env_browser: str | None,
    env_layout: str | None,
    env_env: str | None,
    env_chrome: bool | None,
    env_hard: bool | None,
    env_private: bool | None,
    env_boards: list[bool] | None,
) -> dict[str, Any] | None:
    parts = out.split("|")
    if len(parts) < 2:
        resolved = resolve_browser(out)
        if not resolved:
            return None
        opts = _default_launch_opts()
        opts["browser"] = resolved[0]
        return opts

    label = parts[0].strip()
    layout = parts[1].strip() if len(parts) > 1 else "tiled"
    env_label = parts[2].strip() if len(parts) > 2 else ""
    chrome_flag = parts[3].strip() if len(parts) > 3 else "0"
    boards_bits = parts[4].strip() if len(parts) > 4 else "1111"
    hard_flag = parts[5].strip() if len(parts) > 5 else "1"
    private_flag = parts[6].strip() if len(parts) > 6 else "1"

    if layout not in ("tiled", "single"):
        layout = "tiled"
    env = "remote" if env_label.lower().startswith("remote") else "local"
    show_chrome = chrome_flag in ("1", "true", "yes")
    hard_refresh = hard_flag in ("1", "true", "yes")
    private = private_flag in ("1", "true", "yes")

    boards = [False, False, False, False]
    bits = (boards_bits + "0000")[:4]
    for i, ch in enumerate(bits):
        boards[i] = ch == "1"
    if not any(boards):
        boards = [True, True, True, True]

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

    if env_layout:
        layout = env_layout
    if env_env:
        env = env_env
    if env_chrome is not None:
        show_chrome = env_chrome
    if env_hard is not None:
        hard_refresh = env_hard
    if env_private is not None:
        private = env_private
    if env_boards is not None:
        boards = env_boards
    if env_browser:
        browser_key = env_browser

    return {
        "browser": browser_key,
        "layout": layout,
        "env": env,
        "show_chrome": show_chrome,
        "boards": boards,
        "hard_refresh": hard_refresh,
        "private": private,
    }


def _prompt_fallback_list() -> dict[str, Any] | None:
    """Minimal fallback: browser list only."""
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
    "Open Toki Menu boards in which browser?" ¬
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
    opts = _default_launch_opts()
    for label, key in BROWSER_CHOICES:
        if choice == label:
            opts["browser"] = key
            return opts
    resolved = resolve_browser(choice)
    if not resolved:
        return None
    opts["browser"] = resolved[0]
    return opts


def full_bounds_from_quads(quads):
    x0, y0, _w0, _h0 = quads[0]
    x3, y3, w3, h3 = quads[3]
    return (x0, y0, (x3 + w3) - x0, (y3 + h3) - y0)


def _selected_quads(all_quads):
    """Map URL_QUAD_INDICES → screen quads (natural board corners)."""
    if not URL_QUAD_INDICES:
        return list(all_quads)
    return [all_quads[i] for i in URL_QUAD_INDICES if 0 <= i < len(all_quads)]


def open_single_window(family: str, app_name: str, binary: str | None, bounds):
    global LAUNCH_PRIVATE, LAUNCH_HARD_REFRESH
    x, y, w, h = bounds
    url = PREVIEW_ALL_URL
    private = LAUNCH_PRIVATE
    hard = LAUNCH_HARD_REFRESH
    print(
        "layout: single window",
        url,
        bounds,
        "private=",
        private,
        "hard=",
        hard,
        flush=True,
    )

    if family == "chrome":
        args = chromium_extra_args(private, hard) + [
            "--new-window",
            f"--window-position={x},{y}",
            f"--window-size={w},{h}",
            url,
        ]
        if binary:
            subprocess.Popen(
                [binary] + args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        else:
            subprocess.call(["open", "-na", app_name, "--args"] + args)
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
        # Safari has no clean private CLI; open location (hard refresh via URL bust)
        priv_block = ""
        if private:
            priv_block = """
  try
    tell application "System Events"
      tell process "Safari"
        click menu item "New Private Window" of menu "File" of menu bar 1
      end tell
    end tell
    delay 0.4
  end try
"""
        script = f'''
tell application "Safari"
  activate
  {priv_block}
  open location "{url}"
  delay 0.6
  try
    set bounds of front window to {{{x}, {y}, {x + w}, {y + h}}}
  end try
end tell
'''
        subprocess.run(["osascript", "-e", script], check=False)
        return

    ff_args = firefox_extra_args(private) + [url]
    if binary:
        subprocess.Popen(
            [binary] + ff_args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    else:
        subprocess.call(["open", "-na", "Firefox", "--args"] + ff_args)
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
    global LAUNCH_PRIVATE, LAUNCH_HARD_REFRESH
    private = LAUNCH_PRIVATE
    hard = LAUNCH_HARD_REFRESH
    use_quads = _selected_quads(quads)
    n = min(len(URLS), len(use_quads))
    for i in range(n):
        url = URLS[i]
        x, y, w, h = use_quads[i]
        args = chromium_extra_args(private, hard) + [
            "--new-window",
            f"--window-position={x},{y}",
            f"--window-size={w},{h}",
            url,
        ]
        if binary:
            subprocess.Popen(
                [binary] + args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        else:
            subprocess.call(["open", "-na", app_name, "--args"] + args)
        time.sleep(0.4)

    time.sleep(1.2)
    if n < 1:
        return
    bounds_list = ", ".join(
        "{%d, %d, %d, %d}" % (x, y, x + w, y + h) for x, y, w, h in use_quads[:n]
    )
    # Match by path only (query strings differ with cache-bust)
    path_list = ", ".join(
        '"%s"' % (BOARD_PATHS[URL_QUAD_INDICES[i]] if i < len(URL_QUAD_INDICES) else "")
        for i in range(n)
    )
    script = f'''
tell application "{app_name}"
  activate
  set thePaths to {{{path_list}}}
  set theBounds to {{{bounds_list}}}
  set n to count of thePaths
  repeat with i from 1 to n
    set targetPath to item i of thePaths
    set targetBounds to item i of theBounds
    set found to false
    repeat with wRef in windows
      try
        set tabURL to URL of active tab of wRef
        if tabURL contains targetPath then
          set bounds of wRef to targetBounds
          set found to true
          exit repeat
        end if
      end try
    end repeat
  end repeat
end tell
'''
    subprocess.run(["osascript", "-e", script], check=False)


def open_safari(quads):
    global LAUNCH_PRIVATE
    use_quads = _selected_quads(quads)
    n = min(len(URLS), len(use_quads))
    if n < 1:
        return
    bounds_list = ", ".join(
        "{%d, %d, %d, %d}" % (x, y, x + w, y + h) for x, y, w, h in use_quads[:n]
    )
    urls_as = ", ".join('"%s"' % u for u in URLS[:n])
    priv = "true" if LAUNCH_PRIVATE else "false"
    script = f'''
tell application "Safari"
  activate
  if {priv} then
    try
      tell application "System Events"
        tell process "Safari"
          click menu item "New Private Window" of menu "File" of menu bar 1
        end tell
      end tell
      delay 0.35
    end try
  end if
  set theURLs to {{{urls_as}}}
  set bs to {{{bounds_list}}}
  set n to count of theURLs
  open location item 1 of theURLs
  delay 0.45
  if n > 1 then
    repeat with i from 2 to n
      make new document with properties {{URL:(item i of theURLs)}}
      delay 0.3
    end repeat
  end if
  delay 0.5
  set wn to count of windows
  if wn >= n then
    repeat with i from 1 to n
      -- newest windows first
      set bounds of window (wn - n + i) to item i of bs
    end repeat
  end if
end tell
'''
    subprocess.run(["osascript", "-e", script], check=False)


def open_firefox(binary: str | None, quads):
    global LAUNCH_PRIVATE
    use_quads = _selected_quads(quads)
    n = min(len(URLS), len(use_quads))
    ff_base = firefox_extra_args(LAUNCH_PRIVATE)
    for i in range(n):
        url = URLS[i]
        if binary:
            subprocess.Popen(
                [binary] + ff_base + [url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        else:
            subprocess.call(
                ["open", "-na", "Firefox", "--args"] + ff_base + [url]
            )
        time.sleep(0.5)

    time.sleep(1.6)
    if n < 1:
        return
    pos_list = ", ".join("{%d, %d}" % (x, y) for x, y, _w, _h in use_quads[:n])
    size_list = ", ".join("{%d, %d}" % (w, h) for _x, _y, w, h in use_quads[:n])
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
    set n to count of thePositions
    set wn to count of windows
    set take to n
    if wn < take then set take to wn
    repeat with i from 1 to take
      set qi to take - i + 1
      try
        set position of window i to item qi of thePositions
        set size of window i to item qi of theSizes
      end try
    end repeat
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


def refresh_build_info(root: Path) -> None:
    """Write js/build-info.js from current git HEAD (for Local accuracy)."""
    try:
        r = subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "log",
                "-1",
                "--format=%H%n%h%n%ci%n%s",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if r.returncode != 0:
            return
        lines = (r.stdout or "").strip().split("\n")
        full, short, date, subj = (lines + ["", "", "", ""])[:4]
        import json

        info = {
            "hash": short or "unknown",
            "hashFull": full or "",
            "date": date or "",
            "subject": subj or "",
            "source": "git",
        }
        out = root / "js" / "build-info.js"
        out.write_text(
            "/* Auto-generated build stamp */\n"
            "window.TOKI_BUILD = "
            + json.dumps(info, indent=2)
            + ";\n",
            encoding="utf-8",
        )
        print("build-info:", short, date, flush=True)
    except Exception as e:
        print("build-info skip:", e, flush=True)


def main():
    global LAUNCH_PRIVATE, LAUNCH_HARD_REFRESH
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

    key = picked["browser"]
    layout = picked["layout"]
    env = picked["env"]
    show_chrome = picked["show_chrome"]
    boards = picked["boards"]
    hard_refresh = picked["hard_refresh"]
    private = picked["private"]
    LAUNCH_PRIVATE = private
    LAUNCH_HARD_REFRESH = hard_refresh

    print(
        "choice:",
        key,
        "layout=",
        layout,
        "env=",
        env,
        "chrome=",
        show_chrome,
        "boards=",
        boards,
        "hard=",
        hard_refresh,
        "private=",
        private,
        flush=True,
    )

    if env == "local":
        refresh_build_info(root)
        if not ensure_local_server(root):
            sys.exit(1)
    else:
        if not remote_reachable(DEFAULT_REMOTE_BASE):
            alert(remote_unavailable_message(DEFAULT_REMOTE_BASE), stop=True)
            sys.exit(1)

    set_base_urls(env, show_chrome, boards=boards, hard_refresh=hard_refresh)
    print(
        "BASE=",
        BASE,
        "URLS=",
        len(URLS),
        "PREVIEW=",
        PREVIEW_ALL_URL,
        flush=True,
    )

    if not URLS and layout != "single":
        alert("No boards selected.", stop=True)
        sys.exit(1)

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

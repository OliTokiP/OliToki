#!/usr/bin/env python3
"""
TokiMenu local server: static files + Google Sheets API proxy.

Boards fetch /api/sheets/csv so the spreadsheet can stay private (no
"Anyone with the link"). Live workbook is chosen by OliToki Menu Settings
(Data Source). Drive xlsx export is retired (410 on /api/sheets/xlsx).
The service account key never goes to the browser — only this process
holds secrets/google-service-account.json.

Usage:
  python3 scripts/toki_server.py
  python3 scripts/toki_server.py --port 8765

Env:
  TOKI_SHEET_ID   default spreadsheet id
  TOKI_SA_KEY     path to service account JSON
  TOKI_SA_JSON    service account JSON text (Cloud Run secret; preferred in host)
  TOKI_PORT       port (default 8765). Cloud Run sets PORT — that wins.
  TOKI_BIND       bind address (default 127.0.0.1; 0.0.0.0 when PORT/TOKI_API_ONLY)
  TOKI_API_ONLY   1 = API only, no static files (hosted)
  TOKI_ENV        local | testing | restaurant (Deployer pin)
  TOKI_FORCE_SOURCE  restaurant | alpha — ignore Settings Data Source cell
  TOKI_NO_RELOAD  1 = do not auto-restart when this file changes (local only)
"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
# Wall-clock when this process started. Suite Health uses it to know a
# bounce actually replaced the process (execv keeps the same pid).
_STARTED_AT = time.time()
DEFAULT_KEY = ROOT / "secrets" / "google-service-account.json"
DEFAULT_SHEET_ID = "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10"
DEFAULT_SETTINGS_SHEET_ID = "1OwNKHzjP46xKJBW8sTm4IOWhIzf0lENdZ8rv_GY37fY"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    # Cheap "did the workbook change?" check. Sheets values.get every second
    # is the 60/min quota; Drive metadata is a different, larger pool.
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    # Item Uploader: files this robot creates (food photos), not the whole Drive.
    "https://www.googleapis.com/auth/drive.file",
]
STYLE_THEME_GID = "183083022"
# Inventory targets for POST /api/manager/item (gids match js/config*.js).
ITEM_MENUS = (
    {
        "id": "board1",
        "label": "Board 1 · Bowls",
        "gid": "1058015863",
        "kind": "board",
        "folder": "food-pics/bowls",
        "page": "index.html",
        "hasDescription": True,
        "priceSlots": 3,
    },
    {
        "id": "board2",
        "label": "Board 2 · Handhelds",
        "gid": "314919644",
        "kind": "board",
        "folder": "food-pics/handhelds",
        "page": "index2.html",
        "hasDescription": True,
        "priceSlots": 3,
    },
    {
        "id": "board3",
        "label": "Board 3 · Munchies",
        "gid": "1684494006",
        "kind": "board",
        "folder": "food-pics/munchies",
        "page": "index3.html",
        "hasDescription": True,
        "priceSlots": 3,
    },
    {
        "id": "proteins",
        "label": "Proteins",
        "gid": "1420775786",
        "kind": "box",
        "folder": "food-pics/proteins",
        "page": "index.html",
        "hasDescription": False,
        "priceSlots": 1,
    },
    {
        "id": "sauces",
        "label": "Sauces",
        "gid": "1630545949",
        "kind": "box",
        "folder": "food-pics/sauces",
        "page": "index.html",
        "hasDescription": False,
        "priceSlots": 1,
    },
    {
        "id": "drinks",
        "label": "Drinks · Sodas",
        "gid": "1145721787",
        "kind": "box",
        "folder": "food-pics/drinks",
        "page": "index4.html",
        "hasDescription": False,
        "priceSlots": 1,
    },
    {
        "id": "veggies",
        "label": "Veggies",
        "gid": "640368705",
        "kind": "box",
        "folder": "food-pics/veggies",
        "page": "index.html",
        "hasDescription": False,
        "priceSlots": 1,
    },
)
_ITEM_MENUS_BY_ID = {m["id"]: m for m in ITEM_MENUS}
# OliToki Menu Settings → Debugger tab (Debug Features only).
# Master Debug Mode is Settings column G per catalog row (G2 Restaurant, G3 Beta).
DEBUGGER_GID = "195166367"
DEBUGGER_TAB = "Debugger"
_SHEET_ID_IN_URL = re.compile(r"/spreadsheets/d/([a-zA-Z0-9-_]+)")
_BARE_SHEET_ID = re.compile(r"^[a-zA-Z0-9-_]{30,}$")

# Cache: avoid hammering Google on every soft reload / multi-board open.
# googleapiclient is serialized under _api_lock — without CSV cache, 8 parallel
# board fetches become 8 sequential Google round-trips (20–45s each when slow).
_meta_lock = threading.Lock()
_meta_cache = {"at": 0, "title_by_gid": {}, "gid_by_title": {}}
# sid -> {at, title_by_gid, gid_by_title} for catalog workbooks that are not
# the live TV pointer (Settings A2). ?beta boards read Beta Copy this way.
_sid_meta_cache: dict[str, dict] = {}
_csv_lock = threading.Lock()
# gid or "sid:gid" -> {"at": float, "text": str}
_csv_cache: dict[str, dict] = {}
# Drive modifiedTime/version of the catalog workbook the CSV cache was built from.
_csv_book_rev: str = ""
_csv_book_sid: str = ""
# Single-flight for full-workbook batchGet (all tabs in one Google round-trip)
_csv_batch_event: threading.Event | None = None
_csv_batch_error: BaseException | None = None
# Per-sid single-flight for foreign catalog batchGet (?beta / Manager Beta).
_csv_sid_flight: dict[str, threading.Event] = {}
_csv_sid_flight_error: dict[str, BaseException | None] = {}
_rev_lock = threading.Lock()
_rev_cache: dict = {"at": 0.0, "sid": "", "rev": None, "drive_ok": True}
# Do not ask Drive more than once a second (all boards share this).
REV_MIN_INTERVAL_S = 1.0
META_TTL = 120.0
# Opportunistic cache only (non-force). Menu loads pass force=1 for live sheet edits.
CSV_TTL = 90.0
# Concurrent force=1 boards share one batchGet if a fetch landed this recently.
CSV_FORCE_COALESCE_S = 8.0
_settings_lock = threading.Lock()
_settings_cache: dict = {"at": 0.0, "data": None}
# Keep this above board-poll cadence. force=1 CSV must not re-read Settings
# every time or the shared service account burns the 60 reads/min quota.
SETTINGS_TTL = 30.0
_GEXEC_PATCHED = False


def _patch_sheets_retry() -> None:
    """Retry 429/5xx on every googleapiclient execute(). One service account
    is shared by local + restaurant + testing — a quota spike must not
    permanently disable the API until the next git push."""
    global _GEXEC_PATCHED
    if _GEXEC_PATCHED:
        return
    try:
        from googleapiclient.http import HttpRequest
    except ImportError:
        return
    orig = HttpRequest.execute

    def execute(self, *args, **kwargs):
        delay = 0.75
        for i in range(7):
            try:
                return orig(self, *args, **kwargs)
            except Exception as e:
                status = getattr(getattr(e, "resp", None), "status", None)
                if status not in (429, 500, 503) or i == 6:
                    raise
                _log(f"Sheets HTTP {status}; retry {i + 1}/6 in {delay:.1f}s")
                time.sleep(delay)
                delay = min(delay * 1.7, 12.0)

    HttpRequest.execute = execute  # type: ignore[method-assign]
    _GEXEC_PATCHED = True


def bind_where(bind: str) -> str:
    return "this Mac" if str(bind) in ("127.0.0.1", "::1") else "LAN+Tailscale"


def window_title(port: int, bind: str, source: str | None = None) -> str:
    """Must keep prefix 'Toki Menu Server :{port}' — launcher stop matches it."""
    parts = [f"Toki Menu Server :{port}", ROOT.name, bind_where(bind)]
    src = (source or "").strip()
    if src:
        parts.append(src)
    return " · ".join(parts)


def set_terminal_title(title: str) -> None:
    if not sys.stdout.isatty():
        return
    sys.stdout.write("\033]0;" + title + "\007")
    sys.stdout.flush()


def _log(msg: str) -> None:
    print(f"[toki_server] {msg}", flush=True)


def _mac_notify(
    title: str,
    message: str = "",
    *,
    subtitle: str = "",
    open_url: str = "",
    tag: str = "",
) -> None:
    """Local Notification Center ping, branded as Suite. No-op on Cloud Run.

    Suite.app posts the banner. Never osascript display notification
    (that groups as Script Editor).
    """
    if _hosted():
        return

    def go() -> None:
        try:
            scripts = str(ROOT / "scripts")
            if scripts not in sys.path:
                sys.path.insert(0, scripts)
            import suite_notify

            suite_notify.notify(
                title,
                message,
                subtitle=subtitle,
                open_url=open_url,
                tag=tag,
            )
        except Exception:
            pass

    threading.Thread(target=go, name="mac-notify", daemon=True).start()


def _watch_deploy_and_notify(
    target: str,
    issue_number,
    issue_url: str,
    dry: bool,
) -> None:
    """After a local File deploy, ping when GitHub Actions finishes."""
    if _hosted():
        return
    label = "Restaurant" if str(target).strip().lower() == "restaurant" else "Testing"
    n = str(issue_number or "").strip()
    open_url = (issue_url or "").strip() or "http://127.0.0.1:8765/deploy.html"
    filed_body = ("#" + n) if n else "GitHub Actions is running"
    if dry:
        filed_body = (filed_body + " — dry run").strip(" —")
    _mac_notify(
        f"{label} ship filed",
        filed_body,
        subtitle="Deployer",
        open_url=open_url,
        tag="suite.deploy.filed",
    )
    if dry:
        return

    def go() -> None:
        try:
            import toki_deploy

            gh = toki_deploy._gh_bin()
            env = toki_deploy._gh_env()
            run_id = ""
            run_url = open_url
            deadline_find = time.time() + 90
            while time.time() < deadline_find and not run_id:
                r = subprocess.run(
                    [
                        gh,
                        "run",
                        "list",
                        "--workflow",
                        "deploy.yml",
                        "--limit",
                        "8",
                        "--json",
                        "databaseId,status,conclusion,url,createdAt",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=20,
                    env=env,
                )
                if r.returncode == 0 and (r.stdout or "").strip():
                    rows = json.loads(r.stdout)
                    if isinstance(rows, list):
                        for it in rows:
                            st = str((it or {}).get("status") or "")
                            if st in ("queued", "in_progress", "waiting", "pending"):
                                run_id = str((it or {}).get("databaseId") or "")
                                run_url = str((it or {}).get("url") or run_url)
                                break
                        if not run_id and rows:
                            it = rows[0] or {}
                            run_id = str(it.get("databaseId") or "")
                            run_url = str(it.get("url") or run_url)
                if not run_id:
                    time.sleep(3)
            if not run_id:
                return
            deadline = time.time() + 20 * 60
            while time.time() < deadline:
                r = subprocess.run(
                    [
                        gh,
                        "run",
                        "view",
                        str(run_id),
                        "--json",
                        "status,conclusion,url",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=20,
                    env=env,
                )
                if r.returncode == 0 and (r.stdout or "").strip():
                    info = json.loads(r.stdout) or {}
                    st = str(info.get("status") or "")
                    run_url = str(info.get("url") or run_url)
                    if st == "completed":
                        conc = str(info.get("conclusion") or "").strip() or "done"
                        ok = conc == "success"
                        _mac_notify(
                            f"{label} ship " + ("finished" if ok else "failed"),
                            conc + (f" · #{n}" if n else ""),
                            subtitle="Deployer",
                            open_url=run_url,
                            tag="suite.deploy.done",
                        )
                        return
                time.sleep(8)
        except Exception as e:
            _log(f"deploy watch notify: {e}")

    threading.Thread(target=go, name="deploy-watch", daemon=True).start()


def _reexec_self(reason: str) -> None:
    """Replace this process with a fresh toki_server (same argv / pid)."""
    path = Path(__file__).resolve()
    _log(reason)
    argv = [sys.executable, str(path), *sys.argv[1:]]
    os.execv(sys.executable, argv)


def _schedule_reexec(reason: str, delay: float = 0.25) -> None:
    """Finish the HTTP response, then bounce. Same path as the file watcher."""

    def go() -> None:
        time.sleep(delay)
        _reexec_self(reason)

    threading.Thread(target=go, name="reexec", daemon=True).start()


def _watch_api_and_reexec() -> None:
    """Local only: restart this process when toki_server.py changes on disk."""
    if _hosted():
        return
    if (os.environ.get("TOKI_NO_RELOAD") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        return
    path = Path(__file__).resolve()

    def _mtime() -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0

    last = _mtime()

    def loop() -> None:
        nonlocal last
        while True:
            time.sleep(1.0)
            now = _mtime()
            if now <= 0 or now == last:
                continue
            last = now
            time.sleep(1.2)
            last = _mtime()
            _reexec_self(f"API updated ({path.name}) — restarting")

    threading.Thread(target=loop, name="api-watch", daemon=True).start()
    _log(f"watching {path.name} for API updates")


_TIMER_VALUE_RE = re.compile(
    r"^\s*\d+\s*(second|seconds|sec|s|minute|minutes|min|m)?\s*$",
    re.I,
)
_REFRESH_SECS_RE = re.compile(
    r"^\s*(\d+)\s*(second|seconds|sec|s|minute|minutes|min|m)?\s*$",
    re.I,
)
# Four boards + Cloud Run + Manager share one service account (~60 reads/min).
# 1s / 5s blow that quota and lock the restaurant workbook.
REFRESH_TIMER_MIN_SECONDS = 30


def _is_timer_value(raw: str) -> bool:
    return bool(_TIMER_VALUE_RE.match(str(raw or "").strip()))


def parse_refresh_seconds(raw: str) -> int:
    m = _REFRESH_SECS_RE.match(str(raw or "").strip())
    if not m:
        return REFRESH_TIMER_MIN_SECONDS
    n = int(m.group(1))
    if n <= 0:
        return REFRESH_TIMER_MIN_SECONDS
    unit = (m.group(2) or "s").lower()
    if unit.startswith("m"):
        n *= 60
    return n


def clamp_refresh_timer(raw: str) -> str:
    label = str(raw or "").strip()
    if parse_refresh_seconds(label) < REFRESH_TIMER_MIN_SECONDS:
        return "30 seconds"
    return label or "30 seconds"


def _cell(row: list, idx: int) -> str:
    if not row or idx < 0 or idx >= len(row):
        return ""
    v = row[idx]
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    return str(v).strip()


def _item_price_cell(raw) -> str:
    """Keep volume-bundle tokens as text so Sheets does not parse 1/$2.00."""
    s = str(raw or "").strip()
    if not s:
        return ""
    if s.startswith("'"):
        return s
    if re.match(r"^\d{1,3}/", s):
        return "'" + s
    return s


def _item_bool01(raw, default: str = "1") -> str:
    if raw is None or str(raw).strip() == "":
        return default
    s = str(raw).strip().lower()
    if s in ("1", "yes", "y", "true", "on"):
        return "1"
    if s in ("0", "no", "n", "false", "off"):
        return "0"
    return default


def _item_stem(item_name: str, filename: str = "") -> str:
    base = Path(str(filename or "")).stem
    raw = base or str(item_name or "Item")
    parts = re.findall(r"[A-Za-z0-9]+", raw)
    if not parts:
        return "Item"
    s = "".join(p[:1].upper() + p[1:] for p in parts)
    return s[:80] or "Item"


def _decode_image_payload(raw) -> tuple[bytes, str]:
    s = str(raw or "").strip()
    mime = "application/octet-stream"
    if not s:
        return b"", mime
    if s.startswith("data:") and "," in s:
        header, b64 = s.split(",", 1)
        m = re.search(r"data:([^;]+)", header)
        if m:
            mime = (m.group(1) or mime).strip() or mime
        s = b64
    try:
        data = base64.b64decode(s, validate=False)
    except Exception as e:
        raise ValueError("invalid image data") from e
    if not data:
        raise ValueError("empty image data")
    if len(data) > 10_000_000:
        raise ValueError("image too large (max 10MB)")
    return data, mime


def _ext_for_mime(mime: str, filename: str = "") -> str:
    name = str(filename or "")
    suf = Path(name).suffix.lower()
    if suf in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic"):
        return ".jpg" if suf == ".jpeg" else suf
    m = str(mime or "").lower()
    if "png" in m:
        return ".png"
    if "webp" in m:
        return ".webp"
    if "gif" in m:
        return ".gif"
    if "jpeg" in m or "jpg" in m:
        return ".jpg"
    return ".png"


def _run_magick(args: list[str]) -> bool:
    magick = shutil.which("magick") or shutil.which("convert")
    if not magick:
        return False
    try:
        subprocess.run(
            [magick, *args],
            check=True,
            timeout=45,
            capture_output=True,
        )
        return True
    except Exception:
        return False


def _save_food_image(
    data: bytes, folder_rel: str, stem: str, src_name: str, mime: str
) -> dict:
    """Write food-pics/{folder}/{stem}.webp (+ -sm.webp). Fallback = original ext."""
    folder = ROOT / folder_rel
    folder.mkdir(parents=True, exist_ok=True)
    ext = _ext_for_mime(mime, src_name)
    tmp = folder / f".{stem}.src{ext}"
    tmp.write_bytes(data)
    webp = folder / f"{stem}.webp"
    sm = folder / f"{stem}-sm.webp"
    wrote_webp = False
    if ext == ".webp":
        webp.write_bytes(data)
        wrote_webp = True
        _run_magick([str(tmp), "-resize", "50%", str(sm)])
    elif _run_magick([str(tmp), str(webp)]):
        wrote_webp = True
        _run_magick([str(tmp), "-resize", "50%", str(sm)])
    else:
        try:
            from PIL import Image

            im = Image.open(io.BytesIO(data))
            if im.mode in ("P", "RGBA", "LA"):
                im = im.convert("RGBA")
            else:
                im = im.convert("RGB")
            im.save(webp, "WEBP", quality=82)
            w, h = im.size
            im.resize((max(1, w // 2), max(1, h // 2))).save(
                sm, "WEBP", quality=80
            )
            wrote_webp = True
        except Exception:
            wrote_webp = False
    try:
        tmp.unlink()
    except OSError:
        pass
    if wrote_webp and webp.is_file():
        return {
            "filename": webp.name,
            "path": f"{folder_rel}/{webp.name}",
            "smPath": f"{folder_rel}/{sm.name}" if sm.is_file() else "",
        }
    dest = folder / f"{stem}{ext}"
    dest.write_bytes(data)
    return {
        "filename": dest.name,
        "path": f"{folder_rel}/{dest.name}",
        "smPath": "",
    }


def _is_heavy_filter_header(raw: str) -> bool:
    h = str(raw or "").strip().lower()
    if "heavy" not in h:
        return False
    return "fps" in h or "30" in h or "filter" in h or "fitler" in h


def _parse_yes(raw: str, default: bool = False) -> bool:
    s = str(raw or "").strip().lower()
    if not s:
        return default
    if s in ("1", "yes", "y", "true", "on"):
        return True
    if s in ("0", "no", "n", "false", "off"):
        return False
    return default


def extract_spreadsheet_id(raw: str) -> str | None:
    """Accept a full Sheets URL or a bare spreadsheet id."""
    s = str(raw or "").strip()
    if not s:
        return None
    m = _SHEET_ID_IN_URL.search(s)
    if m:
        return m.group(1)
    if _BARE_SHEET_ID.match(s) and " " not in s:
        return s
    return None


def settings_source_id(name: str) -> str:
    """Fold a Settings Data Source label to restaurant / beta / alpha / slug."""
    n = str(name or "").strip().lower()
    if "beta" in n:
        return "beta"
    if "restaurant" in n:
        return "restaurant"
    if "alpha" in n:
        return "alpha"
    slug = re.sub(r"[^a-z0-9]+", "-", n).strip("-")
    return slug or "source"


def match_catalog_entry(name: str, catalog: list) -> dict | None:
    key = (name or "").strip().lower()
    if not key:
        return None
    for c in catalog or []:
        if (c.get("name") or "").strip().lower() == key:
            return c
    want = settings_source_id(name)
    for c in catalog or []:
        if settings_source_id(c.get("name")) == want:
            return c
    for c in catalog or []:
        n = (c.get("name") or "").strip().lower()
        if n and (key in n or n in key):
            return c
    return None


def _settings_header_cols(header: list) -> dict[str, int]:
    cols: dict[str, int] = {"dataSource": 0, "requireRestart": 1}
    for c, cell in enumerate(header or []):
        label = str(cell or "").strip().lower()
        if label == "data source" or label.startswith("data source"):
            cols["dataSource"] = c
        if "require restart" in label:
            cols["requireRestart"] = c
        if "system font" in label:
            cols["systemFont"] = c
        if _is_heavy_filter_header(label):
            cols["limitHeavyFilters"] = c
        if "confirm" in label and "save" in label:
            cols["confirmSave"] = c
        if "refresh timer" in label:
            cols["refreshTimer"] = c
        if "debug" in label and "mode" in label:
            cols["debugMode"] = c
    return cols


def _parse_one_settings_row(
    row: list, cols: dict[str, int], catalog: list
) -> dict | None:
    name = _cell(row, cols.get("dataSource", 0))
    if not name:
        return None
    if "gsheet" in name.lower():
        return None
    system_font = "roboto"
    if "systemFont" in cols:
        raw = _cell(row, cols["systemFont"]).lower()
        if "poppin" in raw:
            system_font = "poppins"
        elif "roboto" in raw:
            system_font = "roboto"
    refresh_timer = ""
    if "refreshTimer" in cols:
        cand = _cell(row, cols["refreshTimer"])
        if _is_timer_value(cand):
            refresh_timer = cand
    if not refresh_timer:
        for c in range(len(row or [])):
            cand = _cell(row, c)
            if _is_timer_value(cand):
                refresh_timer = cand
                break
    match = match_catalog_entry(name, catalog)
    return {
        "id": settings_source_id(name),
        "name": name,
        "requireRestart": _parse_yes(
            _cell(row, cols.get("requireRestart", 1)), False
        ),
        "systemFont": system_font,
        "limitHeavyFilters": _parse_yes(
            _cell(row, cols.get("limitHeavyFilters", 3)), True
        )
        if "limitHeavyFilters" in cols
        else True,
        "confirmSave": _parse_yes(
            _cell(row, cols.get("confirmSave", 4)), True
        )
        if "confirmSave" in cols
        else True,
        "refreshTimer": clamp_refresh_timer(refresh_timer),
        "debugMode": _parse_yes(_cell(row, cols.get("debugMode")), False)
        if "debugMode" in cols
        else False,
        "sheetId": (match or {}).get("sheetId") or "",
        "sourceUrl": (match or {}).get("url") or "",
    }


def parse_debug_menu_rows(rows: list) -> dict:
    """
    Settings workbook → Debugger (gid 195166367):
      Debug Features header + values row.
    Master Debug Mode no longer lives here — it is Settings column G
    per catalog row. This parser still accepts a leftover A1/A2
    "Debug Mode" block if someone puts it back, but refresh_settings
    only uses debugFeatures from this tab.
    """
    debug_mode = False
    features: dict[str, bool] = {}
    rows = rows or []
    for i, row in enumerate(rows):
        label = _cell(row, 0).strip().lower()
        if label == "debug mode" and i + 1 < len(rows):
            debug_mode = _parse_yes(_cell(rows[i + 1], 0), False)
            break
    for i, row in enumerate(rows):
        label = _cell(row, 0).strip().lower()
        if label == "debug features" and i + 2 < len(rows):
            headers = rows[i + 1] or []
            values = rows[i + 2] or []
            for c, raw in enumerate(headers):
                name = str(raw or "").strip()
                if name:
                    features[name] = _parse_yes(_cell(values, c), False)
            break
    return {"debugMode": bool(debug_mode), "debugFeatures": features}


def parse_settings_rows(rows: list, fallback_sheet_id: str) -> dict:
    """
    Settings tab — one chrome row per catalog:

      A1 Data Source | B1 Require restart | C1 System Font | … F1 Confirm save? | G1 Debug Mode
      A2 Restaurant Copy | B2–G2  (TV default)
      A3 Beta (Development) Copy | B3–G3
      A6 Gsheet name | B6 Gsheet URL
      A7+ catalog workbook rows

    Top-level requireRestart / font / timer / confirmSave / debugMode stay
    on the Restaurant row so dining-room TVs do not pick up Beta chrome.
    Manager reads catalogSettings and writes the matching row.
    """
    catalog: list[dict] = []
    catalog_settings: list[dict] = []

    header_idx = None
    catalog_idx = None
    for i, row in enumerate(rows or []):
        a = _cell(row, 0).lower()
        b = _cell(row, 1).lower()
        if header_idx is None and a == "data source":
            header_idx = i
        if catalog_idx is None and "gsheet" in (a + " " + b) and "url" in (a + " " + b):
            catalog_idx = i

    if catalog_idx is not None:
        for row in rows[catalog_idx + 1 :]:
            name = _cell(row, 0)
            url = _cell(row, 1)
            if not name and not url:
                continue
            catalog.append(
                {
                    "name": name,
                    "url": url,
                    "sheetId": extract_spreadsheet_id(url),
                }
            )

    if header_idx is not None:
        header = rows[header_idx] or []
        cols = _settings_header_cols(header)
        end = catalog_idx if catalog_idx is not None else len(rows)
        for row in rows[header_idx + 1 : end]:
            parsed = _parse_one_settings_row(row, cols, catalog)
            if parsed:
                catalog_settings.append(parsed)

    live = None
    for row in catalog_settings:
        if row.get("id") == "restaurant":
            live = row
            break
    if live is None and catalog_settings:
        live = catalog_settings[0]

    data_source = (live or {}).get("name") or ""
    match = match_catalog_entry(data_source, catalog)
    sheet_id = (
        (live or {}).get("sheetId")
        or (match and match.get("sheetId"))
        or fallback_sheet_id
    )
    data = {
        "dataSource": data_source or "Restaurant Copy",
        "requireRestart": bool((live or {}).get("requireRestart", False)),
        "systemFont": (live or {}).get("systemFont") or "roboto",
        "limitHeavyFilters": bool((live or {}).get("limitHeavyFilters", True)),
        "confirmSave": bool((live or {}).get("confirmSave", True)),
        "refreshTimer": clamp_refresh_timer((live or {}).get("refreshTimer") or ""),
        "debugMode": bool((live or {}).get("debugMode", False)),
        "sheetId": sheet_id,
        "sourceName": (match or live or {}).get("name") or data_source or "",
        "sourceUrl": (live or {}).get("sourceUrl")
        or (match or {}).get("url")
        or "",
        "catalog": catalog,
        "catalogSettings": catalog_settings,
        "resolvedFromCatalog": bool(sheet_id and sheet_id != fallback_sheet_id)
        or bool((live or {}).get("sheetId")),
    }
    return apply_force_source(data)


def apply_force_source(data: dict) -> dict:
    """Restaurant/testing pin: Settings cell must not flip the other site."""
    force = (os.environ.get("TOKI_FORCE_SOURCE") or "").strip().lower()
    if not force:
        env = (os.environ.get("TOKI_ENV") or "").strip().lower()
        if env == "restaurant":
            force = "restaurant"
        elif env == "testing":
            force = "alpha"
    if not force:
        return data
    catalog = data.get("catalog") or []
    match = None
    for c in catalog:
        name = (c.get("name") or "").strip().lower()
        if not name:
            continue
        if force in name or name in force:
            match = c
            break
    if not match or not match.get("sheetId"):
        return data
    data["dataSource"] = match.get("name") or data.get("dataSource")
    data["sheetId"] = match["sheetId"]
    data["sourceName"] = match.get("name") or ""
    data["sourceUrl"] = match.get("url") or ""
    data["forcedSource"] = force
    data["resolvedFromCatalog"] = True
    return data


def _flush_data_caches() -> None:
    global _csv_batch_event, _csv_batch_error, _csv_book_rev, _csv_book_sid
    with _csv_lock:
        _csv_cache.clear()
        _csv_batch_event = None
        _csv_batch_error = None
        _csv_book_rev = ""
        _csv_book_sid = ""
        _csv_sid_flight.clear()
        _csv_sid_flight_error.clear()
    with _meta_lock:
        _meta_cache["at"] = 0
        _meta_cache["title_by_gid"] = {}
        _meta_cache["gid_by_title"] = {}
        _sid_meta_cache.clear()
    with _rev_lock:
        _rev_cache["at"] = 0.0
        _rev_cache["sid"] = ""
        _rev_cache["rev"] = None


def _load_creds(key_path: Path):
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError as e:
        raise SystemExit(
            "Missing Google libraries. Install with:\n"
            "  /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 "
            "-m pip install --user google-api-python-client google-auth\n"
            f"({e})"
        )

    raw = (os.environ.get("TOKI_SA_JSON") or "").strip()
    if raw:
        try:
            info = json.loads(raw)
        except json.JSONDecodeError as e:
            raise SystemExit(f"TOKI_SA_JSON is not valid JSON ({e})")
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=SCOPES
        )
    else:
        if not key_path.is_file():
            raise SystemExit(
                f"Service account key not found:\n  {key_path}\n"
                "See scripts/gsheet_api.md"
            )
        creds = service_account.Credentials.from_service_account_file(
            str(key_path), scopes=SCOPES
        )
    _patch_sheets_retry()
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False)
    drive = None
    try:
        drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception as e:
        _log(f"Drive metadata client not built ({e})")
    return creds, sheets, drive


class SheetsBackend:
    def __init__(
        self,
        sheet_id: str,
        key_path: Path,
        settings_sheet_id: str | None = None,
    ):
        self.fallback_sheet_id = sheet_id
        self.sheet_id = sheet_id
        self.settings_sheet_id = (settings_sheet_id or "").strip()
        self.key_path = key_path
        self.creds, self.sheets, self.drive = _load_creds(key_path)
        # googleapiclient is not reliably thread-safe — serialize API calls
        self._api_lock = threading.Lock()
        self._drive_lock = threading.Lock()
        self._debugger_title = ""
        _log(f"API ready as {self.creds.service_account_email}")
        _log(f"fallback spreadsheet={sheet_id}")
        if self.settings_sheet_id:
            try:
                live = self.apply_live_sheet(force_settings=True)
                _log(
                    f"Settings: dataSource={live.get('dataSource')!r} "
                    f"requireRestart={live.get('requireRestart')} "
                    f"sheet={self.sheet_id}"
                )
            except Exception as e:
                _log(f"WARNING: Settings sheet failed ({e}); using fallback {sheet_id}")
        else:
            _log(f"spreadsheet={sheet_id}")

    def _settings_rows(self) -> list:
        sid = self.settings_sheet_id
        if not sid:
            return []
        with self._api_lock:
            result = (
                self.sheets.spreadsheets()
                .values()
                .get(
                    spreadsheetId=sid,
                    range="Settings",
                    majorDimension="ROWS",
                    valueRenderOption="FORMATTED_VALUE",
                )
                .execute()
            )
        return result.get("values") or []

    def _debugger_tab_title(self) -> str:
        if self._debugger_title:
            return self._debugger_title
        sid = self.settings_sheet_id
        if not sid:
            self._debugger_title = DEBUGGER_TAB
            return self._debugger_title
        try:
            with self._api_lock:
                meta = (
                    self.sheets.spreadsheets()
                    .get(
                        spreadsheetId=sid,
                        fields="sheets.properties(sheetId,title)",
                    )
                    .execute()
                )
            want = str(DEBUGGER_GID)
            for sh in meta.get("sheets") or []:
                p = sh.get("properties") or {}
                if str(p.get("sheetId")) == want:
                    title = str(p.get("title") or "").strip()
                    if title:
                        self._debugger_title = title
                        return title
        except Exception as e:
            _log(f"Debugger tab title lookup failed ({e}); using {DEBUGGER_TAB}")
        self._debugger_title = DEBUGGER_TAB
        return self._debugger_title

    def _debugger_rows(self) -> list:
        sid = self.settings_sheet_id
        if not sid:
            return []
        title = self._debugger_tab_title()
        quoted = "'" + title.replace("'", "''") + "'"
        with self._api_lock:
            result = (
                self.sheets.spreadsheets()
                .values()
                .get(
                    spreadsheetId=sid,
                    range=quoted,
                    majorDimension="ROWS",
                    valueRenderOption="FORMATTED_VALUE",
                )
                .execute()
            )
        return result.get("values") or []

    def refresh_settings(self, force: bool = False) -> dict:
        now = time.time()
        with _settings_lock:
            hit = _settings_cache.get("data")
            if (
                not force
                and hit
                and now - float(_settings_cache.get("at") or 0) < SETTINGS_TTL
            ):
                return dict(hit)
        if not self.settings_sheet_id:
            data = parse_settings_rows([], self.fallback_sheet_id)
            data["settingsSheetId"] = ""
            return data
        rows = self._settings_rows()
        data = parse_settings_rows(rows, self.fallback_sheet_id)
        data["settingsSheetId"] = self.settings_sheet_id
        try:
            dbg = parse_debug_menu_rows(self._debugger_rows())
            data["debugFeatures"] = dbg.get("debugFeatures") or {}
        except Exception as e:
            _log(f"Debugger tab read failed ({e})")
            data.setdefault("debugFeatures", {})
        data.setdefault("debugMode", False)
        with _settings_lock:
            _settings_cache["at"] = time.time()
            _settings_cache["data"] = data
        return dict(data)

    def write_settings(self, body: dict) -> dict:
        """Write System Settings into the OliToki Menu Settings workbook."""
        sid = (self.settings_sheet_id or "").strip()
        if not sid:
            raise ValueError("Settings workbook not configured")
        rows = self._settings_rows()
        header_idx = None
        catalog_idx = None
        for i, row in enumerate(rows or []):
            a = _cell(row, 0).lower()
            b = _cell(row, 1).lower()
            if header_idx is None and a == "data source":
                header_idx = i
            if catalog_idx is None and "gsheet" in (a + " " + b) and "url" in (a + " " + b):
                catalog_idx = i
        if header_idx is None:
            raise KeyError("Settings header row not found")
        header = (rows[header_idx] if header_idx < len(rows) else []) or []
        cols: dict[str, int] = {}
        for c, raw in enumerate(header):
            fold = self._header_fold(str(raw or ""))
            if fold:
                cols[fold] = c
            low = str(raw or "").strip().lower()
            if "system font" in low:
                cols["systemfont"] = c
            if _is_heavy_filter_header(low):
                cols["limitheavyfilters"] = c
            if "confirm" in low and "save" in low:
                cols["confirmsave"] = c
            if "refresh timer" in low:
                cols["refreshtimer"] = c
            if "debug" in low and "mode" in low:
                cols["debugmode"] = c

        # === System Settings contract (Menu Manager) ===
        # Each catalog has its own Settings row (Restaurant A2–G2, Beta A3–G3,
        # and so on). Manager writes the row for the catalog being edited.
        # TVs keep reading the Restaurant row via GET /api/settings.
        # Debug Mode is Settings column G (header "Debug Mode") — not Debugger!A2.
        #
        # - Client (manager-sheet.js) and server discover columns by fuzzy header match
        #   on the Settings row, with documented default_col fallbacks for writes.
        # - New settings features MUST be added as (or mapped to) a column in that sheet.
        # - If during a Pass a new setting has no column yet, the Pass must include a
        #   reminder to Lead to add the header cell + any validation row.
        # - Writes go through POST /api/manager/settings (see writeSystem).
        # - This keeps the "sheet is the database" model.
        # See also: docs/MENU_MANAGER.md, js/manager.js (systemSettingsDirty + confirmChoice),
        # and manager-sheet.js load path.

        want_raw = str(
            body.get("sourceId")
            or body.get("sourceName")
            or body.get("dataSource")
            or "restaurant"
        ).strip()
        created_row = False
        data_idx = self._find_settings_data_idx(
            rows, header_idx, catalog_idx, want_raw
        )
        if data_idx < 0:
            data_idx = self._ensure_settings_data_row(
                sid, rows, header_idx, catalog_idx, want_raw, body
            )
            created_row = True
            rows = self._settings_rows()

        def a1(*folds: str, default_col: int) -> str:
            for fold in folds:
                if fold in cols:
                    return f"{self._col_letters(cols[fold])}{data_idx + 1}"
            return f"{self._col_letters(default_col)}{data_idx + 1}"

        def yn(raw, fallback: bool = False) -> str:
            s = str(raw if raw is not None else "").strip().lower()
            if s in ("1", "yes", "y", "true", "on"):
                return "TRUE"
            if s in ("0", "no", "n", "false", "off"):
                return "FALSE"
            return "TRUE" if fallback else "FALSE"

        values: dict[str, tuple[str, str]] = {}

        if "dataSource" in body and body.get("dataSource") not in (None, ""):
            # Data Source is which catalog row you are editing. Never write
            # column A as a TV pointer — A holds the row's catalog name.
            _log(
                "settings write: skip dataSource cell "
                f"(target row {data_idx + 1} is {want_raw!r})"
            )

        if created_row:
            display = str(body.get("sourceName") or "").strip() or self._settings_display_name(
                want_raw, rows, header_idx, catalog_idx
            )
            values["datasource"] = (
                f"{self._col_letters(0)}{data_idx + 1}",
                display,
            )

        if "requireRestart" in body and body.get("requireRestart") not in (None, ""):
            values["requirerestart"] = (
                a1("requirerestarttoupdate", "requirerestart", default_col=1),
                yn(body.get("requireRestart"), False),
            )
        if "systemFont" in body and body.get("systemFont") not in (None, ""):
            font = str(body.get("systemFont") or "").strip().lower()
            label = "Poppins" if "poppin" in font else "Roboto"
            values["systemfont"] = (a1("systemfont", default_col=2), label)
        if "limitHeavyFilters" in body and body.get("limitHeavyFilters") not in (
            None,
            "",
        ):
            values["limitheavyfilters"] = (
                a1("limitheavyfilters", default_col=3),
                yn(body.get("limitHeavyFilters"), True),
            )
        if "confirmSave" in body and body.get("confirmSave") not in (None, ""):
            values["confirmsave"] = (
                a1("confirmsave", default_col=5),
                yn(body.get("confirmSave"), True),
            )
        if "refreshTimer" in body and body.get("refreshTimer") not in (None, ""):
            values["refreshtimer"] = (
                a1("refreshtimer", default_col=4),
                clamp_refresh_timer(str(body.get("refreshTimer")).strip()),
            )
        if "debugMode" in body and body.get("debugMode") not in (None, ""):
            values["debugmode"] = (
                a1("debugmode", default_col=6),
                yn(body.get("debugMode"), False),
            )
        if not values:
            raise ValueError("nothing to write")
        data = []
        for _k, (cell, val) in values.items():
            rng = cell if "!" in cell else ("Settings!" + cell)
            data.append({"range": rng, "values": [[val]]})
        t0 = time.time()
        with self._api_lock:
            updated = (
                self.sheets.spreadsheets()
                .values()
                .batchUpdate(
                    spreadsheetId=sid,
                    body={"valueInputOption": "USER_ENTERED", "data": data},
                    )
                .execute()
            )
        with _settings_lock:
            _settings_cache["at"] = 0
            _settings_cache["data"] = None
        _log(
            f"settings write {sid} row={data_idx + 1} "
            f"{ {k: v[1] for k, v in values.items()} } "
            f"cells={updated.get('totalUpdatedCells')} ({time.time() - t0:.2f}s)"
        )
        return {
            "ok": True,
            "settingsSheetId": sid,
            "wrote": {k: v[1] for k, v in values.items()},
            "wroteRow": data_idx + 1,
            "sourceId": settings_source_id(want_raw),
            "skippedDataSource": bool("dataSource" in body),
        }

    def _find_settings_data_idx(
        self, rows: list, header_idx: int, catalog_idx: int | None, want: str
    ) -> int:
        want_id = settings_source_id(want)
        want_name = str(want or "").strip().lower()
        end = catalog_idx if catalog_idx is not None else len(rows or [])
        for i in range(header_idx + 1, end):
            name = _cell(rows[i], 0)
            if not name:
                continue
            if settings_source_id(name) == want_id or name.strip().lower() == want_name:
                return i
        return -1

    def _settings_display_name(
        self, want: str, rows: list, header_idx: int, catalog_idx: int | None
    ) -> str:
        explicit = str(want or "").strip()
        live = parse_settings_rows(rows, self.fallback_sheet_id)
        want_id = settings_source_id(want)
        for c in live.get("catalog") or []:
            name = str(c.get("name") or "").strip()
            if name and settings_source_id(name) == want_id:
                return name
        if want_id == "restaurant":
            return "Restaurant Copy"
        if want_id == "beta":
            return "Beta (Development) Copy"
        if want_id == "alpha":
            return "Alpha Copy"
        return explicit or want_id

    def _ensure_settings_data_row(
        self,
        sid: str,
        rows: list,
        header_idx: int,
        catalog_idx: int | None,
        want: str,
        body: dict,
    ) -> int:
        end = catalog_idx if catalog_idx is not None else len(rows or [])
        last_named = header_idx
        for i in range(header_idx + 1, end):
            if _cell(rows[i], 0):
                last_named = i
        empty_idx = -1
        for i in range(last_named + 1, end):
            if not _cell(rows[i], 0):
                empty_idx = i
                break
        if empty_idx >= 0:
            return empty_idx
        insert_at = end if catalog_idx is not None else last_named + 1
        _log(f"settings write: insert catalog row at {insert_at + 1} for {want!r}")
        with self._api_lock:
            self.sheets.spreadsheets().batchUpdate(
                spreadsheetId=sid,
                body={
                    "requests": [
                        {
                            "insertDimension": {
                                "range": {
                                    "sheetId": 0,
                                    "dimension": "ROWS",
                                    "startIndex": insert_at,
                                    "endIndex": insert_at + 1,
                                },
                                "inheritFromBefore": True,
                            }
                        }
                    ]
                },
            ).execute()
        return insert_at

    def apply_live_sheet(self, force_settings: bool = False) -> dict:
        """Point CSV/meta at the workbook chosen in Settings → Data Source."""
        live = self.refresh_settings(force=force_settings)
        new_id = (live.get("sheetId") or self.fallback_sheet_id).strip()
        if new_id and new_id != self.sheet_id:
            _log(
                f"live data source → {live.get('dataSource')!r} "
                f"{self.sheet_id} → {new_id}"
            )
            self.sheet_id = new_id
            _flush_data_caches()
        elif new_id:
            self.sheet_id = new_id
        return live

    def refresh_meta(self, force: bool = False) -> dict:
        now = time.time()
        with _meta_lock:
            if (
                not force
                and _meta_cache["title_by_gid"]
                and now - _meta_cache["at"] < META_TTL
            ):
                return {
                    "title_by_gid": dict(_meta_cache["title_by_gid"]),
                    "gid_by_title": dict(_meta_cache["gid_by_title"]),
                    "at": _meta_cache["at"],
                }
        with self._api_lock:
            meta = (
                self.sheets.spreadsheets()
                .get(
                    spreadsheetId=self.sheet_id,
                    fields="sheets.properties(sheetId,title)",
                )
                .execute()
            )
        title_by_gid = {}
        gid_by_title = {}
        for sh in meta.get("sheets", []):
            p = sh.get("properties", {})
            gid = str(p.get("sheetId"))
            title = p.get("title") or ""
            title_by_gid[gid] = title
            gid_by_title[title] = gid
        with _meta_lock:
            _meta_cache["at"] = time.time()
            _meta_cache["title_by_gid"] = title_by_gid
            _meta_cache["gid_by_title"] = gid_by_title
            return {
                "title_by_gid": dict(title_by_gid),
                "gid_by_title": dict(gid_by_title),
                "at": _meta_cache["at"],
            }

    def refresh_meta_for(self, spreadsheet_id: str, force: bool = False) -> dict:
        """Tab map for a catalog workbook that is not the live TV pointer."""
        sid = (spreadsheet_id or "").strip()
        if not sid or sid == self.sheet_id:
            return self.refresh_meta(force=force)
        now = time.time()
        with _meta_lock:
            hit = _sid_meta_cache.get(sid)
            if (
                not force
                and hit
                and hit.get("title_by_gid")
                and now - float(hit.get("at") or 0) < META_TTL
            ):
                return {
                    "title_by_gid": dict(hit["title_by_gid"]),
                    "gid_by_title": dict(hit["gid_by_title"]),
                    "at": hit["at"],
                }
        with self._api_lock:
            meta = (
                self.sheets.spreadsheets()
                .get(
                    spreadsheetId=sid,
                    fields="sheets.properties(sheetId,title)",
                )
                .execute()
            )
        title_by_gid = {}
        gid_by_title = {}
        for sh in meta.get("sheets", []):
            p = sh.get("properties", {})
            gid = str(p.get("sheetId"))
            title = p.get("title") or ""
            title_by_gid[gid] = title
            gid_by_title[title] = gid
        packed = {
            "at": time.time(),
            "title_by_gid": title_by_gid,
            "gid_by_title": gid_by_title,
        }
        with _meta_lock:
            _sid_meta_cache[sid] = packed
            return {
                "title_by_gid": dict(title_by_gid),
                "gid_by_title": dict(gid_by_title),
                "at": packed["at"],
            }

    def title_for_gid(self, gid: str) -> str:
        meta = self.refresh_meta()
        title = meta["title_by_gid"].get(str(gid))
        if not title:
            meta = self.refresh_meta(force=True)
            title = meta["title_by_gid"].get(str(gid))
        if not title:
            raise KeyError(f"No sheet with gid={gid}")
        return title

    @staticmethod
    def _values_to_csv(values: list) -> str:
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\n")
        for row in values or []:
            writer.writerow(row)
        return buf.getvalue()

    def workbook_rev(self, spreadsheet_id: str) -> str | None:
        """Drive modifiedTime+version. None if Drive is off / unauthorized.

        Rate-limited to REV_MIN_INTERVAL_S so 4 boards polling every second
        share one metadata call, not four Sheets batchGets.
        """
        sid = (spreadsheet_id or "").strip()
        if not sid:
            return None
        now = time.time()
        with _rev_lock:
            if (
                _rev_cache["sid"] == sid
                and now - float(_rev_cache.get("at") or 0) < REV_MIN_INTERVAL_S
            ):
                return _rev_cache.get("rev")
            drive_ok = _rev_cache.get("drive_ok", True)
        if not self.drive or not drive_ok:
            return None
        rev = None
        try:
            with self._drive_lock:
                meta = (
                    self.drive.files()
                    .get(
                        fileId=sid,
                        fields="modifiedTime,version",
                        supportsAllDrives=True,
                    )
                    .execute()
                )
            rev = (
                str(meta.get("modifiedTime") or "")
                + ":"
                + str(meta.get("version") or "")
            )
        except Exception as e:
            _log(f"Drive metadata failed ({e}); falling back to time coalesce")
            with _rev_lock:
                _rev_cache["drive_ok"] = False
                _rev_cache["at"] = now
                _rev_cache["sid"] = sid
                _rev_cache["rev"] = None
            return None
        with _rev_lock:
            _rev_cache["at"] = now
            _rev_cache["sid"] = sid
            _rev_cache["rev"] = rev
            _rev_cache["drive_ok"] = True
        return rev

    def public_rev(self) -> str:
        """Opaque stamp for board pollers. Stable while the workbook is unchanged."""
        sid = self.sheet_id
        rev = self.workbook_rev(sid)
        if rev:
            return rev
        global _csv_book_rev, _csv_book_sid
        with _csv_lock:
            if _csv_book_sid == sid and _csv_book_rev:
                return _csv_book_rev
            if _csv_cache:
                stamp = max(float(v.get("at") or 0) for v in _csv_cache.values())
                return "t:" + str(int(stamp * 1000))
        return ""

    def warm_csv_cache(self, force: bool = False) -> None:
        """
        Load *all* spreadsheet tabs into the CSV cache with one values.batchGet.

        force=True: re-fetch from Google unless a fetch just landed (coalesce
        parallel boards). Drive modifiedTime is not a skip signal — Sheets
        cell edits often do not bump it, which froze live soft-refresh.
        force=False: only fill missing/stale entries (TTL).
        """
        global _csv_batch_event, _csv_batch_error, _csv_book_rev, _csv_book_sid
        now = time.time()
        meta = self.refresh_meta(force=False)
        title_by_gid = meta["title_by_gid"]
        book_rev = self.workbook_rev(self.sheet_id) if force else None

        with _csv_lock:
            if force and _csv_cache and _csv_batch_event is None:
                ages = [now - v["at"] for v in _csv_cache.values()]
                # Concurrent boards all pass force=1 in the same wave → share one batch
                if ages and max(ages) < CSV_FORCE_COALESCE_S:
                    _log(
                        f"csv batch: coalesce force "
                        f"(cache max age {max(ages):.2f}s < {CSV_FORCE_COALESCE_S}s)"
                    )
                    return

            need: list[tuple[str, str]] = []
            for g, title in title_by_gid.items():
                g = str(g)
                hit = _csv_cache.get(g)
                if force or not hit or now - hit["at"] >= CSV_TTL:
                    need.append((g, title))
            if not need:
                return

            # Single-flight: one batchGet, everyone else waits
            if _csv_batch_event is not None:
                wait_ev = _csv_batch_event
            else:
                wait_ev = None
                _csv_batch_event = threading.Event()
                _csv_batch_error = None

        if wait_ev is not None:
            _log("csv batch: join in-flight batchGet")
            wait_ev.wait(timeout=180.0)
            if _csv_batch_error is not None:
                raise _csv_batch_error
            return

        t0 = time.time()
        try:
            with _csv_lock:
                need = []
                now = time.time()
                for g, title in title_by_gid.items():
                    g = str(g)
                    hit = _csv_cache.get(g)
                    if force or not hit or now - hit["at"] >= CSV_TTL:
                        need.append((g, title))
            if not need:
                return

            ranges = [
                "'" + str(title).replace("'", "''") + "'" for _g, title in need
            ]

            with self._api_lock:
                result = (
                    self.sheets.spreadsheets()
                    .values()
                    .batchGet(
                        spreadsheetId=self.sheet_id,
                        ranges=ranges,
                        majorDimension="ROWS",
                        valueRenderOption="FORMATTED_VALUE",
                    )
                    .execute()
                )
            value_ranges = result.get("valueRanges") or []
            filled = 0
            now = time.time()
            stamp = book_rev if force and book_rev else self.workbook_rev(self.sheet_id)
            with _csv_lock:
                for i, (g, title) in enumerate(need):
                    vr = value_ranges[i] if i < len(value_ranges) else {}
                    values = vr.get("values") or []
                    text = self._values_to_csv(values)
                    _csv_cache[g] = {"at": now, "text": text}
                    filled += 1
                if stamp:
                    _csv_book_rev = stamp
                    _csv_book_sid = self.sheet_id
            _log(
                f"csv batchGet force={force} tabs={filled}/{len(need)} "
                f"fetch={time.time() - t0:.2f}s rev={stamp or '-'}"
            )
        except Exception as e:
            _csv_batch_error = e
            _log(f"csv batchGet failed after {time.time() - t0:.2f}s: {e}")
            raise
        finally:
            with _csv_lock:
                ev = _csv_batch_event
                _csv_batch_event = None
            if ev is not None:
                ev.set()

    def warm_csv_cache_sid(self, sid: str, force: bool = False) -> None:
        """batchGet every tab of a catalog workbook that is not the TV pointer.

        Does not flip self.sheet_id (Settings A2 / dining-room). Cache keys are
        "sid:gid". Concurrent ?beta boards share one in-flight batchGet.
        """
        sid = (sid or "").strip()
        if not sid or sid == self.sheet_id:
            self.warm_csv_cache(force=force)
            return
        now = time.time()
        meta = self.refresh_meta_for(sid, force=False)
        title_by_gid = meta["title_by_gid"]
        prefix = sid + ":"

        with _csv_lock:
            if force:
                ages = [
                    now - v["at"]
                    for k, v in _csv_cache.items()
                    if str(k).startswith(prefix)
                ]
                flight = _csv_sid_flight.get(sid)
                if ages and max(ages) < CSV_FORCE_COALESCE_S and flight is None:
                    _log(
                        f"csv batch: coalesce force sid={sid} "
                        f"(cache max age {max(ages):.2f}s < {CSV_FORCE_COALESCE_S}s)"
                    )
                    return
            need: list[tuple[str, str]] = []
            for g, title in title_by_gid.items():
                g = str(g)
                hit = _csv_cache.get(prefix + g)
                if force or not hit or now - hit["at"] >= CSV_TTL:
                    need.append((g, title))
            if not need:
                return
            wait_ev = _csv_sid_flight.get(sid)
            if wait_ev is not None:
                pass
            else:
                wait_ev = None
                _csv_sid_flight[sid] = threading.Event()
                _csv_sid_flight_error[sid] = None

        if wait_ev is not None:
            _log(f"csv batch: join in-flight batchGet sid={sid}")
            wait_ev.wait(timeout=180.0)
            err = _csv_sid_flight_error.get(sid)
            if err is not None:
                raise err
            return

        t0 = time.time()
        try:
            with _csv_lock:
                need = []
                now = time.time()
                for g, title in title_by_gid.items():
                    g = str(g)
                    hit = _csv_cache.get(prefix + g)
                    if force or not hit or now - hit["at"] >= CSV_TTL:
                        need.append((g, title))
            if not need:
                return
            ranges = [
                "'" + str(title).replace("'", "''") + "'" for _g, title in need
            ]
            with self._api_lock:
                result = (
                    self.sheets.spreadsheets()
                    .values()
                    .batchGet(
                        spreadsheetId=sid,
                        ranges=ranges,
                        majorDimension="ROWS",
                        valueRenderOption="FORMATTED_VALUE",
                    )
                    .execute()
                )
            value_ranges = result.get("valueRanges") or []
            filled = 0
            now = time.time()
            with _csv_lock:
                for i, (g, title) in enumerate(need):
                    vr = value_ranges[i] if i < len(value_ranges) else {}
                    values = vr.get("values") or []
                    text = self._values_to_csv(values)
                    _csv_cache[prefix + g] = {"at": now, "text": text}
                    filled += 1
            _log(
                f"csv batchGet sid={sid} force={force} tabs={filled}/{len(need)} "
                f"fetch={time.time() - t0:.2f}s"
            )
        except Exception as e:
            _csv_sid_flight_error[sid] = e
            _log(f"csv batchGet sid={sid} failed after {time.time() - t0:.2f}s: {e}")
            raise
        finally:
            with _csv_lock:
                ev = _csv_sid_flight.pop(sid, None)
            if ev is not None:
                ev.set()

    def csv_for_gid(self, gid: str, force: bool = False, sheet_id: str | None = None) -> str:
        """
        Fetch sheet values by gid.
        force=True (menu hard/soft refresh): re-batchGet unless coalesce window.
        force=False: serve CSV_TTL cache when warm.
        Optional sheet_id reads that catalog workbook without flipping A2.
        """
        gid = str(gid)
        now = time.time()
        want_sid = ""
        if sheet_id:
            want_sid, _name = self.resolve_catalog_sheet_id(sheet_id)
        if want_sid and want_sid != self.sheet_id:
            cache_key = want_sid + ":" + gid
            if not force:
                with _csv_lock:
                    hit = _csv_cache.get(cache_key)
                    if hit and now - hit["at"] < CSV_TTL:
                        _log(
                            f"csv gid={gid} sid={want_sid} cache hit "
                            f"age={now - hit['at']:.1f}s"
                        )
                        return hit["text"]
            self.warm_csv_cache_sid(want_sid, force=force)
            with _csv_lock:
                hit = _csv_cache.get(cache_key)
                if hit:
                    if force:
                        _log(
                            f"csv gid={gid} sid={want_sid} after force-batch "
                            f"age={now - hit['at']:.2f}s"
                        )
                    return hit["text"]
            return self.csv_for_gid_one(gid, force=True, sheet_id=want_sid)
        # Settings TTL already covers Data Source flips. Board force-refresh
        # must not spend a Settings read — that is how we hit 60/min.
        self.apply_live_sheet(force_settings=False)

        if not force:
            with _csv_lock:
                hit = _csv_cache.get(gid)
                if hit and now - hit["at"] < CSV_TTL:
                    _log(f"csv gid={gid} cache hit age={now - hit['at']:.1f}s")
                    return hit["text"]

        # One Google round-trip fills every tab — multi-board shares single-flight
        self.warm_csv_cache(force=force)

        with _csv_lock:
            hit = _csv_cache.get(gid)
            if hit:
                if force:
                    _log(f"csv gid={gid} after force-batch age={now - hit['at']:.2f}s")
                return hit["text"]

        # Tab missing from workbook meta or batch — last-resort single get
        t0 = time.time()
        title = self.title_for_gid(gid)
        safe = "'" + title.replace("'", "''") + "'"
        with self._api_lock:
            result = (
                self.sheets.spreadsheets()
                .values()
                .get(
                    spreadsheetId=self.sheet_id,
                    range=safe,
                    majorDimension="ROWS",
                    valueRenderOption="FORMATTED_VALUE",
                )
                .execute()
            )
        text = self._values_to_csv(result.get("values") or [])
        with _csv_lock:
            _csv_cache[gid] = {"at": time.time(), "text": text}
        _log(
            f"csv gid={gid} title={title!r} single-get "
            f"fetch={time.time() - t0:.2f}s bytes={len(text)}"
        )
        return text

    def csv_for_gid_one(
        self, gid: str, force: bool = False, sheet_id: str | None = None
    ) -> str:
        """One tab only. Does not batchGet the rest of the workbook.

        Optional sheet_id (catalog workbook) reads that spreadsheet without
        flipping the live TV pointer (Settings A2).
        """
        gid = str(gid)
        now = time.time()
        want_sid = ""
        if sheet_id:
            want_sid, _name = self.resolve_catalog_sheet_id(sheet_id)
        if want_sid and want_sid != self.sheet_id:
            cache_key = want_sid + ":" + gid
            if not force:
                with _csv_lock:
                    hit = _csv_cache.get(cache_key)
                    if hit and now - hit["at"] < CSV_TTL:
                        _log(
                            f"csv gid={gid} sid={want_sid} single cache hit "
                            f"age={now - hit['at']:.1f}s"
                        )
                        return hit["text"]
            t0 = time.time()
            title = self._tab_title_for_gid(want_sid, gid)
            safe = "'" + title.replace("'", "''") + "'"
            with self._api_lock:
                result = (
                    self.sheets.spreadsheets()
                    .values()
                    .get(
                        spreadsheetId=want_sid,
                        range=safe,
                        majorDimension="ROWS",
                        valueRenderOption="FORMATTED_VALUE",
                    )
                    .execute()
                )
            text = self._values_to_csv(result.get("values") or [])
            with _csv_lock:
                _csv_cache[cache_key] = {"at": time.time(), "text": text}
            _log(
                f"csv gid={gid} sid={want_sid} title={title!r} single-only "
                f"force={force} fetch={time.time() - t0:.2f}s bytes={len(text)}"
            )
            return text
        self.apply_live_sheet(force_settings=False)
        if not force:
            with _csv_lock:
                hit = _csv_cache.get(gid)
                if hit and now - hit["at"] < CSV_TTL:
                    _log(
                        f"csv gid={gid} single cache hit "
                        f"age={now - hit['at']:.1f}s"
                    )
                    return hit["text"]
        t0 = time.time()
        title = self.title_for_gid(gid)
        safe = "'" + title.replace("'", "''") + "'"
        with self._api_lock:
            result = (
                self.sheets.spreadsheets()
                .values()
                .get(
                    spreadsheetId=self.sheet_id,
                    range=safe,
                    majorDimension="ROWS",
                    valueRenderOption="FORMATTED_VALUE",
                )
                .execute()
            )
        text = self._values_to_csv(result.get("values") or [])
        with _csv_lock:
            _csv_cache[gid] = {"at": time.time(), "text": text}
        _log(
            f"csv gid={gid} title={title!r} single-only "
            f"force={force} fetch={time.time() - t0:.2f}s bytes={len(text)}"
        )
        return text

    def validations_for_settings_row(self, gid: str, force: bool = False) -> dict:
        """
        Read data-validation rules on the Settings data row for a revised tab
        (label → headers → values). Keyed by header name for Menu Manager.
        """
        gid = str(gid)
        self.apply_live_sheet(force_settings=force)
        title = self.title_for_gid(gid)
        safe = "'" + title.replace("'", "''") + "'!A1:Z40"
        t0 = time.time()
        with self._api_lock:
            result = (
                self.sheets.spreadsheets()
                .get(
                    spreadsheetId=self.sheet_id,
                    ranges=[safe],
                    includeGridData=True,
                    fields=(
                        "sheets(data(rowData(values("
                        "formattedValue,userEnteredValue,dataValidation"
                        "))))"
                    ),
                )
                .execute()
            )
        rows = []
        for sh in result.get("sheets") or []:
            for block in sh.get("data") or []:
                rows = block.get("rowData") or []
                break
            if rows:
                break

        def cell_text(cell: dict | None) -> str:
            if not cell:
                return ""
            fv = cell.get("formattedValue")
            if fv is not None and str(fv).strip() != "":
                return str(fv).strip()
            ue = cell.get("userEnteredValue") or {}
            if "stringValue" in ue:
                return str(ue.get("stringValue") or "").strip()
            if "numberValue" in ue:
                return str(ue.get("numberValue"))
            if "boolValue" in ue:
                return "TRUE" if ue.get("boolValue") else "FALSE"
            return ""

        def fold(s: str) -> str:
            return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())

        header_idx = -1
        for i, row in enumerate(rows):
            vals = row.get("values") or []
            a = cell_text(vals[0] if vals else None).lower()
            if a == "settings" or a.startswith("settings"):
                # next non-empty row is headers
                for j in range(i + 1, min(i + 4, len(rows))):
                    hv = (rows[j].get("values") or [])
                    if any(cell_text(c) for c in hv):
                        header_idx = j
                        break
                break
        if header_idx < 0:
            # Fallback: first row that looks like Theme Selector / BG Color
            for i, row in enumerate(rows[:8]):
                vals = row.get("values") or []
                heads = [fold(cell_text(c)) for c in vals]
                if "themeselector" in heads or "bgscrollspeed" in heads:
                    header_idx = i
                    break
        if header_idx < 0 or header_idx + 1 >= len(rows):
            _log(
                f"validations gid={gid}: no Settings header "
                f"({time.time() - t0:.2f}s)"
            )
            return {"gid": gid, "title": title, "fields": {}}

        headers = rows[header_idx].get("values") or []
        data = rows[header_idx + 1].get("values") or []
        fields: dict[str, dict] = {}
        for ci, hcell in enumerate(headers):
            name = cell_text(hcell)
            if not name:
                continue
            dcell = data[ci] if ci < len(data) else None
            dv = (dcell or {}).get("dataValidation") if dcell else None
            if not dv:
                continue
            cond = dv.get("condition") or {}
            ctype = str(cond.get("type") or "").strip()
            raw_vals = []
            for v in cond.get("values") or []:
                if not isinstance(v, dict):
                    continue
                if "userEnteredValue" in v:
                    raw_vals.append(str(v.get("userEnteredValue") or "").strip())
                elif "relativeDate" in v:
                    raw_vals.append(str(v.get("relativeDate") or "").strip())
            entry = {
                "type": ctype,
                "values": raw_vals,
                "strict": bool(dv.get("strict")),
            }
            if dv.get("inputMessage"):
                entry["inputMessage"] = str(dv.get("inputMessage"))
            fields[name] = entry
        _log(
            f"validations gid={gid} fields={len(fields)} "
            f"fetch={time.time() - t0:.2f}s"
        )
        return {"gid": gid, "title": title, "fields": fields}

    def catalog_sheet_ids(self) -> set[str]:
        live = self.refresh_settings(force=False)
        ids: set[str] = set()
        for extra in (self.sheet_id, self.fallback_sheet_id):
            sid = extract_spreadsheet_id(extra or "")
            if sid:
                ids.add(sid)
        for c in live.get("catalog") or []:
            if not isinstance(c, dict):
                continue
            sid = extract_spreadsheet_id(
                c.get("sheetId") or c.get("url") or ""
            )
            if sid:
                ids.add(sid)
        return ids

    def resolve_catalog_sheet_id(self, requested: str | None) -> tuple[str, str]:
        """Return (spreadsheet_id, source_name) for a catalog workbook."""
        live = self.refresh_settings(force=False)
        catalog = [
            c for c in (live.get("catalog") or []) if isinstance(c, dict)
        ]
        want = extract_spreadsheet_id(requested or "")
        if want:
            if want not in self.catalog_sheet_ids():
                raise ValueError("sheetId is not a catalog data source")
            for c in catalog:
                sid = extract_spreadsheet_id(
                    c.get("sheetId") or c.get("url") or ""
                )
                if sid == want:
                    return want, str(c.get("name") or "").strip()
            return want, ""
        sid = extract_spreadsheet_id(
            (live.get("sheetId") or self.sheet_id or self.fallback_sheet_id or "")
        )
        if not sid:
            raise ValueError("no data source spreadsheet")
        return sid, str(live.get("sourceName") or live.get("dataSource") or "").strip()

    def _style_tab_title(self, spreadsheet_id: str) -> str:
        with self._api_lock:
            meta = (
                self.sheets.spreadsheets()
                .get(
                    spreadsheetId=spreadsheet_id,
                    fields="sheets.properties(sheetId,title)",
                )
                .execute()
            )
        want_gid = str(STYLE_THEME_GID)
        named = []
        for sh in meta.get("sheets") or []:
            p = sh.get("properties") or {}
            title = str(p.get("title") or "")
            if str(p.get("sheetId")) == want_gid:
                return title
            folded = re.sub(r"[^a-z0-9]+", "", title.lower())
            if folded == "styleandtheme" and "(old)" not in title.lower():
                named.append(title)
        if named:
            return named[0]
        raise KeyError("Style and Theme tab not found")

    @staticmethod
    def _header_fold(raw: str) -> str:
        name = str(raw or "").strip()
        name = re.sub(r"\s*[\(\[].*[\)\]]\s*$", "", name).strip()
        return re.sub(r"[^a-z0-9]+", "", name.lower())

    @staticmethod
    def _col_letters(idx: int) -> str:
        n = int(idx) + 1
        out = ""
        while n > 0:
            n, rem = divmod(n - 1, 26)
            out = chr(65 + rem) + out
        return out or "A"

    def _settings_layout(self, rows: list) -> tuple[int, int, dict[str, int]]:
        header_idx = -1
        for i, row in enumerate(rows or []):
            a = _cell(row, 0).lower()
            if a == "settings" or a.startswith("settings"):
                if i + 1 < len(rows):
                    header_idx = i + 1
                break
        if header_idx < 0:
            header_idx = 1
        headers = (rows[header_idx] if header_idx < len(rows or []) else []) or []
        data_idx = header_idx + 1
        cols: dict[str, int] = {}
        for c, h in enumerate(headers):
            fold = self._header_fold(str(h or ""))
            if fold:
                cols[fold] = c
        return header_idx, data_idx, cols

    def _a1_for(self, cols: dict[str, int], folds: list[str], data_idx: int, default_col: int) -> str:
        for fold in folds:
            if fold in cols:
                return f"{self._col_letters(cols[fold])}{data_idx + 1}"
        return f"{self._col_letters(default_col)}{data_idx + 1}"

    def _glossary_list(self, rows: list, *name_folds: str) -> list[str]:
        header_idx = -1
        col = -1
        want = set(name_folds)
        for i, row in enumerate(rows or []):
            for c, raw in enumerate(row or []):
                fold = self._header_fold(str(raw or ""))
                if fold in want:
                    header_idx = i
                    col = c
                    break
            if col >= 0:
                break
        if col < 0:
            return []
        out: list[str] = []
        for row in (rows or [])[header_idx + 1 :]:
            name = _cell(row, col)
            if not name:
                continue
            low = name.lower()
            if low in ("theme name", "settings") or "glossary" in low:
                continue
            out.append(name)
        return out

    def _theme_names(self, rows: list) -> list[str]:
        listed = self._glossary_list(rows, "themename")
        if listed:
            return listed
        db = -1
        for i, row in enumerate(rows or []):
            a = _cell(row, 0).lower()
            if a.startswith("themes database"):
                db = i + 2
                break
        if db < 0:
            db = 5
        names: list[str] = []
        for row in (rows or [])[db:]:
            name = _cell(row, 0)
            low = name.lower()
            if not name or low in ("theme name", "settings"):
                continue
            if "glossary" in low:
                continue
            names.append(name)
        return names

    def _canonical_theme(self, rows: list, want_name: str) -> str:
        key = str(want_name or "").strip().lower()
        if not key or len(key) > 64:
            raise ValueError("invalid theme")
        for name in self._theme_names(rows):
            if name.lower() == key:
                return name
        raise ValueError("theme is not in Themes Database")

    def _themes_layout(self, rows: list) -> tuple[int, int, dict[str, int]]:
        header_idx = -1
        for i, row in enumerate(rows or []):
            a = _cell(row, 0).lower()
            if a.startswith("themes database"):
                if i + 1 < len(rows):
                    header_idx = i + 1
                break
        if header_idx < 0:
            header_idx = 4
        headers = (rows[header_idx] if header_idx < len(rows or []) else []) or []
        data_idx = header_idx + 1
        cols: dict[str, int] = {}
        for c, h in enumerate(headers):
            fold = self._header_fold(str(h or ""))
            if fold:
                cols[fold] = c
        return header_idx, data_idx, cols

    def _theme_row_index(self, rows: list, theme_name: str) -> int:
        want = str(theme_name or "").strip().lower()
        if not want:
            raise ValueError("missing theme")
        _header_idx, data_idx, cols = self._themes_layout(rows)
        name_col = cols.get("themename", 0)
        for i, row in enumerate((rows or [])[data_idx:], start=data_idx):
            if _cell(row, name_col).lower() == want:
                return i
        raise ValueError("theme is not in Themes Database")

    def _current_theme_selector(self, rows: list) -> str:
        _header_idx, data_idx, cols = self._settings_layout(rows)
        row = rows[data_idx] if data_idx < len(rows or []) else []
        return _cell(row, cols.get("themeselector", 0))

    def _pattern_color_a1(self, rows: list, theme_name: str) -> dict[str, str]:
        row_idx = self._theme_row_index(rows, theme_name)
        _h, _d, cols = self._themes_layout(rows)
        excel = row_idx + 1
        return {
            "patterncolor1": f"{self._col_letters(cols.get('patterncolor1', 10))}{excel}",
            "patterncolor2": f"{self._col_letters(cols.get('patterncolor2', 11))}{excel}",
        }

    @staticmethod
    def _is_none_token(raw: str) -> bool:
        s = str(raw or "").strip().lower()
        return (not s) or s in (
            "none",
            "off",
            "0",
            "false",
            "no",
            "-",
            "—",
            "–",
            "n/a",
            "solid",
        )

    def _match_glossary(self, values: list[str], want: str, kinds: str) -> str:
        key = re.sub(r"[^a-z0-9]+", "", str(want or "").lower())
        if kinds == "none" or self._is_none_token(want):
            for v in values:
                if self._is_none_token(v):
                    return v
            return "none"
        for v in values:
            fold = re.sub(r"[^a-z0-9]+", "", v.lower())
            if fold == key:
                return v
        if kinds == "color":
            aliases = {
                "main": ("maincolor", "main"),
                "secondary": ("secondarycolor", "secondary"),
                "highlight": ("highlightcolor", "highlight"),
                "special": (
                    "highlightcolorspecial",
                    "special",
                    "highlightspecial",
                ),
            }
            want_ids = None
            for role, names in aliases.items():
                if key in names or key == role:
                    want_ids = names + (role,)
                    break
            if want_ids:
                for v in values:
                    fold = re.sub(r"[^a-z0-9]+", "", v.lower())
                    if fold in want_ids:
                        return v
                    if "special" in want_ids and "special" in fold:
                        return v
                fallbacks = {
                    "main": "main color",
                    "secondary": "secondary color",
                    "highlight": "highlight color",
                    "special": "highlight color (special)",
                }
                for role, names in aliases.items():
                    if key in names or key == role:
                        return fallbacks[role]
        if kinds == "wallpaper":
            for v in values:
                fold = v.lower()
                if key and key in re.sub(r"[^a-z0-9]+", "", fold):
                    return v
                if "galaxy" in key and "galaxy" in fold:
                    return v
                if "film" in key and "film" in fold:
                    return v
            if "film" in key:
                return "film.jpg"
            if key and key not in ("upload",):
                return "galaxy-bg.jpg"
        if kinds == "pattern":
            if key and "stripe" in key:
                for v in values:
                    if "stripe" in v.lower():
                        return v
                return "stripes"
        if values:
            return values[0]
        return str(want or "").strip() or "none"

    def _background_updates(self, rows: list, body: dict) -> dict[str, str]:
        """Exclusive BG Color / Pattern / Wallpaper. Pattern wins on the board."""
        colors = self._glossary_list(rows, "colorpickerfordropdowns", "colorpicker")
        patterns = self._glossary_list(rows, "patterns", "patternoptions")
        wallpapers = self._glossary_list(rows, "wallpaperoptions", "wallpapers")
        none_pat = self._match_glossary(patterns, "none", "none")
        none_wp = self._match_glossary(wallpapers, "none", "none")
        mode = str(body.get("background") or "").strip().lower()
        bg_color = str(body.get("bgColor") or body.get("bg_color") or "").strip()
        pattern = str(body.get("patternType") or body.get("pattern") or "").strip()
        wallpaper = str(
            body.get("wallpaper") or body.get("bgWallpaper") or ""
        ).strip()
        if mode in ("pattern", "wallpaper"):
            pass
        elif mode:
            if not bg_color:
                bg_color = mode
            mode = "color"
        else:
            if wallpaper and not self._is_none_token(wallpaper) and wallpaper != "upload":
                mode = "wallpaper"
            elif pattern and not self._is_none_token(pattern):
                mode = "pattern"
            else:
                mode = "color"
        if not bg_color:
            bg_color = "main"
        color_val = self._match_glossary(colors, bg_color, "color")
        if mode == "pattern":
            return {
                "bgcolor": color_val,
                "bgpattern": self._match_glossary(
                    patterns, pattern or "stripes", "pattern"
                ),
                "bgwallpaper": none_wp,
            }
        if mode == "wallpaper":
            wp = wallpaper if wallpaper != "upload" else "galaxy"
            return {
                "bgcolor": color_val,
                "bgpattern": none_pat,
                "bgwallpaper": self._match_glossary(wallpapers, wp, "wallpaper"),
            }
        return {
            "bgcolor": color_val,
            "bgpattern": none_pat,
            "bgwallpaper": none_wp,
        }

    def write_style(self, body: dict, sheet_id: str | None = None) -> dict:
        sid, source_name = self.resolve_catalog_sheet_id(sheet_id)
        title = self._style_tab_title(sid)
        safe_title = "'" + title.replace("'", "''") + "'"
        t0 = time.time()
        with self._api_lock:
            result = (
                self.sheets.spreadsheets()
                .values()
                .get(
                    spreadsheetId=sid,
                    range=safe_title + "!A1:Z40",
                    majorDimension="ROWS",
                    valueRenderOption="FORMATTED_VALUE",
                )
                .execute()
            )
        rows = result.get("values") or []
        _header_idx, data_idx, cols = self._settings_layout(rows)
        field_a1 = {
            "themeselector": self._a1_for(
                cols, ["themeselector"], data_idx, 0
            ),
            "bgcolor": self._a1_for(
                cols, ["bgcolor", "backgroundcolor"], data_idx, 1
            ),
            "bgpattern": self._a1_for(
                cols, ["bgpattern", "backgroundpattern"], data_idx, 2
            ),
            "bgwallpaper": self._a1_for(
                cols, ["bgwallpaper", "backgroundwallpaper", "bgimage"],
                data_idx,
                3,
            ),
            "bgscrollspeed": self._a1_for(
                cols,
                ["bgscrollspeed", "backgroundscrollspeed", "scrollspeed"],
                data_idx,
                7,
            ),
            "presentationspeed": self._a1_for(
                cols,
                ["presentationspeed", "slideshowspeed"],
                data_idx,
                8,
            ),
            "encorespotlighttype": self._a1_for(
                cols,
                ["encorespotlighttype", "encorestyle"],
                data_idx,
                10,
            ),
            "encorespotlightcolor": self._a1_for(
                cols,
                ["encorespotlightcolor", "encorespot"],
                data_idx,
                11,
            ),
            "encorebackgroundcolor": self._a1_for(
                cols,
                ["encorebackgroundcolor", "encorebg", "encorebackground"],
                data_idx,
                12,
            ),
        }
        values: dict[str, str] = {}
        extra: list[dict] = []
        wrote_theme = False
        wrote_bg = False
        wrote_speeds = False
        wrote_encore = False
        wrote_pattern = False
        theme = str(body.get("theme") or body.get("themeName") or "").strip()
        if theme:
            values["themeselector"] = self._canonical_theme(rows, theme)
            wrote_theme = True
        bg_keys = (
            "background",
            "bgColor",
            "bg_color",
            "patternType",
            "pattern",
            "wallpaper",
            "bgWallpaper",
        )
        if any(k in body and body.get(k) not in (None, "") for k in bg_keys):
            values.update(self._background_updates(rows, body))
            wrote_bg = True

        def _int_speed(raw, name: str) -> str:
            try:
                n = int(round(float(raw)))
            except (TypeError, ValueError) as e:
                raise ValueError("invalid " + name) from e
            if n < 0 or n > 30:
                raise ValueError("invalid " + name)
            return str(n)

        if "scrollSpeed" in body and body.get("scrollSpeed") not in (None, ""):
            values["bgscrollspeed"] = _int_speed(
                body.get("scrollSpeed"), "scrollSpeed"
            )
            wrote_speeds = True
        if "presentationSpeed" in body and body.get("presentationSpeed") not in (
            None,
            "",
        ):
            values["presentationspeed"] = _int_speed(
                body.get("presentationSpeed"), "presentationSpeed"
            )
            wrote_speeds = True
        if "encoreStyle" in body or "encoreSpotlightType" in body:
            values["encorespotlighttype"] = self._as_encore_style(
                body.get("encoreStyle") or body.get("encoreSpotlightType")
            )
            wrote_encore = True
        if "encoreSpot" in body or "encoreSpotlightColor" in body:
            values["encorespotlightcolor"] = self._as_encore_spot(
                body.get("encoreSpot") or body.get("encoreSpotlightColor")
            )
            wrote_encore = True
        if "encoreBg" in body or "encoreBackground" in body:
            colors = self._glossary_list(
                rows, "colorpickerfordropdowns", "colorpicker"
            )
            values["encorebackgroundcolor"] = self._match_glossary(
                colors,
                body.get("encoreBg") or body.get("encoreBackground") or "",
                "color",
            )
            wrote_encore = True

        def _body_color(keys: tuple[str, ...]):
            for k in keys:
                if k in body and body.get(k) not in (None, ""):
                    return body.get(k)
            return None

        pat1 = _body_color(("patternColor1", "pattern_color_1"))
        pat2 = _body_color(("patternColor2", "pattern_color_2"))
        if pat1 is not None or pat2 is not None:
            theme_for_pat = values.get("themeselector") or ""
            if not theme_for_pat:
                raw_theme = theme or self._current_theme_selector(rows)
                theme_for_pat = self._canonical_theme(rows, raw_theme)
            colors = self._glossary_list(
                rows, "colorpickerfordropdowns", "colorpicker"
            )
            a1 = self._pattern_color_a1(rows, theme_for_pat)
            if pat1 is not None:
                extra.append(
                    {
                        "range": safe_title + "!" + a1["patterncolor1"],
                        "values": [[self._match_glossary(colors, pat1, "color")]],
                    }
                )
            if pat2 is not None:
                extra.append(
                    {
                        "range": safe_title + "!" + a1["patterncolor2"],
                        "values": [[self._match_glossary(colors, pat2, "color")]],
                    }
                )
            wrote_pattern = True

        data = [
            {
                "range": safe_title + "!" + field_a1[fold],
                "values": [[val]],
            }
            for fold, val in values.items()
            if fold in field_a1
        ]
        data.extend(extra)
        if not data:
            raise ValueError("nothing to write")
        with self._api_lock:
            updated = (
                self.sheets.spreadsheets()
                .values()
                .batchUpdate(
                    spreadsheetId=sid,
                    body={
                        "valueInputOption": "USER_ENTERED",
                        "data": data,
                    },
                )
                .execute()
            )
        _flush_data_caches()
        ranges = [
            (u.get("updatedRange") or "")
            for u in (updated.get("responses") or [])
        ]
        _log(
            f"style write {source_name or sid} {values} "
            f"pattern={wrote_pattern} "
            f"cells={updated.get('totalUpdatedCells')} "
            f"({time.time() - t0:.2f}s)"
        )
        return {
            "ok": True,
            "theme": values.get("themeselector") or theme,
            "background": {
                "bgColor": values.get("bgcolor"),
                "bgPattern": values.get("bgpattern"),
                "bgWallpaper": values.get("bgwallpaper"),
                "scrollSpeed": values.get("bgscrollspeed"),
            }
            if wrote_bg
            else None,
            "wroteTheme": wrote_theme,
            "wroteBackground": wrote_bg,
            "wroteSpeeds": wrote_speeds,
            "wroteEncore": wrote_encore,
            "wrotePattern": wrote_pattern,
            "scrollSpeed": values.get("bgscrollspeed"),
            "presentationSpeed": values.get("presentationspeed"),
            "range": ", ".join([r for r in ranges if r]),
            "sheetId": sid,
            "sourceName": source_name,
        }

    def write_theme(self, theme: str, sheet_id: str | None = None) -> dict:
        return self.write_style({"theme": theme}, sheet_id)

    @staticmethod
    def _as_encore_style(raw) -> str:
        s = re.sub(r"[^a-z0-9]+", "", str(raw or "").lower())
        if "soft" in s:
            return "soft"
        if "hardshadow" in s or s in ("shadow", "hardwithshadow"):
            return "hard_shadow"
        if "hard" in s:
            return "hard"
        raise ValueError("invalid encoreStyle")

    @staticmethod
    def _as_encore_spot(raw) -> str:
        s = re.sub(r"[^a-z0-9]+", "", str(raw or "").lower())
        if "highlight" in s or "special" in s:
            return "highlight"
        if "black" in s or "main" in s:
            return "black"
        raise ValueError("invalid encoreSpot")

    def _tab_title_for_gid(self, spreadsheet_id: str, gid: str) -> str:
        want = str(gid or "").strip()
        if not want:
            raise ValueError("missing gid")
        with self._api_lock:
            meta = (
                self.sheets.spreadsheets()
                .get(
                    spreadsheetId=spreadsheet_id,
                    fields="sheets.properties(sheetId,title)",
                )
                .execute()
            )
        for sh in meta.get("sheets") or []:
            p = sh.get("properties") or {}
            if str(p.get("sheetId")) == want:
                title = str(p.get("title") or "").strip()
                if title:
                    return title
        raise KeyError("No sheet with gid=" + want)

    @staticmethod
    def _as_bool01(raw) -> str:
        s = str(raw if raw is not None else "").strip().lower()
        if s in ("1", "yes", "y", "true", "on"):
            return "1"
        if s in ("0", "no", "n", "false", "off"):
            return "0"
        raise ValueError("invalid yes/no")

    @staticmethod
    def _as_presentation_mode(raw) -> str:
        s = re.sub(r"[^a-z0-9]+", "", str(raw or "").lower())
        if "encore" in s:
            return "encore"
        if "slide" in s:
            return "slideshow"
        if "ken" in s or "burn" in s:
            return "ken burns"
        raise ValueError("invalid presentation")

    def _inventory_layout(self, rows: list) -> tuple[int, int, list]:
        inv_label = -1
        for i, row in enumerate(rows or []):
            a = _cell(row, 0).strip().lower()
            if a == "inventory" or a.startswith("inventory"):
                inv_label = i
                break
        if inv_label < 0 or inv_label + 1 >= len(rows or []):
            raise ValueError("no inventory block")
        header_idx = inv_label + 1
        data_start = header_idx + 1
        headers = list((rows[header_idx] if header_idx < len(rows) else []) or [])
        return header_idx, data_start, headers

    def _inventory_data(self, rows: list):
        header_idx, data_start, headers = self._inventory_layout(rows)
        data = []
        for i in range(data_start, len(rows or [])):
            row = list(rows[i] or [])
            name = _cell(row, 0)
            if not name:
                continue
            fold = re.sub(r"[^a-z0-9]+", "", name.lower())
            if fold in ("settings", "inventory"):
                break
            data.append((i, row))
        if not data:
            raise ValueError("inventory is empty")
        return header_idx, data_start, headers, data

    def _reorder_inventory(self, rows: list, items: list) -> tuple[list, int, list]:
        _header_idx, data_start, headers, data = self._inventory_data(rows)
        by_excel = {idx + 1: vals for idx, vals in data}
        by_name: dict[str, list] = {}
        for _idx, vals in data:
            n = _cell(vals, 0)
            if n and n not in by_name:
                by_name[n] = vals
        used: set[int] = set()
        ordered: list[list] = []
        item_rows: list[dict] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name") or "").strip()
            vals = None
            raw_row = it.get("row")
            if raw_row not in (None, ""):
                try:
                    vals = by_excel.get(int(raw_row))
                except (TypeError, ValueError):
                    vals = None
            if vals is None and name:
                vals = by_name.get(name)
            if vals is None:
                continue
            key = id(vals)
            if key in used:
                continue
            used.add(key)
            ordered.append(vals)
        leftovers = [vals for _idx, vals in data if id(vals) not in used]
        block = ordered + leftovers
        width = 1
        for r in [headers] + block:
            if len(r) > width:
                width = len(r)
        padded = []
        for r in block:
            row = list(r)
            if len(row) < width:
                row.extend([""] * (width - len(row)))
            padded.append(row)
        for i, vals in enumerate(padded):
            item_rows.append(
                {"name": _cell(vals, 0), "row": data_start + i + 1}
            )
        return padded, data_start, item_rows

    def write_board(self, body: dict, sheet_id: str | None = None) -> dict:
        """Write Board 1–3 Settings cells and/or inventory row order."""
        sid, source_name = self.resolve_catalog_sheet_id(sheet_id)
        gid = str(body.get("gid") or "").strip()
        title = self._tab_title_for_gid(sid, gid)
        safe_title = "'" + title.replace("'", "''") + "'"
        items = body.get("items")
        want_inv = isinstance(items, list) and len(items) > 0
        t0 = time.time()
        with self._api_lock:
            result = (
                self.sheets.spreadsheets()
                .values()
                .get(
                    spreadsheetId=sid,
                    range=safe_title + ("!A1:Z80" if want_inv else "!A1:Z12"),
                    majorDimension="ROWS",
                    valueRenderOption="FORMATTED_VALUE",
                )
                .execute()
            )
        rows = result.get("values") or []
        _header_idx, data_idx, cols = self._settings_layout(rows)
        field_a1 = {
            "menutitle": self._a1_for(cols, ["menutitle", "title"], data_idx, 0),
            "familyportrait": self._a1_for(cols, ["familyportrait"], data_idx, 1),
            "presentationmode": self._a1_for(
                cols, ["presentationmode", "presentationstyle"], data_idx, 2
            ),
            "includedescriptions": self._a1_for(
                cols,
                ["includedescriptions", "includeitemdescriptions"],
                data_idx,
                6,
            ),
        }
        values: dict[str, str] = {}
        if "menuTitle" in body or "title" in body:
            name = str(body.get("menuTitle") or body.get("title") or "").strip()
            if not name:
                raise ValueError("missing menuTitle")
            values["menutitle"] = name
        if "familyPortrait" in body:
            values["familyportrait"] = self._as_bool01(body.get("familyPortrait"))
        if "presentation" in body or "presentationMode" in body:
            values["presentationmode"] = self._as_presentation_mode(
                body.get("presentation") or body.get("presentationMode")
            )
        if "includeDescriptions" in body:
            values["includedescriptions"] = self._as_bool01(
                body.get("includeDescriptions")
            )
        data = [
            {
                "range": safe_title + "!" + field_a1[fold],
                "values": [[val]],
            }
            for fold, val in values.items()
            if fold in field_a1
        ]
        item_rows = None
        wrote_inv = False
        if want_inv:
            padded, data_start, item_rows = self._reorder_inventory(rows, items)
            end_col = self._col_letters(max(len(padded[0]) - 1, 0))
            end_row = data_start + len(padded)
            data.append(
                {
                    "range": f"{safe_title}!A{data_start + 1}:{end_col}{end_row}",
                    "values": padded,
                }
            )
            wrote_inv = True
        if not data:
            raise ValueError("nothing to write")
        with self._api_lock:
            updated = (
                self.sheets.spreadsheets()
                .values()
                .batchUpdate(
                    spreadsheetId=sid,
                    body={
                        "valueInputOption": "USER_ENTERED",
                        "data": data,
                    },
                )
                .execute()
            )
        _flush_data_caches()
        ranges = [
            (u.get("updatedRange") or "")
            for u in (updated.get("responses") or [])
        ]
        _log(
            f"board write {source_name or sid} gid={gid} {values} "
            f"inv={wrote_inv} cells={updated.get('totalUpdatedCells')} "
            f"({time.time() - t0:.2f}s)"
        )
        return {
            "ok": True,
            "wroteBoard": bool(values) or wrote_inv,
            "wroteInventory": wrote_inv,
            "gid": gid,
            "tab": title,
            "values": values,
            "itemRows": item_rows,
            "range": ", ".join([r for r in ranges if r]),
            "sheetId": sid,
            "sourceName": source_name,
        }

    def list_item_menus(self) -> dict:
        live = self.refresh_settings(force=False) or {}
        catalogs = []
        for c in live.get("catalog") or []:
            if not isinstance(c, dict):
                continue
            sid = extract_spreadsheet_id(
                c.get("sheetId") or c.get("url") or ""
            )
            if not sid:
                continue
            catalogs.append(
                {
                    "id": sid,
                    "name": str(c.get("name") or "").strip(),
                    "sheetId": sid,
                }
            )
        return {
            "ok": True,
            "menus": [dict(m) for m in ITEM_MENUS],
            "catalogs": catalogs,
            "sheetId": live.get("sheetId") or self.sheet_id,
            "sourceName": live.get("sourceName") or live.get("dataSource") or "",
        }

    def _drive_upload_folder_id(self) -> str:
        """A user-owned folder shared with the robot. SA My Drive has no quota."""
        return (os.environ.get("TOKI_UPLOAD_FOLDER_ID") or "").strip()

    def upload_drive_image(
        self, data: bytes, filename: str, mime: str
    ) -> dict:
        """Store a public-with-link photo in a shared Drive folder.

        Google service accounts have no My Drive quota. Set
        TOKI_UPLOAD_FOLDER_ID to a folder in your Drive that is shared
        with the robot email, then TVs can load the URL with no git ship.
        """
        if not self.drive:
            raise ValueError("Drive client not available")
        from googleapiclient.http import MediaIoBaseUpload

        folder_id = self._drive_upload_folder_id()
        if not folder_id:
            raise ValueError(
                "Drive upload needs TOKI_UPLOAD_FOLDER_ID "
                "(share a Drive folder with the service account; "
                "the robot has no storage quota of its own)"
            )
        media = MediaIoBaseUpload(
            io.BytesIO(data),
            mimetype=mime or "application/octet-stream",
            resumable=False,
        )
        body = {"name": filename}
        if folder_id:
            body["parents"] = [folder_id]
        with self._drive_lock:
            created = (
                self.drive.files()
                .create(body=body, media_body=media, fields="id,name")
                .execute()
            )
            fid = str(created.get("id") or "")
            if not fid:
                raise ValueError("Drive create returned no id")
            self.drive.permissions().create(
                fileId=fid,
                body={"type": "anyone", "role": "reader"},
            ).execute()
        url = "https://lh3.googleusercontent.com/d/" + fid
        return {
            "id": fid,
            "name": created.get("name") or filename,
            "url": url,
            "mediaPath": "/api/media/" + fid,
        }

    def media_bytes(self, file_id: str) -> tuple[bytes, str]:
        if not self.drive:
            raise ValueError("Drive client not available")
        from googleapiclient.http import MediaIoBaseDownload

        fid = re.sub(r"[^a-zA-Z0-9_-]", "", str(file_id or ""))
        if not fid or fid != str(file_id or ""):
            raise ValueError("bad media id")
        with self._drive_lock:
            meta = (
                self.drive.files()
                .get(fileId=fid, fields="id,mimeType,name")
                .execute()
            )
            req = self.drive.files().get_media(fileId=fid)
            buf = io.BytesIO()
            downloader = MediaIoBaseDownload(buf, req)
            done = False
            while not done:
                _status, done = downloader.next_chunk()
        mime = str(meta.get("mimeType") or "application/octet-stream")
        return buf.getvalue(), mime

    @staticmethod
    def _a1_first_row(a1: str) -> int:
        m = re.search(r"!\$?[A-Za-z]+\$?(\d+)", str(a1 or ""))
        if m:
            return int(m.group(1))
        m = re.search(r"(\d+)", str(a1 or ""))
        return int(m.group(1)) if m else 0

    def write_item(self, body: dict, sheet_id: str | None = None) -> dict:
        """Append or update one Inventory row on a board or footer-box tab."""
        menu_id = str(body.get("menu") or body.get("menuId") or "").strip().lower()
        if menu_id in ("1", "2", "3"):
            menu_id = "board" + menu_id
        spec = _ITEM_MENUS_BY_ID.get(menu_id)
        if not spec:
            raise ValueError("unknown menu")
        name = str(body.get("item") or body.get("name") or "").strip()
        if not name:
            raise ValueError("missing item name")
        sid, source_name = self.resolve_catalog_sheet_id(sheet_id)
        gid = str(body.get("gid") or spec["gid"] or "").strip()
        title = self._tab_title_for_gid(sid, gid)
        safe_title = "'" + title.replace("'", "''") + "'"
        t0 = time.time()
        with self._api_lock:
            result = (
                self.sheets.spreadsheets()
                .values()
                .get(
                    spreadsheetId=sid,
                    range=safe_title + "!A1:Z200",
                    majorDimension="ROWS",
                    valueRenderOption="FORMATTED_VALUE",
                )
                .execute()
            )
        rows = result.get("values") or []
        _header_idx, data_start, headers = self._inventory_layout(rows)
        cols: dict[str, int] = {}
        for c, h in enumerate(headers):
            fold = self._header_fold(str(h or ""))
            if fold:
                cols[fold] = c
        kind = spec["kind"]
        width = max(len(headers), 9 if kind == "board" else 6)
        target_row = None
        raw_row = body.get("row") if "row" in body else body.get("rowIndex")
        if raw_row not in (None, ""):
            try:
                n = int(raw_row)
                if n >= data_start + 1:
                    target_row = n
            except (TypeError, ValueError):
                target_row = None
        if target_row:
            existing = list(rows[target_row - 1] or []) if target_row - 1 < len(rows) else []
            while len(existing) < width:
                existing.append("")
            row = existing
        else:
            row = [""] * width

        def put(value, *folds: str, default_col: int | None = None):
            if value is None:
                return
            s = str(value)
            for fold in folds:
                if fold in cols:
                    idx = cols[fold]
                    while len(row) <= idx:
                        row.append("")
                    row[idx] = s
                    return
            if default_col is not None:
                while len(row) <= default_col:
                    row.append("")
                row[default_col] = s

        image_cell = str(body.get("image") or "").strip()
        image_info: dict = {}
        raw_image = body.get("imageData") or body.get("imageBase64") or ""
        if raw_image:
            data, mime = _decode_image_payload(raw_image)
            stem = _item_stem(name, str(body.get("imageName") or ""))
            src_name = str(body.get("imageName") or stem)
            if not _hosted():
                image_info.update(
                    _save_food_image(data, spec["folder"], stem, src_name, mime)
                )
            drive_mime = mime if mime and mime != "application/octet-stream" else (
                mimetypes.guess_type(src_name)[0] or "image/jpeg"
            )
            drive_name = (image_info.get("filename") or (stem + _ext_for_mime(mime, src_name)))
            if self._drive_upload_folder_id():
                try:
                    uploaded = self.upload_drive_image(data, drive_name, drive_mime)
                    image_info["driveId"] = uploaded.get("id") or ""
                    image_info["driveUrl"] = uploaded.get("url") or ""
                    image_info["mediaPath"] = uploaded.get("mediaPath") or ""
                except Exception as e:
                    image_info["driveError"] = str(e)
                    _log(f"item image Drive upload skipped: {e}")
                    traceback.print_exc()
            else:
                image_info["driveError"] = "no TOKI_UPLOAD_FOLDER_ID"
            if image_info.get("driveUrl"):
                image_cell = image_info["driveUrl"]
            elif image_info.get("filename"):
                image_cell = image_info["filename"]
        write_image = bool(raw_image) or ("image" in body)
        if kind == "board":
            put(name, "item", default_col=0)
            put(
                _item_price_cell(body.get("price1") or body.get("price") or ""),
                "price1",
                "price",
                default_col=1,
            )
            put(_item_price_cell(body.get("price2") or ""), "price2", default_col=2)
            put(_item_price_cell(body.get("price3") or ""), "price3", default_col=3)
            put(str(body.get("subtitle") or "").strip(), "subtitle", "itemsubtitle", default_col=4)
            put(str(body.get("description") or "").strip(), "description", default_col=5)
            put(_item_bool01(body.get("isNew") or body.get("new"), "0"), "new", default_col=6)
            if write_image:
                put(image_cell, "image", default_col=7)
            put(_item_bool01(body.get("include"), "1"), "include", default_col=8)
        else:
            put(name, "item", default_col=0)
            put(str(body.get("subtitle") or "").strip(), "itemsubtitle", "subtitle", default_col=1)
            put(
                _item_price_cell(body.get("price1") or body.get("price") or ""),
                "itemprice",
                "price",
                "price1",
                default_col=2,
            )
            put(_item_bool01(body.get("isNew") or body.get("new"), "0"), "new", default_col=3)
            if write_image:
                put(image_cell, "image", default_col=4)
            put(_item_bool01(body.get("include"), "1"), "include", default_col=5)
        if not image_cell:
            img_idx = cols.get("image")
            if img_idx is not None and img_idx < len(row):
                image_cell = str(row[img_idx] or "").strip()
        if target_row:
            end_col = self._col_letters(max(len(row) - 1, 0))
            wrote_range = f"{safe_title}!A{target_row}:{end_col}{target_row}"
            with self._api_lock:
                updated = (
                    self.sheets.spreadsheets()
                    .values()
                    .update(
                        spreadsheetId=sid,
                        range=f"{safe_title}!A{target_row}",
                        valueInputOption="USER_ENTERED",
                        body={"values": [row]},
                    )
                    .execute()
                )
            wrote_range = str(updated.get("updatedRange") or wrote_range)
            excel_row = target_row
            action = "update"
        else:
            append_range = f"{safe_title}!A{data_start + 1}"
            with self._api_lock:
                updated = (
                    self.sheets.spreadsheets()
                    .values()
                    .append(
                        spreadsheetId=sid,
                        range=append_range,
                        valueInputOption="USER_ENTERED",
                        insertDataOption="INSERT_ROWS",
                        body={"values": [row]},
                    )
                    .execute()
                )
            updates = updated.get("updates") or updated
            wrote_range = str(updates.get("updatedRange") or "")
            excel_row = self._a1_first_row(wrote_range) or (data_start + 1)
            action = "append"
        _flush_data_caches()
        _log(
            f"item write {source_name or sid} menu={menu_id} gid={gid} "
            f"item={name!r} {action} row={excel_row} range={wrote_range} "
            f"drive={bool(image_info.get('driveId'))} ({time.time() - t0:.2f}s)"
        )
        return {
            "ok": True,
            "menu": menu_id,
            "label": spec["label"],
            "gid": gid,
            "tab": title,
            "item": name,
            "row": excel_row,
            "action": action,
            "range": wrote_range,
            "sheetId": sid,
            "sourceName": source_name,
            "image": image_info,
            "imageCell": image_cell,
            "page": spec.get("page") or "",
            "folder": spec["folder"],
        }


_SYS_LOCK = threading.Lock()
_SYS_CACHE: dict = {"at": 0.0, "data": None}
SYS_TTL = 2.5


def _ps_ax() -> str:
    try:
        r = subprocess.run(
            ["ps", "-axo", "pid=,command="],
            capture_output=True,
            text=True,
            timeout=2,
        )
        return r.stdout or ""
    except Exception:
        return ""


def _parse_swap(text: str) -> tuple[float, float]:
    tot = used = 0.0
    m = re.search(r"total\s*=\s*([\d.]+)\s*M", text, re.I)
    if m:
        tot = float(m.group(1))
    m = re.search(r"used\s*=\s*([\d.]+)\s*M", text, re.I)
    if m:
        used = float(m.group(1))
    return tot, used


def collect_sys_snapshot(port: int, bind: str, backend) -> dict:
    """Mac load / grok / sockets. Cached; never calls Google."""
    now = time.time()
    with _SYS_LOCK:
        hit = _SYS_CACHE.get("data")
        if hit and now - float(_SYS_CACHE.get("at") or 0) < SYS_TTL:
            return dict(hit)

    cpus = os.cpu_count() or 1
    try:
        load1, load5, load15 = os.getloadavg()
    except OSError:
        load1 = load5 = load15 = 0.0

    swap_tot = swap_used = 0.0
    try:
        sw = subprocess.run(
            ["sysctl", "vm.swapusage"],
            capture_output=True,
            text=True,
            timeout=1,
        )
        swap_tot, swap_used = _parse_swap(sw.stdout or "")
    except Exception:
        pass

    mem_mb = 0
    try:
        r = subprocess.run(
            ["sysctl", "-n", "hw.memsize"],
            capture_output=True,
            text=True,
            timeout=1,
        )
        mem_mb = int(int((r.stdout or "0").strip() or 0) / (1024 * 1024))
    except Exception:
        pass

    grok = 0
    grok_tickets = 0
    servers = 0
    server_pids: list[int] = []
    for line in _ps_ax().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) < 2:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        cmd = parts[1]
        if "toki_server.py" in cmd and "zsh" not in cmd:
            servers += 1
            server_pids.append(pid)
        if "listener.py" in cmd or "zsh -c" in cmd:
            continue
        if (
            "/usr/local/bin/grok " in cmd
            or cmd.strip() == "grok"
            or cmd.startswith("grok ")
        ):
            grok += 1
        if "toki-listener/tickets" in cmd and "run-grok" in cmd:
            grok_tickets += 1

    listen = established = close_wait = 0
    if server_pids:
        try:
            r = subprocess.run(
                [
                    "lsof",
                    "-nP",
                    "-p",
                    ",".join(str(p) for p in server_pids),
                    "-a",
                    "-iTCP",
                ],
                capture_output=True,
                text=True,
                timeout=2,
            )
            for ln in (r.stdout or "").splitlines():
                if "(LISTEN)" in ln:
                    listen += 1
                elif "(ESTABLISHED)" in ln:
                    established += 1
                elif "(CLOSE_WAIT)" in ln:
                    close_wait += 1
        except Exception:
            pass

    live = None
    if backend:
        with _settings_lock:
            cached = _settings_cache.get("data")
            if isinstance(cached, dict):
                live = dict(cached)

    hosted = _hosted()
    data = {
        "ok": True,
        "mac": not hosted,
        "hosted": hosted,
        "cpus": cpus,
        "load1": round(load1, 2),
        "load5": round(load5, 2),
        "load15": round(load15, 2),
        "swapTotalMb": round(swap_tot, 1),
        "swapUsedMb": round(swap_used, 1),
        "swapUsedPct": round((100.0 * swap_used / swap_tot), 1) if swap_tot else 0.0,
        "memTotalMb": mem_mb,
        "grok": grok,
        "grokTickets": grok_tickets,
        "servers": servers,
        "listen": listen,
        "established": established,
        "closeWait": close_wait,
        "sheetsApi": backend is not None,
        "dataSource": (live or {}).get("dataSource") or "",
        "port": port,
        "bind": bind,
        "pid": os.getpid(),
        "startedAt": int(_STARTED_AT),
        "canRestart": not hosted,
    }
    with _SYS_LOCK:
        _SYS_CACHE["at"] = time.time()
        _SYS_CACHE["data"] = data
    return dict(data)


def make_handler(
    api: dict, root: Path, bind: str = "127.0.0.1", api_only: bool = False
):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def _backend(self):
            return api.get("backend")

        def log_message(self, fmt, *args):
            # Quieter access log
            sys.stderr.write(
                "[toki_server] %s - %s\n" % (self.address_string(), fmt % args)
            )

        def end_headers(self):
            # Local operator pages (Deployer/Suite) must not stick in Chrome
            # app-mode cache. TVs are GitHub Pages, not this server.
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def _send(self, code: int, body: bytes, content_type: str):
            self.close_connection = True
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj: dict):
            body = json.dumps(obj).encode("utf-8")
            self._send(code, body, "application/json; charset=utf-8")

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.end_headers()

        def _read_json_body(self, max_bytes: int = 2_000_000):
            try:
                n = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                n = 0
            if n <= 0 or n > max_bytes:
                return None, {"error": "bad content-length"}
            raw = self.rfile.read(n)
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                return None, {"error": "invalid json"}
            if not isinstance(body, dict):
                return None, {"error": "expected object"}
            return body, None

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path == "/api/sys/restart":
                # Suite Health. Laptop only — never bounce Cloud Run.
                if api_only or _hosted():
                    self._json(404, {"error": "not found"})
                    return
                self._json(
                    200,
                    {
                        "ok": True,
                        "restarting": True,
                        "pid": os.getpid(),
                        "startedAt": int(_STARTED_AT),
                    },
                )
                os.environ["TOKI_RESTART_NOTIFY"] = "1"
                _schedule_reexec("restart requested from Suite — bouncing")
                return
            if parsed.path in ("/api/manager/theme", "/api/manager/style"):
                backend = self._backend()
                if not backend:
                    self._json(
                        503,
                        {
                            "error": "Sheets API not configured",
                            "hint": "Add secrets/google-service-account.json",
                        },
                    )
                    return
                body, err = self._read_json_body(16_384)
                if err:
                    self._json(400, err)
                    return
                sheet_id = str(body.get("sheetId") or "").strip()
                try:
                    result = backend.write_style(body, sheet_id or None)
                    self._json(200, result)
                except ValueError as e:
                    self._json(400, {"error": str(e)})
                except KeyError as e:
                    self._json(404, {"error": str(e)})
                except Exception as e:
                    _log(f"style write error: {e}")
                    traceback.print_exc()
                    self._json(500, {"error": str(e)})
                return
            if parsed.path in ("/api/manager/settings", "/api/manager/system"):
                backend = self._backend()
                if not backend:
                    self._json(
                        503,
                        {
                            "error": "Sheets API not configured",
                            "hint": "Add secrets/google-service-account.json",
                        },
                    )
                    return
                body, err = self._read_json_body(16_384)
                if err:
                    self._json(400, err)
                    return
                try:
                    result = backend.write_settings(body)
                    self._json(200, result)
                except ValueError as e:
                    self._json(400, {"error": str(e)})
                except KeyError as e:
                    self._json(404, {"error": str(e)})
                except Exception as e:
                    _log(f"settings write error: {e}")
                    traceback.print_exc()
                    self._json(500, {"error": str(e)})
                return
            if parsed.path == "/api/manager/board":
                backend = self._backend()
                if not backend:
                    self._json(
                        503,
                        {
                            "error": "Sheets API not configured",
                            "hint": "Add secrets/google-service-account.json",
                        },
                    )
                    return
                body, err = self._read_json_body(16_384)
                if err:
                    self._json(400, err)
                    return
                sheet_id = str(body.get("sheetId") or "").strip()
                try:
                    result = backend.write_board(body, sheet_id or None)
                    self._json(200, result)
                except ValueError as e:
                    self._json(400, {"error": str(e)})
                except KeyError as e:
                    self._json(404, {"error": str(e)})
                except Exception as e:
                    _log(f"board write error: {e}")
                    traceback.print_exc()
                    self._json(500, {"error": str(e)})
                return
            if parsed.path == "/api/manager/item":
                backend = self._backend()
                if not backend:
                    self._json(
                        503,
                        {
                            "error": "Sheets API not configured",
                            "hint": "Add secrets/google-service-account.json",
                        },
                    )
                    return
                body, err = self._read_json_body(12_000_000)
                if err:
                    self._json(400, err)
                    return
                sheet_id = str(body.get("sheetId") or "").strip()
                try:
                    result = backend.write_item(body, sheet_id or None)
                    self._json(200, result)
                except ValueError as e:
                    self._json(400, {"error": str(e)})
                except KeyError as e:
                    self._json(404, {"error": str(e)})
                except Exception as e:
                    _log(f"item write error: {e}")
                    traceback.print_exc()
                    self._json(500, {"error": str(e)})
                return
            if parsed.path == "/api/deploy":
                # Suite App / local Mac only. Cloud Run must not file ships.
                # gh lives in Homebrew; toki_deploy resolves the binary.
                if api_only or _hosted():
                    self._json(404, {"error": "not found"})
                    return
                body, err = self._read_json_body(16_384)
                if err:
                    self._json(400, err)
                    return
                try:
                    import toki_deploy

                    result = toki_deploy.file_deploy_issue(body or {})
                    # Dispatch the workflow explicitly from the local Mac so that
                    # "File deploy" in the UI reliably starts the ship/push without
                    # depending only on the GitHub issues event.
                    try:
                        import subprocess
                        f = body or {}
                        t = f.get("target") or "testing"
                        src = f.get("source") or "main"
                        sh = f.get("ship") or "both"
                        p = f.get("pin") or "auto"
                        dry = str(bool(f.get("dry"))).lower()
                        conf = str(bool(f.get("confirm") or f.get("confirm-restaurant"))).lower()
                        nt = f.get("notes") or ""
                        disp_args = [
                            "/usr/local/bin/gh", "workflow", "run", "deploy.yml",
                            "--ref", "main",
                            "-f", f"target={t}",
                            "-f", f"source={src}",
                            "-f", f"ship={sh}",
                            "-f", f"pin={p}",
                            "-f", f"dry_run={dry}",
                            "-f", f"confirm_restaurant={conf}",
                            "-f", f"notes={nt}",
                        ]
                        subprocess.run(disp_args, capture_output=True, text=True, timeout=20)
                        result["dispatched"] = True
                    except Exception as _de:
                        _log(f"deploy dispatch warning (push may rely on issue event): {_de}")
                    try:
                        f = body or {}
                        _watch_deploy_and_notify(
                            f.get("target") or "testing",
                            result.get("issueNumber"),
                            str(result.get("issueUrl") or ""),
                            bool(f.get("dry") or f.get("dry-run")),
                        )
                    except Exception as _ne:
                        _log(f"deploy notify: {_ne}")
                    self._json(200, result)
                except ValueError as e:
                    self._json(400, {"error": str(e)})
                except Exception as e:
                    _log(f"deploy file error: {e}")
                    self._json(503, {"error": str(e)})
                return
            if parsed.path != "/api/manager/fallback":
                self.send_error(404, "Not found")
                return
            if api_only:
                self._json(
                    501,
                    {"error": "fallback store is local-only"},
                )
                return
            body, err = self._read_json_body()
            if err:
                self._json(400, err)
                return
            sid = re.sub(
                r"[^a-z0-9-]+",
                "",
                str(body.get("sourceId") or "source").lower(),
            )[:40] or "source"
            keep = (
                "sourceId",
                "sourceName",
                "sheetId",
                "draft",
                "themes",
                "speedTiles",
                "colorRoles",
                "wallpapers",
                "fieldValidations",
                "dataSources",
                "motionStyles",
            )
            entry = {k: body.get(k) for k in keep}
            entry["sourceId"] = sid
            entry["savedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            dest = ROOT / "data" / "manager-fallback.json"
            dest.parent.mkdir(parents=True, exist_ok=True)
            store = {"updatedAt": entry["savedAt"], "active": sid, "sources": {}}
            if dest.is_file():
                try:
                    prev = json.loads(dest.read_text(encoding="utf-8"))
                    if isinstance(prev, dict) and isinstance(prev.get("sources"), dict):
                        store["sources"] = prev["sources"]
                except Exception:
                    pass
            store["sources"][sid] = entry
            store["updatedAt"] = entry["savedAt"]
            store["active"] = sid
            tmp = dest.with_name("manager-fallback.json.tmp")
            tmp.write_text(
                json.dumps(store, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            tmp.replace(dest)
            _log(f"fallback wrote {dest} source={sid}")
            self._json(200, {"ok": True, "path": "data/manager-fallback.json", "sourceId": sid})

        def do_GET(self):
            parsed = urlparse(self.path)
            path = parsed.path
            backend = self._backend()

            if path in ("/portal", "/portal/", "/local", "/local/"):
                self.send_response(302)
                self.send_header("Location", "/suite.html")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return

            if path == "/api/health":
                # Cache only — never wait on Google. Boards and Deployer treat a
                # hung health check as "API down"; a blocked handler leaves the
                # socket in CLOSE_WAIT until Sheets returns.
                live = None
                if backend:
                    with _settings_lock:
                        hit = _settings_cache.get("data")
                        if isinstance(hit, dict):
                            live = dict(hit)
                self._json(
                    200,
                    {
                        "ok": True,
                        "sheetsApi": backend is not None,
                        "itemUpdate": True,
                        "catalogSheetId": True,
                        "sheetId": backend.sheet_id if backend else None,
                        "dataSource": (live or {}).get("dataSource"),
                        "requireRestart": (live or {}).get("requireRestart"),
                        "root": str(ROOT),
                        "bind": bind,
                        "env": (os.environ.get("TOKI_ENV") or "local"),
                        "forcedSource": (live or {}).get("forcedSource")
                        or (os.environ.get("TOKI_FORCE_SOURCE") or ""),
                        "revision": os.environ.get("K_REVISION") or "",
                        "email": (
                            backend.creds.service_account_email
                            if backend
                            else None
                        ),
                    },
                )
                return

            if path == "/api/sys":
                try:
                    sys_port = int(self.server.server_address[1])
                except Exception:
                    sys_port = 0
                self._json(200, collect_sys_snapshot(sys_port, bind, backend))
                return

            if path == "/api/brightness":
                qs = parse_qs(parsed.query)
                target = (qs.get("target") or ["screen"])[0]
                action = (qs.get("action") or ["up"])[0]
                if target == "screen":
                    delta = 0.25 if action == "up" else -0.25
                    try:
                        result = subprocess.run(["/usr/local/bin/brightness", "-l"], capture_output=True, text=True, check=True)
                        current = 0.5
                        for line in result.stdout.splitlines():
                            if "brightness" in line.lower():
                                try:
                                    current = float(line.split()[-1])
                                    break
                                except:
                                    pass
                        new = max(0.0, min(1.0, current + delta))
                        subprocess.run(["/usr/local/bin/brightness", str(new)], check=True, capture_output=True)
                        self._json(200, {"status": "ok", "brightness": new})
                    except Exception as e:
                        self._json(500, {"status": "error", "message": str(e)})
                    return
                # keyboard uses key code
                keycodes = {"up": 97, "down": 96}
                keycode = keycodes.get(action)
                if keycode is None:
                    self._json(400, {"status": "error", "message": "bad action"})
                    return
                try:
                    subprocess.run(
                        ["osascript", "-e", f'tell application "System Events" to key code {keycode}'],
                        check=True, capture_output=True, text=True
                    )
                    self._json(200, {"status": "ok"})
                except Exception as e:
                    self._json(500, {"status": "error", "message": str(e)})
                return

            if path == "/api/manager/menus":
                if not backend:
                    self._json(
                        503,
                        {
                            "error": "Sheets API not configured",
                            "hint": "Add secrets/google-service-account.json",
                        },
                    )
                    return
                try:
                    self._json(200, backend.list_item_menus())
                except Exception as e:
                    _log(f"item menus error: {e}")
                    traceback.print_exc()
                    self._json(500, {"error": str(e)})
                return

            media_m = re.match(r"^/api/media/([A-Za-z0-9_-]+)$", path)
            if media_m:
                if not backend:
                    self._json(503, {"error": "Sheets API not configured"})
                    return
                try:
                    blob, mime = backend.media_bytes(media_m.group(1))
                    self._send(200, blob, mime or "application/octet-stream")
                except ValueError as e:
                    self._json(400, {"error": str(e)})
                except Exception as e:
                    _log(f"media fetch error: {e}")
                    traceback.print_exc()
                    self._json(404, {"error": "media not found"})
                return

            if path == "/api/settings":
                if not backend:
                    self._json(503, {"error": "Sheets API not configured"})
                    return
                qs = parse_qs(parsed.query)
                force = (qs.get("force") or ["0"])[0] in ("1", "true", "yes")
                try:
                    live = backend.apply_live_sheet(force_settings=force)
                    self._json(
                        200,
                        {
                            "dataSource": live.get("dataSource"),
                            "requireRestart": bool(live.get("requireRestart")),
                            "systemFont": live.get("systemFont") or "roboto",
                            "limitHeavyFilters": live.get("limitHeavyFilters")
                            if "limitHeavyFilters" in live
                            else True,
                            "confirmSave": live.get("confirmSave")
                            if "confirmSave" in live
                            else True,
                            "refreshTimer": live.get("refreshTimer") or "",
                            "debugMode": bool(live.get("debugMode")),
                            "debugFeatures": live.get("debugFeatures") or {},
                            "sheetId": backend.sheet_id,
                            "sourceName": live.get("sourceName"),
                            "sourceUrl": live.get("sourceUrl") or "",
                            "settingsSheetId": live.get("settingsSheetId"),
                            "resolvedFromCatalog": bool(
                                live.get("resolvedFromCatalog")
                            ),
                            "catalog": live.get("catalog") or [],
                            "catalogSettings": live.get("catalogSettings") or [],
                            "forcedSource": live.get("forcedSource") or "",
                            "env": os.environ.get("TOKI_ENV") or "local",
                        },
                    )
                except Exception as e:
                    _log(f"settings error: {e}")
                    traceback.print_exc()
                    self._json(500, {"error": str(e)})
                return

            if path == "/api/deploy":
                if api_only or _hosted():
                    self._json(404, {"error": "not found"})
                    return
                try:
                    import toki_deploy

                    self._json(200, toki_deploy.github_status())
                except Exception as e:
                    _log(f"deploy status error: {e}")
                    self._json(503, {"ok": False, "local": True, "error": str(e)})
                return

            if path == "/api/build":
                # Live git stamp for Show Version (Local / toki_server only).
                # Hash/date = HEAD; subject skips auto "chore: update build-info.js".
                info = {
                    "hash": "unknown",
                    "hashFull": "",
                    "date": "",
                    "subject": "",
                    "source": "api",
                }
                try:
                    import subprocess as _sp

                    r = _sp.run(
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
                    if r.returncode == 0:
                        lines = (r.stdout or "").strip().split("\n")
                        full, short, date, subj = (lines + ["", "", "", ""])[:4]
                        # Prefer last non-chore message (build-info auto-commits)
                        subj_r = _sp.run(
                            [
                                "git",
                                "-C",
                                str(root),
                                "log",
                                "-12",
                                "--format=%s",
                            ],
                            capture_output=True,
                            text=True,
                            check=False,
                        )
                        meaningful = subj or ""
                        if subj_r.returncode == 0:
                            for line in (subj_r.stdout or "").splitlines():
                                s = line.strip()
                                if not s:
                                    continue
                                if s.lower().startswith(
                                    "chore: update build-info"
                                ):
                                    continue
                                meaningful = s
                                break
                        info = {
                            "hash": short or "unknown",
                            "hashFull": full or "",
                            "date": date or "",
                            "subject": meaningful,
                            "source": "git",
                        }
                except Exception as e:
                    info["error"] = str(e)
                self._json(200, info)
                return

            if path == "/api/sheets/rev":
                if not backend:
                    self._json(
                        503,
                        {
                            "error": "Sheets API not configured",
                            "hint": "Add secrets/google-service-account.json",
                        },
                    )
                    return
                try:
                    backend.apply_live_sheet(force_settings=False)
                    rev = backend.public_rev()
                    self._json(
                        200,
                        {
                            "ok": True,
                            "sheetId": backend.sheet_id,
                            "rev": rev or "",
                        },
                    )
                except Exception as e:
                    _log(f"rev error: {e}")
                    self._json(500, {"error": str(e)})
                return

            if path == "/api/sheets/csv":
                if not backend:
                    self._json(
                        503,
                        {
                            "error": "Sheets API not configured",
                            "hint": "Add secrets/google-service-account.json",
                        },
                    )
                    return
                qs = parse_qs(parsed.query)
                gid = (qs.get("gid") or [None])[0]
                if gid is None or gid == "":
                    self._json(400, {"error": "missing gid"})
                    return
                force = (qs.get("force") or ["0"])[0] in ("1", "true", "yes")
                single = (qs.get("single") or ["0"])[0] in ("1", "true", "yes")
                req_sid = (qs.get("sheetId") or qs.get("spreadsheetId") or [""])[0]
                try:
                    if single:
                        text = backend.csv_for_gid_one(
                            str(gid), force=force, sheet_id=req_sid or None
                        )
                    else:
                        text = backend.csv_for_gid(
                            str(gid), force=force, sheet_id=req_sid or None
                        )
                    self._send(
                        200,
                        text.encode("utf-8"),
                        "text/csv; charset=utf-8",
                    )
                except BrokenPipeError:
                    # Client navigated away mid-response — not a server fault
                    return
                except Exception as e:
                    try:
                        _log(f"csv gid={gid} error: {e}")
                        traceback.print_exc()
                        self._json(500, {"error": str(e)})
                    except BrokenPipeError:
                        return
                return

            if path == "/api/sheets/xlsx":
                # Retired 2026-08-13 — boards are API-only (CSV/values).
                # Reconnect: deprecated/sheet-styles/README.md
                self._json(
                    410,
                    {
                        "error": "xlsx export retired",
                        "detail": (
                            "Live boards are API-only. Cell fills and rich "
                            "text live in deprecated/sheet-styles/."
                        ),
                    },
                )
                return

            if path == "/api/sheets/tabs":
                if not backend:
                    self._json(503, {"error": "Sheets API not configured"})
                    return
                try:
                    backend.apply_live_sheet(force_settings=True)
                    meta = backend.refresh_meta(force=True)
                    tabs = [
                        {"gid": g, "title": t}
                        for g, t in sorted(
                            meta["title_by_gid"].items(),
                            key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0,
                        )
                    ]
                    self._json(200, {"tabs": tabs})
                except Exception as e:
                    self._json(500, {"error": str(e)})
                return

            if path == "/api/sheets/validations":
                # Settings-row dataValidation rules keyed by header name.
                # Menu Manager uses this for number-pill bounds (not CSV).
                if not backend:
                    self._json(
                        503,
                        {
                            "error": "Sheets API not configured",
                            "hint": "Add secrets/google-service-account.json",
                        },
                    )
                    return
                qs = parse_qs(parsed.query)
                gid = (qs.get("gid") or [None])[0]
                if gid is None or gid == "":
                    self._json(400, {"error": "missing gid"})
                    return
                force = (qs.get("force") or ["0"])[0] in ("1", "true", "yes")
                try:
                    payload = backend.validations_for_settings_row(
                        str(gid), force=force
                    )
                    self._json(200, payload)
                except Exception as e:
                    _log(f"validations gid={gid} error: {e}")
                    traceback.print_exc()
                    self._json(500, {"error": str(e)})
                return

            # Static files — never on the hosted API (would leak the tree).
            if api_only:
                self._json(404, {"error": "not found"})
                return
            return SimpleHTTPRequestHandler.do_GET(self)

    return Handler


def _hosted() -> bool:
    return bool(os.environ.get("PORT") or os.environ.get("K_SERVICE"))


def _api_only_default() -> bool:
    raw = (os.environ.get("TOKI_API_ONLY") or "").strip().lower()
    if raw in ("0", "false", "no"):
        return False
    if raw in ("1", "true", "yes"):
        return True
    return bool(os.environ.get("K_SERVICE"))


def main():
    ap = argparse.ArgumentParser(description="TokiMenu static + Sheets API server")
    default_port = int(os.environ.get("PORT") or os.environ.get("TOKI_PORT") or "8765")
    default_bind = os.environ.get("TOKI_BIND") or (
        "0.0.0.0" if _hosted() else "127.0.0.1"
    )
    ap.add_argument("--port", type=int, default=default_port)
    ap.add_argument(
        "--bind",
        default=default_bind,
        help="Bind address (default 127.0.0.1; 0.0.0.0 when hosted)",
    )
    ap.add_argument(
        "--sheet-id",
        default=os.environ.get("TOKI_SHEET_ID", DEFAULT_SHEET_ID),
        help="Fallback menu workbook if Settings is missing or unreadable",
    )
    ap.add_argument(
        "--settings-sheet-id",
        default=os.environ.get("TOKI_SETTINGS_SHEET_ID", DEFAULT_SETTINGS_SHEET_ID),
        help="OliToki Menu Settings workbook (Data Source + Require Restart)",
    )
    ap.add_argument(
        "--key",
        type=Path,
        default=Path(os.environ.get("TOKI_SA_KEY", str(DEFAULT_KEY))),
    )
    ap.add_argument(
        "--no-api",
        action="store_true",
        help="Static files only (no Sheets proxy)",
    )
    ap.add_argument(
        "--api-only",
        action="store_true",
        default=_api_only_default(),
        help="API only (no static files). Default on Cloud Run unless TOKI_API_ONLY=0.",
    )
    args = ap.parse_args()

    os.chdir(ROOT)
    api: dict = {"backend": None}

    def _resolve_key(key_path: Path) -> Path:
        if key_path.is_file():
            return key_path
        sibling = (
            Path.home()
            / "Library/CloudStorage/Dropbox/2026/8/TokiMenu/secrets"
            / "google-service-account.json"
        )
        if sibling.is_file():
            _log(f"no key at {key_path}; using {sibling}")
            return sibling
        return key_path

    def _attach_backend() -> object | None:
        """Load the robot key and publish backend immediately.

        Warmup failures must not drop the backend — that is how testing
        stayed sheetsApi:false until the next Deployer push.
        """
        if args.no_api:
            _log("Sheets API disabled (--no-api)")
            return None
        backend = SheetsBackend(
            args.sheet_id,
            _resolve_key(args.key),
            settings_sheet_id=args.settings_sheet_id,
        )
        api["backend"] = backend
        _log("Sheets API attached (writes + reads on)")
        return backend

    def _warmup(backend) -> None:
        if not backend:
            return
        try:
            tabs = backend.refresh_meta(force=True)
            _log(f"tabs: {len(tabs['title_by_gid'])}")
            _log(
                "Sheets API proxy: /api/sheets/csv?gid=…  "
                "POST /api/manager/style  (/api/sheets/xlsx → 410)"
            )
            # Hosted lazy-loads tabs. Full workbook warm on Cloud Run
            # testing was ~20 reads and blew the 60/min quota on cold start.
            if not args.api_only and not _hosted():
                t0 = time.time()
                backend.warm_csv_cache(force=True)
                _log(f"startup csv warm done in {time.time() - t0:.2f}s")
            live = backend.refresh_settings(force=False)
            src = (live or {}).get("dataSource") or ""
            set_terminal_title(window_title(args.port, args.bind, src))
        except Exception as e:
            _log(f"WARNING: Sheets warmup failed (API stays on): {e}")
            traceback.print_exc()

    def _init_sheets() -> None:
        delay = 1.0
        while True:
            if api.get("backend") is not None:
                _warmup(api["backend"])
                return
            try:
                backend = _attach_backend()
                _warmup(backend)
                return
            except SystemExit as e:
                _log(f"WARNING: Sheets API unavailable: {e}")
            except Exception as e:
                _log(f"WARNING: Sheets API init failed: {e}")
                traceback.print_exc()
            _log(f"retrying Sheets attach in {delay:.1f}s (key is local; no git push)")
            time.sleep(delay)
            delay = min(delay * 1.6, 20.0)

    def _init_in_background() -> None:
        threading.Thread(target=_init_sheets, name="sheets-init", daemon=True).start()

    # Hosted: attach the key before listen so /api/health is never
    # sheetsApi:false on a live process. Local: bind first so the
    # launcher health-check does not time out, then attach.
    if _hosted() and not args.no_api:
        delay = 0.5
        while api.get("backend") is None:
            try:
                _attach_backend()
            except Exception as e:
                _log(f"WARNING: hosted Sheets attach: {e}")
                time.sleep(delay)
                delay = min(delay * 1.6, 8.0)
        _init_in_background()
    httpd = ThreadingHTTPServer(
        (args.bind, args.port),
        make_handler(api, ROOT, bind=args.bind, api_only=bool(args.api_only)),
    )
    set_terminal_title(window_title(args.port, args.bind))
    _log(f"serving {ROOT} on http://{args.bind}:{args.port}/")
    _log(f"window: {window_title(args.port, args.bind)}")
    _watch_api_and_reexec()
    if not _hosted() and not args.no_api:
        _init_in_background()
    if str(os.environ.pop("TOKI_RESTART_NOTIFY", "")).strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        _mac_notify(
            "Local server restarted.",
            "",
            subtitle="Health",
            open_url="http://127.0.0.1:8765/suite.html",
            tag="suite.health.restart",
        )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        _log("shutdown")
        httpd.shutdown()


if __name__ == "__main__":
    main()

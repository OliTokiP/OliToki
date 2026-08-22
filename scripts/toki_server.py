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
import csv
import io
import json
import mimetypes
import os
import re
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
]
STYLE_THEME_GID = "183083022"
# OliToki Menu Settings → Debugger tab (master Debug Mode in A2).
DEBUGGER_GID = "195166367"
DEBUGGER_TAB = "Debugger"
_SHEET_ID_IN_URL = re.compile(r"/spreadsheets/d/([a-zA-Z0-9-_]+)")
_BARE_SHEET_ID = re.compile(r"^[a-zA-Z0-9-_]{30,}$")

# Cache: avoid hammering Google on every soft reload / multi-board open.
# googleapiclient is serialized under _api_lock — without CSV cache, 8 parallel
# board fetches become 8 sequential Google round-trips (20–45s each when slow).
_meta_lock = threading.Lock()
_meta_cache = {"at": 0, "title_by_gid": {}, "gid_by_title": {}}
_csv_lock = threading.Lock()
# gid -> {"at": float, "text": str}
_csv_cache: dict[str, dict] = {}
# Drive modifiedTime/version of the catalog workbook the CSV cache was built from.
_csv_book_rev: str = ""
_csv_book_sid: str = ""
# Single-flight for full-workbook batchGet (all tabs in one Google round-trip)
_csv_batch_event: threading.Event | None = None
_csv_batch_error: BaseException | None = None
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


def _mac_notify(title: str, message: str) -> None:
    """Local Notification Center ping. No-op on Cloud Run."""
    if _hosted():
        return

    def go() -> None:
        try:
            def esc(s: str) -> str:
                return s.replace("\\", "\\\\").replace('"', '\\"')

            subprocess.run(
                [
                    "osascript",
                    "-e",
                    f'display notification "{esc(message)}" with title "{esc(title)}"',
                ],
                check=False,
                capture_output=True,
                timeout=5,
            )
        except Exception:
            pass

    threading.Thread(target=go, name="mac-notify", daemon=True).start()


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


def parse_debug_menu_rows(rows: list) -> dict:
    """
    Settings workbook → Debugger (gid 195166367):
      A1 Debug Mode
      A2 TRUE/FALSE
      then Debug Features header + values row
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
    Settings tab:
      A1 Data Source | B1 Require restart to update?
      A2 Alpha Copy / Restaurant Copy | B2 checkbox
      A6 Gsheet name | B6 Gsheet URL
      A7+ catalog rows
    """
    data_source = ""
    require_restart = False
    system_font = "roboto"
    limit_heavy_filters = True
    confirm_save = True
    refresh_timer = ""
    catalog: list[dict] = []

    header_idx = None
    catalog_idx = None
    for i, row in enumerate(rows or []):
        a = _cell(row, 0).lower()
        b = _cell(row, 1).lower()
        if header_idx is None and a == "data source":
            header_idx = i
        if catalog_idx is None and "gsheet" in (a + " " + b) and "url" in (a + " " + b):
            catalog_idx = i

    if header_idx is not None and header_idx + 1 < len(rows):
        data_source = _cell(rows[header_idx + 1], 0)
        require_restart = _parse_yes(_cell(rows[header_idx + 1], 1), False)
        header = rows[header_idx] or []
        for c, cell in enumerate(header):
            label = str(cell or "").strip().lower()
            if "system font" in label:
                raw = _cell(rows[header_idx + 1], c).lower()
                if "poppin" in raw:
                    system_font = "poppins"
                elif "roboto" in raw:
                    system_font = "roboto"
            if _is_heavy_filter_header(label):
                limit_heavy_filters = _parse_yes(
                    _cell(rows[header_idx + 1], c), True
                )
            if "confirm" in label and "save" in label:
                confirm_save = _parse_yes(_cell(rows[header_idx + 1], c), True)
            if "refresh timer" in label:
                cand = _cell(rows[header_idx + 1], c)
                if _is_timer_value(cand):
                    refresh_timer = cand
        if not refresh_timer and header_idx is not None:
            data_row = rows[header_idx + 1] if header_idx + 1 < len(rows) else []
            for c in range(len(data_row or [])):
                cand = _cell(data_row, c)
                if _is_timer_value(cand):
                    refresh_timer = cand
                    break

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

    key = data_source.lower()
    match = None
    if key:
        for c in catalog:
            if (c.get("name") or "").strip().lower() == key:
                match = c
                break
        if match is None:
            for c in catalog:
                n = (c.get("name") or "").strip().lower()
                if n and (key in n or n in key):
                    match = c
                    break

    sheet_id = (match and match.get("sheetId")) or fallback_sheet_id
    data = {
        "dataSource": data_source or "Alpha Copy",
        "requireRestart": require_restart,
        "systemFont": system_font,
        "limitHeavyFilters": bool(limit_heavy_filters),
        "confirmSave": bool(confirm_save),
        "refreshTimer": clamp_refresh_timer(refresh_timer),
        "sheetId": sheet_id,
        "sourceName": (match or {}).get("name") or "",
        "sourceUrl": (match or {}).get("url") or "",
        "catalog": catalog,
        "resolvedFromCatalog": bool(match and match.get("sheetId")),
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
    with _meta_lock:
        _meta_cache["at"] = 0
        _meta_cache["title_by_gid"] = {}
        _meta_cache["gid_by_title"] = {}
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
            data.update(parse_debug_menu_rows(self._debugger_rows()))
        except Exception as e:
            _log(f"Debugger tab read failed ({e})")
            data.setdefault("debugMode", False)
            data.setdefault("debugFeatures", {})
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
        for i, row in enumerate(rows or []):
            if _cell(row, 0).lower() == "data source":
                header_idx = i
                break
        if header_idx is None:
            raise KeyError("Settings header row not found")
        data_idx = header_idx + 1
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

        # === System Settings contract (Menu Manager) ===
        # All user-accessible settings toggles/options shown in Menu Manager
        # (dataSource, requireRestart, systemFont, limitHeavyFilters, confirmSave,
        # refreshTimer, debugMode, and future ones) live in the "OliToki Menu Settings"
        # workbook. Most map to the Settings tab (first data row after the header).
        # Debug Mode is Debugger!A2 (gid 195166367) — not a Settings-tab column.
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
        force = (os.environ.get("TOKI_FORCE_SOURCE") or "").strip().lower()
        if not force:
            env = (os.environ.get("TOKI_ENV") or "").strip().lower()
            if env == "restaurant":
                force = "restaurant"
            elif env == "testing":
                force = "alpha"

        if "dataSource" in body and body.get("dataSource") not in (None, ""):
            # Manager Data Source is which catalog you are editing. TVs stay
            # on Settings A2 (Restaurant) unless a board URL has ?beta.
            _log("settings write: skip dataSource (A2 is TV pointer, not Manager editor)")

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
                a1("confirmsave", default_col=4),
                yn(body.get("confirmSave"), True),
            )
        if "refreshTimer" in body and body.get("refreshTimer") not in (None, ""):
            values["refreshtimer"] = (
                a1("refreshtimer", default_col=5),
                clamp_refresh_timer(str(body.get("refreshTimer")).strip()),
            )
        if "debugMode" in body and body.get("debugMode") not in (None, ""):
            tab = self._debugger_tab_title()
            quoted = "'" + tab.replace("'", "''") + "'!A2"
            values["debugmode"] = (
                quoted,
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
            f"settings write {sid} { {k: v[1] for k, v in values.items()} } "
            f"cells={updated.get('totalUpdatedCells')} ({time.time() - t0:.2f}s)"
        )
        return {
            "ok": True,
            "settingsSheetId": sid,
            "wrote": {k: v[1] for k, v in values.items()},
            "skippedDataSource": bool("dataSource" in body),
        }

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

    def csv_for_gid(self, gid: str, force: bool = False) -> str:
        """
        Fetch sheet values by gid.
        force=True (menu hard/soft refresh): re-batchGet unless coalesce window.
        force=False: serve CSV_TTL cache when warm.
        """
        gid = str(gid)
        now = time.time()
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

    def _inventory_data(self, rows: list):
        inv_label = -1
        for i, row in enumerate(rows or []):
            a = _cell(row, 0).strip().lower()
            if a == "inventory" or a.startswith("inventory"):
                inv_label = i
                break
        if inv_label < 0 or inv_label + 2 > len(rows or []):
            raise ValueError("no inventory block")
        header_idx = inv_label + 1
        data_start = header_idx + 1
        headers = list((rows[header_idx] if header_idx < len(rows) else []) or [])
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
                        text = backend.csv_for_gid(str(gid), force=force)
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
        _mac_notify("Toki Menu", "Local server restarted.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        _log("shutdown")
        httpd.shutdown()


if __name__ == "__main__":
    main()

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
  TOKI_PORT       port (default 8765)
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import mimetypes
import os
import re
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_KEY = ROOT / "secrets" / "google-service-account.json"
DEFAULT_SHEET_ID = "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10"
DEFAULT_SETTINGS_SHEET_ID = "1OwNKHzjP46xKJBW8sTm4IOWhIzf0lENdZ8rv_GY37fY"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]
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
# Single-flight for full-workbook batchGet (all tabs in one Google round-trip)
_csv_batch_event: threading.Event | None = None
_csv_batch_error: BaseException | None = None
META_TTL = 120.0
# Opportunistic cache only (non-force). Menu loads pass force=1 for live sheet edits.
CSV_TTL = 90.0
# Concurrent boards all force-refresh in the same second → one batchGet, not four.
CSV_FORCE_COALESCE_S = 2.5
_settings_lock = threading.Lock()
_settings_cache: dict = {"at": 0.0, "data": None}
SETTINGS_TTL = 15.0


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


def _cell(row: list, idx: int) -> str:
    if not row or idx < 0 or idx >= len(row):
        return ""
    v = row[idx]
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    return str(v).strip()


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
            if "system font" in str(cell or "").strip().lower():
                raw = _cell(rows[header_idx + 1], c).lower()
                if "poppin" in raw:
                    system_font = "poppins"
                elif "roboto" in raw:
                    system_font = "roboto"
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
    return {
        "dataSource": data_source or "Alpha Copy",
        "requireRestart": require_restart,
        "systemFont": system_font,
        "sheetId": sheet_id,
        "sourceName": (match or {}).get("name") or "",
        "sourceUrl": (match or {}).get("url") or "",
        "catalog": catalog,
        "resolvedFromCatalog": bool(match and match.get("sheetId")),
    }


def _flush_data_caches() -> None:
    global _csv_batch_event, _csv_batch_error
    with _csv_lock:
        _csv_cache.clear()
        _csv_batch_event = None
        _csv_batch_error = None
    with _meta_lock:
        _meta_cache["at"] = 0
        _meta_cache["title_by_gid"] = {}
        _meta_cache["gid_by_title"] = {}


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

    if not key_path.is_file():
        raise SystemExit(
            f"Service account key not found:\n  {key_path}\n"
            "See scripts/gsheet_api.md"
        )

    creds = service_account.Credentials.from_service_account_file(
        str(key_path), scopes=SCOPES
    )
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return creds, sheets


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
        self.creds, self.sheets = _load_creds(key_path)
        # googleapiclient is not reliably thread-safe — serialize API calls
        self._api_lock = threading.Lock()
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
        with _settings_lock:
            _settings_cache["at"] = time.time()
            _settings_cache["data"] = data
        return dict(data)

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

    def warm_csv_cache(self, force: bool = False) -> None:
        """
        Load *all* spreadsheet tabs into the CSV cache with one values.batchGet.

        force=True: always re-fetch from Google unless a force-fill completed in the
        last CSV_FORCE_COALESCE_S seconds (multi-board open / parallel requests).
        force=False: only fill missing/stale entries (TTL).
        """
        global _csv_batch_event, _csv_batch_error
        now = time.time()
        meta = self.refresh_meta(force=False)
        title_by_gid = meta["title_by_gid"]

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
            with _csv_lock:
                for i, (g, title) in enumerate(need):
                    vr = value_ranges[i] if i < len(value_ranges) else {}
                    values = vr.get("values") or []
                    text = self._values_to_csv(values)
                    _csv_cache[g] = {"at": now, "text": text}
                    filled += 1
            _log(
                f"csv batchGet force={force} tabs={filled}/{len(need)} "
                f"fetch={time.time() - t0:.2f}s"
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
        self.apply_live_sheet(force_settings=force)

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

    def csv_for_gid_one(self, gid: str, force: bool = False) -> str:
        """One tab only. Does not batchGet the rest of the workbook."""
        gid = str(gid)
        now = time.time()
        self.apply_live_sheet(force_settings=force)
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


def make_handler(api: dict, root: Path, bind: str = "127.0.0.1"):
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

        def _send(self, code: int, body: bytes, content_type: str):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
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

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path != "/api/manager/fallback":
                self.send_error(404, "Not found")
                return
            try:
                n = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                n = 0
            if n <= 0 or n > 2_000_000:
                self._json(400, {"error": "bad content-length"})
                return
            raw = self.rfile.read(n)
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                self._json(400, {"error": "invalid json"})
                return
            if not isinstance(body, dict):
                self._json(400, {"error": "expected object"})
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

            if path == "/api/health":
                live = None
                if backend:
                    try:
                        live = backend.refresh_settings(force=False)
                    except Exception:
                        live = None
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
                        "email": (
                            backend.creds.service_account_email
                            if backend
                            else None
                        ),
                    },
                )
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
                            "sheetId": backend.sheet_id,
                            "sourceName": live.get("sourceName"),
                            "sourceUrl": live.get("sourceUrl") or "",
                            "settingsSheetId": live.get("settingsSheetId"),
                            "resolvedFromCatalog": bool(
                                live.get("resolvedFromCatalog")
                            ),
                            "catalog": live.get("catalog") or [],
                        },
                    )
                except Exception as e:
                    _log(f"settings error: {e}")
                    traceback.print_exc()
                    self._json(500, {"error": str(e)})
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
                try:
                    if single:
                        text = backend.csv_for_gid_one(str(gid), force=force)
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

            # Static files
            return SimpleHTTPRequestHandler.do_GET(self)

    return Handler


def main():
    ap = argparse.ArgumentParser(description="TokiMenu static + Sheets API server")
    ap.add_argument("--port", type=int, default=int(os.environ.get("TOKI_PORT", "8765")))
    ap.add_argument(
        "--bind",
        default=os.environ.get("TOKI_BIND", "127.0.0.1"),
        help="Bind address (default 127.0.0.1)",
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

    def _init_sheets() -> None:
        if args.no_api:
            _log("Sheets API disabled (--no-api)")
            return
        try:
            backend = SheetsBackend(
                args.sheet_id,
                _resolve_key(args.key),
                settings_sheet_id=args.settings_sheet_id,
            )
            tabs = backend.refresh_meta(force=True)
            api["backend"] = backend
            _log(f"tabs: {len(tabs['title_by_gid'])}")
            _log("Sheets API proxy: /api/sheets/csv?gid=…  (/api/sheets/xlsx → 410)")
            t0 = time.time()
            backend.warm_csv_cache(force=True)
            _log(f"startup csv warm done in {time.time() - t0:.2f}s")
            live = backend.refresh_settings(force=False)
            src = (live or {}).get("dataSource") or ""
            set_terminal_title(window_title(args.port, args.bind, src))
        except SystemExit as e:
            _log(f"WARNING: Sheets API unavailable: {e}")
            _log("Serving static files only (Menu Manager still works).")
        except Exception as e:
            _log(f"WARNING: Sheets API init failed: {e}")
            _log("Serving static files only; boards need public sheet or fix credentials.")
            traceback.print_exc()

    # Bind first so the launcher health-check does not time out while Google loads.
    httpd = ThreadingHTTPServer(
        (args.bind, args.port), make_handler(api, ROOT, bind=args.bind)
    )
    set_terminal_title(window_title(args.port, args.bind))
    _log(f"serving {ROOT} on http://{args.bind}:{args.port}/")
    _log(f"window: {window_title(args.port, args.bind)}")
    threading.Thread(target=_init_sheets, name="sheets-init", daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        _log("shutdown")
        httpd.shutdown()


if __name__ == "__main__":
    main()

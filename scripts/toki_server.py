#!/usr/bin/env python3
"""
TokiMenu local server: static files + Google Sheets API proxy.

Boards fetch /api/sheets/csv and /api/sheets/xlsx so the spreadsheet can stay
private (no "Anyone with the link"). The service account key never goes to the
browser — only this process holds secrets/google-service-account.json.

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
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

# Cache: avoid hammering Google on every soft reload
_meta_lock = threading.Lock()
_meta_cache = {"at": 0, "title_by_gid": {}, "gid_by_title": {}}
_xlsx_lock = threading.Lock()
_xlsx_cache = {"at": 0, "bytes": None}
META_TTL = 120.0
XLSX_TTL = 90.0


def _log(msg: str) -> None:
    print(f"[toki_server] {msg}", flush=True)


def _load_creds(key_path: Path):
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaIoBaseDownload
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
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    return creds, sheets, drive, MediaIoBaseDownload


class SheetsBackend:
    def __init__(self, sheet_id: str, key_path: Path):
        self.sheet_id = sheet_id
        self.key_path = key_path
        self.creds, self.sheets, self.drive, self.MediaIoBaseDownload = _load_creds(
            key_path
        )
        # googleapiclient is not reliably thread-safe — serialize API calls
        self._api_lock = threading.Lock()
        _log(f"API ready as {self.creds.service_account_email}")
        _log(f"spreadsheet={sheet_id}")

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

    def csv_for_gid(self, gid: str) -> str:
        """Fetch sheet values by gid. Retries once with fresh meta if tab was renamed."""
        last_err = None
        for attempt in (0, 1):
            title = self.title_for_gid(gid) if attempt == 0 else (
                self.refresh_meta(force=True)["title_by_gid"].get(str(gid))
            )
            if not title:
                raise KeyError(f"No sheet with gid={gid}")
            safe = "'" + title.replace("'", "''") + "'"
            try:
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
                values = result.get("values", [])
                buf = io.StringIO()
                writer = csv.writer(buf, lineterminator="\n")
                for row in values:
                    writer.writerow(row)
                return buf.getvalue()
            except Exception as e:
                last_err = e
                # Stale title after rename — force meta refresh and retry once
                if attempt == 0:
                    _log(f"csv gid={gid} title={title!r} failed, refreshing meta: {e}")
                    continue
                raise
        raise last_err  # pragma: no cover

    def xlsx_bytes(self, force: bool = False) -> bytes:
        now = time.time()
        with _xlsx_lock:
            if (
                not force
                and _xlsx_cache["bytes"] is not None
                and now - _xlsx_cache["at"] < XLSX_TTL
            ):
                return _xlsx_cache["bytes"]

        # Drive export → .xlsx (needs Drive API enabled + sheet shared with SA)
        with self._api_lock:
            request = self.drive.files().export_media(
                fileId=self.sheet_id,
                mimeType=(
                    "application/vnd.openxmlformats-officedocument"
                    ".spreadsheetml.sheet"
                ),
            )
            fh = io.BytesIO()
            downloader = self.MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _status, done = downloader.next_chunk()
            data = fh.getvalue()
        if len(data) < 100 or data[:2] != b"PK":
            raise RuntimeError(
                "Drive export did not return xlsx. "
                "Enable Google Drive API and ensure the sheet is shared "
                "with the service account."
            )
        with _xlsx_lock:
            _xlsx_cache["at"] = time.time()
            _xlsx_cache["bytes"] = data
        return data


def make_handler(backend: SheetsBackend | None, root: Path):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

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
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.end_headers()

        def do_GET(self):
            parsed = urlparse(self.path)
            path = parsed.path

            if path == "/api/health":
                self._json(
                    200,
                    {
                        "ok": True,
                        "sheetsApi": backend is not None,
                        "sheetId": backend.sheet_id if backend else None,
                        "email": (
                            backend.creds.service_account_email
                            if backend
                            else None
                        ),
                    },
                )
                return

            if path == "/api/build":
                # Live git stamp for Show Version (Local / toki_server only)
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
                        info = {
                            "hash": short or "unknown",
                            "hashFull": full or "",
                            "date": date or "",
                            "subject": subj or "",
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
                try:
                    text = backend.csv_for_gid(str(gid))
                    self._send(
                        200,
                        text.encode("utf-8"),
                        "text/csv; charset=utf-8",
                    )
                except Exception as e:
                    _log(f"csv gid={gid} error: {e}")
                    traceback.print_exc()
                    self._json(500, {"error": str(e)})
                return

            if path == "/api/sheets/xlsx":
                if not backend:
                    self._json(
                        503,
                        {"error": "Sheets API not configured"},
                    )
                    return
                qs = parse_qs(parsed.query)
                force = (qs.get("force") or ["0"])[0] in ("1", "true", "yes")
                try:
                    data = backend.xlsx_bytes(force=force)
                    self._send(
                        200,
                        data,
                        "application/vnd.openxmlformats-officedocument"
                        ".spreadsheetml.sheet",
                    )
                except Exception as e:
                    _log(f"xlsx error: {e}")
                    traceback.print_exc()
                    self._json(500, {"error": str(e)})
                return

            if path == "/api/sheets/tabs":
                if not backend:
                    self._json(503, {"error": "Sheets API not configured"})
                    return
                try:
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
    backend = None
    if not args.no_api:
        try:
            backend = SheetsBackend(args.sheet_id, args.key)
            # Smoke: list tabs once at startup
            tabs = backend.refresh_meta(force=True)
            _log(f"tabs: {len(tabs['title_by_gid'])}")
        except SystemExit:
            raise
        except Exception as e:
            _log(f"WARNING: Sheets API init failed: {e}")
            _log("Serving static files only; boards need public sheet or fix credentials.")
            traceback.print_exc()
            backend = None

    handler = make_handler(backend, ROOT)
    httpd = ThreadingHTTPServer((args.bind, args.port), handler)
    _log(f"serving {ROOT} on http://{args.bind}:{args.port}/")
    if backend:
        _log("Sheets API proxy: /api/sheets/csv?gid=…  /api/sheets/xlsx")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        _log("shutdown")
        httpd.shutdown()


if __name__ == "__main__":
    main()

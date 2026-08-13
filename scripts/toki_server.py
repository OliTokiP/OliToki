#!/usr/bin/env python3
"""
TokiMenu local server: static files + Google Sheets API proxy.

Boards fetch /api/sheets/csv so the spreadsheet can stay private (no
"Anyone with the link"). Drive xlsx export is retired (410 on
/api/sheets/xlsx). The service account key never goes to the browser —
only this process holds secrets/google-service-account.json.

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
]

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


def _log(msg: str) -> None:
    print(f"[toki_server] {msg}", flush=True)


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
    def __init__(self, sheet_id: str, key_path: Path):
        self.sheet_id = sheet_id
        self.key_path = key_path
        self.creds, self.sheets = _load_creds(key_path)
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
                try:
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
        _log("Sheets API proxy: /api/sheets/csv?gid=…  (/api/sheets/xlsx → 410)")
        # Warm CSV cache in background so first board open isn't 8× Google latency
        def _bg_warm() -> None:
            try:
                t0 = time.time()
                backend.warm_csv_cache(force=True)
                _log(f"startup csv warm done in {time.time() - t0:.2f}s")
            except Exception as e:
                _log(f"startup csv warm failed: {e}")

        threading.Thread(target=_bg_warm, name="csv-warm", daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        _log("shutdown")
        httpd.shutdown()


if __name__ == "__main__":
    main()

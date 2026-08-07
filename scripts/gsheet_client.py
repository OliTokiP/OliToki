#!/usr/bin/env python3
"""
Minimal Google Sheets API helper for TokiMenu.

Setup: see scripts/gsheet_api.md
Key path (default): secrets/google-service-account.json

Examples:
  python3 scripts/gsheet_client.py whoami
  python3 scripts/gsheet_client.py tabs
  python3 scripts/gsheet_client.py get "Sauces!A1:F5"
  python3 scripts/gsheet_client.py set "Sauces!E2" "No"
  python3 scripts/gsheet_client.py set-range "Sauces!A2:B2" '[["Sauces",""]]'
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Project root = parent of scripts/
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_KEY = ROOT / "secrets" / "google-service-account.json"
DEFAULT_SHEET_ID = "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10"

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _load_creds(key_path: Path):
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError:
        print(
            "Missing packages. Install once:\n"
            "  python3 -m pip install --user google-api-python-client google-auth",
            file=sys.stderr,
        )
        sys.exit(1)

    if not key_path.is_file():
        print(
            f"Service account key not found:\n  {key_path}\n\n"
            "Follow scripts/gsheet_api.md (download JSON → secrets/google-service-account.json).",
            file=sys.stderr,
        )
        sys.exit(1)

    creds = service_account.Credentials.from_service_account_file(
        str(key_path), scopes=SCOPES
    )
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return creds, service


def cmd_tabs(_creds, service, args):
    meta = (
        service.spreadsheets()
        .get(spreadsheetId=args.sheet_id, fields="sheets.properties")
        .execute()
    )
    for sh in meta.get("sheets", []):
        p = sh.get("properties", {})
        print(
            f"gid={p.get('sheetId')}\t{p.get('title')}\t"
            f"rows={p.get('gridProperties', {}).get('rowCount')}"
        )


def cmd_get(_creds, service, args):
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=args.sheet_id, range=args.range)
        .execute()
    )
    values = result.get("values", [])
    if args.json:
        print(json.dumps(values, indent=2, ensure_ascii=False))
    else:
        for row in values:
            print("\t".join(str(c) for c in row))
        if not values:
            print("(empty range)")


def cmd_set(_creds, service, args):
    body = {"values": [[args.value]]}
    result = (
        service.spreadsheets()
        .values()
        .update(
            spreadsheetId=args.sheet_id,
            range=args.range,
            valueInputOption="USER_ENTERED",
            body=body,
        )
        .execute()
    )
    print("updated:", result.get("updatedRange"), "cells:", result.get("updatedCells"))


def cmd_set_range(_creds, service, args):
    try:
        rows = json.loads(args.json_rows)
    except json.JSONDecodeError as e:
        print("Invalid JSON for rows:", e, file=sys.stderr)
        sys.exit(1)
    if not isinstance(rows, list):
        print("JSON must be a list of rows (list of lists).", file=sys.stderr)
        sys.exit(1)
    body = {"values": rows}
    result = (
        service.spreadsheets()
        .values()
        .update(
            spreadsheetId=args.sheet_id,
            range=args.range,
            valueInputOption="USER_ENTERED",
            body=body,
        )
        .execute()
    )
    print("updated:", result.get("updatedRange"), "cells:", result.get("updatedCells"))


def main():
    p = argparse.ArgumentParser(description="TokiMenu Google Sheets API client")
    p.add_argument(
        "--key",
        type=Path,
        default=DEFAULT_KEY,
        help=f"Service account JSON (default: {DEFAULT_KEY})",
    )
    p.add_argument(
        "--sheet-id",
        default=DEFAULT_SHEET_ID,
        help="Spreadsheet ID",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("whoami", help="Print service account email")
    sub.add_parser("tabs", help="List sheet tabs + gids")

    g = sub.add_parser("get", help="Read a range (A1 notation, e.g. Sauces!A1:F10)")
    g.add_argument("range")
    g.add_argument("--json", action="store_true")

    s = sub.add_parser("set", help="Write one cell")
    s.add_argument("range", help="e.g. Sauces!E2")
    s.add_argument("value")

    sr = sub.add_parser("set-range", help="Write a 2D range from JSON")
    sr.add_argument("range")
    sr.add_argument("json_rows", help='e.g. [["a","b"],["c","d"]]')

    args = p.parse_args()
    creds, service = _load_creds(args.key)

    if args.cmd == "whoami":
        # Fix: print email properly
        print("service_account_email:", creds.service_account_email)
        print("Share your spreadsheet with that address as Editor.")
        return
    if args.cmd == "tabs":
        cmd_tabs(creds, service, args)
    elif args.cmd == "get":
        cmd_get(creds, service, args)
    elif args.cmd == "set":
        cmd_set(creds, service, args)
    elif args.cmd == "set-range":
        cmd_set_range(creds, service, args)


if __name__ == "__main__":
    main()

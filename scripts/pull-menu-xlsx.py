#!/usr/bin/env python3
"""Download the live Google Sheet as Menu.xlsx (full workbook).

xlsx preserves multi-tabs, cell fills, fonts, and rich text — the closest
mirror of Google Sheets for local / offline driving of TokiMenu.
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "Menu.xlsx"
SHEET_ID = "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10"
URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"


def main() -> int:
    print(f"Fetching {URL}")
    try:
        with urllib.request.urlopen(URL, timeout=60) as res:
            data = res.read()
    except Exception as err:
        print("Download failed:", err, file=sys.stderr)
        return 1
    if len(data) < 1000 or data[:2] != b"PK":
        print("Response does not look like an xlsx (is the sheet shared?)", file=sys.stderr)
        return 1
    OUT.write_bytes(data)
    print(f"Wrote {OUT} ({len(data):,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

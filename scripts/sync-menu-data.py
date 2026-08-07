#!/usr/bin/env python3
"""Regenerate js/menu-data.js from Google Sheet export or local Menu.xlsx.

Prefers live Google Sheet (Bowls tab + Style tab). Falls back to Menu.xlsx
looking for a "Bowls" sheet name (skips Style/Theme).
"""
from __future__ import annotations

import json
import re
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "Menu.xlsx"
OUT = ROOT / "js" / "menu-data.js"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

SHEET_ID = "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10"
BOWLS_GID = "0"
STYLE_GID = "1076652078"


def fetch_csv(gid: str) -> list[list[str]]:
    url = (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export"
        f"?format=csv&gid={gid}"
    )
    with urllib.request.urlopen(url, timeout=30) as res:
        text = res.read().decode("utf-8-sig")
    # minimal CSV parse via split (sheet is simple for bowls)
    import csv
    from io import StringIO

    return list(csv.reader(StringIO(text)))


def load_xlsx_rows(path: Path, name_re: str) -> list[list[object]]:
    z = zipfile.ZipFile(path)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {}
    for rel in rels:
        rid = rel.get("Id")
        t = rel.get("Target") or ""
        if t and not t.startswith("xl/"):
            t = "xl/" + t.lstrip("/")
        rid_to_target[rid] = t

    sheet_path = None
    for sh in wb.findall("m:sheets/m:sheet", NS):
        name = sh.get("name") or ""
        if re.search(name_re, name, re.I):
            rid = sh.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            )
            sheet_path = rid_to_target.get(rid)
            break
    if not sheet_path:
        # first non-style sheet
        for sh in wb.findall("m:sheets/m:sheet", NS):
            name = sh.get("name") or ""
            if re.search(r"style|theme", name, re.I):
                continue
            rid = sh.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            )
            sheet_path = rid_to_target.get(rid)
            break
    if not sheet_path:
        sheet_path = "xl/worksheets/sheet1.xml"

    ss: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", NS):
            texts = [
                t.text or ""
                for t in si.iter(
                    "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
                )
            ]
            ss.append("".join(texts))

    sheet = ET.fromstring(z.read(sheet_path))
    grid: dict[int, dict[str, object]] = {}
    for c in sheet.findall(".//m:c", NS):
        ref = c.get("r")
        col = "".join(x for x in ref if x.isalpha())
        row = int("".join(x for x in ref if x.isdigit()))
        t = c.get("t")
        v = c.find("m:v", NS)
        if v is None:
            val = None
        elif t == "s":
            val = ss[int(v.text)]
        else:
            val = v.text
        grid.setdefault(row, {})[col] = val

    max_row = max(grid) if grid else 1
    rows: list[list[object]] = []
    for r in range(1, max_row + 1):
        row = grid.get(r, {})
        # A-G
        rows.append([row.get(chr(ord("A") + i)) for i in range(7)])
    return rows


def parse_include(raw) -> int:
    if raw is None or str(raw).strip() == "":
        return 1
    try:
        return 1 if int(float(raw)) == 1 else 0
    except (TypeError, ValueError):
        return 0 if str(raw).strip() == "0" else 1


def main() -> None:
    style = {
        "bgScrollSpeed": 1.0,
        "slideshowSpeed": 3.0,
        "highlight": "26bbcb",
        "highlightSpecial": "fff900",
        "mainColor": "000000",
        "secondaryColor": "ffffff",
        "themeName": None,
    }
    try:
        srows = fetch_csv(STYLE_GID)
        # Theme palette: A selector | B name | C main | D secondary | E highlight | F special
        # Board-wide (first filled): G color | H image | I blur | J blend | K opacity
        #   L scroll | M slideshow
        theme_row = None
        global_bg_row = None
        # Theme Selector (col A) is a dropdown of theme names — first match wins
        selected_name = None
        theme_catalog = []  # (name_key, row)
        for s in srows[1:]:
            if not s or not any(str(c or "").strip() for c in s):
                continue
            name = str(s[1] if len(s) > 1 else "").strip()
            has_palette = bool(name) or any(
                str(s[i] if len(s) > i else "").strip() for i in (2, 3, 4, 5)
            )
            # Board-wide BG: color/image/speeds (not blend-only option rows)
            if global_bg_row is None and any(
                str(s[i] if len(s) > i else "").strip()
                for i in (6, 7, 8, 10, 11, 12)
            ):
                global_bg_row = s
            if has_palette:
                theme_catalog.append((name.lower().strip(), s))
            sel = str(s[0] if len(s) > 0 else "").strip()
            if sel and selected_name is None and sel.lower() not in (
                "0",
                "1",
                "true",
                "false",
            ):
                selected_name = sel
        if selected_name:
            key = selected_name.lower().strip()
            for nk, s in theme_catalog:
                if nk == key:
                    theme_row = s
                    break
        if theme_row is None and theme_catalog:
            theme_row = theme_catalog[0][1]
        if theme_row is not None:
            s = theme_row
            if len(s) > 1 and s[1]:
                style["themeName"] = str(s[1]).strip()
            if len(s) > 2 and s[2]:
                style["mainColor"] = str(s[2]).lstrip("#")
            if len(s) > 3 and s[3]:
                style["secondaryColor"] = str(s[3]).lstrip("#")
            if len(s) > 4 and s[4]:
                style["highlight"] = str(s[4]).lstrip("#")
            if len(s) > 5 and s[5]:
                style["highlightSpecial"] = str(s[5]).lstrip("#")
        bg_src = global_bg_row or theme_row
        if bg_src is not None:
            # L scroll (11), M slideshow (12) — new column layout
            if len(bg_src) > 11 and bg_src[11]:
                style["bgScrollSpeed"] = float(bg_src[11])
            if len(bg_src) > 12 and bg_src[12]:
                style["slideshowSpeed"] = float(bg_src[12])
        brows = fetch_csv(BOWLS_GID)
        source = "google-sheet"
    except Exception as err:
        print("Google fetch failed, using Menu.xlsx:", err)
        brows = load_xlsx_rows(XLSX, r"bowls")
        source = "xlsx"

    # brows[0] = header; A title, B item, C price, D desc, E new, F image, G include
    title = ""
    items = []
    for r in brows[1:]:
        while len(r) < 7:
            r.append("")
        if not title and r[0]:
            title = str(r[0]).strip()
        name = r[1]
        if not name or not str(name).strip():
            continue
        try:
            is_new = int(float(r[4])) == 1
        except (TypeError, ValueError):
            is_new = str(r[4]).strip() == "1"
        img = str(r[5]).strip() if r[5] else None
        if img and img.lower() == "null":
            img = None
        items.append(
            {
                "name": str(name).strip(),
                "price": r[2],
                "description": str(r[3] or "").strip(),
                "isNew": is_new,
                "image": img,
                "include": parse_include(r[6]),
            }
        )

    data = {
        "title": title or "Bowls & Salads",
        "themeName": style.get("themeName"),
        "mainColor": style["mainColor"],
        "secondaryColor": style["secondaryColor"],
        "bgScrollSpeed": style["bgScrollSpeed"],
        "slideshowSpeed": style["slideshowSpeed"],
        "highlight": style["highlight"],
        "highlightSpecial": style["highlightSpecial"],
        "items": items,
    }

    OUT.write_text(
        "/* Auto-generated from "
        + source
        + " — run: python3 scripts/sync-menu-data.py */\n"
        "window.TOKI_MENU = "
        + json.dumps(data, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(items)} items) from {source}")


if __name__ == "__main__":
    main()

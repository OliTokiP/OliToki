#!/usr/bin/env python3
"""Toki Git Commit — checkpoint code + snapshot the Google Sheet.

What it does (in parallel where possible):
  1. Commit any dirty worktree (optional message)
  2. Pull BOTH sheet exports we need for a full restore:
       • Menu.xlsx  — Drive export (fills, fonts, rich text / formatting)
       • values/*.csv — Sheets API values (what the boards read live)
  3. Pack both into one zip named with the git commit SHA, then delete
     the loose files outside the zip
  4. git push to origin

Zip naming (links to GitHub forever):
  backups/sheet-snapshots/Menu-sheet-<12-char-sha>.zip

  The 12-char prefix is unique for this repo in practice. Full 40-char SHA,
  branch, remote URL, and timestamp live in MANIFEST.txt inside the zip.
  On GitHub:  https://github.com/<user>/<repo>/commit/<full-sha>

Usage:
  python3 scripts/toki_git_commit.py
  python3 scripts/toki_git_commit.py --message "describe checkpoint"
  python3 scripts/toki_git_commit.py --no-commit   # snapshot + push only
  python3 scripts/toki_git_commit.py --no-push
  python3 scripts/toki_git_commit.py --no-ui        # no dialogs (CLI only)
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_KEY = ROOT / "secrets" / "google-service-account.json"
DEFAULT_SHEET_ID = "1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10"
SNAPSHOT_DIR = ROOT / "backups" / "sheet-snapshots"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]


# ── UI helpers ──────────────────────────────────────────────────────────────

def _use_ui(args) -> bool:
    return not args.no_ui and sys.platform == "darwin"


def notify(title: str, message: str, ui: bool) -> None:
    print(f"[{title}] {message}", flush=True)
    if not ui:
        return
    try:
        # Escape for AppleScript string
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
        )
    except Exception:
        pass


def dialog(message: str, title: str = "Toki Git Commit", ui: bool = True, fatal: bool = False) -> None:
    print(message, flush=True)
    if not ui:
        return
    try:
        def esc(s: str) -> str:
            return s.replace("\\", "\\\\").replace('"', '\\"')

        icon = "stop" if fatal else "note"
        subprocess.run(
            [
                "osascript",
                "-e",
                f'display dialog "{esc(message)}" buttons {{"OK"}} default button 1 '
                f'with icon {icon} with title "{esc(title)}"',
            ],
            check=False,
            capture_output=True,
        )
    except Exception:
        pass


def prompt_commit_message(default: str, ui: bool) -> str | None:
    """Return commit message, or None to cancel."""
    if not ui:
        return default
    try:
        def esc(s: str) -> str:
            return s.replace("\\", "\\\\").replace('"', '\\"')

        script = f'''
try
  set r to display dialog "Commit message (code checkpoint):" default answer "{esc(default)}" buttons {{"Cancel", "Commit"}} default button "Commit" with title "Toki Git Commit"
  return text returned of r
on error
  return ""
end try
'''
        out = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            check=False,
        )
        msg = (out.stdout or "").strip()
        if not msg:
            return None
        return msg
    except Exception:
        return default


# ── Git helpers ─────────────────────────────────────────────────────────────

def run_git(args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=check,
    )


def git_head_full() -> str:
    return run_git(["rev-parse", "HEAD"]).stdout.strip()


def git_head_short(n: int = 12) -> str:
    full = git_head_full()
    return full[:n]


def git_branch() -> str:
    r = run_git(["rev-parse", "--abbrev-ref", "HEAD"], check=False)
    return (r.stdout or "").strip() or "HEAD"


def git_remote_url() -> str:
    r = run_git(["remote", "get-url", "origin"], check=False)
    return (r.stdout or "").strip()


def git_is_dirty() -> bool:
    r = run_git(["status", "--porcelain"], check=False)
    return bool((r.stdout or "").strip())


def git_commit(message: str) -> bool:
    """Stage all + commit. Returns True if a commit was created."""
    run_git(["add", "-A"], check=False)
    # Re-check after add (nothing staged?)
    r = run_git(["diff", "--cached", "--quiet"], check=False)
    if r.returncode == 0:
        # also untracked already added; if still nothing:
        r2 = run_git(["status", "--porcelain"], check=False)
        if not (r2.stdout or "").strip():
            return False
    try:
        run_git(["commit", "-m", message])
        return True
    except subprocess.CalledProcessError as e:
        err = (e.stderr or e.stdout or str(e)).strip()
        if "nothing to commit" in err.lower():
            return False
        raise RuntimeError(f"git commit failed:\n{err}") from e


def git_push() -> str:
    """Push current branch to origin. Returns summary string."""
    remote = git_remote_url()
    if not remote:
        raise RuntimeError(
            "No git remote named 'origin'.\n\n"
            "Create a private GitHub repo, then once:\n"
            "  cd TokiMenu\n"
            "  git remote add origin git@github.com:YOU/TokiMenu.git\n"
            "  # or: https://github.com/YOU/TokiMenu.git\n"
            "  git push -u origin main\n\n"
            "See docs/git-howto.txt"
        )
    branch = git_branch()
    # Ensure upstream if missing
    up = run_git(["rev-parse", "--abbrev-ref", f"{branch}@{{upstream}}"], check=False)
    if up.returncode != 0:
        r = run_git(["push", "-u", "origin", branch], check=False)
    else:
        r = run_git(["push"], check=False)
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "push failed").strip()
        raise RuntimeError(f"git push failed:\n{err}")
    out = (r.stdout or "").strip() + "\n" + (r.stderr or "").strip()
    return out.strip() or f"Pushed {branch} → origin"


def github_commit_url(full_sha: str) -> str:
    remote = git_remote_url()
    if not remote:
        return ""
    # git@github.com:user/repo.git  or  https://github.com/user/repo.git
    m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", remote)
    if not m:
        return ""
    user, repo = m.group(1), m.group(2)
    return f"https://github.com/{user}/{repo}/commit/{full_sha}"


# ── Google Sheet export ─────────────────────────────────────────────────────

def _load_google(key_path: Path):
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaIoBaseDownload
    except ImportError as e:
        raise RuntimeError(
            "Missing Google libraries. Install once:\n"
            "  python3 -m pip install --user google-api-python-client google-auth\n"
            f"({e})"
        ) from e
    if not key_path.is_file():
        raise RuntimeError(
            f"Service account key not found:\n  {key_path}\n"
            "See scripts/gsheet_api.md"
        )
    creds = service_account.Credentials.from_service_account_file(
        str(key_path), scopes=SCOPES
    )
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False)
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    return creds, sheets, drive, MediaIoBaseDownload


def fetch_xlsx_bytes(sheet_id: str, key_path: Path) -> bytes:
    """Full workbook via Drive export — preserves fills, fonts, rich text."""
    _creds, _sheets, drive, MediaIoBaseDownload = _load_google(key_path)
    request = drive.files().export_media(
        fileId=sheet_id,
        mimeType=(
            "application/vnd.openxmlformats-officedocument"
            ".spreadsheetml.sheet"
        ),
    )
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _status, done = downloader.next_chunk()
    data = fh.getvalue()
    if len(data) < 100 or data[:2] != b"PK":
        raise RuntimeError(
            "Drive export did not return xlsx. Enable Google Drive API and "
            "share the sheet with the service account (see scripts/gsheet_api.md)."
        )
    return data


def fetch_tabs_and_csvs(sheet_id: str, key_path: Path) -> list[tuple[str, str, str]]:
    """Return list of (title, gid, csv_text) for every tab."""
    _creds, sheets, _drive, _dl = _load_google(key_path)
    meta = (
        sheets.spreadsheets()
        .get(
            spreadsheetId=sheet_id,
            fields="sheets.properties(sheetId,title)",
        )
        .execute()
    )
    out: list[tuple[str, str, str]] = []
    for sh in meta.get("sheets", []):
        p = sh.get("properties", {})
        title = p.get("title") or "Sheet"
        gid = str(p.get("sheetId"))
        # Safe range name (escape single quotes)
        safe = title.replace("'", "''")
        result = (
            sheets.spreadsheets()
            .values()
            .get(spreadsheetId=sheet_id, range=f"'{safe}'")
            .execute()
        )
        values = result.get("values", [])
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\n")
        for row in values:
            writer.writerow(row)
        out.append((title, gid, buf.getvalue()))
    return out


def safe_filename(name: str) -> str:
    s = re.sub(r"[^\w\-.# ]+", "_", name, flags=re.UNICODE).strip()
    return s or "sheet"


def build_snapshot_zip(
    zip_path: Path,
    xlsx_bytes: bytes,
    tabs: list[tuple[str, str, str]],
    *,
    full_sha: str,
    short_sha: str,
    branch: str,
    remote: str,
    sheet_id: str,
    sa_email: str,
) -> None:
    """Write zip with Menu.xlsx + values/*.csv + MANIFEST.txt; no loose leftovers."""
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    if zip_path.exists():
        zip_path.unlink()

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    commit_url = github_commit_url(full_sha)
    tab_lines = "\n".join(f"  - {t} (gid={g})" for t, g, _ in tabs)

    manifest = f"""TokiMenu sheet snapshot
=======================

Linked git commit (primary key)
  short:  {short_sha}
  full:   {full_sha}
  branch: {branch}
  remote: {remote or "(no origin)"}
  github: {commit_url or "(set origin to enable URL)"}

When:     {now}
Sheet ID: {sheet_id}
Service:  {sa_email}

Contents
--------
  Menu.xlsx          Full workbook (Drive export). Use this for fills,
                     fonts, rich text, and offline style matching.
  values/*.csv       One CSV per tab (Sheets API VALUES). Same shape the
                     live boards read via /api/sheets/csv — plain cell text,
                     no formatting.
  tabs.json          Tab titles + gids for tooling.
  MANIFEST.txt       This file.

Tabs exported
-------------
{tab_lines}

Restore pairing
---------------
  Code:  git checkout {full_sha}
         (or open the GitHub commit URL above)
  Sheet: unzip this archive; open Menu.xlsx in Excel/Sheets or drop it
         next to the boards as a local fallback.

Zip filename encodes the short SHA so you can match any snapshot to
`git log` / GitHub without opening the archive:
  Menu-sheet-{short_sha}.zip  ↔  commit {full_sha}
"""

    tabs_meta = [
        {"title": t, "gid": g, "csv": f"values/{safe_filename(t)}.csv"}
        for t, g, _ in tabs
    ]

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("MANIFEST.txt", manifest)
        zf.writestr("Menu.xlsx", xlsx_bytes)
        zf.writestr(
            "tabs.json",
            json.dumps(
                {
                    "sheet_id": sheet_id,
                    "git_commit_full": full_sha,
                    "git_commit_short": short_sha,
                    "branch": branch,
                    "remote": remote,
                    "github_commit_url": commit_url,
                    "exported_at_utc": now,
                    "tabs": tabs_meta,
                },
                indent=2,
            )
            + "\n",
        )
        for title, _gid, csv_text in tabs:
            zf.writestr(f"values/{safe_filename(title)}.csv", csv_text)

    # Append to local index (gitignored with other backups; easy human lookup)
    index_path = SNAPSHOT_DIR / "INDEX.txt"
    line = f"{short_sha}\t{full_sha}\t{now}\t{zip_path.name}\t{branch}\n"
    with index_path.open("a", encoding="utf-8") as f:
        f.write(line)


# ── Main ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="Toki Git Commit — push + sheet snapshot")
    ap.add_argument("-m", "--message", default="", help="Commit message")
    ap.add_argument("--no-commit", action="store_true", help="Skip commit even if dirty")
    ap.add_argument("--no-push", action="store_true", help="Skip git push")
    ap.add_argument("--no-sheet", action="store_true", help="Skip Google Sheet snapshot")
    ap.add_argument("--no-ui", action="store_true", help="No macOS dialogs/notifications")
    ap.add_argument("--sheet-id", default=DEFAULT_SHEET_ID)
    ap.add_argument("--key", type=Path, default=DEFAULT_KEY)
    args = ap.parse_args()
    ui = _use_ui(args)

    os.chdir(ROOT)
    if not (ROOT / ".git").is_dir():
        dialog("Not a git repository:\n" + str(ROOT), ui=ui, fatal=True)
        return 1

    notify("Toki Git Commit", "Starting…", ui)
    errors: list[str] = []
    notes: list[str] = []

    # ── Parallel: start sheet pull while we commit ──────────────────────────
    sheet_future = None
    executor = ThreadPoolExecutor(max_workers=2)
    try:
        if not args.no_sheet:
            def _pull():
                xlsx = fetch_xlsx_bytes(args.sheet_id, args.key)
                tabs = fetch_tabs_and_csvs(args.sheet_id, args.key)
                # email for manifest
                try:
                    creds, *_ = _load_google(args.key)
                    email = creds.service_account_email
                except Exception:
                    email = ""
                return xlsx, tabs, email

            sheet_future = executor.submit(_pull)

        # ── Commit ──────────────────────────────────────────────────────────
        committed = False
        if not args.no_commit and git_is_dirty():
            default_msg = args.message.strip() or (
                "checkpoint " + datetime.now().strftime("%Y-%m-%d %H:%M")
            )
            msg = (
                args.message.strip()
                if args.message.strip()
                else prompt_commit_message(default_msg, ui)
            )
            if msg is None:
                dialog("Cancelled — nothing committed or pushed.", ui=ui)
                if sheet_future:
                    sheet_future.cancel()
                return 0
            try:
                committed = git_commit(msg)
                if committed:
                    notes.append(f"Committed: {msg}")
                else:
                    notes.append("Nothing to commit (clean after stage).")
            except Exception as e:
                errors.append(str(e))
        elif args.no_commit:
            notes.append("Skipped commit (--no-commit).")
        else:
            notes.append("Working tree clean — no new commit.")

        full_sha = git_head_full()
        short_sha = full_sha[:12]
        branch = git_branch()
        remote = git_remote_url()

        # ── Sheet zip ───────────────────────────────────────────────────────
        zip_path = None
        if sheet_future is not None:
            try:
                xlsx_bytes, tabs, sa_email = sheet_future.result()
                zip_path = SNAPSHOT_DIR / f"Menu-sheet-{short_sha}.zip"
                # If same short-sha zip exists (re-run), overwrite with fresher sheet
                build_snapshot_zip(
                    zip_path,
                    xlsx_bytes,
                    tabs,
                    full_sha=full_sha,
                    short_sha=short_sha,
                    branch=branch,
                    remote=remote,
                    sheet_id=args.sheet_id,
                    sa_email=sa_email,
                )
                # Ensure no loose Menu.xlsx left from this run (do not delete
                # user's older backups/ copies; only root temp if we wrote one)
                root_xlsx = ROOT / "Menu.xlsx"
                # User asked: delete copies outside the zip. Remove root Menu.xlsx
                # only if it is clearly a stale mirror (optional). We never wrote
                # loose CSVs to disk — only into the zip — so nothing else to clean.
                # If a previous pull left Menu.xlsx and user wants only zip archives:
                # leave Menu.xlsx alone if it predates this tool; document instead.
                notes.append(
                    f"Sheet snapshot: {zip_path.relative_to(ROOT)} "
                    f"({len(xlsx_bytes):,} byte xlsx + {len(tabs)} CSV tabs)"
                )
                notes.append(f"Linked to commit {short_sha}… ({full_sha})")
            except Exception as e:
                errors.append(f"Sheet snapshot failed:\n{e}")
                traceback.print_exc()
        else:
            notes.append("Skipped sheet snapshot (--no-sheet).")

        # ── Push ────────────────────────────────────────────────────────────
        if not args.no_push:
            try:
                push_out = git_push()
                notes.append("Push: " + push_out.splitlines()[-1] if push_out else "Push OK")
            except Exception as e:
                errors.append(str(e))
        else:
            notes.append("Skipped push (--no-push).")

    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    # ── Summary ─────────────────────────────────────────────────────────────
    url = github_commit_url(git_head_full()) if (ROOT / ".git").is_dir() else ""
    summary_lines = notes + ([] if not errors else ["", "ERRORS:"] + errors)
    if url:
        summary_lines.append(f"GitHub: {url}")
    if zip_path and zip_path.exists():
        summary_lines.append(f"Zip: {zip_path}")
    summary = "\n".join(summary_lines)

    print("\n=== Toki Git Commit ===\n" + summary + "\n", flush=True)

    if errors:
        dialog(summary[:900], ui=ui, fatal=True)
        return 1

    notify("Toki Git Commit", "Done — " + (notes[0] if notes else "OK"), ui)
    dialog(summary[:900], ui=ui, fatal=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

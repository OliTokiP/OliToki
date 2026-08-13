#!/usr/bin/env python3
"""Toki Git Commit — fast by default.

When using Toki Git Commit.app (or python with UI):

  Single dialog with:
  - Commit message text field
  - Buttons:
      "Cancel"
      "Commit (fast)"               (default — no sheet snapshot)
      "Commit + full GSheet backup" (does the full Menu.xlsx + CSVs snapshot)

The full Google Sheet backup (for restore pairing) only happens when you
choose that button or pass --sheet.

Snapshots are saved locally as backups/sheet-snapshots/Menu-sheet-<sha>.zip
(these are gitignored, not pushed).

Usage (CLI):
  python3 scripts/toki_git_commit.py
  python3 scripts/toki_git_commit.py -m "describe change"
  python3 scripts/toki_git_commit.py --sheet -m "full checkpoint"
  python3 scripts/toki_git_commit.py --all -m "changed images"
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


def prompt_commit_options(default: str, ui: bool):
    """Single dialog for commit message + choice of full GSheet backup.

    Returns (message: str | None, include_sheet: bool)
    If user cancels, returns (None, False)
    """
    if not ui:
        # non-UI: respect CLI flags later, no prompt
        return default, False
    try:
        def esc(s: str) -> str:
            return s.replace("\\", "\\\\").replace('"', '\\"')

        script = f'''
try
  set r to display dialog "Commit message:" default answer "{esc(default)}" buttons {{"Cancel", "Commit (fast)", "Commit + full GSheet backup"}} default button "Commit (fast)" with title "Toki Git Commit"
  set btn to button returned of r
  set txt to text returned of r
  if btn is "Cancel" then
    return "CANCEL"
  else if btn is "Commit + full GSheet backup" then
    return "SHEET|" & txt
  else
    return "FAST|" & txt
  end if
on error
  return "CANCEL"
end try
'''
        out = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            check=False,
        )
        result = (out.stdout or "").strip()
        if not result or result == "CANCEL":
            return None, False
        if result.startswith("SHEET|"):
            msg = result[6:].strip()
            return (msg if msg else None), True
        else:
            # FAST| or plain
            if result.startswith("FAST|"):
                msg = result[5:].strip()
            else:
                msg = result.strip()
            return (msg if msg else None), False
    except Exception:
        return default, False


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


def _is_build_info_chore_subject(subject: str) -> bool:
    s = (subject or "").strip().lower()
    return s.startswith("chore: update build-info")


def git_meaningful_subject(max_walk: int = 12) -> str:
    """
    Latest commit message that is not the auto build-info stamp commit.
    Hash still comes from HEAD; subject should describe the real change.
    """
    r = run_git(["log", f"-{max_walk}", "--format=%s"], check=False)
    if r.returncode != 0:
        return ""
    for line in (r.stdout or "").splitlines():
        s = line.strip()
        if not s or _is_build_info_chore_subject(s):
            continue
        return s
    return ""


def write_build_info() -> Path | None:
    """Write js/build-info.js from HEAD so Pages/remote can show the commit stamp."""
    try:
        full = git_head_full()
        short = full[:7] if full else "unknown"
        r = run_git(["log", "-1", "--format=%ci%n%s"], check=False)
        lines = (r.stdout or "").strip().split("\n") if r.returncode == 0 else []
        date = lines[0] if lines else ""
        head_subject = lines[1] if len(lines) > 1 else ""
        # Skip auto "chore: update build-info.js" so Show Version shows real work
        subject = git_meaningful_subject() or head_subject
        info = {
            "hash": short,
            "hashFull": full,
            "date": date,
            "subject": subject,
            "source": "git",
        }
        out = ROOT / "js" / "build-info.js"
        out.write_text(
            "/* Auto-generated by toki_git_commit — commit stamp for Show Version */\n"
            "window.TOKI_BUILD = "
            + json.dumps(info, indent=2)
            + ";\n",
            encoding="utf-8",
        )
        return out
    except Exception as e:
        print("write_build_info failed:", e, flush=True)
        return None


def git_commit(message: str, full: bool = False) -> bool:
    """Stage + commit.

    Default (full=False): selective add for normal code files + git add -u.
    This avoids pushing the whole database/images every time.

    full=True: full git add -A (use --all or when you mean to include big assets).
    """
    if full:
        run_git(["add", "-A"], check=False)
    else:
        run_git([
            "add",
            "js/", "css/",
            "index.html", "index2.html", "index3.html", "index4.html",
            "preview-all.html", "glossary.html",
            "docs/", "scripts/", "AGENTS.md",
            "*.command", "Start Toki Menu.command",
            "Open Toki Menus.app/", "Toki Git Commit.app/"
        ], check=False)
        run_git(["add", "-u"], check=False)

    # Re-check after add (nothing staged?)
    r = run_git(["diff", "--cached", "--quiet"], check=False)
    if r.returncode == 0:
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
    ap = argparse.ArgumentParser(description="Toki Git Commit — fast by default + checkbox for sheet")
    ap.add_argument("-m", "--message", default="", help="Commit message")
    ap.add_argument("--no-commit", action="store_true", help="Skip commit even if dirty")
    ap.add_argument("--no-push", action="store_true", help="Skip git push")
    ap.add_argument("--sheet", action="store_true", help="Force full sheet snapshot (same as checking the box)")
    ap.add_argument("--no-sheet", action="store_true", help="Force skip sheet snapshot")
    ap.add_argument("--all", action="store_true", help="Stage everything (git add -A) — use if changing photos etc.")
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

    # ── Sheet snapshot decision (default off, checkbox in UI) ───────────────
    sheet_future = None
    executor = ThreadPoolExecutor(max_workers=2)
    pull_func = None

    # Prepare the pull function (expensive Google work only happens if we decide yes)
    def _pull():
        xlsx = fetch_xlsx_bytes(args.sheet_id, args.key)
        tabs = fetch_tabs_and_csvs(args.sheet_id, args.key)
        try:
            creds, *_ = _load_google(args.key)
            email = creds.service_account_email
        except Exception:
            email = ""
        return xlsx, tabs, email
    pull_func = _pull

    want_sheet = args.sheet and not args.no_sheet

    try:
        if want_sheet:
            # CLI forced --sheet: start the work early in parallel
            sheet_future = executor.submit(pull_func)

        # ── Commit ──────────────────────────────────────────────────────────
        committed = False
        if not args.no_commit and git_is_dirty():
            default_msg = args.message.strip() or (
                "checkpoint " + datetime.now().strftime("%Y-%m-%d %H:%M")
            )
            cli_msg = args.message.strip()
            if cli_msg:
                msg = cli_msg
                do_sheet = args.sheet and not args.no_sheet
            else:
                msg, do_sheet = prompt_commit_options(default_msg, ui)

            if msg is None:
                dialog("Cancelled — nothing committed or pushed.", ui=ui)
                if sheet_future:
                    sheet_future.cancel()
                return 0

            if do_sheet:
                want_sheet = True
                if pull_func is not None and sheet_future is None:
                    sheet_future = executor.submit(pull_func)

            try:
                committed = git_commit(msg, full=args.all)
                if committed:
                    notes.append(f"Committed: {msg}")
                    # Stamp build-info and amend into the same commit so HEAD
                    # subject stays the real message (not "chore: update build-info").
                    bi = write_build_info()
                    if bi and bi.is_file():
                        rel = str(bi.relative_to(ROOT))
                        run_git(["add", rel], check=False)
                        if git_is_dirty():
                            try:
                                run_git(
                                    [
                                        "commit",
                                        "--amend",
                                        "--no-edit",
                                        "--no-verify",
                                    ],
                                    check=False,
                                )
                                # Refresh hash after amend (subject unchanged)
                                bi2 = write_build_info()
                                if bi2 and git_is_dirty():
                                    run_git(["add", rel], check=False)
                                    run_git(
                                        [
                                            "commit",
                                            "--amend",
                                            "--no-edit",
                                            "--no-verify",
                                        ],
                                        check=False,
                                    )
                                notes.append("Updated js/build-info.js (amended)")
                            except Exception:
                                # Fallback: tiny follow-up commit (subject still skipped in stamp)
                                try:
                                    run_git(
                                        [
                                            "commit",
                                            "-m",
                                            "chore: update build-info.js",
                                        ],
                                        check=False,
                                    )
                                    write_build_info()
                                    notes.append(
                                        "Updated js/build-info.js (separate commit)"
                                    )
                                except Exception:
                                    notes.append(
                                        "build-info written (commit separately)"
                                    )
                else:
                    notes.append("Nothing to commit (clean after stage).")
            except Exception as e:
                errors.append(str(e))
        elif args.no_commit:
            notes.append("Skipped commit (--no-commit).")
            write_build_info()
        else:
            notes.append("Working tree clean — no new commit.")
            write_build_info()

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
            # Normal fast path — no sheet snapshot performed.
            if want_sheet:
                notes.append("Sheet snapshot requested but did not run.")

        # ── Push ────────────────────────────────────────────────────────────
        if not args.no_push:
            try:
                push_out = git_push()
                last = (push_out.splitlines()[-1] if push_out else "Push OK").strip()
                if "up-to-date" not in last.lower():
                    notes.append("Push: " + last)
                else:
                    notes.append("Pushed (up to date).")
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

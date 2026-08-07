# Sheet snapshots (paired with git commits)

Created by **Toki Git Commit** (`Toki Git Commit.app` or `scripts/toki_git_commit.py`).

## Naming ↔ GitHub

| File | Meaning |
|------|---------|
| `Menu-sheet-<12-char-sha>.zip` | Snapshot taken when `HEAD` was that commit |
| `INDEX.txt` | Append-only log: short SHA, full SHA, time, zip name, branch |
| zip → `MANIFEST.txt` | Full 40-char SHA, remote URL, GitHub commit link, sheet id |
| zip → `Menu.xlsx` | **Formatted** workbook (fills, fonts) via Drive export |
| zip → `values/*.csv` | **Values only** (one CSV per tab) via Sheets API |
| zip → `tabs.json` | Machine-readable metadata + same commit fields |

The **12-character prefix of the git commit SHA** is the join key:

```text
git log --oneline
# 9ba31760fe6a feat(board3): …

# matching sheet:
# backups/sheet-snapshots/Menu-sheet-9ba31760fe6a.zip

# GitHub:
# https://github.com/<user>/<repo>/commit/<full-40-char-sha>
# (full SHA is inside MANIFEST.txt / tabs.json)
```

## Why two formats?

Live boards use **CSV/values** for menu text and **xlsx styles** for cell fills/fonts
(e.g. announcement colors). A full offline restore needs both; one zip holds both.

## Git

Zip files are gitignored (`*.zip`). Keep this folder on Dropbox/your Mac; use
git/GitHub for code. Pair them with the SHA in the filename.

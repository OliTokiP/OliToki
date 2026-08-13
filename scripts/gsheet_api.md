# Google Sheets API setup (TokiMenu)

Use a **service account** so scripts (and Grok, with the key on your machine) can
read/write the menu spreadsheet without you clicking “Allow” every time.

Your spreadsheet ID:

```
1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10
```

---

## 1. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Sign in with the **same Google account** that owns the TokiMenu sheet (or one
   that can share it).
3. Top bar → **Select a project** → **New project**.
4. Name it e.g. `TokiMenu Tools` → **Create**.
5. Select that project if it isn’t already active.

---

## 2. Enable the Sheets API

1. Menu → **APIs & Services** → **Library**.
2. Search for **Google Sheets API**.
3. Open it → **Enable**.

**Drive API is not required for live boards.** Cell fills and announcement
rich text were retired 2026-08-13 (see `deprecated/sheet-styles/`). CSV /
Sheets `values.batchGet` is enough. Drive export is only used by optional
backup tools (`Toki Git Commit.app` sheet snapshot, `pull-menu-xlsx.py`).

---

## 3. Create a service account + key

1. **APIs & Services** → **Credentials**.
2. **+ Create credentials** → **Service account**.
3. Name: e.g. `tokimenu-editor`.
4. **Create and continue** (roles optional for this use case → **Continue** → **Done**).
5. In the credentials list, click the new service account.
6. Tab **Keys** → **Add key** → **Create new key** → **JSON** → **Create**.
7. A `.json` file downloads. **Treat it like a password.**

### Put the key here (this repo already gitignores it)

```text
TokiMenu/secrets/google-service-account.json
```

Create the folder if needed:

```bash
mkdir -p secrets
mv ~/Downloads/your-project-*.json secrets/google-service-account.json
```

---

## 4. Share the spreadsheet with the robot

1. Open the JSON key and copy `client_email`, e.g.

   ```text
   tokimenu-editor@tokimenu-tools.iam.gserviceaccount.com
   ```

2. Open the [TokiMenu spreadsheet](https://docs.google.com/spreadsheets/d/1gtTQIXzTptmDxuddR0idCuataAhH6jnoEzp8dRY9g10/edit).
3. **Share** → paste that email → role **Editor** → uncheck “Notify people” → **Share**.

Without this step, the API returns **403** even with a valid key.

---

## 5. Install the Python client (once)

From the TokiMenu project folder:

```bash
python3 -m pip install --user google-api-python-client google-auth
```

---

## 6. Smoke test

```bash
python3 scripts/gsheet_client.py whoami
python3 scripts/gsheet_client.py tabs
python3 scripts/gsheet_client.py get "Sauces!A1:E3"
```

If `tabs` lists Style, Bowls, Sauces, Drinks, etc., you’re done.

Write example (careful — this changes the live sheet):

```bash
# Write a single cell (A1 notation)
python3 scripts/gsheet_client.py set "Sauces!A2" "Sauces"

# Write a small range (JSON list of rows)
python3 scripts/gsheet_client.py set-range "Sauces!A1:B2" '[["Sauces Box Title","Sauces Box Subtitle"],["Sauces",""]]'
```

---

## 7. Using this with Grok

Once `secrets/google-service-account.json` exists on your machine:

1. Tell Grok the sheet is shared with the service account.
2. Ask for a concrete edit (“set Sauces Create Columns to No”, “add item X”).
3. Grok can run `scripts/gsheet_client.py` via the terminal tools **on your Mac**
   (it never uploads the key to Google Chat; it only uses the local file).

**Do not** paste the full JSON key into chat.

---

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| `FileNotFoundError` for secrets/… | Move the JSON to `secrets/google-service-account.json` |
| `403` / permission denied | Share the **spreadsheet** with `client_email` as Editor |
| `API has not been used` / 403 API | Enable **Google Sheets API** on the Cloud project |
| Wrong project | Credentials page must be the same project where you enabled the API |
| Boards show empty / 401 public export | Run `toki_server.py` or **Open Toki Menus** (not plain `http.server`); sheet can stay private |
| Xlsx / cell colors missing | Enable **Google Drive API** on the same Cloud project (see below) |

---

## Private sheet + live boards (recommended)

Boards must **not** embed the service account key. Instead run:

```bash
python3 scripts/toki_server.py
# or Open Toki Menus.app (starts the same server)
```

That process holds the key and exposes:

- `GET /api/health`
- `GET /api/sheets/csv?gid=…`
- `GET /api/sheets/xlsx`

`menu.js` auto-detects `/api/health` and uses the proxy so **General access can stay Restricted**.

### Also enable Drive API (for xlsx / cell colors)

1. Cloud Console → **APIs & Services** → **Library**
2. Enable **Google Drive API** (Sheets API alone is enough for CSV values; xlsx export uses Drive)

Share the sheet with the service account as **Editor** (or Viewer if you only need read).

---

## Security notes

- Never commit `secrets/` or the JSON key (see `.gitignore`).
- Prefer **Editor** only on this one spreadsheet, not your whole Drive.
- If the key leaks: Cloud Console → service account → Keys → delete the key → create a new one.
- The browser never sees the JSON key when using `toki_server.py`.

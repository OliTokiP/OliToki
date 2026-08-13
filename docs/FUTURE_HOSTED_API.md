# Future: hosted API so Remote can read a private sheet

**Status:** not built. Parked 2026-08-13.  
**Today:** GitHub Pages (Remote) needs **Anyone with the link → Viewer** on Settings + the Alpha / Restaurant workbook it loads. Local already reads private sheets via `toki_server.py`.

This is the usual “private data on a public site” pattern. We are not missing a second Google API. We are missing **a place on the internet that can hold the robot key**.

---

## 1. Why Pages cannot do it alone

| Piece | What it is | Can it hold `secrets/google-service-account.json`? |
|-------|------------|-----------------------------------------------------|
| GitHub Pages | Static HTML/CSS/JS | **No.** View Source would steal the key. |
| Dropbox / this repo | File sync | **No.** Storage, not a running server. |
| `toki_server.py` on this Mac | Local proxy | **Yes** — that is why Local works. |
| Same server on Fly / Cloud Run / a VPS | Hosted proxy | **Yes** — that is the future feature. |

The service account is a robot identity for *our software*, not a password we put in the website.

```text
Today — Remote (public Viewer)

  Browser on GitHub Pages
       → public Google /export?format=csv
       → sheet must be “Anyone with the link”

Today — Local (private OK)

  Browser on 127.0.0.1
       → toki_server /api/sheets/csv
       → Sheets API with the key
       → sheet shared only with menueditor@…

Future — Remote + private sheet

  Browser on GitHub Pages
       → https://toki-api.example.com/api/sheets/csv
       → hosted toki_server (key in the host’s secret store)
       → private sheet
```

---

## 2. What is enough (when we build it)

Software we already have:

- Service account + Sheets API (`scripts/gsheet_api.md`)
- `toki_server.py` — `/api/settings`, `/api/sheets/csv`, `/api/health` (CORS already `*`)
- Settings workbook choosing Alpha vs Restaurant

What we still need:

1. **A 24/7 host** (Fly.io, Cloud Run, Railway, Render, or a small VPS). A tunnel from this Mac is demo-only.
2. **Boards pointed at that origin** — a `TOKI_API_BASE` (or equivalent) so Remote does not assume `/api` is same-site as GitHub Pages.
3. **The JSON key only on the host** (env / secret). Never commit it; never ship it in `js/`.

Then Settings → Data Source and Require Restart work on live TVs without publishing the menu workbooks.

A git push still only ships the website. The hosted API reads Settings; it does not live in git.

---

## 3. What we will not do

- Put the service account JSON in the GitHub Pages site or a public repo
- Treat Dropbox, iCloud, or Pages as the API server
- Build a second Google Cloud “API product” — Sheets API + the existing proxy is the product

---

## 4. When to pick this up

When the restaurant cannot keep Settings / Restaurant Copy as “Anyone with the link,” or when a second tenant needs a private sheet on the same public frontend.

Until then: share **OliToki Menu Settings** and whichever catalog workbook Remote should load as **Viewer** to anyone with the link. Keep the service-account share for Local.

See [ARCHITECTURE.md](./ARCHITECTURE.md) § Private Google Sheet + live boards.

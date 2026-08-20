# Deployer

**Last updated:** 2026-08-20 18:39

Phone hub: [`suite.html`](../suite.html) — Suite, Deployer, Tickets, Menu Manager, boards.

**Health** on Suite: Restaurant TVs vs last restaurant ship vs `main`, Testing vs `main`, plus a grid for network, load, swap, Grok agents, open / leftover sockets, Sheets, and how many `toki_server` processes are up. Mac meters need the laptop API (`/api/sys`). Deployer uses the same TV verdict.

**Open a copy** is one matrix: Hub (Suite, Deployer, Tickets, Menu Manager, Brightness) then Boards. Columns are **Local** (this Mac), **Test** (beta / Alpha sheet), **TVs** (Restaurant / GitHub Pages). Boards are not listed twice. The column you are on is marked. Brightness is Mac-only.

Green when Pages matches the last restaurant ship. Yellow if `main` is ahead of that ship (unpublished work — not a dining-room outage). Red only when Pages does not match the last restaurant ship.

Phone form: [`deploy.html`](../deploy.html). Worker: GitHub Actions [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

Deployer cache-busts itself: opening the page adds `_toki=` so Chrome / Suite App cannot keep a stale `deploy.html`. Local `toki_server` also sends `Cache-Control: no-store` for static files. If `/api/build` (or `js/build-info.js` on Live) moves while the tab is open, Deployer reloads. You do not need Launcher **Hard refresh** for this page.

Your laptop is staging. **main** is today’s work. **testing** is unmerged beta. **restaurant** is what the dining-room TVs run. The local portal is `/portal` on this Mac’s `.local` name — not a Wi-Fi IP.

**Set and forget:** leave Ship on **Website + API**. One restaurant ship updates Pages and Cloud Run together. Menu edits do not need a redeploy. The laptop is not the live server. Only ship again when app code changes.

## Two branches

| Branch | Site | Sheet (forced) | API |
|--------|------|----------------|-----|
| `restaurant` | https://olitokip.github.io/OliToki/ | Restaurant Copy | `toki-api` |
| `testing` | https://toki-api-testing-3rx5m3qpzq-uc.a.run.app/ | Alpha Copy | same service serves HTML + API |
| `main` | not live | Settings sheet (local / Listener) | local `toki_server` |

GitHub Pages **must** publish from `restaurant`, not `main`. Otherwise every Listener commit ships to the TVs.

## How to ship

1. Open [`deploy.html`](https://olitokip.github.io/OliToki/deploy.html) (or local `/deploy.html`).
2. Pick **Testing** (default) or **Restaurant**.
3. File the issue. You must be signed into GitHub as someone with repo write access.
4. Actions **publishes** the source onto that branch (no merge), writes `js/env.js`, and deploys Cloud Run when `TOKI_GCP_SA` is set.

Restaurant requires the dining-room checkbox. Dry run comments the plan only.

Promote: check **Promote testing → restaurant** when Alpha-tested code is ready for TVs.

## Data Source

Menu Manager **Data Source** is the same switch as the Settings catalog:

- **Restaurant Copy** → restaurant site + restaurant sheet
- **Alpha Copy** → testing site + Alpha sheet (unmerged features)

On a live site, picking the other source **opens that site**. It does not flip the shared Settings cell (that would move the TVs). Local still honors the Settings sheet so you can stage.

## One-time GCP

Repo secret `TOKI_GCP_SA` is set (`toki-deployer@menudesigner`). Repo vars `TOKI_TESTING_API` / `TOKI_TESTING_SITE` point at the testing Cloud Run URL.

Mac fallback (if Actions cannot reach GCP):

```bash
# restaurant API
./scripts/cloud-run/deploy.sh

# testing site + API
TOKI_GCP_SERVICE=toki-api-testing TOKI_DEPLOY_MODE=web ./scripts/cloud-run/deploy.sh
```

## Do not

- Force-push **main**. `restaurant` / `testing` are publish branches — Deployer force-with-leases only those.
- Point Pages back at `main`
- Put the service account in `js/`
- Commit unique work on `restaurant` or `testing`. Those tips are replaced on the next ship.

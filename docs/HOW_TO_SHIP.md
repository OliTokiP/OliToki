# How to ship

This is the operator guide. You do **not** need to understand git, Cloud Run, or APIs to get a version onto the restaurant TVs.

Open the ship form from [[Launcher]] → **Suite** or **Deployer** → **Live**, or here: [Suite](https://olitokip.github.io/OliToki/suite.html) · [Deployer](https://olitokip.github.io/OliToki/deploy.html). Suite, Deployer, and Tickets share the same top bar. The current page is plain text in that same slot. Menu Manager opens the local Manager in a new window.

Suite’s **Open a copy** chart is the three copies of every surface: **Local** (this Mac), **Test** (beta / Alpha), **TVs** (Restaurant). Same meaning as the table below.

---

## The only picture you need

There are three copies of the app:

| Name | What it is | Who sees it |
|------|------------|-------------|
| **main** | Today’s work. Listener / tickets land here. | You, on this Mac. **Not** the TVs. |
| **testing** | A practice restaurant. Unmerged / beta code. | You, on your phone. Uses the **Alpha** Google Sheet. |
| **restaurant** | What the dining-room screens actually run. | Guests. Uses the **Restaurant** Google Sheet. |

Pushing a ticket or committing on the Mac updates **main** only. The TVs do not change until you use Deployer and pick **Restaurant**.

### Set and forget

Leave **Ship** on **Website + API**. One restaurant ship updates the TV website and the sheet brain together. You do **not** redeploy because someone edited the menu. You do **not** need this Mac after that. Only ship again when the **app itself** changes (new buttons, new write routes, that kind of thing).

Testing site (safe to poke): https://toki-api-testing-3rx5m3qpzq-uc.a.run.app/

Restaurant site (the TVs): https://olitokip.github.io/OliToki/

---

## What the [[Launcher]] page means

The table is three ways to open the **same page**:

| Column | Meaning |
|--------|---------|
| **Local** | This Mac’s portal. Stable `.local` name (does not change when Wi‑Fi hands out a new IP). Bookmark `/portal`. Needs **Enable local server** on. |
| **Tailscale** | This Mac from anywhere (phone, another network). Same server as Local. The laptop must be awake. |
| **Live** | The real internet copy on GitHub Pages. This is what the restaurant screens load. **Does not need your laptop.** |

The Health line is “do the TVs have the **last restaurant ship**?”

- 🟢 live = last restaurant ship = main — dining room matches main
- Yellow — TVs have the last restaurant ship; main has newer commits that are **not** a TV outage. Ship Restaurant only if that work belongs in the dining room
- 🔴 live ≠ last restaurant ship — Pages is still publishing, or the last ship did not land

### The three switches

Check a box, then **save** the note. The Mac does the work.

| Switch | Leave it… | What it does |
|--------|-----------|--------------|
| **Hard refresh** | Off unless a board looks stuck on an old file | Adds a cache-buster to the Local / Tailscale links so the browser fetches fresh JS/CSS |
| **Allow LAN** | **On** if you want the phone on this Wi‑Fi to open Local / Tailscale | Lets other devices on the network reach this Mac’s server |
| **Enable local server** | **On** when you want Local / Tailscale links to work | Starts the little website on this Mac. Turn **off** to stop it. Restaurant TVs do **not** use this. |

---

## What each Deployer setting means

Open [Deployer](https://olitokip.github.io/OliToki/deploy.html). From **Suite App** the Mac files the GitHub issue itself (stay on Deployer). From Live without the Mac, GitHub opens in a **new window** — you must be signed in as `OliTokiP`. The dining-room checkbox on the form is the confirmation; GitHub does not need a second “are you sure?”

Deployer hard-refreshes itself on open (`_toki=` on the URL). You do not need the Launcher **Hard refresh** switch to see a new status line.

### Target — where should this go?

| Pick | What happens |
|------|----------------|
| **Testing** | Practice ship. TVs do not change. You preview on the testing link above. |
| **Restaurant** | Dining-room ship. The TV website updates. |

Default is Testing. Use that first unless you are sure.

### Ship — what pieces?

| Pick | What happens |
|------|----------------|
| **Website + API** | The pages **and** the Google Sheet brain. **Use this.** |
| **Website only** | Just the HTML/JS. Only if someone told you the API is already fine. |
| **API only** | Just the Sheet brain. Rare. |

### Source commit — which work are we shipping?

| Pick | What happens |
|------|----------------|
| **main (today’s work)** | Whatever Listener / you last committed. Fast, but it has not been previewed on testing. |
| **testing (promote)** | The copy already sitting on the practice site. Use this after you liked testing. |
| **Other SHA / branch** | A specific commit. Skip this unless you know the hash. |

### Data source pin — which Google Sheet?

| Pick | What happens |
|------|----------------|
| **Auto** | Testing → Alpha sheet. Restaurant → Restaurant sheet. **Leave this on.** |
| **Force Alpha Copy** | Makes that site read Alpha even if it is restaurant. Don’t use for TVs. |
| **Force Restaurant Copy** | Makes that site read Restaurant even if it is testing. Rare. |

Auto exists so a Settings-sheet flip cannot accidentally point the TVs at the Alpha workbook.

### The extra checkboxes

| Box | What it does |
|-----|----------------|
| **Promote testing → restaurant** | Ignores Source and ships whatever is already on testing onto the TVs. This is the safe “I liked the practice site, make it real” button. |
| **Dry run** | Writes the plan on the GitHub issue and **does not ship**. Use this if you want to see the plan first. |
| **I am shipping to the dining room** | Required for Restaurant. The form will not file without it. That’s the seatbelt. |

**Notes** is optional. A sentence like “Encore punch-in fix” is enough.

---

## Recipe A — the safe way (recommended)

Preview on testing, then promote to the TVs.

### 1. Ship to testing

1. On your phone, open [[Launcher]] → **Deployer** → **Live**.
2. Leave **Target** on **Testing**.
3. Leave **Ship** on **Website + API**.
4. Leave **Source** on **main (today’s work)**.
5. Leave **Data source pin** on **Auto**.
6. Do **not** check dining room or promote.
7. Optional: type a note.
8. Tap **File testing deploy**. Suite App stays on this page. (On Live without the Mac, GitHub opens in a new window — submit the issue there.)
9. Optional: **Latest GitHub commit** opens that commit on GitHub in a new window. The label updates after you file.
10. Wait until Actions comments on the issue (usually 1–3 minutes; first testing ship can be longer). Use **This ship · #…** if it appeared, still in a new window. From this Mac, Suite also pings Notification Center when the ship is filed and when Actions finishes.
11. Open https://toki-api-testing-3rx5m3qpzq-uc.a.run.app/ and click through the boards + Menu Manager. This is Alpha data. TVs are untouched.

### 2. If testing looks right, ship to the restaurant

1. Open Deployer again.
2. Target: **Restaurant**.
3. Ship: **Website + API**.
4. Check **Promote testing → restaurant**.
5. Check **I am shipping to the dining room. TVs will update.**
6. Leave pin on **Auto**.
7. Tap **File restaurant deploy**. Stay on Deployer (or submit in the new GitHub window on Live).
8. Wait for the Actions comment.
9. On [[Launcher]], wait until **Live** is 🟢.
10. On a TV / Fire Stick, force-refresh the page (or wait ~30 seconds if Require Restart is off). Open https://olitokip.github.io/OliToki/index.html to confirm.

That’s it. Laptop can stay closed.

---

## Recipe B — emergency, skip testing

Only if you need today’s `main` on the TVs right now.

1. Deployer → Target **Restaurant**.
2. Ship **Website + API**.
3. Source **main (today’s work)**.
4. Pin **Auto**.
5. Check **I am shipping to the dining room**.
6. Tap **File restaurant deploy**. Stay on Deployer.
7. Wait for 🟢 on [[Launcher]], then refresh the TVs.

---

## How you know it worked

- The GitHub issue (new window, or **This ship · #…**) shows a **Deployer plan** comment and no red X on the Actions tab.
- [[Launcher]] **Live** is 🟢 and the short code matches what you just shipped.
- The TV shows the new behavior. Theme / menu edits still write to the **Restaurant** Google Sheet.

If Live stays 🔴 for more than ~5 minutes, open the issue and look at the Actions log — or ask Grok to read it.

---

## Menu Manager “Data Source”

On a live site this is **which world you’re in**, not a hidden TV switch.

- **Restaurant Copy** = restaurant website + restaurant sheet.
- **Alpha Copy** = testing website + Alpha sheet (unmerged features).

If you pick the other one on a live site, Manager **opens that other website**. It does not flip the TVs by rewriting the shared Settings cell.

On Local (this Mac), Data Source still follows the Settings sheet, so you can stage.

---

## Do not

- Expect a Listener ticket / git commit to update the TVs. That only updates **main**.
- Let Suite App navigate to GitHub. There is no back button. File stays on Deployer; **Latest GitHub commit** opens a new window.
- Ship Restaurant with pin **Force Alpha Copy**.
- Uncheck **Enable local server** thinking that turns the restaurant off. It only stops this Mac.
- Point GitHub Pages back at `main`. TVs must stay on the `restaurant` branch.

---

## If you’re lost

1. Are the TVs wrong, or is only your laptop wrong? TVs = restaurant. Laptop Local = this Mac.
2. Did you file a **Restaurant** deploy, or only Testing?
3. Does Deployer say TVs have the last restaurant ship (live = last ship)? Yellow means main is ahead of that ship — not that the dining room is broken.
4. Did you refresh the TV?

Tech background (optional): [[Docs/DEPLOYER]]

# Magic Pod Metrics

A dashboard of win rates and other stats from our Magic: The Gathering game log
(a public Google Sheet). It reads the sheet live in the browser, so there's no
build step and no backend.

## Run it

- Double-click `index.html`, **or**
- `node serve.js` and open http://localhost:8765

## Updating

The page reads the whole log when it loads, then re-checks it every 60 seconds
(and whenever you switch back to the tab). It redraws only if the log changed.

## Logging games from the site

The **+ Log a game** button adds a game straight to the sheet. A Google Apps
Script attached to the sheet does the writing, and a passcode you choose keeps
strangers from adding games. Setup takes one time, about 5 minutes:

1. Open the sheet and go to **Extensions > Apps Script**.
2. Replace everything in `Code.gs` with [apps-script/Code.gs](apps-script/Code.gs) and save.
3. Click **Project Settings** (gear icon) > **Script properties** > **Add script property**:
   name `PASSCODE`, value: whatever passcode the pod will use. (Keep it out of this repo.)
4. Click **Deploy > New deployment**, pick type **Web app**, set
   *Execute as*: **Me** and *Who has access*: **Anyone**, then **Deploy**.
   Approve the permission prompt (it asks to edit your spreadsheets).
5. Copy the **Web app URL** (ends in `/exec`) into `APPS_SCRIPT_URL` at the top
   of `app.js`, then commit and push.

Each device asks for the passcode once and remembers it. If you later edit
`Code.gs`, use **Deploy > Manage deployments > Edit > New version** so the URL
stays the same.

## Log format it expects

Blocks of rows, one block per game:

| A | B | C | D |
|---|---|---|---|
| date | 3/7/2026 | *(optional note)* | |
| winner | dustin | *(2nd winner if shared)* | |
| players | chuck | dustin | pk |
| commander | deck | deck | deck |
| *(blank)* | | *partner / 2nd line* | |

- `DNF`, `did not finish`, `no one`, or blank in the winner row = unfinished game
  (left out of win rates).
- A deck named `mad` is counted as a "Mad" game; a deck with `precon` in its
  name counts as a precon.
- More players work: add columns to the `players` row.

## Config

The sheet ID, refresh interval and rolling-window size are at the top of `app.js`.
The sheet must stay shared as "anyone with the link can view".

## Hosting

It's a static site, so GitHub Pages (or Netlify) can serve it as-is.

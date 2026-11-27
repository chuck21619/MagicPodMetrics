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

One row per game, with a header row and a column per player:

| Date | Winner | First | Note | chuck | dustin | pk |
|---|---|---|---|---|---|---|
| 3/7/2026 | dustin | | | ikra shadiqi | leonardo + april o'neal | roxanne |
| 7/21/2026 | chuck, pk | | | mad | mad | mad |
| 10/25/2026 | | | did not finish | scryfall random | sefris precon | -1/-1 precon |
| 11/26/2026 | pk | chuck | | kykar | mad | roxanne |

- **Winner**: one name, or several separated by commas for a shared win.
  Blank (or `dnf`, `no one`) = no winner; those games are left out of win rates.
- **First**: who took the first turn. Blank = not recorded. (Date, Winner, First and
  Note are found by name, so their order doesn't matter as long as they come before
  the player columns.)
- **Player columns**: the deck that player used. Blank = they sat out.
  `unknown` = they played but the deck wasn't recorded.
- Partners or a second commander go in the same cell, joined with `+`.
- A deck named `mad` counts as a "Mad" game; a deck with `precon` in its name
  counts as a precon.
- New player: add a column on the right (the form does this automatically).

## Config

The sheet ID, refresh interval and rolling-window size are at the top of `app.js`.
The sheet must stay shared as "anyone with the link can view".

## Hosting

It's a static site, so GitHub Pages (or Netlify) can serve it as-is.

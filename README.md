# Magic Pod Metrics

A dashboard of win rates and other stats from our Magic: The Gathering game log
(a public Google Sheet). It reads the sheet live in the browser, so there's no
build step and no backend.

## Run it

- Double-click `index.html`, **or**
- `node serve.js` and open http://localhost:8765

## Updating

- The page reads the whole log every time it loads.
- **Update now** re-reads it on demand.
- **Auto-update** (on by default) re-checks every 60 seconds and redraws only
  if the log changed.

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

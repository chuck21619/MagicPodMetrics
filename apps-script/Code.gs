/**
 * Magic Pod Metrics - Apps Script for the game log sheet.
 *
 * Paste this into the sheet's Apps Script editor (Extensions > Apps Script),
 * set a PASSCODE script property, and deploy as a web app. Full steps are in
 * the README. Do NOT put the passcode in this file.
 *
 * The log is one row per game:
 *   Date | Winner | First | Note | chuck | dustin | pk | ...
 * - Winner: one name, several separated by commas, or blank for no winner.
 * - First: who took the first turn (blank = not recorded).
 * - Each player has a column holding the deck they played (blank = sat out).
 * - A new player gets a new column added on the right.
 */

const LOG_SHEET_ID = 0; // the tab's gid
const FIXED_COLS = ["date", "winner", "first", "note"]; // matched by name, any order, before the player columns

function logSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets().filter((s) => s.getSheetId() === LOG_SHEET_ID)[0];
  if (!sheet) throw new Error("Log tab not found");
  return sheet;
}

function doGet() {
  return json({ ok: true, ready: !!PropertiesService.getScriptProperties().getProperty("PASSCODE") });
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const passcode = PropertiesService.getScriptProperties().getProperty("PASSCODE");
    if (!passcode) return json({ ok: false, error: "PASSCODE script property isn't set" });
    if (String(d.passcode || "") !== passcode) return json({ ok: false, error: "Wrong passcode" });

    const clean = (s) => String(s == null ? "" : s).trim().slice(0, 120);
    const date = clean(d.date);
    const note = clean(d.note);
    const players = (d.players || []).map((p) => clean(p).toLowerCase()).filter(Boolean);
    const decks = (d.decks || []).map((x) => clean(x).toLowerCase());
    const winners = (d.winners || []).map((w) => clean(w).toLowerCase()).filter((w) => players.indexOf(w) !== -1);
    const first = clean(d.first).toLowerCase();
    if (first && players.indexOf(first) === -1) return json({ ok: false, error: "First player isn't in this game" });

    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) return json({ ok: false, error: "Bad date" });
    if (players.length < 2 || players.length > 10) return json({ ok: false, error: "Need 2-10 players" });
    if (decks.length !== players.length) return json({ ok: false, error: "Each player needs a deck" });
    if (players.some((p) => p.indexOf(",") !== -1)) return json({ ok: false, error: "Player names can't contain commas" });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sheet = logSheet();
      const layout = readHeader(sheet);
      if (!layout) return json({ ok: false, error: "Row 1 should start with Date | Winner | First | Note" });
      if (first && layout.col.first == null) return json({ ok: false, error: "Add a First column to the sheet (before the player columns)" });

      // Add a column for any new player.
      const known = layout.players.slice();
      players.forEach((p) => {
        if (known.indexOf(p) === -1) {
          known.push(p);
          const col = layout.playerStart + known.length; // 1-based
          sheet.getRange(1, col).setNumberFormat("@").setValue(p).setFontWeight("bold");
        }
      });

      const row = new Array(layout.playerStart + known.length).fill("");
      const values = { date: date, winner: winners.join(", "), first: first, note: note };
      Object.keys(layout.col).forEach((k) => { row[layout.col[k]] = values[k]; });
      known.forEach((p, i) => {
        const j = players.indexOf(p);
        row[layout.playerStart + i] = j === -1 ? "" : decks[j];
      });
      const range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length);
      range.setNumberFormat("@"); // keep the date as plain text
      range.setValues([row]);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

/**
 * Reads row 1. The leading columns named Date / Winner / First / Note (any order)
 * are the game fields; every column after them is a player.
 * Returns { col: {date: 0, ...}, playerStart, players } or null if Date/Winner are missing.
 */
function readHeader(sheet) {
  const lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() < 1 || lastCol < 2) return null;
  const header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map((h) => String(h).trim().toLowerCase());
  const col = {};
  let i = 0;
  while (i < header.length && FIXED_COLS.indexOf(header[i]) !== -1) { col[header[i]] = i; i++; }
  if (col.date == null || col.winner == null) return null;
  return { col: col, playerStart: i, players: header.slice(i).filter((h) => h !== "") };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

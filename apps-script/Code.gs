/**
 * Magic Pod Metrics - Apps Script for the game log sheet.
 *
 * Paste this into the sheet's Apps Script editor (Extensions > Apps Script),
 * set a PASSCODE script property, and deploy as a web app. Full steps are in
 * the README. Do NOT put the passcode in this file.
 *
 * The log is one row per game:
 *   Date | Winner | Note | chuck | dustin | pk | ...
 * - Winner: one name, several separated by commas, or blank for no winner.
 * - Each player has a column holding the deck they played (blank = sat out).
 * - A new player gets a new column added on the right.
 */

const LOG_SHEET_ID = 0; // the tab's gid
const FIXED_COLS = ["Date", "Winner", "Note"];

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

    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) return json({ ok: false, error: "Bad date" });
    if (players.length < 2 || players.length > 10) return json({ ok: false, error: "Need 2-10 players" });
    if (decks.length !== players.length) return json({ ok: false, error: "Each player needs a deck" });
    if (players.some((p) => p.indexOf(",") !== -1)) return json({ ok: false, error: "Player names can't contain commas" });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sheet = logSheet();
      const header = readHeader(sheet);
      if (!header) return json({ ok: false, error: "The log isn't in the one-row-per-game layout yet" });

      // Add a column for any new player.
      const known = header.slice(FIXED_COLS.length).map((h) => h.toLowerCase());
      players.forEach((p) => {
        if (known.indexOf(p) === -1) {
          known.push(p);
          const col = FIXED_COLS.length + known.length;
          sheet.getRange(1, col).setNumberFormat("@").setValue(p).setFontWeight("bold");
        }
      });

      const row = [date, winners.join(", "), note].concat(known.map((p) => {
        const i = players.indexOf(p);
        return i === -1 ? "" : decks[i];
      }));
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

/** Returns the header row if the sheet is in the one-row layout, else null. */
function readHeader(sheet) {
  const lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() < 1 || lastCol < FIXED_COLS.length) return null;
  const header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map((h) => String(h).trim());
  const isRowLayout = FIXED_COLS.every((c, i) => header[i].toLowerCase() === c.toLowerCase());
  return isRowLayout ? header.filter((h, i) => i < FIXED_COLS.length || h !== "") : null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

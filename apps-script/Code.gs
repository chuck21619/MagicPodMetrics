/**
 * Magic Pod Metrics - "Log a game" endpoint.
 *
 * Paste this into the sheet's Apps Script editor (Extensions > Apps Script),
 * set a PASSCODE script property, and deploy as a web app. Full steps are in
 * the README. Do NOT put the passcode in this file.
 *
 * Appends one game block at the bottom of the log, in the same layout as the
 * hand-written entries:
 *   date      | 11/26/2026 | note
 *   winner    | dustin     | (2nd winner)
 *   players   | chuck      | dustin | pk
 *   commander | deck       | deck   | deck
 */

const LOG_SHEET_ID = 0; // the tab's gid

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

    const width = Math.max(4, players.length + 1, winners.length + 1);
    const pad = (row) => row.concat(new Array(width - row.length).fill(""));
    const block = [
      pad(["date", date].concat(note ? [note] : [])),
      pad(["winner"].concat(winners.length ? winners : ["no one"])),
      pad(["players"].concat(players)),
      pad(["commander"].concat(decks)),
    ];

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets().filter((s) => s.getSheetId() === LOG_SHEET_ID)[0];
      if (!sheet) return json({ ok: false, error: "Log tab not found" });
      const last = sheet.getLastRow();
      const start = last === 0 ? 1 : last + 2; // leave one blank row between games
      const range = sheet.getRange(start, 1, block.length, width);
      range.setNumberFormat("@"); // keep the date as plain text, like the rest of the log
      range.setValues(block);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

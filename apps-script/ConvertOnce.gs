/**
 * ONE-TIME conversion of the game log from the block layout to one row per game.
 *
 * How to use:
 *   1. In the sheet: Extensions > Apps Script.
 *   2. Click + next to "Files" > Script, name it ConvertOnce, paste this file in, save.
 *   3. Pick convertLogOnce in the function dropdown at the top and click Run.
 *   4. Check the sheet. If anything looks wrong: File > Version history in the sheet.
 *   5. Delete this ConvertOnce file from the Apps Script project.
 *
 * Old layout (per game):            New layout (one row per game):
 *   date      | 3/7/2026 | note      Date | Winner | Note | chuck | dustin | pk
 *   winner    | dustin
 *   players   | chuck | dustin | pk
 *   commander | deck  | deck   | deck
 *
 * Everything lives inside convertLogOnce so nothing clashes with Code.gs.
 */
function convertLogOnce() {
  const LOG_TAB_GID = 0;
  const NO_WINNER = ["", "dnf", "did not finish", "no one", "none", "draw", "n/a"];

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets().filter((s) => s.getSheetId() === LOG_TAB_GID)[0];
  if (!sheet) throw new Error("Log tab not found");

  const rows = sheet.getDataRange().getDisplayValues();
  const a1 = String(rows[0][0] || "").trim().toLowerCase();
  const b1 = String(rows[0][1] || "").trim().toLowerCase();
  if (a1 === "date" && b1 === "winner") throw new Error("Already converted - row 1 is already Date | Winner | Note. Nothing changed.");

  const result = convertLogOnce_blocksToRows(rows, NO_WINNER);
  if (!result.out.length) throw new Error("No games found - nothing changed.");

  const table = [result.header].concat(result.out);
  sheet.clearContents();
  const range = sheet.getRange(1, 1, table.length, result.header.length);
  range.setNumberFormat("@"); // keep dates as plain text, like before
  range.setValues(table);
  sheet.getRange(1, 1, 1, result.header.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
  SpreadsheetApp.flush();
  Logger.log("Converted " + result.out.length + " games. Players: " + result.header.slice(3).join(", "));
}

/** Pure conversion (no Sheets calls). The trailing underscore hides it from the Run menu. */
function convertLogOnce_blocksToRows(rows, NO_WINNER) {
  const games = [];
  let cur = null;
  let lastKey = null;
  rows.forEach((row) => {
    const key = String(row[0] || "").trim().toLowerCase();
    const vals = row.slice(1).map((v) => String(v == null ? "" : v).trim());
    if (key === "date") {
      cur = { date: vals[0], note: vals.slice(1).filter(Boolean).join(" "), winners: [], winnerNote: "", players: [], decks: [] };
      games.push(cur);
    } else if (!cur) {
      return;
    } else if (key === "winner" || key === "winners") {
      const ws = vals.map((v) => v.toLowerCase()).filter(Boolean);
      cur.winners = ws.filter((w) => NO_WINNER.indexOf(w) === -1);
      const marker = ws.filter((w) => NO_WINNER.indexOf(w) !== -1)[0];
      if (marker) cur.winnerNote = marker === "dnf" ? "did not finish" : marker;
    } else if (key === "players") {
      cur.players = vals.map((v) => v.toLowerCase()).filter(Boolean);
    } else if (key === "commander" || key === "commanders") {
      cur.decks = vals.slice();
    } else if (key === "" && lastKey === "commander" && vals.some(Boolean)) {
      // A second line under a deck (e.g. a partner commander) joins with " + ".
      vals.forEach((v, i) => { if (v) cur.decks[i] = cur.decks[i] ? cur.decks[i] + " + " + v : v; });
      return;
    }
    if (key) lastKey = key === "commanders" ? "commander" : key;
  });

  const valid = games.filter((g) => g.players.length);
  const players = [];
  valid.forEach((g) => g.players.forEach((p) => { if (players.indexOf(p) === -1) players.push(p); }));
  const header = ["Date", "Winner", "Note"].concat(players);
  const out = valid.map((g) => {
    const winners = g.winners.filter((w) => g.players.indexOf(w) !== -1);
    const note = [g.note, g.winnerNote].filter(Boolean).join("; ");
    const decks = players.map((p) => {
      const i = g.players.indexOf(p);
      // Blank = sat out in the new layout, so a player who played with no deck written gets "unknown".
      return i === -1 ? "" : (String(g.decks[i] || "").trim() || "unknown");
    });
    return [g.date, winners.join(", "), note].concat(decks);
  });
  return { header: header, out: out };
}

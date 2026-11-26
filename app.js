// ---- Config -------------------------------------------------------------
const SHEET_ID = "1_MfWXpThGr1jBHWyuX50s2UDzmNB5iG13GLLXrg7SJg";
const SHEET_GID = "0";
const AUTO_REFRESH_MS = 60_000;
// Paste the Apps Script web app URL here (ends in /exec) to enable "Log a game".
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzaWB3jRP8Wzl5hb5yxrqCiWSBC-h3bIPTOULtarogRVSR5HzmpBe_mOoJ02xL9LJGAbA/exec";
const ROLLING_WINDOW = 10;
const NO_WINNER = new Set(["", "dnf", "did not finish", "no one", "none", "draw", "n/a"]);

// ---- Fetching -----------------------------------------------------------
// Uses the Google Visualization endpoint with a JSONP callback, so the page
// works when opened straight from disk (file://) as well as when hosted.
let jsonpCounter = 0;
function fetchSheetRows() {
  return new Promise((resolve, reject) => {
    const cb = `__sheetCb${++jsonpCounter}`;
    const script = document.createElement("script");
    const timer = setTimeout(() => cleanup(new Error("Timed out reading the sheet")), 15000);
    function cleanup(err, data) {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
      err ? reject(err) : resolve(data);
    }
    window[cb] = (resp) => {
      if (resp.status !== "ok") return cleanup(new Error("Sheet returned an error (is it still shared?)"));
      const rows = resp.table.rows.map((r) =>
        (r.c || []).map((cell) => (cell && cell.v != null ? String(cell.v).trim() : ""))
      );
      cleanup(null, rows);
    };
    script.onerror = () => cleanup(new Error("Could not reach Google Sheets"));
    script.src =
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
      `?gid=${SHEET_GID}&headers=0&tqx=out:json;responseHandler:${cb}&_=${Date.now()}`;
    document.head.appendChild(script);
  });
}

// ---- Parsing ------------------------------------------------------------
// The log is one row per game, with a column per player holding their deck:
//   Date      | Winner    | Note | chuck | dustin | pk | ...
//   3/7/2026  | dustin    |      | deck  | deck   | deck
//   7/21/2026 | chuck, pk |      | mad   | mad    | mad
// Winner: comma-separated names, or blank for no winner. Blank deck = sat out.
function parseGames(rows) {
  if (norm(rows[0]?.[0]) !== "date" || norm(rows[0]?.[1]) !== "winner") {
    throw new Error("The log's first row should be Date | Winner | Note | players…");
  }
  const players = rows[0].slice(3).map(norm);
  return rows.slice(1)
    .filter((r) => (r[0] || "").trim())
    .map((r) => {
      const g = { date: parseDate(r[0]), dateText: r[0], note: r[2] || "", players: [], deckOf: {} };
      players.forEach((p, i) => {
        const deck = (r[3 + i] || "").trim().toLowerCase();
        if (p && deck) { g.players.push(p); g.deckOf[p] = deck; }
      });
      g.winners = (r[1] || "").split(/,|&/).map(norm).filter((w) => !NO_WINNER.has(w) && g.players.includes(w));
      g.finished = g.winners.length > 0;
      return g;
    })
    .filter((g) => g.players.length)
    .map((g, i) => ({ ...g, index: i + 1 }));
}
const norm = (s) => (s || "").trim().toLowerCase();
function parseDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s || "");
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return new Date(y, +m[1] - 1, +m[2]);
}
const deckType = (deck) => (deck === "mad" ? "Mad" : /precon/.test(deck) ? "Precon" : "Own deck");
const cap = (s) => (s.length <= 2 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1));

// ---- Stats --------------------------------------------------------------
function computeStats(games) {
  const players = [...new Set(games.flatMap((g) => g.players))].sort();
  const finished = games.filter((g) => g.finished);
  const per = {};
  for (const p of players) per[p] = { games: 0, wins: 0, byType: {}, decks: {} };

  for (const g of finished) {
    for (const p of g.players) {
      const s = per[p];
      const won = g.winners.includes(p);
      s.games++; if (won) s.wins++;
      const d = g.deckOf[p];
      if (d === "unknown") continue; // deck wasn't recorded: counts toward win rate only
      const t = deckType(d);
      s.byType[t] ??= { games: 0, wins: 0 };
      s.byType[t].games++; if (won) s.byType[t].wins++;
      if (d && d !== "mad") {
        s.decks[d] ??= { games: 0, wins: 0 };
        s.decks[d].games++; if (won) s.decks[d].wins++;
      }
    }
  }

  // Streaks: consecutive finished games won (best) and lost (worst)
  const streak = {};
  for (const p of players) {
    let run = 0, best = 0, lossRun = 0, worst = 0;
    for (const g of finished) {
      if (!g.players.includes(p)) continue;
      const won = g.winners.includes(p);
      run = won ? run + 1 : 0;
      lossRun = won ? 0 : lossRun + 1;
      best = Math.max(best, run);
      worst = Math.max(worst, lossRun);
    }
    streak[p] = { current: run, currentLoss: lossRun, best, worst };
  }

  const nights = new Set(games.map((g) => g.dateText)).size;
  return { players, games, finished, per, streak, nights };
}

// ---- Rendering ----------------------------------------------------------
const charts = {};
let colorMap = {};

function css(name) {
  return getComputedStyle(document.querySelector(".viz-root")).getPropertyValue(name).trim();
}
function assignColors(players) {
  // Fixed order by player name so a player keeps their color across updates.
  colorMap = {};
  players.forEach((p, i) => { colorMap[p] = css(`--series-${(i % 8) + 1}`); });
}
function baseOptions() {
  const text = css("--text-secondary");
  const grid = css("--grid");
  Chart.defaults.color = text;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.borderColor = grid;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: {
        position: "top", align: "start",
        labels: {
          boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3,
          // Legend swatches always show the full color, even while bars are dimmed.
          generateLabels: (chart) => Chart.defaults.plugins.legend.labels.generateLabels(chart).map((l) => {
            const base = chart.data.datasets[l.datasetIndex]?.baseColor;
            if (base) { l.fillStyle = base; l.strokeStyle = base; }
            return l;
          }),
        },
      },
      tooltip: { padding: 10, cornerRadius: 6, boxPadding: 4 },
    },
  };
}
function draw(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}
// Hover dimming for bar charts: the hovered bar (or the hovered group, for
// grouped bars) keeps its color and every other bar fades.
const DIM_ALPHA = "4d"; // ~30% opacity
function dim(colorOf) {
  return (ctx) => {
    const c = colorOf(ctx);
    const h = ctx.chart.$hoverIndex;
    return h == null || ctx.dataIndex === h ? c : c + DIM_ALPHA;
  };
}
function dimOnHover(evt, active, chart) {
  const idx = active.length ? active[0].index : null;
  if (idx !== chart.$hoverIndex) {
    chart.$hoverIndex = idx;
    chart.update("none");
  }
}
// Un-dim when the mouse leaves the chart.
Chart.register({
  id: "dimReset",
  afterEvent(chart, args) {
    if (args.event.type === "mouseout" && chart.$hoverIndex != null) {
      chart.$hoverIndex = null;
      chart.update("none");
    }
  },
});
// Touch screens never send "mouse left the chart", so a tapped tooltip (and the
// bar dimming) would stick. Tapping anywhere outside a chart clears them.
document.addEventListener("pointerdown", (e) => {
  for (const chart of Object.values(charts)) {
    if (!chart || e.target === chart.canvas) continue;
    if (!chart.tooltip?.getActiveElements().length && chart.$hoverIndex == null) continue;
    chart.$hoverIndex = null;
    chart.setActiveElements([]);
    chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    chart.update("none");
  }
});
// Tooltip placement for bar charts: put the tooltip beside the hovered bar(s)
// so it never covers them or their value label.
Chart.Tooltip.positioners.beside = function (items) {
  if (!items.length) return false;
  const chart = this.chart;
  const area = chart.chartArea;
  const w = this.width || 160;
  const gap = 10;
  if (chart.options.indexAxis === "y") {
    // Horizontal bars: to the right of the value label at the bar's end.
    const el = items[0].element;
    const labelRoom = 52;
    const x = el.x + labelRoom;
    if (x + w <= chart.width) return { x, y: el.y, xAlign: "left", yAlign: "center" };
    return { x: el.x, y: el.y + el.height / 2 + 4, xAlign: "right", yAlign: "top" }; // no room: drop below the bar
  }
  // Vertical (grouped) bars: beside the whole group, aligned with its top.
  const left = Math.min(...items.map((i) => i.element.x - i.element.width / 2));
  const right = Math.max(...items.map((i) => i.element.x + i.element.width / 2));
  const barTop = Math.min(...items.map((i) => i.element.y));
  const top = Math.max(area.top, Math.min(barTop, area.bottom - (this.height || 80))); // keep it inside the plot
  if (right + gap + w <= chart.width) return { x: right + gap, y: top, xAlign: "left", yAlign: "top" };
  return { x: left - gap, y: top, xAlign: "right", yAlign: "top" };
};
const pct = (w, g) => (g ? (100 * w) / g : 0);

function render(stats) {
  const { players, games, finished, per, streak, nights } = stats;
  assignColors(players);
  const opts = baseOptions();
  const surface = css("--surface-1");

  // Streaks: one row per player with current / longest win / longest loss.
  const plural = (k, word) => `${k} ${k === 1 ? word : word === "loss" ? "losses" : word + "s"}`;
  const recordWin = Math.max(...players.map((p) => streak[p].best));
  const recordLoss = Math.max(...players.map((p) => streak[p].worst));
  document.getElementById("streaks").innerHTML =
    `<div class="streak-row streak-head"><span>Player</span><span>Current</span><span>Longest win streak</span><span>Longest losing streak</span></div>` +
    [...players]
      .sort((a, b) => streak[b].current - streak[a].current || streak[a].currentLoss - streak[b].currentLoss)
      .map((p) => {
        const s = streak[p];
        const up = s.current > 0;
        return `<div class="streak-row" style="--pc:${colorMap[p]}">
          <span class="sname"><span class="swatch" style="background:${colorMap[p]}"></span>${esc(cap(p))}</span>
          <span class="scell"><em>Current</em><span class="cur ${up ? "up" : "down"} ${(up ? s.current === recordWin : s.currentLoss === recordLoss) ? "at-longest" : ""}">${up ? "▲" : "▼"} ${up ? plural(s.current, "win") : plural(s.currentLoss, "loss")}</span></span>
          <span class="scell ${s.best === recordWin ? "record" : ""}"><em>Longest win</em>${plural(s.best, "win")}</span>
          <span class="scell ${s.worst === recordLoss ? "record" : ""}"><em>Longest loss</em>${plural(s.worst, "loss")}</span>
        </div>`;
      })
      .join("");

  // Win rate (horizontal bar)
  const sorted = [...players].sort((a, b) => pct(per[b].wins, per[b].games) - pct(per[a].wins, per[a].games));
  draw("winRateChart", {
    type: "bar",
    data: {
      labels: sorted.map(cap),
      datasets: [{
        label: "Win rate",
        data: sorted.map((p) => +pct(per[p].wins, per[p].games).toFixed(1)),
        backgroundColor: dim((ctx) => colorMap[sorted[ctx.dataIndex]]), hoverBackgroundColor: dim((ctx) => colorMap[sorted[ctx.dataIndex]]),
        borderRadius: 4, borderSkipped: "start", barThickness: 28,
      }],
    },
    options: {
      ...opts, indexAxis: "y", onHover: dimOnHover,
      plugins: {
        ...opts.plugins, legend: { display: false },
        tooltip: { ...opts.plugins.tooltip, position: "beside", callbacks: { label: (c) => { const p = sorted[c.dataIndex]; return ` ${c.raw}%  (${per[p].wins} wins / ${per[p].games} games)`; } } },
      },
      scales: {
        x: { min: 0, max: 100, ticks: { callback: (v) => v + "%" }, grid: { color: css("--grid") } },
        y: { grid: { display: false }, ticks: { color: css("--text-primary"), font: { weight: 600 } } },
      },
    },
    plugins: [valueLabels((v) => v + "%")],
  });

  // Cumulative wins
  const labels = finished.map((g) => `#${g.index}`);
  const running = Object.fromEntries(players.map((p) => [p, 0]));
  const cumData = Object.fromEntries(players.map((p) => [p, []]));
  for (const g of finished) {
    for (const p of players) { if (g.winners.includes(p)) running[p]++; cumData[p].push(running[p]); }
  }
  draw("cumulativeChart", {
    type: "line",
    data: { labels, datasets: players.map((p) => lineSet(cap(p), cumData[p], colorMap[p], surface)) },
    options: lineOptions(opts, finished, { y: { beginAtZero: true, title: { display: true, text: "Wins" } } }),
  });

  // Rolling win rate
  const rollData = Object.fromEntries(players.map((p) => [p, []]));
  const hist = Object.fromEntries(players.map((p) => [p, []]));
  for (const g of finished) {
    for (const p of players) {
      if (g.players.includes(p)) hist[p].push(g.winners.includes(p) ? 1 : 0);
      const h = hist[p].slice(-ROLLING_WINDOW);
      rollData[p].push(h.length >= Math.min(ROLLING_WINDOW, 5) ? +(100 * h.reduce((a, b) => a + b, 0) / h.length).toFixed(0) : null);
    }
  }
  draw("rollingChart", {
    type: "line",
    data: { labels, datasets: players.map((p) => lineSet(cap(p), rollData[p], colorMap[p], surface)) },
    options: lineOptions(opts, finished, { y: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } } }, "%"),
  });

  // Wins by month
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const months = [...new Set(finished.filter((g) => g.date).map((g) => monthKey(g.date)))].sort();
  const monthLabel = (k) => new Date(+k.slice(0, 4), +k.slice(5) - 1, 1).toLocaleString(undefined, { month: "short", year: "2-digit" });
  draw("monthlyChart", {
    type: "bar",
    data: {
      labels: months.map(monthLabel),
      datasets: players.map((p) => ({
        label: cap(p),
        data: months.map((m) => finished.filter((g) => g.date && monthKey(g.date) === m && g.winners.includes(p)).length),
        baseColor: colorMap[p], backgroundColor: dim(() => colorMap[p]), hoverBackgroundColor: dim(() => colorMap[p]), borderRadius: 4, borderSkipped: "start",
        borderColor: surface, borderWidth: { left: 1, right: 1 },
      })),
    },
    options: { ...opts, plugins: { ...opts.plugins, tooltip: { ...opts.plugins.tooltip, position: "beside" } }, onHover: dimOnHover, interaction: { mode: "index", intersect: false }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });

  // Win rate by deck type
  const types = ["Own deck", "Precon", "Mad"];
  draw("deckTypeChart", {
    type: "bar",
    data: {
      labels: types,
      datasets: players.map((p) => ({
        label: cap(p),
        data: types.map((t) => { const s = per[p].byType[t]; return s ? +pct(s.wins, s.games).toFixed(1) : 0; }),
        baseColor: colorMap[p], backgroundColor: dim(() => colorMap[p]), hoverBackgroundColor: dim(() => colorMap[p]), borderRadius: 4, borderSkipped: "start",
        borderColor: surface, borderWidth: { left: 1, right: 1 },
      })),
    },
    options: {
      ...opts, onHover: dimOnHover, interaction: { mode: "index", intersect: false },
      plugins: {
        ...opts.plugins,
        tooltip: { ...opts.plugins.tooltip, position: "beside", callbacks: { label: (c) => { const p = players[c.datasetIndex]; const s = per[p].byType[types[c.dataIndex]] || { wins: 0, games: 0 }; return ` ${cap(p)}: ${c.raw}% (${s.wins}/${s.games})`; } } },
      },
      scales: { x: { grid: { display: false } }, y: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } } },
    },
  });

  // Commanders
  document.getElementById("commanders").innerHTML = players.map((p) => {
    const decks = Object.entries(per[p].decks).sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins).slice(0, 8);
    const max = decks[0]?.[1].games || 1;
    const rows = decks.map(([name, s]) => `
      <div class="cmd-row" title="${esc(name)}: ${s.wins} wins in ${s.games} games">
        <div class="cmd-name"><span>${esc(name)}</span><span>${s.wins}W / ${s.games}G</span></div>
        <div class="cmd-track">
          <div class="cmd-games" style="width:${(100 * s.games) / max}%;background:${colorMap[p]}"></div>
          <div class="cmd-wins" style="width:${(100 * s.wins) / max}%;background:${colorMap[p]}"></div>
        </div>
      </div>`).join("");
    return `<div><h3><span class="swatch" style="background:${colorMap[p]}"></span>${cap(p)}</h3>${rows || '<p class="note">No decks yet.</p>'}</div>`;
  }).join("");

  // Recent games table
  const recent = games.slice(-15).reverse();
  document.getElementById("recentTable").innerHTML =
    `<thead><tr><th>#</th><th>Date</th>${players.map((p) => `<th class="pcol" style="--pc:${colorMap[p]}"><span class="swatch" style="background:${colorMap[p]}"></span>${cap(p)}</th>`).join("")}</tr></thead><tbody>` +
    recent.map((g) => `<tr class="${g.finished ? "" : "nowin"}">
      <td class="num">${g.index}</td>
      <td>${esc(g.dateText)}${g.finished ? "" : '<span class="tag nowin-tag">no winner</span>'}${g.note ? `<span class="tag">${esc(g.note)}</span>` : ""}</td>
      ${players.map((p) => {
        const deck = g.deckOf[p] || "—";
        const won = g.winners.includes(p);
        return `<td class="cmd pcell ${won ? "won" : ""} ${deck === "mad" ? "mad" : ""}" style="--pc:${colorMap[p]}">${esc(deck)}</td>`;
      }).join("")}
    </tr>`).join("") + "</tbody>";
}

// Gaussian-weighted average of nearby games, for drawing only. The window shrinks
// symmetrically at the ends so the first and last points stay exact.
const SMOOTH_RADIUS = 4;
function smooth(data, r = SMOOTH_RADIUS) {
  const sigma = r / 2;
  return data.map((v, i) => {
    if (v == null) return null;
    const k = Math.min(r, i, data.length - 1 - i);
    let sum = 0, wsum = 0;
    for (let j = i - k; j <= i + k; j++) {
      if (data[j] == null) continue;
      const w = Math.exp(-((j - i) ** 2) / (2 * sigma * sigma));
      sum += w * data[j]; wsum += w;
    }
    return sum / wsum;
  });
}
function lineSet(label, data, color, surface) {
  return {
    label, data: smooth(data), exact: data, // tooltips show the exact values
    borderColor: color, backgroundColor: color, pointHoverBackgroundColor: color,
    borderWidth: 2, tension: 0.3, spanGaps: true,
    pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: surface, pointHoverBorderWidth: 2,
  };
}
function lineOptions(opts, finished, scales, suffix = "") {
  return {
    ...opts,
    interaction: { mode: "index", intersect: false },
    plugins: {
      ...opts.plugins,
      tooltip: {
        ...opts.plugins.tooltip,
        itemSort: (a, b) => (b.dataset.exact[b.dataIndex] ?? -1) - (a.dataset.exact[a.dataIndex] ?? -1),
        callbacks: {
          title: (items) => { const g = finished[items[0].dataIndex]; return `Game #${g.index} · ${g.dateText} · won by ${g.winners.map(cap).join(" & ")}`; },
          label: (c) => { const v = c.dataset.exact[c.dataIndex]; return ` ${c.dataset.label}: ${v ?? "–"}${v != null ? suffix : ""}`; },
        },
      },
    },
    scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12, autoSkip: true } }, ...scales },
  };
}
// Draws the value at the end of each horizontal bar.
function valueLabels(fmt) {
  return {
    id: "valueLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = css("--text-primary");
      ctx.font = `600 13px ${Chart.defaults.font.family}`;
      ctx.textBaseline = "middle";
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        ctx.fillText(fmt(chart.data.datasets[0].data[i]), bar.x + 8, bar.y);
      });
      ctx.restore();
    },
  };
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---- Update loop (always on) --------------------------------------------
const statusEl = document.getElementById("status");
let lastSignature = null;
let lastStats = null;

async function update() {
  try {
    const rows = await fetchSheetRows();
    const sig = JSON.stringify(rows);
    if (sig !== lastSignature) {
      lastSignature = sig;
      const games = parseGames(rows);
      if (!games.length) throw new Error("No games found in the log");
      lastStats = computeStats(games);
      render(lastStats);
    }
    statusEl.classList.remove("error");
    statusEl.textContent = `${lastStats.games.length} games · ${lastStats.nights} game nights · checked ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  } catch (err) {
    statusEl.classList.add("error");
    statusEl.textContent = `Couldn't update: ${err.message}`;
  }
}

setInterval(() => { if (!document.hidden) update(); }, AUTO_REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) update(); });
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => lastStats && render(lastStats));
// ---- Color palette picker ----
const PALETTE_KEY = "magicpod.palette";
const PALETTES = ["jewel", "classic", "bright"];
function applyPalette(name) {
  if (!PALETTES.includes(name)) name = "jewel";
  document.querySelector(".viz-root").dataset.palette = name;
  document.querySelector(`input[name=palette][value=${name}]`).checked = true;
}
applyPalette(localStorage.getItem(PALETTE_KEY));
document.querySelectorAll("input[name=palette]").forEach((r) => r.addEventListener("change", () => {
  localStorage.setItem(PALETTE_KEY, r.value);
  applyPalette(r.value);
  if (lastStats) render(lastStats);
}));
document.getElementById("sheetLink").href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}`;

// ---- Log a game form ----------------------------------------------------
// Submits to a Google Apps Script web app bound to the sheet (see apps-script/Code.gs).
const PASS_KEY = "magicpod.passcode";
const dlg = document.getElementById("logDialog");
const form = document.getElementById("logForm");
const formMsg = document.getElementById("formMsg");
let formPlayers = [];

function todayText() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function openLogForm() {
  formMsg.textContent = "";
  formMsg.className = "form-msg";
  if (!APPS_SCRIPT_URL) {
    formMsg.textContent = "Logging isn't set up yet: the Apps Script URL is missing from app.js (see README).";
    formMsg.classList.add("error");
  }
  const games = lastStats?.games || [];
  formPlayers = games.length ? [...games[games.length - 1].players] : [];
  form.date.value = todayText();
  form.note.value = "";
  form.passcode.value = localStorage.getItem(PASS_KEY) || "";
  document.getElementById("passRow").hidden = !!localStorage.getItem(PASS_KEY);
  renderPlayerRows();
  dlg.showModal();
}

function decksFor(player) {
  // Most recent first, unique, no "mad"
  const seen = new Set();
  const out = [];
  for (const g of [...(lastStats?.games || [])].reverse()) {
    const d = g.deckOf[player];
    if (d && d !== "unknown" && !seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out;
}

function renderPlayerRows() {
  const wrap = document.getElementById("playerRows");
  const prev = {};
  wrap.querySelectorAll(".player-row").forEach((row) => {
    prev[row.dataset.player] = { deck: row.querySelector("input[type=text]").value, won: row.querySelector("input[type=checkbox]").checked };
  });
  wrap.innerHTML = formPlayers.map((p, i) => `
    <div class="player-row" data-player="${esc(p)}">
      <button type="button" class="icon" title="Remove ${esc(cap(p))}" data-remove="${i}">×</button>
      <span class="swatch" style="background:${colorMap[p] || "var(--text-muted)"}"></span>
      <span class="pname">${esc(cap(p))}</span>
      <input type="text" list="decks-${i}" placeholder="Commander / deck (or mad)" value="${esc(prev[p]?.deck || "")}" required />
      <datalist id="decks-${i}">${["mad", ...decksFor(p).filter((d) => d !== "mad")].map((d) => `<option value="${esc(d)}">`).join("")}</datalist>
      <label class="won"><input type="checkbox" ${prev[p]?.won ? "checked" : ""} /> Won</label>
    </div>`).join("");
  wrap.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
    formPlayers.splice(+b.dataset.remove, 1);
    renderPlayerRows();
  }));
  wrap.querySelectorAll(".won input").forEach((c) => c.addEventListener("change", () => { if (c.checked) form.noWinner.checked = false; }));
}

document.getElementById("addPlayerBtn").addEventListener("click", () => {
  const name = norm(form.newPlayer.value);
  if (name && !formPlayers.includes(name)) { formPlayers.push(name); renderPlayerRows(); }
  form.newPlayer.value = "";
});
form.newPlayer.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("addPlayerBtn").click(); } });
form.noWinner.addEventListener("change", () => {
  if (form.noWinner.checked) document.querySelectorAll("#playerRows .won input").forEach((c) => { c.checked = false; });
});
document.getElementById("logBtn").addEventListener("click", openLogForm);
document.getElementById("cancelBtn").addEventListener("click", () => dlg.close());
// Close when clicking the dimmed area outside the form box. Both press and
// release must be outside, so dragging out of a text box (or using the form's
// scrollbar) doesn't close it.
const outsideDialog = (e) => {
  const r = dlg.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
};
let pressedOutside = false;
dlg.addEventListener("pointerdown", (e) => { pressedOutside = outsideDialog(e); });
dlg.addEventListener("click", (e) => { if (pressedOutside && outsideDialog(e)) dlg.close(); pressedOutside = false; });
document.getElementById("changePass").addEventListener("click", (e) => {
  e.preventDefault();
  localStorage.removeItem(PASS_KEY);
  form.passcode.value = "";
  document.getElementById("passRow").hidden = false;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const rows = [...document.querySelectorAll("#playerRows .player-row")];
  const players = rows.map((r) => r.dataset.player);
  const decks = rows.map((r) => r.querySelector("input[type=text]").value.trim().toLowerCase());
  const winners = rows.filter((r) => r.querySelector(".won input").checked).map((r) => r.dataset.player);
  const [y, m, d] = form.date.value.split("-").map(Number);
  const passcode = form.passcode.value.trim();

  const fail = (msg) => { formMsg.textContent = msg; formMsg.className = "form-msg error"; };
  if (!APPS_SCRIPT_URL) return fail("Logging isn't set up yet (see README).");
  if (players.length < 2) return fail("Add at least two players.");
  if (!winners.length && !form.noWinner.checked) return fail("Tick who won, or tick \"No winner\".");
  if (!passcode) return fail("Enter the pod passcode.");

  const payload = { passcode, date: `${m}/${d}/${y}`, note: form.note.value.trim(), players, decks, winners };
  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";
  try {
    // text/plain keeps this a "simple" request, so the browser skips the CORS preflight Apps Script can't answer.
    const res = await fetch(APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || "The sheet rejected the game");
    localStorage.setItem(PASS_KEY, passcode);
    dlg.close();
    statusEl.textContent = "Game logged. Refreshing…";
    // Google's read endpoint can lag a few seconds behind a write.
    setTimeout(update, 2000);
    setTimeout(update, 8000);
  } catch (err) {
    if (/passcode/i.test(err.message)) { localStorage.removeItem(PASS_KEY); document.getElementById("passRow").hidden = false; }
    fail(`Couldn't save: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save game";
  }
});

update();

// ---- Info buttons -------------------------------------------------------
// Tap/click toggles the description; tapping elsewhere or Esc closes it.
// (On devices with a mouse, hovering also shows it — see styles.css.)
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".info-btn");
  document.querySelectorAll(".info.open").forEach((el) => {
    if (!btn || el !== btn.parentElement) { el.classList.remove("open"); el.querySelector(".info-btn").setAttribute("aria-expanded", "false"); }
  });
  if (btn) {
    const open = btn.parentElement.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(open));
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".info.open").forEach((el) => el.classList.remove("open"));
});

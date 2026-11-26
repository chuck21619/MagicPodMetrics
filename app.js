// ---- Config -------------------------------------------------------------
const SHEET_ID = "1_MfWXpThGr1jBHWyuX50s2UDzmNB5iG13GLLXrg7SJg";
const SHEET_GID = "0";
const AUTO_REFRESH_MS = 60_000;
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
// The log is a series of blocks:
//   date      | 3/7/2026 | (optional note)
//   winner    | dustin   | (second winner if shared)
//   players   | chuck    | dustin | pk
//   commander | deck     | deck   | deck
//   (blank)   |          | partner/extra line for a deck
function parseGames(rows) {
  const games = [];
  let cur = null;
  let lastKey = null;
  for (const row of rows) {
    const key = (row[0] || "").toLowerCase();
    const vals = row.slice(1);
    if (key === "date") {
      cur = { date: parseDate(vals[0]), dateText: vals[0], note: vals.slice(1).filter(Boolean).join(" "), winners: [], players: [], decks: [] };
      games.push(cur);
    } else if (!cur) {
      continue;
    } else if (key === "winner" || key === "winners") {
      cur.winners = vals.map(norm).filter((v) => !NO_WINNER.has(v));
    } else if (key === "players") {
      cur.players = vals.map(norm).filter(Boolean);
    } else if (key === "commander" || key === "commanders") {
      cur.decks = vals.map((v) => v.toLowerCase());
    } else if (key === "" && lastKey === "commander" && vals.some(Boolean)) {
      vals.forEach((v, i) => { if (v) cur.decks[i] = cur.decks[i] ? `${cur.decks[i]} + ${v.toLowerCase()}` : v.toLowerCase(); });
      continue; // keep lastKey as commander for further continuation lines
    }
    if (key) lastKey = key === "commanders" ? "commander" : key;
  }
  return games
    .filter((g) => g.players.length)
    .map((g, i) => {
      g.index = i + 1;
      g.winners = g.winners.filter((w) => g.players.includes(w));
      g.finished = g.winners.length > 0;
      g.deckOf = {};
      g.players.forEach((p, idx) => { g.deckOf[p] = (g.decks[idx] || "").trim(); });
      return g;
    });
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
      const t = deckType(g.deckOf[p]);
      s.byType[t] ??= { games: 0, wins: 0 };
      s.byType[t].games++; if (won) s.byType[t].wins++;
      const d = g.deckOf[p];
      if (d && d !== "mad") {
        s.decks[d] ??= { games: 0, wins: 0 };
        s.decks[d].games++; if (won) s.decks[d].wins++;
      }
    }
  }

  // Streaks (consecutive finished games won)
  const streak = {};
  for (const p of players) {
    let run = 0, best = 0;
    for (const g of finished) {
      if (!g.players.includes(p)) continue;
      run = g.winners.includes(p) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    streak[p] = { current: run, best };
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
      legend: { position: "top", align: "start", labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } },
      tooltip: { padding: 10, cornerRadius: 6, boxPadding: 4 },
    },
  };
}
function draw(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}
const pct = (w, g) => (g ? (100 * w) / g : 0);

function render(stats) {
  const { players, games, finished, per, streak, nights } = stats;
  assignColors(players);
  const opts = baseOptions();
  const surface = css("--surface-1");

  // Tiles
  const leader = [...players].sort((a, b) => pct(per[b].wins, per[b].games) - pct(per[a].wins, per[a].games))[0];
  const hot = [...players].sort((a, b) => streak[b].current - streak[a].current)[0];
  const bestStreakP = [...players].sort((a, b) => streak[b].best - streak[a].best)[0];
  const last = games[games.length - 1];
  const tiles = [
    ["Games logged", games.length, `${finished.length} finished · ${nights} game nights`],
    ["Top win rate", cap(leader), `${pct(per[leader].wins, per[leader].games).toFixed(0)}% (${per[leader].wins} of ${per[leader].games})`],
    ["On a streak", streak[hot].current ? cap(hot) : "Nobody", streak[hot].current ? `${streak[hot].current} win${streak[hot].current === 1 ? "" : "s"} in a row` : "Last game broke it"],
    ["Longest streak", streak[bestStreakP].best, `${cap(bestStreakP)}`],
    ["Last game", last.dateText, last.finished ? `Won by ${last.winners.map(cap).join(" & ")}` : "No winner"],
  ];
  document.getElementById("tiles").innerHTML = tiles
    .map(([l, v, d]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="detail">${d}</div></div>`)
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
        backgroundColor: sorted.map((p) => colorMap[p]),
        borderRadius: 4, borderSkipped: "start", barThickness: 28,
      }],
    },
    options: {
      ...opts, indexAxis: "y",
      plugins: {
        ...opts.plugins, legend: { display: false },
        tooltip: { ...opts.plugins.tooltip, callbacks: { label: (c) => { const p = sorted[c.dataIndex]; return ` ${c.raw}%  (${per[p].wins} wins / ${per[p].games} games)`; } } },
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
        backgroundColor: colorMap[p], borderRadius: 4, borderSkipped: "start",
        borderColor: surface, borderWidth: { left: 1, right: 1 },
      })),
    },
    options: { ...opts, interaction: { mode: "index", intersect: false }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } },
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
        backgroundColor: colorMap[p], borderRadius: 4, borderSkipped: "start",
        borderColor: surface, borderWidth: { left: 1, right: 1 },
      })),
    },
    options: {
      ...opts, interaction: { mode: "index", intersect: false },
      plugins: {
        ...opts.plugins,
        tooltip: { ...opts.plugins.tooltip, callbacks: { label: (c) => { const p = players[c.datasetIndex]; const s = per[p].byType[types[c.dataIndex]] || { wins: 0, games: 0 }; return ` ${cap(p)}: ${c.raw}% (${s.wins}/${s.games})`; } } },
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
    `<thead><tr><th>#</th><th>Date</th><th>Winner</th>${players.map((p) => `<th><span class="swatch" style="background:${colorMap[p]}"></span>${cap(p)}</th>`).join("")}</tr></thead><tbody>` +
    recent.map((g) => `<tr>
      <td>${g.index}</td><td>${esc(g.dateText)}${g.note ? `<span class="tag">${esc(g.note)}</span>` : ""}</td>
      <td class="win">${g.finished ? g.winners.map(cap).join(" & ") : '<span class="tag">no winner</span>'}</td>
      ${players.map((p) => `<td class="cmd ${g.winners.includes(p) ? "win" : ""}">${esc(g.deckOf[p] || "—")}</td>`).join("")}
    </tr>`).join("") + "</tbody>";
}

function lineSet(label, data, color, surface) {
  return {
    label, data, borderColor: color, backgroundColor: color,
    borderWidth: 2, tension: 0.25, spanGaps: true,
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
        itemSort: (a, b) => (b.raw ?? -1) - (a.raw ?? -1),
        callbacks: {
          title: (items) => { const g = finished[items[0].dataIndex]; return `Game #${g.index} · ${g.dateText} · won by ${g.winners.map(cap).join(" & ")}`; },
          label: (c) => ` ${c.dataset.label}: ${c.raw ?? "–"}${c.raw != null ? suffix : ""}`,
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

// ---- Update loop --------------------------------------------------------
const statusEl = document.getElementById("status");
const btn = document.getElementById("refreshBtn");
const auto = document.getElementById("autoRefresh");
let lastSignature = null;
let lastStats = null;
let timer = null;

async function update({ manual = false } = {}) {
  btn.disabled = true;
  if (manual) btn.textContent = "Updating…";
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
    statusEl.textContent = `${lastStats.games.length} games · checked ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  } catch (err) {
    statusEl.classList.add("error");
    statusEl.textContent = `Couldn't update: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Update now";
  }
}

function schedule() {
  clearInterval(timer);
  if (auto.checked) timer = setInterval(() => { if (!document.hidden) update(); }, AUTO_REFRESH_MS);
}

btn.addEventListener("click", () => update({ manual: true }));
auto.addEventListener("change", schedule);
document.addEventListener("visibilitychange", () => { if (!document.hidden && auto.checked) update(); });
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => lastStats && render(lastStats));
document.getElementById("sheetLink").href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}`;

update();
schedule();

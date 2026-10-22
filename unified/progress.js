/* FIT HQ Progress: weight chart (raw + weekly average), measurements,
   nutrition & workout summaries. All charts draw from stored records. */
"use strict";
let progRange = 90; // days; 0 = all
function drawChart(cv, series, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = 190;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px";
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  const all = series.flatMap(s => s.pts);
  if (all.length < 2) { ctx.fillStyle = "#9a9ba4"; ctx.font = "13px system-ui"; ctx.fillText("Not enough data yet — log a few more points.", 10, 30); return; }
  let min = Math.min(...all.map(p => p[1])), max = Math.max(...all.map(p => p[1]));
  const padV = Math.max(0.5, (max - min) * 0.15); min -= padV; max += padV;
  const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]));
  const X = t => 34 + (t - t0) / Math.max(1, t1 - t0) * (W - 44);
  const Y = v => 12 + (1 - (v - min) / (max - min)) * (H - 44);
  ctx.strokeStyle = "#2e3038"; ctx.fillStyle = "#6d6e77"; ctx.font = "10px system-ui"; ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const v = min + (max - min) * i / 3, y = Y(v);
    ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(W - 10, y); ctx.stroke();
    ctx.fillText(opts.fmt ? opts.fmt(v) : String(Math.round(v)), 2, y + 3);
  }
  const d0 = new Date(t0), d1 = new Date(t1);
  ctx.fillText(d0.toLocaleDateString(undefined, {month: "short", day: "numeric"}), 34, H - 8);
  const lbl = d1.toLocaleDateString(undefined, {month: "short", day: "numeric"});
  ctx.fillText(lbl, W - 10 - ctx.measureText(lbl).width, H - 8);
  for (const s of series) {
    if (s.pts.length < 2) continue;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2;
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    s.pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
    ctx.stroke(); ctx.setLineDash([]);
    if (s.dots) { ctx.fillStyle = s.color; for (const p of s.pts) { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 2.4, 0, 7); ctx.fill(); } }
  }
}
function rollingAvg(ws, days = 7) {
  return ws.map(w => {
    const from = addDays(w.date, -(days - 1));
    const inWin = ws.filter(x => x.date >= from && x.date <= w.date);
    return [parseKey(w.date).getTime(), inWin.reduce((a, x) => a + x.kg, 0) / inWin.length];
  });
}
function renderProgress() {
  const el = $("#view-progress"), s = S();
  const ws = sortedWeights();
  const cur = latestWeight();
  const start = ws.length ? ws[0] : null;
  const change = (cur && start && ws.length > 1) ? cur.kg - start.kg : 0;
  const cutoff = progRange ? addDays(todayKey(), -progRange) : "0000-00-00";
  const wIn = ws.filter(w => w.date >= cutoff);
  const conv = v => s.units === "lb" ? kgToLb(v) : v;
  /* nutrition summaries */
  const wk = weekDates();
  const wkFood = wk.filter(d => dayEntries(d).length);
  const wkAvg = k => wkFood.length ? wkFood.reduce((a, d) => a + dayTotals(d)[k], 0) / wkFood.length : 0;
  const last30 = Array.from({length: 30}, (_, i) => addDays(todayKey(), -i));
  const d30 = last30.filter(d => dayEntries(d).length);
  const sess30 = DB.sessions.filter(x => last30.includes(x.date));
  const runs = DB.sessions.filter(x => x.type === "run");
  const bestRun = runs.reduce((b, r) => (r.detail?.km || 0) > (b?.detail?.km || 0) ? r : b, null);
  el.innerHTML = (typeof fitnessPanelsHTML === "function" ? fitnessPanelsHTML() : "") + `
  <div class="card"><div class="row between"><h3>⚖️ Weight</h3>
    <button class="btn sm" onclick="quickWeight()">＋ Log</button></div>
    <div class="grid3" style="margin:8px 0">
      <div class="stat"><div class="v">${start ? dispW(start.kg) : "—"}</div><div class="k">Start</div></div>
      <div class="stat"><div class="v">${cur ? dispW(cur.kg) : "—"}</div><div class="k">Current</div></div>
      <div class="stat"><div class="v" style="color:${change < 0 ? "var(--grn)" : change > 0 ? "var(--red)" : "inherit"}">${ws.length > 1 ? (change > 0 ? "+" : change < 0 ? "−" : "") + dispW(Math.abs(change)) : "—"}</div><div class="k">Change</div></div>
    </div>
    <p class="small muted">Goal: ${dispW(s.goalKg)} · Single weigh-ins bounce with water and meals — judge the orange weekly-average line, not single days.</p>
    <div class="row" style="margin:10px 0 4px">
      ${[[30,"30D"],[90,"90D"],[0,"All"]].map(([v, l]) => `<button class="chip ${progRange === v ? "on" : ""}" onclick="progRange=${v};renderProgress()">${l}</button>`).join("")}
    </div>
    <canvas class="chart" id="wChart"></canvas>
    <div class="list" style="margin-top:6px">${ws.slice().reverse().slice(0, 8).map(w => `
      <div class="item"><div class="grow"><div class="t">${dispW(w.kg)}</div><div class="s">${fmtDay(w.date)}</div></div>
      <button class="iconbtn" onclick="editWeight('${w.id}')">✏️</button>
      <button class="iconbtn" onclick="delWeight('${w.id}')">✕</button></div>`).join("") || `<div class="empty">No weigh-ins yet.</div>`}</div>
  </div>
  <div class="card"><div class="row between"><h3>📏 Measurements</h3><button class="btn sm ghost" onclick="addMeasure()">＋ Add</button></div>
    ${DB.measures.length ? `<div class="list">${DB.measures.slice().reverse().slice(0, 6).map(m => `
      <div class="item"><div class="grow"><div class="t">${esc(m.type)} — ${r1(m.cm)} cm</div><div class="s">${fmtDay(m.date)}</div></div>
      <button class="iconbtn" onclick="delMeasure('${m.id}')">✕</button></div>`).join("")}</div>`
    : `<p class="small muted">Optional: waist, chest, hips… tape measurements change even when the scale stalls.</p>`}
  </div>
  <div class="card"><h3>📅 This week</h3>
    <div class="grid3">
      <div class="stat"><div class="v">${wkFood.length ? r0(wkAvg("kcal")) : "—"}</div><div class="k">Avg kcal</div></div>
      <div class="stat"><div class="v">${wkFood.length ? r0(wkAvg("p")) + "g" : "—"}</div><div class="k">Avg protein</div></div>
      <div class="stat"><div class="v">${DB.sessions.filter(x => wk.includes(x.date)).length}</div><div class="k">Workouts</div></div>
    </div>
    <p class="small muted" style="margin-top:8px">Diary logged ${wkFood.length} of 7 days · Targets: ${s.targets.kcal} kcal, ${s.targets.p}g protein</p>
  </div>
  <div class="card"><h3>🗓️ Last 30 days</h3>
    <div class="grid3">
      <div class="stat"><div class="v">${d30.length}</div><div class="k">Days logged</div></div>
      <div class="stat"><div class="v">${sess30.length}</div><div class="k">Workouts</div></div>
      <div class="stat"><div class="v">${runs.length}</div><div class="k">Runs total</div></div>
    </div>
    ${bestRun ? `<p class="small muted" style="margin-top:8px">Longest run: <b style="color:var(--ink)">${r1(bestRun.detail.km)} km</b> on ${fmtDay(bestRun.date)}${bestRun.detail.paceSec ? ` · ${Math.floor(bestRun.detail.paceSec / 60)}:${pad2(Math.round(bestRun.detail.paceSec % 60))}/km` : ""}</p>` : ""}
    ${DB.sessions.length ? `<div class="list" style="margin-top:6px">${DB.sessions.slice().reverse().slice(0, 6).map(x => `
      <div class="item"><div class="grow"><div class="t">${esc(x.title)}</div><div class="s">${fmtDay(x.date)} · ${x.mins} min</div></div></div>`).join("")}</div>` : ""}
  </div>
  <div id="insightsSlot"></div>`;
  requestAnimationFrame(() => {
    const cv = $("#wChart"); if (!cv) return;
    const pts = wIn.map(w => [parseKey(w.date).getTime(), conv(w.kg)]);
    const avg = rollingAvg(wIn).map(([t, v]) => [t, conv(v)]);
    drawChart(cv, [{pts, color: "#5aa2e0", width: 1.4, dots: true}, {pts: avg, color: "#ff7a1a", width: 2.4}],
      {fmt: v => String(Math.round(v))});
  });
  if (window.renderInsights) renderInsights();
}
function editWeight(id) {
  const w = DB.weights.find(x => x.id === id); if (!w) return;
  openSheet(`<h3>Edit weight</h3>
  <label>Weight (${S().units})</label><input id="ewV" type="number" inputmode="decimal" step="0.1" value="${S().units === "lb" ? r1(kgToLb(w.kg)) : r1(w.kg)}">
  <label>Date</label><input id="ewD" type="date" value="${w.date}">
  <button class="btn block" style="margin-top:12px" id="ewGo">Save</button>`);
  $("#ewGo").onclick = () => { const v = Number($("#ewV").value); if (v > 0) { w.kg = inputW(v); w.date = $("#ewD").value || w.date; saveDB(); } closeSheet(); renderProgress(); };
}
function delWeight(id) {
  confirmSheet("Delete weigh-in?", "This measurement will be removed.", "Delete", () => {
    DB.weights = DB.weights.filter(x => x.id !== id); saveDB(); renderProgress();
  });
}
function addMeasure() {
  openSheet(`<h3>Add measurement</h3>
  <label>Type</label><select id="amT"><option>Waist</option><option>Chest</option><option>Hips</option><option>Arm</option><option>Thigh</option><option>Neck</option></select>
  <label>Centimetres</label><input id="amV" type="number" inputmode="decimal" step="0.1" placeholder="e.g. 102">
  <label>Date</label><input id="amD" type="date" value="${todayKey()}">
  <button class="btn block" style="margin-top:12px" id="amGo">Save</button>`);
  $("#amGo").onclick = () => {
    const v = Number($("#amV").value); if (!(v > 0)) return;
    DB.measures.push({id: uid(), date: $("#amD").value || todayKey(), type: $("#amT").value, cm: v});
    saveDB(); closeSheet(); renderProgress(); if (curView === "body" && window.renderBody) renderBody(); toast("Measurement saved");
  };
}
function delMeasure(id) { DB.measures = DB.measures.filter(x => x.id !== id); saveDB(); renderProgress(); if (curView === "body" && window.renderBody) renderBody(); }

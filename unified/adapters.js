"use strict";
/* ============================================================
   adapters.js — Forge 2.0 integration layer.
   Read-only adapters over the standalone apps' localStorage
   stores. All four apps share this origin, so their stores are
   readable here. NOTHING in this file writes to another app's
   store. Unified records are derived fresh on every render —
   no shadow copy, so nothing can drift or duplicate.
   ============================================================ */

function readStore(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch (e) { return null; }
}
function fmtDayShort(k) {
  if (!k) return "—";
  try { return parseKey(k).toLocaleDateString("en-CA", {weekday: "short", month: "short", day: "numeric"}); }
  catch (e) { return k; }
}
function minsOf(e) { return e.durationSec ? Math.round(e.durationSec / 60) : (e.minutes || e.mins || 0); }

/* ---------- Couch to 5K (first5k.v1) ---------- */
/* Planned session totals (sec) per week, summed from the app’s own sessionSteps tables. */
const COUCH_PLANNED = [1800, 1860, 1500, 1890, 1860, 2160, 1800, 2100, 2400];
function couchEntryStatus(e) {
  if (e.status) return e.status;                       // patched app writes this explicitly
  const planned = COUCH_PLANNED[e.week] || 1800;       // legacy inference (Part 7)
  return (e.durationSec || 0) >= 0.85 * planned ? "completed" : "partial";
}
/* [U4] a DB.imported run record -> a couch entry (single mapping, used by
   couchData AND the import dry-run preview so they can never drift). */
function couchEntryFromRecord(r) {
  return {
    key: r.key, week: r.week, run: r.run, date: r.date, timestamp: r.timestamp,
    minutes: r.minutes, durationSec: r.durationSec, status: r.status,
    km: r.km, paceSec: r.paceSec, track: r.track };
}
/* [U4] programme progress from an entries list — couchData's own logic,
   extracted verbatim so the import preview is computed by the same code
   that will judge the result after commit. */
function couchProgressFrom(entries) {
  const doneKeys = new Set();
  let totalKm = 0, lastDone = null, weekDone = 0;
  const wk = weekDates();
  for (const e of entries) {
    if (couchEntryStatus(e) !== "completed") continue;
    doneKeys.add(e.key);
    totalKm += e.km || 0;
    if (!lastDone || (e.timestamp || 0) > (lastDone.timestamp || 0)) lastDone = e;
    if (wk.includes(e.date)) weekDone++;
  }
  let next = null;
  outer: for (let w = 0; w < 9; w++) for (let r = 0; r < 3; r++)
    if (!doneKeys.has((w + 1) + "-" + (r + 1))) { next = {w, r}; break outer; }
  return { doneKeys, done: doneKeys.size, totalKm: Math.round(totalKm * 10) / 10, lastDone, next, weekDone };
}
function couchData() {
  const st = readStore("first5k.v1");
  const legacy = (st && Array.isArray(st.completed)) ? st.completed : [];
  const entries = legacy.concat(nativeRecords("run").map(couchEntryFromRecord));
  const pr = couchProgressFrom(entries);
  return {available: !!st, attempts: entries.length, done: pr.done, total: 27, pct: Math.round(pr.done / 27 * 100),
    totalKm: pr.totalKm, lastDone: pr.lastDone, next: pr.next, weekDone: pr.weekDone, entries};
}

/* ---------- Home Corner (basementbelt.v1) ---------- */
const CORNER_MODULES = {dumbbell: "Dumbbell Circuit", boxing: "Championship Rounds", core: "Core Finisher"};
function nativeRecords(discipline) {
  /* [U1] records written by the unified app's own modules + the legacy
     importer live in DB.imported; they merge with the legacy stores here. */
  const all = (typeof DB !== "undefined" && Array.isArray(DB.imported)) ? DB.imported : [];
  return discipline ? all.filter(r => r.discipline === discipline) : all;
}
function cornerData() {
  const st = readStore("basementbelt.v1");
  const legacy = (st && Array.isArray(st.completed)) ? st.completed : [];
  const entries = legacy.concat(nativeRecords("train").map(r => ({
    module: r.module || "laceup", name: r.title || r.name || "Lace Up",
    date: r.date, timestamp: r.timestamp, minutes: r.minutes, durationSec: r.durationSec })));
  const wk = weekDates();
  const byModule = {};
  let mins = 0, weekDone = 0, last = null;
  for (const e of entries) {
    byModule[e.module] = (byModule[e.module] || 0) + 1;
    mins += minsOf(e);
    if (wk.includes(e.date)) weekDone++;
    if (!last || (e.timestamp || 0) > (last.timestamp || 0)) last = e;
  }
  return {available: !!st, total: entries.length, weekDone, mins, byModule, last, entries};
}

/* ---------- Namastay Home (namastayhome.v1) ---------- */
function yogaData() {
  const st = readStore("namastayhome.v1");
  const legacy = (st && Array.isArray(st.completed)) ? st.completed : [];
  const entries = legacy.concat(nativeRecords("yoga").map(r => ({
    key: r.key, routine: r.routine, title: r.title, date: r.date,
    timestamp: r.timestamp, minutes: r.minutes, durationSec: r.durationSec })));
  const wk = weekDates();
  const byRoutine = {};
  let mins = 0, weekDone = 0, last = null;
  for (const e of entries) {
    byRoutine[e.title || e.routine] = (byRoutine[e.title || e.routine] || 0) + 1;
    mins += minsOf(e);
    if (wk.includes(e.date)) weekDone++;
    if (!last || (e.timestamp || 0) > (last.timestamp || 0)) last = e;
  }
  return {available: !!st, total: entries.length, weekDone, mins, byRoutine, last, entries};
}

/* ---------- Unified history (Part 4) ---------- */
function unifiedHistory(limit) {
  const out = [];
  const c = couchData();
  for (const e of c.entries) out.push({id: "couch:" + e.timestamp, source: "couch", app: "Couch to 5K",
    name: `Week ${e.week + 1} · Run ${e.run + 1}`, date: e.date, ts: e.timestamp || Date.parse(e.date) || 0,
    durationSec: e.durationSec || 0, status: couchEntryStatus(e),
    meta: e.km ? `${e.km} km${e.paceSec ? " · " + Math.floor(e.paceSec / 60) + ":" + String(e.paceSec % 60).padStart(2, "0") + "/km" : ""}` : ""});
  const hc = cornerData();
  for (const e of hc.entries) out.push({id: "corner:" + e.timestamp, source: "corner", app: "Lace Up",
    name: e.name || CORNER_MODULES[e.module] || "Workout", date: e.date, ts: e.timestamp || Date.parse(e.date) || 0,
    durationSec: e.durationSec || 0, status: "completed", meta: CORNER_MODULES[e.module] || ""});
  const y = yogaData();
  for (const e of y.entries) out.push({id: "yoga:" + (e.key || e.timestamp), source: "yoga", app: "Namastay Home",
    name: e.title || "Yoga session", date: e.date, ts: e.timestamp || Date.parse(e.date) || 0,
    durationSec: e.durationSec || 0, status: "completed", meta: ""});
  for (const r of nativeRecords()) out.push({id: r.id, source: r.discipline === "train" ? "corner" : r.discipline === "run" ? "couch" : "yoga",
    app: r.discipline === "train" ? "Lace Up" : r.discipline === "run" ? "Couch to 5K" : "Namastay Home",
    name: r.title || "Session", date: r.date, ts: r.timestamp || Date.parse(r.date) || 0,
    durationSec: r.durationSec || 0, status: r.status || "completed", meta: r.source === "native" ? "in The Forge" : "imported"});
  for (const s of DB.sessions) out.push({id: "forge:" + s.id, source: "forge", app: "Forge player",
    name: s.title || "Workout", date: s.date, ts: Date.parse(s.date) || 0,
    durationSec: (s.mins || 0) * 60, status: "completed", meta: "built-in player"});
  out.sort((a, b) => b.ts - a.ts);
  return limit ? out.slice(0, limit) : out;
}
function weekActivity() {
  const wk = weekDates();
  const recs = unifiedHistory().filter(r => wk.includes(r.date) && r.status === "completed");
  return {count: recs.length, days: new Set(recs.map(r => r.date)).size,
    mins: recs.reduce((a, r) => a + Math.round((r.durationSec || 0) / 60), 0), recs};
}

/* ---------- Rule-based “up next” (Part 6 foundation — honest rules, no AI) ---------- */
function upNext() {
  const t = todayKey(), plan = plannedFor(t);
  const hist = unifiedHistory();
  const doneToday = src => hist.some(r => r.date === t && r.source === src && r.status === "completed");
  const c = couchData(), hc = cornerData(), y = yogaData();
  if (plan.type === "yoga" && !doneToday("yoga"))
    return {app: "Namastay Home", text: "Yoga day — " + (y.last ? "last time: " + esc(y.last.title || "a routine") : "start with Back Care Basics"), url: "yoga"};
  if (plan.type === "dumbbell" && !doneToday("corner") && !doneToday("forge"))
    return {app: "Lace Up", text: "Strength day — dumbbells + boxing are on the plan", url: "train"};
  if (c.next && !doneToday("couch")) {
    const lastRun = c.lastDone ? (Date.parse(t) - Date.parse(c.lastDone.date)) / 864e5 : 99;
    if (lastRun >= 1) return {app: "Couch to 5K", text: `Week ${c.next.w + 1} · Run ${c.next.r + 1} is next${c.lastDone ? " — last run " + fmtDayShort(c.lastDone.date) : ""}`, url: "run"};
  }
  if (doneToday("couch") || doneToday("corner") || doneToday("yoga") || doneToday("forge"))
    return {app: "Done for today", text: "Training's in the book. Recovery is training too.", url: null};
  return {app: "Your call", text: plan.label + " — or pick whichever app you fancy", url: null};
}

/* ---------- Shared markup ---------- */
function fbar(pct, color) {
  return `<div style="height:7px;border-radius:99px;background:#232f4d;overflow:hidden;margin-top:6px"><div style="height:100%;width:${Math.max(0, Math.min(100, pct))}%;background:${color || "var(--org)"};border-radius:99px"></div></div>`;
}
const APP_META = {
  couch: {name: "Couch to 5K", icon: "🏃", color: "#ff7a1a", url: "run", blurb: "The 9-week running programme — intervals, coach cues, GPS routes."},
  corner: {name: "Lace Up", icon: "🥊", color: "#d4a72c", url: "train", blurb: "The full session: full-body dumbbell circuit, shadow boxing rounds, core finisher."},
  yoga: {name: "Namastay Home", icon: "🧘", color: "#9db98a", url: "yoga", blurb: "Guided yoga for back care, foundations, and a full reset."}
};
function appStatLines(k) {
  if (k === "couch") { const c = couchData();
    return {head: `${c.done}/27 runs · ${c.pct}%`, sub: c.next ? `Next: Week ${c.next.w + 1} · Run ${c.next.r + 1}` : "Programme complete 🎉",
      foot: c.lastDone ? `Last run ${fmtDayShort(c.lastDone.date)}${c.lastDone.km ? " · " + c.lastDone.km + " km" : ""} · ${c.totalKm} km all-time` : "No runs logged yet", pct: c.pct}; }
  if (k === "corner") { const h = cornerData();
    return {head: `${h.total} workouts · ${h.mins} min`, sub: `${h.weekDone} this week`,
      foot: h.last ? `Last: ${esc(h.last.name || "Workout")} · ${fmtDayShort(h.last.date)}` : "No workouts logged yet", pct: null}; }
  const y = yogaData();
  return {head: `${y.total} sessions · ${y.mins} min`, sub: `${y.weekDone} this week`,
    foot: y.last ? `Last: ${esc(y.last.title || "Yoga")} · ${fmtDayShort(y.last.date)}` : "No sessions logged yet", pct: null};
}
function fitnessStripHTML() {
  const w = weekActivity(), nx = upNext();
  const rows = ["couch", "corner", "yoga"].map(k => { const s = appStatLines(k), m = APP_META[k];
    return `<div class="row between" style="padding:5px 0;border-top:1px solid #232f4d">
      <span class="small">${m.icon} <b>${m.name}</b></span><span class="small muted">${s.head}</span></div>
      ${s.pct !== null && s.pct !== undefined ? fbar(s.pct, m.color) : ""}`; }).join("");
  return `<div class="card"><div class="row between"><h3>🔥 This week at the Forge</h3>
    <span class="small muted">${w.count} workout${w.count === 1 ? "" : "s"} · ${w.days} active day${w.days === 1 ? "" : "s"} · ${w.mins} min</span></div>
    ${rows}
    <p class="small" style="margin-top:8px">Up next: <b>${esc(nx.app)}</b> <span class="muted">— ${nx.text}</span></p></div>`;
}
function fitnessPanelsHTML() {
  const c = couchData(), h = cornerData(), y = yogaData(), w = weekActivity();
  const hist = unifiedHistory(12);
  const panel = (k, inner) => `<div class="card"><div class="row between"><h3>${APP_META[k].icon} ${APP_META[k].name}</h3>
    <button class="btn sm" onclick="show('${APP_META[k].url}')">Open app →</button></div>${inner}</div>`;
  const couchInner = `${fbar(c.pct, APP_META.couch.color)}
    <p class="small muted" style="margin-top:8px">${c.done} of 27 programme runs · ${c.attempts} total attempts · ${c.totalKm} km recorded</p>
    <p class="small">${c.next ? `Next up: <b>Week ${c.next.w + 1} · Run ${c.next.r + 1}</b>` : "🎉 Programme complete"}${c.lastDone ? ` · Last run ${fmtDayShort(c.lastDone.date)}` : ""}</p>`;
  const cornerInner = `<p class="small muted" style="margin-top:6px">${h.total} workouts all-time · ${h.weekDone} this week · ${h.mins} minutes total</p>
    <p class="small">${Object.entries(h.byModule).map(([m, n]) => `${esc(CORNER_MODULES[m] || m)}: <b>${n}</b>`).join(" · ") || "No workouts yet"}${h.last ? `<br>Most recent: <b>${esc(h.last.name || "")}</b> · ${fmtDayShort(h.last.date)}` : ""}</p>`;
  const yogaInner = `<p class="small muted" style="margin-top:6px">${y.total} sessions all-time · ${y.weekDone} this week · ${y.mins} minutes on the mat</p>
    <p class="small">${Object.entries(y.byRoutine).map(([r, n]) => `${esc(r)}: <b>${n}</b>`).join(" · ") || "No sessions yet"}${y.last ? `<br>Most recent: <b>${esc(y.last.title || "")}</b> · ${fmtDayShort(y.last.date)}` : ""}</p>`;
  const histHTML = hist.length ? `<div class="card"><h3>🕘 Recent activity — all apps</h3><div class="list">${hist.map(r => `
    <div class="item"><div class="grow"><div class="t">${esc(r.name)} ${r.status === "partial" ? `<span class="dim">· partial</span>` : ""}</div>
    <div class="s">${esc(r.app)} · ${fmtDayShort(r.date)}${r.durationSec ? " · " + Math.round(r.durationSec / 60) + " min" : ""}${r.meta ? " · " + esc(r.meta) : ""}</div></div></div>`).join("")}</div></div>` : "";
  return `<div class="card" style="border-color:var(--org)"><div class="row between"><h3>🏆 Fitness progress — all programmes</h3></div>
    <p class="small muted" style="margin-top:4px">${w.count} workouts this week across ${w.days} active day${w.days === 1 ? "" : "s"} · ${w.mins} minutes. Live from each app's own records — nothing copied, nothing double-counted.</p></div>
    ${panel("couch", couchInner)}${panel("corner", cornerInner)}${panel("yoga", yogaInner)}${histHTML}`;
}
function appCardsHTML() {
  return ["couch", "corner", "yoga"].map(k => { const m = APP_META[k], s = appStatLines(k);
    return `<div class="card" style="border-top:3px solid ${m.color}">
    <div class="row between"><h3>${m.icon} ${m.name}</h3><span class="small" style="color:${m.color}"><b>${s.head}</b></span></div>
    <p class="small muted" style="margin:6px 0">${m.blurb}</p>
    ${s.pct !== null && s.pct !== undefined ? fbar(s.pct, m.color) : ""}
    <p class="small" style="margin-top:8px">${s.sub}<br><span class="muted">${s.foot}</span></p>
    <button class="btn block" style="margin-top:10px" onclick="show('${m.url}')">▶ Open ${m.name}</button></div>`; }).join("");
}


/* Hub point artwork — his picks 2026-10-21: Couch C8 Stopwatch, Home Corner H2 The Belt, Namastay N4 Morning Sun */
const APP_LOGOS = {
  couch: `<svg viewBox="0 0 100 100"> <rect width="100" height="100" fill="#171310"/> <rect x="44" y="8" width="12" height="7" rx="2" fill="#ff7a1a"/> <rect x="48.5" y="13" width="3" height="6" fill="#ff7a1a"/> <circle cx="50" cy="55" r="34" fill="none" stroke="#ff7a1a" stroke-width="5"/> <path d="M50 55 L50 36" stroke="#d7fd44" stroke-width="4.5" stroke-linecap="round"/> <path d="M50 55 L63 62" stroke="#d7fd44" stroke-width="4.5" stroke-linecap="round"/> <circle cx="50" cy="55" r="4" fill="#fff"/> <text x="50" y="84" text-anchor="middle" font-family="Arial Black,Arial" font-size="11" font-weight="900" fill="#fff">5K</text> </svg>`,
  corner: `<svg viewBox="0 0 100 100"> <rect width="100" height="100" fill="#141b2e"/> <path d="M8 42 L92 42 L92 58 L8 58 Z" fill="#232f52"/> <path d="M8 42 L92 42 L92 58 L8 58 Z" fill="none" stroke="#d4a72c" stroke-width="2"/> <ellipse cx="50" cy="50" rx="19" ry="15" fill="#d4a72c"/> <ellipse cx="50" cy="50" rx="14.5" ry="11" fill="#f5eeda"/> <path d="M50 42 L52.2 47.6 L58.2 47.8 L53.5 51.4 L55.1 57.2 L50 54 L44.9 57.2 L46.5 51.4 L41.8 47.8 L47.8 47.6 Z" fill="#d4a72c"/> <circle cx="24" cy="50" r="3" fill="#d4a72c"/><circle cx="76" cy="50" r="3" fill="#d4a72c"/> </svg>`,
  yoga: `<svg viewBox="0 0 100 100"> <rect width="100" height="100" fill="#141b2e"/> <g stroke="#d4a72c" stroke-width="3" stroke-linecap="round"><path d="M50 10 L50 17"/><path d="M28 19 L33 25"/><path d="M72 19 L67 25"/><path d="M17 36 L24 39"/><path d="M83 36 L76 39"/></g> <path d="M28 52 A22 22 0 0 1 72 52 Z" fill="#d4a72c"/> <path d="M50 42 C56 51 56 59 50 65 C44 59 44 51 50 42 Z" fill="#f6d47a"/> <path d="M50 65 C43 63 37 57 35 49 C45 51 49 57 50 65 Z" fill="#d4a72c"/> <path d="M50 65 C57 63 63 57 65 49 C55 51 51 57 50 65 Z" fill="#d4a72c"/> <path d="M24 72 L76 72" stroke="#f6d47a" stroke-width="2.6" stroke-linecap="round"/> </svg>`,
};

/* ---------- Workouts hub (twin of the main hub: 3 points + week centre) ---------- */
function workoutHubHTML() {
  const w = weekActivity(), nx = upNext();
  const pos = {couch: ["50%", "5%"], corner: ["13%", "76%"], yoga: ["87%", "76%"]};
  const node = k => { const m = APP_META[k];
    return `<button class="node wnode" style="left:${pos[k][0]};top:${pos[k][1]}" onclick="show('${m.url}')">
      <span class="bub wbub">${APP_LOGOS[k] || `<span class="wemoji">${m.icon}</span>`}</span>
      <span class="nl">${m.name}</span></button>`; };
  return `<div class="hub whub">
    <svg class="hexsvg" viewBox="0 0 100 100">
      <circle cx="50" cy="52" r="34" fill="none" stroke="#d4a72c" stroke-width=".55" opacity=".45"/>
      <polygon points="50,5 87,76 13,76" fill="none" stroke="#d4a72c" stroke-width="1" opacity=".8"/>
      <g fill="#f6d47a"><circle cx="50" cy="5" r="1.5"/><circle cx="87" cy="76" r="1.5"/><circle cx="13" cy="76" r="1.5"/></g>
    </svg>
    ${node("couch")}${node("corner")}${node("yoga")}
    <div class="wcenter">
      <div class="wck">THIS WEEK</div>
      <div class="wcnum">${w.count}</div>
      <div class="wccap">workout${w.count === 1 ? "" : "s"} · ${w.days} active day${w.days === 1 ? "" : "s"}<br>${w.mins} minutes trained</div>
      <div class="wcnext">Up next · <b>${esc(nx.app)}</b></div>
    </div>
  </div>`;
}

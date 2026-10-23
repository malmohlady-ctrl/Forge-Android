/* FIT HQ core: store, utils, router, Home, Settings, backup.
   Local-first: all data lives in localStorage under a versioned key.
   Nothing is sent anywhere. */
"use strict";
const DB_KEY = "fithq.db.v1";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad2 = n => String(n).padStart(2, "0");
const dateKey = (d = new Date()) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
const parseKey = k => { const [y, m, dd] = k.split("-").map(Number); return new Date(y, m - 1, dd); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const todayKey = () => dateKey();
const fmtDay = k => parseKey(k).toLocaleDateString(undefined, {weekday: "short", month: "short", day: "numeric"});
const r0 = n => Math.round(n || 0);
const r1 = n => Math.round((n || 0) * 10) / 10;
const KG_PER_LB = 0.45359237;
const lbToKg = lb => lb * KG_PER_LB;
const kgToLb = kg => kg / KG_PER_LB;

function defaultDB() {
  return {
    v: 1,
    settings: {
      name: "", age: 31, sex: "male", heightCm: 178,
      startKg: lbToKg(235), goalKg: lbToKg(200), units: "lb",
      activity: 1.55, goalType: "lose", weekStart: 1, centerStat: "kcal",
      targets: {kcal: 2000, p: 150, c: 200, f: 67, waterMl: 2500},
      targetsCustom: false, exerciseBack: false
    },
    entries: [],   // food diary entries (nutrition snapshot per entry)
    foods: [],     // custom food library
    meals: [],     // saved meals & recipes
    water: [],     // {id,date,ml}
    weights: [],   // {id,date,kg}
    measures: [],  // {id,date,type,cm}
    sessions: []   // workout sessions {id,date,type,title,mins,detail}
  };
}
let DB;
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) { DB = defaultDB(); saveDB(); return; }
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object" || !d.settings) throw new Error("bad db");
    const def = defaultDB();
    DB = Object.assign(def, d);
    DB.settings = Object.assign(def.settings, d.settings || {});
    DB.settings.targets = Object.assign(def.settings.targets, (d.settings || {}).targets || {});
    for (const k of ["entries","foods","meals","water","weights","measures","sessions"])
      if (!Array.isArray(DB[k])) DB[k] = [];
  } catch (e) { DB = defaultDB(); }
}
function saveDB() { try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); const w = document.getElementById("savewarn"); if (w) w.style.display = "none"; }
  catch (e) { const w = document.getElementById("savewarn"); if (w) { w.textContent = "⚠️ Couldn't save — device storage may be full. Export a backup in Settings → Data."; w.style.display = "block"; } } }
const S = () => DB.settings;
const dispW = kg => S().units === "lb" ? r1(kgToLb(kg)) + " lb" : r1(kg) + " kg";
const inputW = v => S().units === "lb" ? lbToKg(Number(v) || 0) : (Number(v) || 0);

/* ---------- nutrition math (shared) ---------- */
const NUT_KEYS = ["kcal","p","c","f","fiber","sugar","satfat","sodium"];
function zeroNut() { const o = {}; NUT_KEYS.forEach(k => o[k] = 0); return o; }
function scaleNut(per, qty) { const o = {}; NUT_KEYS.forEach(k => o[k] = (Number(per?.[k]) || 0) * (Number(qty) || 0)); return o; }
function addNut(a, b) { const o = {}; NUT_KEYS.forEach(k => o[k] = (a[k] || 0) + (b[k] || 0)); return o; }
function dayEntries(date) { return DB.entries.filter(e => e.date === date); }
function dayTotals(date) {
  let t = zeroNut();
  for (const e of dayEntries(date)) t = addNut(t, scaleNut(e.per, e.qty));
  return t;
}
function waterFor(date) { return DB.water.filter(w => w.date === date).reduce((a, w) => a + (w.ml || 0), 0); }
function latestWeight() {
  if (!DB.weights.length) return null;
  return DB.weights.slice().sort((a, b) => a.date < b.date ? -1 : 1).slice(-1)[0];
}
function sortedWeights() { return DB.weights.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0); }

/* ---------- target calculator (Mifflin-St Jeor) ---------- */
function calcTargets(s) {
  const kg = latestWeight()?.kg ?? s.startKg;
  let bmr = 10 * kg + 6.25 * s.heightCm - 5 * s.age + (s.sex === "female" ? -161 : 5);
  const tdee = bmr * (Number(s.activity) || 1.55);
  let kcal = tdee;
  if (s.goalType === "lose") kcal = tdee - 500;
  if (s.goalType === "gain") kcal = tdee + 300;
  const floor = s.sex === "female" ? 1200 : 1500;
  kcal = Math.max(floor, Math.round(kcal / 10) * 10);
  const p = Math.round(kg * 2.0);                    // 2.0 g/kg — supports muscle retention
  const f = Math.round(kcal * 0.30 / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return {kcal, p, c, f, waterMl: s.targets.waterMl || 2500, bmr: Math.round(bmr), tdee: Math.round(tdee)};
}

/* ---------- UI helpers ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2400);
}
function openSheet(html) { $("#sheet").innerHTML = html; $("#modal").classList.add("on"); }
function closeSheet() { $("#modal").classList.remove("on"); if (window._scanStop) { window._scanStop(); window._scanStop = null; } }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeSheet(); });
function confirmSheet(title, body, okLabel, onOk) {
  openSheet(`<h3>${esc(title)}</h3><p class="small muted" style="margin:6px 0 14px">${esc(body)}</p>
    <div class="row"><button class="btn ghost grow" onclick="closeSheet()">Cancel</button>
    <button class="btn danger grow" id="cfOk">${esc(okLabel)}</button></div>`);
  $("#cfOk").onclick = () => { closeSheet(); onOk(); };
}
function bar(pct, cls = "") {
  return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
}
function greet() { const h = new Date().getHours(); return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }

/* ---------- router ---------- */
let curView = "home";
let zoomOrigin = null;
function show(view, origin) {
  curView = view;
  $$(".view").forEach(v => v.classList.remove("on", "hubview"));
  const el = $("#view-" + view);
  if (origin) { el.style.setProperty("--zox", origin.x + "%"); el.style.setProperty("--zoy", origin.y + "%"); }
  el.classList.add("on");
  if (view === "home") el.classList.add("hubview");
  const titles = {home: "", nutrition: "Nutrition", workouts: "Workouts", progress: "Progress", plan: "Plan", body: "Body", settings: "Settings", train: "Train — Lace Up", run: "Run — Couch to 5K", yoga: "Yoga — Namastay Home", diag: "U0 Diagnostics"};
  const tt = $("#topTitle");
  tt.textContent = titles[view] || "";
  tt.style.display = view === "home" ? "none" : "block";
  $("#hubBack").style.display = view === "home" ? "none" : "block";
  $("#topBar").style.display = view === "home" ? "none" : "block";
  ({home: renderHome, nutrition: window.renderNutrition, workouts: window.renderWorkouts,
    progress: window.renderProgress, plan: renderPlan, body: renderBody, settings: renderSettings,
    train: window.renderTrain, run: window.renderRun, yoga: renderModuleStub, diag: window.renderDiag}[view] || renderHome)();
  window.scrollTo(0, 0);
}
function hubGo(view, ev) {
  let origin = null;
  const t = ev && ev.currentTarget;
  if (t) {
    const r = t.getBoundingClientRect();
    origin = {x: Math.round((r.left + r.width / 2) / window.innerWidth * 100),
              y: Math.round((r.top + r.height / 2) / window.innerHeight * 100)};
  }
  show(view, origin);
}
$("#hubBack").onclick = () => show("home");

/* ---------- unified app: view history + Android Back rule (U0) ----------
   Back = previous in-app view; at Home = exit. (Mid-session no-op arrives
   with the first module in U1 — no sessions exist yet.) */
const viewStack = [];
const _showU0 = show;
show = function (view, origin) {
  if (curView && curView !== view && !origin) viewStack.push(curView);
  if (viewStack.length > 24) viewStack.shift();
  _showU0(view, origin);
};
function goBack() {
  const prev = viewStack.pop();
  _showU0(prev || "home");
}
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
  window.Capacitor.Plugins.App.addListener("backButton", () => {
    if ((window.TrainSession && window.TrainSession.active()) || (window.RunSession && window.RunSession.active())) return; // [U1/U2] Back is a no-op mid-session
    if (curView === "home") window.Capacitor.Plugins.App.exitApp();
    else goBack();
  });
}

/* ---------- unified app: module stubs (engines arrive U1/U2/U3) ---------- */
const MODULE_INFO = {
  train: {icon: "🥊", name: "Lace Up", phase: "U1 — Train module", blurb: "The full session, built in here: 29-exercise dumbbell circuit → 3 rounds of called shadow boxing → 6-move core finisher. The cornerman's voice runs on the shared audio core (test him in Diagnostics)."},
  run: {icon: "🏃", name: "Couch to 5K", phase: "U2 — Run module", blurb: "The 9-week programme with Miles coaching and GPS route tracking, as a native Forge module — no separate app, your runs land straight in Progress."},
  yoga: {icon: "🧘", name: "Namastay Home", phase: "U3 — Yoga module", blurb: "Back Care Basics, Foundations, and Full Reset with the guide voice and 432 Hz chime, built in here."},
};
function renderModuleStub() {
  const m = MODULE_INFO[curView]; if (!m) return;
  $("#view-" + curView).innerHTML = `<div style="padding:22px 18px;max-width:520px;margin:0 auto">
    <div style="font-size:44px">${m.icon}</div>
    <h2 style="margin:8px 0 2px">${m.name}</h2>
    <div style="color:var(--gold,#d4a72c);font-weight:700;letter-spacing:.04em">${m.phase}</div>
    <p style="color:var(--muted,#a8b4d4);line-height:1.55">${m.blurb}</p>
    <p style="line-height:1.55">This module is a placeholder in U0 (Foundations). Its engine is ported in its own phase, behind its own approval — nothing here is a finished workout screen.</p>
    <button class="btn block" onclick="show('workouts')">‹ Back to Workouts</button>
    <button class="btn block" style="margin-top:8px" onclick="show('diag')">U0 Diagnostics</button>
  </div>`;
}
window.renderDiag = function () {
  $("#view-diag").innerHTML = `<div style="padding:22px 18px;max-width:560px;margin:0 auto">
    <h2 style="margin:4px 0">U0 Diagnostics</h2>
    <p style="color:var(--muted,#a8b4d4);line-height:1.5">Device evidence for the U0 acceptance checklist. Synthetic data only — the importer self-test runs on an in-memory sandbox and never touches the app store.</p>
    <h3>Audio core (F2 pattern)</h3>
    <button class="btn" onclick="ForgeDiag.playCorner()">▶ Cornerman clip</button>
    <button class="btn" onclick="ForgeDiag.playMiles()">▶ Miles clip</button>
    <button class="btn" onclick="ForgeDiag.playChime()">▶ 432 Hz chime</button>
    <pre id="diagAudio" style="white-space:pre-wrap;background:#10182b;padding:10px;border-radius:10px">No audio test yet. Tip: run one, lock the phone 60 s, unlock — then run another.</pre>
    <h3>Service workers</h3>
    <button class="btn" onclick="ForgeDiag.dumpSW()">List registrations</button>
    <pre id="diagSW" style="white-space:pre-wrap;background:#10182b;padding:10px;border-radius:10px">Not checked yet.</pre>
    <h3>Storage</h3>
    <button class="btn" onclick="ForgeDiag.dumpKeys()">Dump origin + keys</button>
    <pre id="diagKeys" style="white-space:pre-wrap;background:#10182b;padding:10px;border-radius:10px">Not dumped yet.</pre>
    <h3>Importer self-test (synthetic fixtures)</h3>
    <button class="btn" onclick="ForgeDiag.runImporter()">Run importer self-test</button>
    <pre id="diagImport" style="white-space:pre-wrap;background:#10182b;padding:10px;border-radius:10px">Not run yet. Expects: import #1 adds 7 · repeat adds 0 · conflict probe reports 1 · corrupt fixture rejected · restore returns to 0.</pre>
    <h3>GPS probe (U2 spike)</h3>
    <p style="color:var(--muted,#a8b4d4);line-height:1.5">Location permission + live fix stream inside the WebView, judged by the original Couch rules (&gt;40 m accuracy dropped · &lt;8 m in &lt;15 s = jitter · &gt;16.7 m/s = teleport). Coordinates show only here — nothing is stored or sent anywhere.</p>
    <button class="btn" onclick="ForgeDiag.gpsState()">Permission state</button>
    <button class="btn" onclick="ForgeDiag.gpsRequest()">Request permission</button>
    <button class="btn" onclick="ForgeDiag.gpsOnce()">One fix</button>
    <button class="btn" onclick="ForgeDiag.gpsWatch()">Start / stop watch</button>
    <pre id="diagGps" style="white-space:pre-wrap;background:#10182b;padding:10px;border-radius:10px">No GPS test yet. Lock test: start the watch, note the elapsed time, lock the phone 60 s, unlock, and read the log — fixes stamped inside the lock window mean the watch survived.</pre>
    <pre id="diagGpsLog" style="white-space:pre-wrap;background:#10182b;padding:10px;border-radius:10px;max-height:260px;overflow:auto">Probe log is empty.</pre>
    <button class="btn block" style="margin-top:14px" onclick="show('home')">‹ Hub</button>
  </div>`;
  if (window.ForgeDiag) ForgeDiag.gpsPaint();
};
let _tsy = null;
if (typeof document.addEventListener === "function") {
  document.addEventListener("touchstart", e => { _tsy = e.touches[0].clientY; }, {passive: true});
  document.addEventListener("touchend", e => {
    if (_tsy === null || curView === "home") { _tsy = null; return; }
    if (e.changedTouches[0].clientY - _tsy > 80 && window.scrollY < 40) show("home");
    _tsy = null;
  }, {passive: true});
}

/* ---------- HOME ---------- */
function weekDates() {
  const t = todayKey(); const dow = parseKey(t).getDay();
  const startOffset = (dow - S().weekStart + 7) % 7;
  const start = addDays(t, -startOffset);
  return Array.from({length: 7}, (_, i) => addDays(start, i));
}
function plannedFor(k) {
  const dow = parseKey(k).getDay(); // 0 Sun
  if ([1, 3, 5].includes(dow)) return {type: "dumbbell", label: "Dumbbell circuit + boxing", short: "Strength"};
  if ([2, 4, 6].includes(dow)) return {type: "yoga", label: "Yoga — recovery", short: "Yoga"};
  return {type: "run", label: "Rest day — or a Couch to 5K run", short: "Rest"};
}
function plannedToday() { return plannedFor(todayKey()); }
const ICONS = {
  workouts: `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#141b2e"/>
  <path d="M37 58 V30 Q37 20 47 20 H53 Q63 20 63 30 V58 H54 V31 H46 V58 Z" fill="url(#gGold)"/>
  <circle cx="50" cy="64" r="24" fill="url(#gGold)"/>
  <circle cx="50" cy="64" r="16.5" fill="url(#gGlow)"/><path d="M50 43 c6 9.8 13.4 15 13.4 25.2 a13.4 13.4 0 1 1 -26.8 0 C36.6 58 44 52.8 50 43z" fill="url(#gFire)"/><path d="M50 58 c3 4.8 6.6 7.4 6.6 12.4 a6.6 6.6 0 1 1 -13.2 0 c0-5 3.6-7.6 6.6-12.4z" fill="#fff3c4"/>
  <ellipse cx="40" cy="56" rx="3.4" ry="6" fill="#fff" opacity=".28"/></svg>`,
  nutrition: `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#141b2e"/>
  <path d="M50 90 V26" stroke="url(#gGold)" stroke-width="4.6" stroke-linecap="round"/>
  <g fill="url(#gGold)">
    <path d="M50 66 C39 64 32 55 31 43 C43 45 49 53 50 66 Z"/>
    <path d="M50 66 C61 64 68 55 69 43 C57 45 51 53 50 66 Z"/>
    <path d="M50 51 C40 49 34 41 33 30 C44 32 49 39 50 51 Z"/>
    <path d="M50 51 C60 49 66 41 67 30 C56 32 51 39 50 51 Z"/>
    <path d="M50 37 C43 33 40 25 41 16 C49 19 51 27 50 37 Z"/>
    <path d="M50 37 C57 33 60 25 59 16 C51 19 49 27 50 37 Z"/>
  </g>
  <path d="M50 26 C46 19 46 11 50 4 C54 11 54 19 50 26 Z" fill="url(#gGold)"/>
  <circle cx="50" cy="90" r="3.2" fill="url(#gGold)"/></svg>`,
  progress: `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#141b2e"/>
  <path d="M10 86 L21 77 L32 80 L43 66 L54 69 L65 54 L76 46 L82 37" fill="none" stroke="url(#gGold)" stroke-width="2.2" stroke-dasharray="1 7" stroke-linecap="round"/>
  <g fill="#f5eeda"><circle cx="10" cy="86" r="2.9"/><circle cx="21" cy="77" r="2.7"/><circle cx="32" cy="80" r="2.7"/><circle cx="43" cy="66" r="2.7"/><circle cx="54" cy="69" r="2.7"/><circle cx="65" cy="54" r="2.7"/><circle cx="76" cy="46" r="2.7"/></g>
  <circle cx="85" cy="22" r="18" fill="url(#gGlow)" opacity=".55"/>
  <polygon points="85,9 88.2,19 98.4,19.4 90.3,25.7 93.1,35.8 85,29.7 76.9,35.8 79.7,25.7 71.6,19.4 81.8,19" fill="url(#gFire)"/></svg>`,
  plan: `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#141b2e"/>
  <path d="M28 90 L28 38 Q28 13 50 13 Q72 13 72 38 L72 90 Z" fill="#1c2742" stroke="url(#gGold)" stroke-width="3"/>
  <path d="M34.5 90 L34.5 39 Q34.5 19.5 50 19.5 Q65.5 19.5 65.5 39 L65.5 90" fill="none" stroke="#f5eeda" stroke-width="1.3" opacity=".45"/>
  <circle cx="50" cy="31" r="2.8" fill="url(#gFire)"/>
  <path d="M33 69 A17 17 0 0 1 67 69" fill="none" stroke="url(#gGold)" stroke-width="3"/>
  <g stroke="#f5eeda" stroke-width="2" stroke-linecap="round"><path d="M39 60 v4.4"/><path d="M50 54 v4.4"/><path d="M61 60 v4.4"/></g>
  <polygon points="50,69 50,57 58,69" fill="url(#gGold)"/>
  <path d="M31 69 h38" stroke="#f5eeda" stroke-width="2"/></svg>`,
  body: `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#141b2e"/><path d="M14 62 a40 40 0 0 1 72 0" fill="none" stroke="url(#gGold)" stroke-width="9"/><g stroke="#141b2e" stroke-width="3"><line x1="26" y1="42" x2="31" y2="52"/><line x1="50" y1="28" x2="50" y2="40"/><line x1="74" y1="42" x2="69" y2="52"/></g><rect x="8" y="62" width="84" height="9" rx="4" fill="#f5eeda"/><path d="M50 62 v14" stroke="url(#gFire)" stroke-width="5"/></svg>`,
  settings: `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#141b2e"/>
  <polygon points="82,50 66,77.7 34,77.7 18,50 34,22.3 66,22.3" fill="url(#gGold)"/>
  <circle cx="50" cy="50" r="14.5" fill="#141b2e"/>
  <circle cx="50" cy="50" r="14.5" fill="none" stroke="#f5eeda" stroke-width="1.6" opacity=".55"/>
  <path d="M41 41 l18 18" stroke="#f5eeda" stroke-width="2.4" opacity=".8"/>
  <circle cx="50" cy="50" r="3.2" fill="url(#gFire)"/></svg>`
};
function streakDays() {
  let n = 0; let k = todayKey();
  if (!dayEntries(k).length) k = addDays(k, -1);
  while (dayEntries(k).length) { n++; k = addDays(k, -1); }
  return n;
}
function centerData() {
  const s = S(), tg = s.targets, t = todayKey();
  const tot = dayTotals(t), rem = tg.kcal - tot.kcal;
  const mode = s.centerStat || "kcal";
  if (mode === "weight") {
    const lw = latestWeight();
    const pct = (lw && s.startKg !== s.goalKg) ? Math.max(0, Math.min(1, (s.startKg - lw.kg) / (s.startKg - s.goalKg))) : 0;
    return {mode, hero: lw ? dispW(lw.kg) : "—", cap: lw ? `goal ${dispW(s.goalKg)} · ${r0(pct * 100)}% of the way` : "log a weight to start",
      pct, glow: 0.5, tap: "body"};
  }
  if (mode === "next") {
    const nx = (typeof c25kNext === "function") ? c25kNext() : null;
    const wk = weekDates();
    const done = DB.sessions.filter(x => wk.includes(x.date)).length;
    return {mode, hero: nx ? `W${nx.w + 1} · Run ${nx.r + 1}` : "5K done 🏆",
      cap: nx ? "next Couch to 5K run" : "program complete", pct: Math.min(1, done / 5), glow: 0.6, tap: "workouts"};
  }
  const pct = tg.kcal ? Math.min(1, Math.max(0, tot.kcal / tg.kcal)) : 0;
  const doneToday = DB.sessions.filter(x => x.date === t);
  const plan = plannedToday();
  const hr = new Date().getHours();
  let cap;
  if (doneToday.length) cap = `training done ✓ · ${streakDays()} day streak`;
  else if (hr >= 20) cap = `${streakDays()} day streak · day closes at midnight`;
  else cap = `${plan.label} today`;
  return {mode, hero: r0(Math.abs(rem)).toLocaleString(), cap: (rem < 0 ? "kcal over target" : "kcal left") + " · " + cap,
    pct, glow: Math.max(0.15, 0.9 - pct * 0.65), tap: "nutrition",
    sub: `${r0(tot.kcal)} of ${tg.kcal} eaten · P ${r0(tot.p)}/${tg.p}g`};
}
function centerTap() { show(centerData().tap); }
function renderHome() {
  const cd = centerData();
  const circ = 2 * Math.PI * 80;
  const nodes = [
    ["workouts", "Workouts", "50%", "4%"], ["nutrition", "Nutrition", "91%", "27%"],
    ["progress", "Progress", "91%", "73%"], ["plan", "Plan", "50%", "96%"],
    ["body", "Body", "9%", "73%"], ["settings", "Settings", "9%", "27%"]
  ];
  $("#view-home").innerHTML = `
  <div class="hub">
    <svg class="hexsvg" viewBox="0 0 100 100">
      <polygon points="50,2 91.6,26 91.6,74 50,98 8.4,74 8.4,26" fill="none" stroke="#d4a72c" stroke-width="1.1"/>
      <polygon points="50,7.5 86.8,28.7 86.8,71.3 50,92.5 13.2,71.3 13.2,28.7" fill="none" stroke="#d4a72c" stroke-width=".55" opacity=".5"/>
      <g fill="#f6d47a"><circle cx="50" cy="2" r="1.5"/><circle cx="91.6" cy="26" r="1.5"/><circle cx="91.6" cy="74" r="1.5"/><circle cx="50" cy="98" r="1.5"/><circle cx="8.4" cy="74" r="1.5"/><circle cx="8.4" cy="26" r="1.5"/></g>
    </svg>
    ${nodes.map(([v, label, x, y]) => `<button class="node" style="left:${x};top:${y}" onclick="hubGo('${v}',event)"><span class="bub">${ICONS[v]}</span><span class="nl">${label}${v === "plan" ? `<span class="nsub">ALL-SEEING</span>` : ""}</span></button>`).join("")}
    <div class="hubcenter" onclick="centerTap()" role="button" aria-label="Centre stat">
      <svg viewBox="0 0 178 178" style="width:100%;height:100%">
        <circle cx="89" cy="89" r="80" stroke="#2c3a5e" stroke-width="4.5" fill="rgba(16,24,43,.72)"/>
        <circle cx="89" cy="89" r="80" stroke="#d4a72c" stroke-width="4.5" fill="none" stroke-linecap="round"
          stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - cd.pct)}" transform="rotate(-90 89 89)"/>
        <circle cx="89" cy="76" r="46" fill="url(#gGlow)" opacity="${cd.glow}"/>
        <g>
          <path d="M89 42 c8.6 14.4 20 22.2 20 37.4 a20 20 0 1 1 -40 0 C69 64.2 80.4 56.4 89 42z" fill="#43331a"/>
          <clipPath id="flameClip"><rect x="59" y="${(99.4 - 57.4 * cd.pct).toFixed(1)}" width="60" height="${(57.4 * cd.pct).toFixed(1)}"/></clipPath>
          <g clip-path="url(#flameClip)"><path d="M89 42 c8.6 14.4 20 22.2 20 37.4 a20 20 0 1 1 -40 0 C69 64.2 80.4 56.4 89 42z" fill="url(#gFire)"/></g>
          <path d="M89 68 c4.2 6.8 9.4 10.4 9.4 17.6 a9.4 9.4 0 1 1 -18.8 0 C79.6 78.4 84.8 74.8 89 68z" fill="#fff3c4" opacity=".92"/>
        </g>
      </svg>
      <div class="ctext"><div class="cnum">${esc(cd.hero)}</div><div class="ccap">${esc(cd.cap)}</div></div>
    </div>
  </div>`;
}

/* ---------- PLAN (week at a glance) ---------- */
const TYPE_ICON = {run: "🏃", dumbbell: "🏋️", boxing: "🥊", core: "🔥", yoga: "🧘"};
function renderPlan() {
  const wk = weekDates(), t = todayKey();
  const nx = (typeof c25kNext === "function") ? c25kNext() : null;
  const wkSessions = DB.sessions.filter(x => wk.includes(x.date));
  const wkFood = wk.filter(d => dayEntries(d).length);
  const avgK = wkFood.length ? wkFood.reduce((a, d) => a + dayTotals(d).kcal, 0) / wkFood.length : 0;
  const cells = wk.map(d => {
    const isT = d === t, future = d > t;
    const sess = DB.sessions.filter(x => x.date === d);
    const tot = dayTotals(d);
    const icons = sess.map(x => TYPE_ICON[x.type] || "🏋️").join(" ");
    const plan = plannedFor(d);
    return `<div class="daycell ${isT ? "today" : ""} ${future ? "future" : ""}">
      <div class="dl">${parseKey(d).toLocaleDateString(undefined, {weekday: "short"})}</div>
      <div class="dn">${parseKey(d).getDate()}</div>
      ${future ? `<div class="dk">${plan.short}</div>`
        : `<div class="di">${icons || "·"}</div><div class="dk">${dayEntries(d).length ? `<b>${r0(tot.kcal)}</b> kcal` : "no food"}</div>`}
    </div>`;
  }).join("");
  $("#view-plan").innerHTML = `
  <div class="card tight"><div class="row between"><h3>Week at a glance</h3><span class="small muted">${fmtDay(wk[0])} – ${fmtDay(wk[6])}</span></div>
    <div class="weekgrid" style="margin-top:10px">${cells}</div>
    <p class="small muted" style="margin-top:10px">Future days show your training rhythm — Mon/Wed/Fri strength, Tue/Thu/Sat yoga, Sunday rest.</p>
  </div>
  <div class="card"><h3>Up next</h3>
    ${nx ? `<div class="item"><div class="grow"><div class="t">🏃 Couch to 5K — Week ${nx.w + 1}, Run ${nx.r + 1}</div><div class="s">Your next scheduled run</div></div></div>`
         : `<div class="item"><div class="grow"><div class="t">🏆 Couch to 5K complete</div><div class="s">All 27 runs done — time to pick the next mountain</div></div></div>`}
    <div class="item"><div class="grow"><div class="t">${esc(plannedToday().label)}</div><div class="s">Today's rhythm</div></div></div>
    <button class="btn block" style="margin-top:10px" onclick="show('workouts')">Open Workouts</button>
  </div>
  <div class="grid2">
    <div class="card tight"><div class="stat"><div class="v">${wkSessions.length}</div><div class="k">Workouts this week</div></div></div>
    <div class="card tight"><div class="stat"><div class="v">${wkFood.length ? r0(avgK) : "—"}</div><div class="k">Avg kcal / logged day</div></div></div>
  </div>`;
}

/* ---------- BODY (water · weight · measurements) ---------- */
function renderBody() {
  const t = todayKey(), tg = S().targets;
  const wml = waterFor(t), lw = latestWeight();
  const sw = sortedWeights();
  const trend = sw.length > 1 ? `${dispW(sw[0].kg)} → ${dispW(sw[sw.length - 1].kg)} across ${sw.length} weigh-ins` : "Log a weight to start your trend";
  const byType = {};
  for (const m of DB.measures) if (!byType[m.type] || byType[m.type].date < m.date) byType[m.type] = m;
  const latest = Object.values(byType).sort((a, b) => a.type < b.type ? -1 : 1);
  $("#view-body").innerHTML = `
  <div class="card tight">
    <div class="row between"><h3>💧 Water</h3><span class="small muted">${wml} / ${tg.waterMl} ml</span></div>
    ${bar(tg.waterMl ? wml / tg.waterMl * 100 : 0, "b")}
    <div class="row" style="margin-top:10px">
      <button class="chip grow" style="justify-content:center" onclick="addWater(250)">+250 ml</button>
      <button class="chip grow" style="justify-content:center" onclick="addWater(500)">+500 ml</button>
      <button class="chip grow" style="justify-content:center" onclick="customWater()">Custom</button>
    </div>
  </div>
  <div class="card">
    <div class="row between"><h3>⚖️ Weight</h3><span class="small muted">goal ${dispW(S().goalKg)}</span></div>
    <div class="stat" style="margin:8px 0"><div class="v" style="font-size:1.9rem">${lw ? dispW(lw.kg) : "—"}</div><div class="k">Current</div></div>
    <p class="small muted" style="text-align:center">${esc(trend)}</p>
    <button class="btn block" style="margin-top:10px" onclick="quickWeight()">Log weight</button>
    <button class="btn ghost block" style="margin-top:8px" onclick="show('progress')">Weight history & chart</button>
  </div>
  <div class="card">
    <div class="row between"><h3>📏 Measurements</h3><span class="small muted">${DB.measures.length} logged</span></div>
    ${latest.length ? `<div class="list">${latest.map(m => `<div class="item"><div class="grow"><div class="t">${esc(m.type)}</div><div class="s">${fmtDay(m.date)}</div></div><span class="kc">${m.cm} cm</span></div>`).join("")}</div>`
      : `<p class="small muted" style="margin:8px 0">No measurements yet — waist is a great first one; it moves even when the scale stalls.</p>`}
    <button class="btn block" style="margin-top:8px" onclick="addMeasure()">Add measurement</button>
  </div>`;
}

function addWater(ml, date = todayKey()) {
  DB.water.push({id: uid(), date, ml}); saveDB();
  if (curView === "home") renderHome(); if (curView === "body") renderBody(); if (curView === "nutrition" && window.renderNutrition) renderNutrition();
  toast(`+${ml} ml water`);
}
function customWater() {
  openSheet(`<h3>Add water</h3><label>Amount (ml)</label><input id="cwMl" type="number" inputmode="numeric" min="1" placeholder="e.g. 350">
  <button class="btn block" style="margin-top:14px" id="cwGo">Add</button>`);
  $("#cwGo").onclick = () => { const v = Number($("#cwMl").value); if (v > 0) { closeSheet(); addWater(v); } };
}
function quickWeight(date = todayKey()) {
  openSheet(`<h3>Log weight</h3>
  <label>Weight (${S().units})</label><input id="qwV" type="number" inputmode="decimal" step="0.1" placeholder="${S().units === "lb" ? "e.g. 232.5" : "e.g. 105.2"}">
  <label>Date</label><input id="qwD" type="date" value="${date}">
  <button class="btn block" style="margin-top:14px" id="qwGo">Save</button>`);
  $("#qwGo").onclick = () => {
    const v = Number($("#qwV").value); if (!(v > 0)) return;
    const d = $("#qwD").value || todayKey();
    const ex = DB.weights.find(w => w.date === d);
    if (ex) ex.kg = inputW(v); else DB.weights.push({id: uid(), date: d, kg: inputW(v)});
    saveDB(); closeSheet(); toast("Weight saved");
    if (curView === "home") renderHome(); if (curView === "body") renderBody(); if (curView === "progress" && window.renderProgress) renderProgress();
  };
}

/* ---------- SETTINGS ---------- */
function setCenterStat(v) { S().centerStat = v; saveDB(); renderSettings(); toast("Centre updated"); }
function renderSettings() {
  const s = S(), u = s.units;
  const wNow = latestWeight()?.kg ?? s.startKg;
  $("#view-settings").innerHTML = `
  <div class="card"><h3>📸 AI meal photos (optional)</h3>
    <p class="small muted">Add your own free OpenRouter key to analyse meal photos in Nutrition. The key never leaves this device except to call OpenRouter, no account with The Forge exists, and manual logging works fully without it. Get a free key at openrouter.ai.</p>
    <label>OpenRouter API key</label><input id="orKey" type="password" value="${esc(s.orKey || "")}" placeholder="sk-or-… (optional)" autocomplete="off">
    <button class="btn block" style="margin-top:8px" onclick="saveOrKey()">Save key</button></div>
  <div class="card"><h3>Profile</h3>
    <label>Display name (optional)</label><input id="pfName" value="${esc(s.name)}" placeholder="Your name">
    <div class="two"><div><label>Age</label><input id="pfAge" type="number" inputmode="numeric" value="${s.age}"></div>
    <div><label>Sex (for calorie equation)</label><select id="pfSex"><option value="male" ${s.sex === "male" ? "selected" : ""}>Male</option><option value="female" ${s.sex === "female" ? "selected" : ""}>Female</option></select></div></div>
    <div class="two"><div><label>Height (cm)</label><input id="pfH" type="number" inputmode="decimal" value="${s.heightCm}"></div>
    <div><label>Units</label><select id="pfUnits"><option value="lb" ${u === "lb" ? "selected" : ""}>Pounds (lb)</option><option value="kg" ${u === "kg" ? "selected" : ""}>Kilograms (kg)</option></select></div></div>
    <div class="two"><div><label>Start weight (${u})</label><input id="pfStart" type="number" inputmode="decimal" step="0.1" value="${u === "lb" ? r1(kgToLb(s.startKg)) : r1(s.startKg)}"></div>
    <div><label>Goal weight (${u})</label><input id="pfGoal" type="number" inputmode="decimal" step="0.1" value="${u === "lb" ? r1(kgToLb(s.goalKg)) : r1(s.goalKg)}"></div></div>
    <p class="small muted" style="margin-top:6px">Current weight: <b style="color:var(--ink)">${dispW(wNow)}</b> (from your weight log)</p>
    <label>Activity level</label><select id="pfAct">
      ${[[1.2,"Sedentary — desk job, little exercise"],[1.375,"Light — exercise 1–3 days/week"],[1.55,"Moderate — exercise 3–5 days/week"],[1.725,"Active — exercise 6–7 days/week"],[1.9,"Athlete — hard daily training"]].map(([v, l]) => `<option value="${v}" ${Number(s.activity) === v ? "selected" : ""}>${l}</option>`).join("")}
    </select>
    <label>Goal</label><select id="pfGoalT"><option value="lose" ${s.goalType === "lose" ? "selected" : ""}>Lose weight</option><option value="maintain" ${s.goalType === "maintain" ? "selected" : ""}>Maintain</option><option value="gain" ${s.goalType === "gain" ? "selected" : ""}>Gain muscle</option></select>
    <label>Week starts on</label><select id="pfWeek"><option value="1" ${s.weekStart === 1 ? "selected" : ""}>Monday</option><option value="0" ${s.weekStart === 0 ? "selected" : ""}>Sunday</option></select>
    <button class="btn block" style="margin-top:14px" id="pfSave">Save profile</button>
  </div>
  <div class="card"><h3>Daily targets</h3>
    <div class="two"><div><label>Calories (kcal)</label><input id="tgK" type="number" inputmode="numeric" value="${s.targets.kcal}"></div>
    <div><label>Water (ml)</label><input id="tgW" type="number" inputmode="numeric" value="${s.targets.waterMl}"></div></div>
    <div class="three"><div><label>Protein (g)</label><input id="tgP" type="number" inputmode="numeric" value="${s.targets.p}"></div>
    <div><label>Carbs (g)</label><input id="tgC" type="number" inputmode="numeric" value="${s.targets.c}"></div>
    <div><label>Fat (g)</label><input id="tgF" type="number" inputmode="numeric" value="${s.targets.f}"></div></div>
    <button class="btn block" style="margin-top:12px" id="tgSave">Save targets</button>
    <button class="btn ghost block" style="margin-top:8px" id="tgCalc">Calculate for me instead</button>
    <div id="calcOut"></div>
    <p class="small muted" style="margin-top:10px">Calculated targets use the Mifflin-St Jeor equation with a moderate 500 kcal deficit for weight loss — a starting point, not medical advice. Adjust any time based on your actual trend.</p>
    <label style="margin-top:12px"><span style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="tgExBack" style="width:auto;margin-top:2px" ${s.exerciseBack ? "checked" : ""}> <span>Add exercise calories back to my food budget <span class="dim">(off by default — workout and wearable calorie estimates are often inflated, which can stall weight loss)</span></span></span></label>
  </div>
  <div class="card"><h3>Hub centre</h3>
    <p class="small muted">What the flame at the heart of the hub shows. The flame fills as the day's calories are eaten, and its glow dims as you near your target.</p>
    <div class="seg" style="margin-top:10px">
      <button class="${(s.centerStat || "kcal") === "kcal" ? "on" : ""}" onclick="setCenterStat('kcal')">Calories left</button>
      <button class="${s.centerStat === "weight" ? "on" : ""}" onclick="setCenterStat('weight')">Weight</button>
      <button class="${s.centerStat === "next" ? "on" : ""}" onclick="setCenterStat('next')">Next workout</button>
    </div>
  </div>
  <div class="card"><h3>Your data</h3>
    <p class="small muted">Everything lives only in this browser on this device. Export a backup regularly — clearing browser data or switching phones erases it otherwise.</p>
    <div class="row" style="margin-top:10px"><button class="btn ghost grow" id="dtExp">⬇ Export backup</button>
    <button class="btn ghost grow" id="dtImp">⬆ Import backup</button></div>
    <input type="file" id="dtFile" accept="application/json" style="display:none">
    <button class="btn danger block" style="margin-top:10px" id="dtReset">Reset everything</button>
    <p class="small muted" style="margin-top:10px">${DB.entries.length} food entries · ${DB.foods.length} custom foods · ${DB.meals.length} saved meals · ${DB.weights.length} weigh-ins · ${DB.sessions.length} workouts logged</p>
  </div>
  <div class="card"><h3>About</h3>
    <p class="small muted">The Forge · Free forever, no account, no tracking. Food search (optional, in Nutrition) uses Open Food Facts — only the words you search are sent. Core features work fully offline.</p>
  </div>`;
  $("#pfSave").onclick = () => {
    s.name = $("#pfName").value.trim(); s.age = Number($("#pfAge").value) || s.age;
    s.sex = $("#pfSex").value; s.heightCm = Number($("#pfH").value) || s.heightCm;
    s.units = $("#pfUnits").value; s.startKg = inputW($("#pfStart").value); s.goalKg = inputW($("#pfGoal").value);
    s.activity = Number($("#pfAct").value); s.goalType = $("#pfGoalT").value; s.weekStart = Number($("#pfWeek").value);
    saveDB(); toast("Profile saved"); renderSettings();
  };
  $("#tgSave").onclick = () => {
    s.targets = {kcal: Number($("#tgK").value) || 2000, p: Number($("#tgP").value) || 0,
      c: Number($("#tgC").value) || 0, f: Number($("#tgF").value) || 0, waterMl: Number($("#tgW").value) || 2500};
    s.targetsCustom = true; s.exerciseBack = $("#tgExBack").checked;
    saveDB(); toast("Targets saved");
  };
  $("#tgCalc").onclick = () => {
    const c = calcTargets(s);
    $("#calcOut").innerHTML = `<div class="okn">Estimated maintenance: <b>${c.tdee} kcal/day</b> (BMR ${c.bmr}). Suggested target: <b>${c.kcal} kcal</b> · Protein ${c.p}g · Carbs ${c.c}g · Fat ${c.f}g.
    <button class="btn sm grn" style="margin-top:8px" id="calcApply">Use these targets</button></div>`;
    $("#calcApply").onclick = () => {
      s.targets = {kcal: c.kcal, p: c.p, c: c.c, f: c.f, waterMl: c.waterMl};
      s.targetsCustom = false; saveDB(); toast("Targets updated"); renderSettings();
    };
  };
  $("#dtExp").onclick = exportData;
  $("#dtImp").onclick = () => $("#dtFile").click();
  $("#dtFile").onchange = e => importData(e.target.files[0]);
  $("#dtReset").onclick = () => confirmSheet("Reset The Forge?", "This deletes ALL data on this device — diary, weights, workouts, settings. Export a backup first if you might want it back.", "Delete everything", () => {
    localStorage.removeItem(DB_KEY); loadDB(); saveDB(); toast("Fresh start"); show("home");
  });
}
function exportData() {
  const blob = new Blob([JSON.stringify(DB, null, 1)], {type: "application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "theforge-backup-" + todayKey() + ".json";
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Backup downloaded");
}
function importData(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    let d; try { d = JSON.parse(rd.result); } catch (e) { toast("That file isn't valid JSON"); return; }
    if (!d || typeof d !== "object" || !d.settings || ![ "entries","foods","weights"].every(k => Array.isArray(d[k]))) {
      toast("That doesn't look like a Forge backup"); return;
    }
    openSheet(`<h3>Import backup</h3>
      <p class="small muted" style="margin:6px 0">Backup contains ${d.entries.length} food entries, ${d.weights.length} weigh-ins, ${(d.sessions || []).length} workouts.</p>
      <p class="small" style="margin-bottom:12px"><b>Merge</b> adds records you don't already have (matched by ID) and keeps your current data. <b>Replace</b> wipes this device's data and uses the backup.</p>
      <div class="row"><button class="btn grow" id="impMerge">Merge</button>
      <button class="btn danger grow" id="impRep">Replace all</button></div>
      <button class="btn ghost block" style="margin-top:8px" onclick="closeSheet()">Cancel</button>`);
    $("#impMerge").onclick = () => {
      for (const k of ["entries","foods","meals","water","weights","measures","sessions"]) {
        const have = new Set(DB[k].map(x => x.id));
        for (const rec of (d[k] || [])) if (rec && rec.id && !have.has(rec.id)) DB[k].push(rec);
      }
      saveDB(); closeSheet(); toast("Backup merged"); show("home");
    };
    $("#impRep").onclick = () => { DB = Object.assign(defaultDB(), d); saveDB(); closeSheet(); toast("Backup restored"); show("home"); };
  };
  rd.readAsText(file);
}

/* ---------- boot ---------- */
loadDB();

show("home");

function saveOrKey() { S().orKey = document.getElementById("orKey").value.trim(); saveDB(); toast(S().orKey ? "Key saved — photo analysis on" : "Key cleared"); }

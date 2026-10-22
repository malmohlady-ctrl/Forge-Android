/* FIT HQ Workouts: shared timestamp-based interval player (survives
   screen sleep), Couch to 5K with optional GPS, dumbbell studio with
   set tracking + PRs, boxing round timer, yoga player. */
"use strict";
/* ---------- speech + sound ---------- */
let voiceOn = true;
function speak(text) {
  if (!voiceOn || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0; speechSynthesis.speak(u);
  } catch (e) {}
}
function beep(freq = 760, dur = 0.16) {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = freq; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.stop(ctx.currentTime + dur); setTimeout(() => ctx.close(), dur * 1000 + 80);
  } catch (e) {}
}
/* ---------- GPS ---------- */
const GPS = {on: false, watchId: null, pts: [], dist: 0, last: null};
function hav(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function gpsStart() {
  GPS.pts = []; GPS.dist = 0; GPS.last = null;
  if (!navigator.geolocation) { GPS.on = false; return; }
  GPS.watchId = navigator.geolocation.watchPosition(p => {
    if (!p.coords || (p.coords.accuracy && p.coords.accuracy > 60)) return;
    const pt = {lat: p.coords.latitude, lon: p.coords.longitude, t: p.timestamp};
    if (GPS.last) { const d = hav(GPS.last, pt); if (d > 1 && d < 120) GPS.dist += d; }
    GPS.last = pt; GPS.pts.push(pt);
    const el = document.getElementById("gpsLine"); if (el) el.textContent = gpsText();
  }, () => { const el = document.getElementById("gpsLine"); if (el) el.textContent = "GPS unavailable — timer still running."; },
  {enableHighAccuracy: true, maximumAge: 3000});
}
function gpsStop() { if (GPS.watchId != null) { navigator.geolocation.clearWatch(GPS.watchId); GPS.watchId = null; } }
function gpsText() { return `📍 ${(GPS.dist / 1000).toFixed(2)} km`; }
function gpsPaceSec(elapsedSec) {
  const km = GPS.dist / 1000;
  return km > 0.05 ? Math.round(elapsedSec / km) : 0;
}
/* ---------- shared player ---------- */
let PL = null;
function fmtClock(s) { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + pad2(s % 60); }
function plStart(cfg) {
  PL = Object.assign({idx: 0, paused: false, pauseAccum: 0, pauseStart: 0, midSpoken: false,
    startedAt: Date.now(), totalSecs: cfg.steps.reduce((a, x) => a + x.secs, 0)}, cfg);
  PL.stepEnd = Date.now() + PL.steps[0].secs * 1000;
  if (PL.gps) gpsStart();
  try { navigator.wakeLock?.request("screen").catch(() => {}); } catch (e) {}
  speak(PL.steps[0].say || PL.steps[0].label);
  PL.timer = setInterval(plTick, 250);
  renderPlayer();
}
function plElapsed() { return (Date.now() - PL.startedAt - PL.pauseAccum - (PL.paused ? Date.now() - PL.pauseStart : 0)) / 1000; }
function plTick() {
  if (!PL || PL.paused) return;
  const step = PL.steps[PL.idx]; if (!step) return;
  const rem = (PL.stepEnd - Date.now()) / 1000;
  if (step.mid && !PL.midSpoken && rem < step.secs / 2) { PL.midSpoken = true; speak(step.mid); }
  if (rem <= 0) { plNext(); return; }
  const c = $("#plClock"); if (c) c.textContent = fmtClock(rem);
  const barEl = $("#plBar"); if (barEl) barEl.style.width = Math.min(100, plElapsed() / PL.totalSecs * 100) + "%";
  const g = $("#gpsLine"); if (g && PL.gps) g.textContent = gpsText() + (gpsPaceSec(plElapsed()) ? ` · ${fmtClock(gpsPaceSec(plElapsed()))}/km` : "");
}
function plNext() {
  if (!PL) return;
  PL.idx++; PL.midSpoken = false;
  if (PL.idx >= PL.steps.length) { plFinish(true); return; }
  const s = PL.steps[PL.idx];
  PL.stepEnd = Date.now() + s.secs * 1000;
  beep(s.type === "Run" ? 880 : 620);
  speak(s.say || s.label);
  renderPlayer();
}
function plPauseToggle() {
  if (!PL) return;
  if (PL.paused) { PL.pauseAccum += Date.now() - PL.pauseStart; PL.stepEnd = Date.now() + PL.pausedRemain * 1000; PL.paused = false; }
  else { PL.paused = true; PL.pauseStart = Date.now(); PL.pausedRemain = Math.max(0, (PL.stepEnd - Date.now()) / 1000); try { speechSynthesis.cancel(); } catch (e) {} }
  renderPlayer();
}
function plRestartStep() { if (!PL) return; PL.stepEnd = Date.now() + PL.steps[PL.idx].secs * 1000; PL.midSpoken = false; renderPlayer(); }
function plQuit() {
  confirmSheet("End session?", "The session will be logged with the time completed so far.", "End & log", () => plFinish(false));
}
function plFinish(completed) {
  if (!PL) return;
  clearInterval(PL.timer);
  const mins = Math.max(1, Math.round(plElapsed() / 60));
  const detail = Object.assign({}, PL.detail || {});
  if (PL.gps) {
    gpsStop();
    detail.km = Math.round(GPS.dist / 10) / 100;
    detail.paceSec = gpsPaceSec(plElapsed());
    const stride = Math.max(1, Math.floor(GPS.pts.length / 150));
    detail.track = GPS.pts.filter((_, i) => i % stride === 0).map(p => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]);
  }
  DB.sessions.push({id: uid(), date: todayKey(), type: PL.type, title: PL.title, mins, detail});
  saveDB();
  const doneTitle = PL.title, wasGps = !!PL.gps; PL = null;
  beep(980, 0.25);
  openSheet(`<div style="text-align:center;padding:8px 0">
    <div style="font-size:2.4rem">${completed ? "🏁" : "✅"}</div>
    <h3>${completed ? "Session complete" : "Session logged"}</h3>
    <p class="small muted" style="margin:6px 0">${esc(doneTitle)} · ${mins} min${detail.km ? ` · ${detail.km} km` : ""}${detail.paceSec ? ` · ${fmtClock(detail.paceSec)}/km` : ""}</p>
    ${detail.track && detail.track.length > 2 ? `<canvas id="routeCv" class="chart" style="height:150px"></canvas>` : ""}
    <button class="btn block" style="margin-top:12px" onclick="closeSheet();show('workouts')">Done</button></div>`);
  if (detail.track && detail.track.length > 2) requestAnimationFrame(() => drawRoute($("#routeCv"), detail.track));
  renderWorkouts();
}
function drawRoute(cv, track) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = 150;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  const las = track.map(p => p[0]), los = track.map(p => p[1]);
  const mnLa = Math.min(...las), mxLa = Math.max(...las), mnLo = Math.min(...los), mxLo = Math.max(...los);
  const X = lo => 12 + (lo - mnLo) / Math.max(1e-9, mxLo - mnLo) * (W - 24);
  const Y = la => H - 12 - (la - mnLa) / Math.max(1e-9, mxLa - mnLa) * (H - 24);
  ctx.strokeStyle = "#ff7a1a"; ctx.lineWidth = 2.4; ctx.beginPath();
  track.forEach((p, i) => i ? ctx.lineTo(X(p[1]), Y(p[0])) : ctx.moveTo(X(p[1]), Y(p[0])));
  ctx.stroke();
  ctx.fillStyle = "#43c47c"; ctx.beginPath(); ctx.arc(X(track[0][1]), Y(track[0][0]), 4, 0, 7); ctx.fill();
  ctx.fillStyle = "#e05a5a"; ctx.beginPath(); ctx.arc(X(track[track.length - 1][1]), Y(track[track.length - 1][0]), 4, 0, 7); ctx.fill();
}
function renderPlayer() {
  const s = PL.steps[PL.idx], next = PL.steps[PL.idx + 1];
  $("#view-workouts").innerHTML = `
  <div class="card" style="text-align:center">
    <p class="small muted">${esc(PL.title)}</p>
    <h2 style="margin:6px 0 0">${esc(s.label)}</h2>
    ${s.sub ? `<p class="muted" style="margin-top:2px">${esc(s.sub)}</p>` : ""}
    <div style="font-size:3.6rem;font-weight:800;line-height:1.1" id="plClock">${fmtClock((PL.stepEnd - Date.now()) / 1000)}</div>
    <p class="small muted">Step ${PL.idx + 1} of ${PL.steps.length}${next ? ` · Next: ${esc(next.label)}` : ""}</p>
    ${PL.gps ? `<p class="small" id="gpsLine" style="margin-top:4px">${gpsText()}</p>` : ""}
    <div class="bar" style="margin:12px 0"><i id="plBar" style="width:${Math.min(100, plElapsed() / PL.totalSecs * 100)}%"></i></div>
    <div class="row">
      <button class="btn ghost grow" onclick="plRestartStep()">↺ Restart</button>
      <button class="btn grow" onclick="plPauseToggle()">${PL.paused ? "▶ Resume" : "⏸ Pause"}</button>
      <button class="btn ghost grow" onclick="plNext()">⏭ Skip</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="chip grow" style="justify-content:center" onclick="voiceOn=!voiceOn;renderPlayer()">${voiceOn ? "🔊 Voice on" : "🔇 Voice off"}</button>
      <button class="chip grow" style="justify-content:center" onclick="plQuit()">End & log</button>
    </div>
  </div>`;
}
/* ---------- Couch to 5K ---------- */
function c25kSteps(w) {
  const p = C25K_PLANS[w]; let iv = [];
  const pair = (r, wk) => wk > 0 ? [{type: "Run", secs: r}, {type: "Walk", secs: wk}] : [{type: "Run", secs: r}];
  if (w === 0) for (let i = 0; i < 8; i++) iv.push(...pair(60, 90));
  else if (w === 1) for (let i = 0; i < 6; i++) iv.push(...pair(90, 120));
  else if (w === 2) [[90, 90], [180, 180], [90, 90], [180, 0]].forEach(([r, wk]) => iv.push(...pair(r, wk)));
  else if (w === 3) [[180, 90], [300, 150], [180, 90], [300, 0]].forEach(([r, wk]) => iv.push(...pair(r, wk)));
  else if (w === 4) [[300, 180], [300, 180], [300, 0]].forEach(([r, wk]) => iv.push(...pair(r, wk)));
  else if (w === 5) [[300, 180], [600, 180], [300, 0]].forEach(([r, wk]) => iv.push(...pair(r, wk)));
  else iv = [{type: "Run", secs: p.run}];
  const steps = [{label: "Warm-up walk", secs: 300, say: "Warm up walk. Five minutes, easy pace."}];
  for (const s of iv) steps.push({label: s.type, type: s.type, secs: s.secs, say: s.type === "Run" ? "Run. Easy effort — you should be able to speak in short sentences." : "Walk. Recover."});
  steps.push({label: "Cool-down walk", secs: 300, say: "Cool down walk. Well done."});
  return steps;
}
function c25kDone(w, r) { return DB.sessions.some(x => x.type === "run" && x.detail?.program === "c25k" && x.detail.week === w + 1 && x.detail.run === r + 1); }
function c25kNext() {
  for (let w = 0; w < 9; w++) for (let r = 0; r < 3; r++) if (!c25kDone(w, r)) return {w, r};
  return null;
}
function startRun(w, r) {
  openSheet(`<h3>Week ${w + 1} · Run ${r + 1}</h3>
  <p class="small muted" style="margin:6px 0">${esc(C25K_PLANS[w].desc)} About ${Math.round(c25kSteps(w).reduce((a, x) => a + x.secs, 0) / 60)} minutes including warm-up and cool-down.</p>
  <label><span style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="runGps" style="width:auto;margin-top:2px" checked> <span>Track GPS route, distance & pace <span class="dim">(optional — the run works without it; location stays on this device)</span></span></span></label>
  <button class="btn block" style="margin-top:12px" id="runGo">▶ Start run</button>`);
  $("#runGo").onclick = () => {
    const gps = $("#runGps").checked;
    closeSheet();
    plStart({type: "run", title: `Couch to 5K — Week ${w + 1} Run ${r + 1}`, steps: c25kSteps(w), gps,
      detail: {program: "c25k", week: w + 1, run: r + 1}});
  };
}

/* ---------- Dumbbell studio ---------- */
function circuitSteps() {
  const steps = [{label: "Get ready", secs: 10, say: "Get ready. First up: " + DUMBBELL[0]}];
  DUMBBELL.forEach((name, i) => {
    steps.push({label: name, secs: 45, say: name.replace(/\+/g, " plus ")});
    if (i < DUMBBELL.length - 1) steps.push({label: "Rest", secs: 15, sub: "Next: " + DUMBBELL[i + 1], say: "Rest. Next: " + DUMBBELL[i + 1].replace(/\+/g, " plus ")});
  });
  return steps;
}
function coreSteps() {
  const steps = [{label: "Get ready", secs: 10, say: "Core finisher. First up: " + CORE[0][0]}];
  CORE.forEach(([name, secs], i) => {
    steps.push({label: name, secs, say: name});
    if (i < CORE.length - 1) steps.push({label: "Rest", secs: 20, sub: "Next: " + CORE[i + 1][0], say: "Rest. Next: " + CORE[i + 1][0]});
  });
  return steps;
}
function exHistory(name) {
  return DB.sessions.filter(x => x.type === "dumbbell" && x.detail?.exercise === name);
}
function exPR(name) {
  let best = 0;
  for (const s of exHistory(name)) for (const set of (s.detail.sets || [])) if (set.done && set.kg > best) best = set.kg;
  return best;
}
let setDraft = null, restTimer = null;
function openExercise(name) {
  const hist = exHistory(name), last = hist[hist.length - 1];
  const pr = exPR(name);
  setDraft = last?.detail?.sets?.length ? last.detail.sets.map(s => ({kg: s.kg, reps: s.reps, done: false}))
    : [{kg: 0, reps: 10, done: false}, {kg: 0, reps: 10, done: false}, {kg: 0, reps: 10, done: false}];
  const u = S().units;
  const draw = () => {
    openSheet(`<h3>${esc(name)}</h3>
    <p class="small muted">${pr ? `PR: ${dispW(pr)} · ` : ""}${last ? `Last time: ${fmtDay(last.date)} — ${last.detail.sets.filter(s => s.done).length} sets, top ${dispW(Math.max(...last.detail.sets.filter(s => s.done).map(s => s.kg), 0))}` : "No sessions logged yet."}</p>
    <div class="list">${setDraft.map((s, i) => `
      <div class="item"><span class="small muted" style="width:44px">Set ${i + 1}</span>
      <input type="number" inputmode="decimal" step="0.5" value="${u === "lb" ? r1(kgToLb(s.kg)) || "" : r1(s.kg) || ""}" placeholder="${u}" style="width:86px" onchange="setDraft[${i}].kg=inputW(this.value)">
      <input type="number" inputmode="numeric" value="${s.reps || ""}" placeholder="reps" style="width:70px" onchange="setDraft[${i}].reps=Number(this.value)||0">
      <button class="chip ${s.done ? "grn on" : ""}" onclick="setDraft[${i}].done=!setDraft[${i}].done;window._exDraw()">${s.done ? "✓ Done" : "Mark"}</button>
      <button class="iconbtn" onclick="setDraft.splice(${i},1);window._exDraw()">✕</button></div>`).join("")}</div>
    <div class="row" style="margin-top:8px">
      <button class="chip grow" style="justify-content:center" onclick="setDraft.push({kg:setDraft.length?setDraft[setDraft.length-1].kg:0,reps:10,done:false});window._exDraw()">＋ Add set</button>
      <button class="chip grow" style="justify-content:center" onclick="startRest(60)">⏱ Rest 60s</button>
      <button class="chip grow" style="justify-content:center" onclick="startRest(90)">⏱ Rest 90s</button>
    </div>
    <div id="restSlot"></div>
    <button class="btn block" style="margin-top:12px" id="exSave">Log session</button>`);
    window._exDraw = draw;
    $("#exSave").onclick = () => {
      const done = setDraft.filter(s => s.done);
      if (!done.length) { toast("Mark at least one set done"); return; }
      const topKg = Math.max(...done.map(s => s.kg));
      const wasPR = pr > 0 && topKg > pr;
      DB.sessions.push({id: uid(), date: todayKey(), type: "dumbbell",
        title: "Strength — " + name, mins: Math.max(1, done.length * 3),
        detail: {exercise: name, sets: setDraft}});
      saveDB(); closeSheet(); toast(wasPR ? `🏆 New PR: ${dispW(topKg)}!` : "Session logged");
      renderWorkouts();
    };
  };
  window._exDraw = draw; draw();
}
function startRest(secs) {
  const slot = $("#restSlot"); if (!slot) return;
  clearInterval(restTimer);
  const end = Date.now() + secs * 1000;
  slot.innerHTML = `<div class="okn" style="text-align:center">Rest: <b id="restClock">${fmtClock(secs)}</b> <button class="chip" style="margin-left:8px" onclick="clearInterval(restTimer);this.parentElement.remove()">Cancel</button></div>`;
  restTimer = setInterval(() => {
    const rem = (end - Date.now()) / 1000, el = $("#restClock");
    if (!el) { clearInterval(restTimer); return; }
    if (rem <= 0) { clearInterval(restTimer); el.textContent = "Go!"; beep(920); speak("Go. Next set."); return; }
    el.textContent = fmtClock(rem);
  }, 250);
}
/* ---------- Boxing ---------- */
const NUMW = {1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six"};
const comboWords = c => c.split("-").map(n => NUMW[n] || n).join(", ") + "!";
function boxingSteps(rounds, roundMin, restSec) {
  const lists = [R1, R2, R3];
  const steps = [{label: "Get ready", secs: 10, say: "Boxing. Hands up, light on your feet."}];
  for (let r = 0; r < rounds; r++) {
    const list = r < 3 ? lists[r] : R1.concat(R2, R3);
    const calls = Math.floor(roundMin * 60 / 20);
    steps.push({label: `Round ${r + 1}`, secs: 3, say: `Round ${r + 1}.`});
    for (let i = 0; i < calls; i++) {
      const c = list[Math.floor(Math.random() * list.length)];
      steps.push({label: `Round ${r + 1}`, sub: "Combo: " + c, secs: 20, say: comboWords(c)});
    }
    if (r < rounds - 1) steps.push({label: "Rest", secs: restSec, say: "Rest. Breathe."});
  }
  steps.push({label: "Done", secs: 3, say: "Time. Great work."});
  return steps;
}
function startBoxing() {
  openSheet(`<h3>🥊 Boxing rounds</h3>
  <label>Rounds</label><select id="bxR"><option>3</option><option selected>4</option><option>6</option><option>8</option></select>
  <label>Round length</label><select id="bxM"><option value="2">2 minutes</option><option value="3" selected>3 minutes</option></select>
  <label>Rest between rounds</label><select id="bxRest"><option value="30">30 seconds</option><option value="60" selected>60 seconds</option><option value="90">90 seconds</option></select>
  <p class="small muted" style="margin-top:8px">Combos are called every 20 seconds (1 = jab, 2 = cross, 3 = lead hook, 4 = rear hook, 5 = lead uppercut, 6 = rear uppercut) — the Championship Rounds format from Home Corner.</p>
  <button class="btn block" style="margin-top:12px" id="bxGo">▶ Start</button>`);
  $("#bxGo").onclick = () => {
    const rounds = Number($("#bxR").value), mins = Number($("#bxM").value), rest = Number($("#bxRest").value);
    closeSheet();
    plStart({type: "boxing", title: `Boxing — ${rounds} × ${mins} min`, steps: boxingSteps(rounds, mins, rest), detail: {rounds, roundMin: mins}});
  };
}
/* ---------- Yoga ---------- */
function startYoga(idx) {
  const r = YOGA_ROUTINES[idx];
  const steps = r.segs.map(sg => ({label: sg.name, sub: sg.sanskrit || (sg.type === "rest" ? "Transition" : ""), secs: sg.secs, say: sg.cue, mid: sg.mid}));
  plStart({type: "yoga", title: "Yoga — " + r.title, steps, detail: {routine: r.title}});
}
/* ---------- workouts home ---------- */
function renderWorkouts() {
  if (PL) { renderPlayer(); return; }
  $("#view-workouts").innerHTML = (typeof workoutHubHTML === "function" ? workoutHubHTML() : "");
}
function delSession(id) {
  confirmSheet("Delete session?", "This workout record will be removed.", "Delete", () => {
    DB.sessions = DB.sessions.filter(x => x.id !== id); saveDB(); renderWorkouts();
  });
}

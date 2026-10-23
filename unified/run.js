"use strict";
/* Unified Forge — Run module (U2): Couch to 5K, ported from the standalone
   app @ 0015723. Programme tables, session builder, engine, voice and GPS
   rules mirror the original; adaptations are marked [U2]:
     - clips play through ForgeAudio from assets/run-coach/ (never a fresh
       Audio()); tones through the shared Web Audio context; AppMusic
       ducking is gone (music is U5);
     - GPS runs on gps-core.js — the original's acceptance rules, extracted
       during the spike and shared with the Diagnostics probe;
     - Leaflet is VENDORED (assets/vendor/) — no runtime CDN for code;
       tiles are CARTO dark basemaps as in the original, canvas fallback
       when Leaflet/tiles are unavailable; the map never gates recording;
     - completions write ONE native record into DB.imported (discipline
       "run", the original's full entry fields); selection + prefs live in
       DB.runState / DB.runPrefs; programme position reads through
       adapters' couchData() (legacy + imported + native in one place).

   ENGINE + COMPLETION SPEC (from the original source; the U2 tests encode it):
     - sync() walks stepEnd forward from the real clock; tick every 1 s;
       elapsed is step-derived: calcElapsed() = full steps + (current step
       secs - remaining). Pause syncs first (may finish), then freezes;
       resume sets stepEnd = now + remaining and plays the resumed cue.
     - Skip sets skippedAny, syncs, advances; a skip past the end finishes.
     - finishWorkout is the ONLY save path, guarded by sessionFinished.
       finElapsed = total when stepIndex ran past the end, else calcElapsed().
       Status: "completed" iff !skippedAny AND finElapsed >= 0.9 * total,
       else "partial". Partials save but never count as Done (isDone) and
       never advance the programme.
     - Entry: {key "W-R" (1-based), week, run (0-based), date, timestamp,
       minutes: round(finElapsed/60), durationSec: finElapsed, status};
       km (2dp), paceSec (finElapsed/km) and the downsampled track (<=300)
       are added ONLY when km > 0.05 AND track points > 1 AND finElapsed > 30.
     - GPS points are recorded only while running && !paused (the watch
       itself starts at begin and stops in stopTimer, as in the original). */
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const dateKey = (d) => { d = d || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- programme (verbatim from the original) ---------- */
  const plans = [
    { title: "Week 1", desc: "Build the habit with short, gentle jogs.", run: 60, walk: 90, reps: 8, extra: 0 },
    { title: "Week 2", desc: "Let the running intervals grow a little.", run: 90, walk: 120, reps: 6, extra: 0 },
    { title: "Week 3", desc: "Introduce longer jogs with recovery walks.", run: 90, walk: 90, reps: 2, extra: 180 },
    { title: "Week 4", desc: "A steady step toward longer continuous running.", run: 180, walk: 90, reps: 3, extra: 180 },
    { title: "Week 5", desc: "Build confidence with a longer run interval.", run: 300, walk: 150, reps: 3, extra: 300 },
    { title: "Week 6", desc: "Work toward longer stretches without stopping.", run: 480, walk: 180, reps: 2, extra: 600 },
    { title: "Week 7", desc: "Practice continuous easy running.", run: 1200, walk: 0, reps: 1, extra: 0 },
    { title: "Week 8", desc: "Extend the continuous run gently.", run: 1500, walk: 0, reps: 1, extra: 0 },
    { title: "Week 9", desc: "Finish with a continuous 30-minute easy run.", run: 1800, walk: 0, reps: 1, extra: 0 }
  ];
  function sessionSteps(w, session) {
    const p = plans[w]; let intervals = [];
    if (w === 0) { for (let i = 0; i < 8; i++) { intervals.push({ type: "Run", secs: 60 }); intervals.push({ type: "Walk", secs: 90 }); } }
    else if (w === 1) { for (let i = 0; i < 6; i++) { intervals.push({ type: "Run", secs: 90 }); intervals.push({ type: "Walk", secs: 120 }); } }
    else if (w === 2) { intervals = [{ type: "Run", secs: 90 }, { type: "Walk", secs: 90 }, { type: "Run", secs: 180 }, { type: "Walk", secs: 180 }, { type: "Run", secs: 90 }, { type: "Walk", secs: 90 }, { type: "Run", secs: 180 }]; }
    else if (w === 3) { intervals = [{ type: "Run", secs: 180 }, { type: "Walk", secs: 90 }, { type: "Run", secs: 300 }, { type: "Walk", secs: 150 }, { type: "Run", secs: 180 }, { type: "Walk", secs: 90 }, { type: "Run", secs: 300 }]; }
    else if (w === 4) { intervals = [{ type: "Run", secs: 300 }, { type: "Walk", secs: 180 }, { type: "Run", secs: 300 }, { type: "Walk", secs: 180 }, { type: "Run", secs: 300 }]; }
    else if (w === 5) { intervals = [{ type: "Run", secs: 300 }, { type: "Walk", secs: 180 }, { type: "Run", secs: 600 }, { type: "Walk", secs: 180 }, { type: "Run", secs: 300 }]; }
    else { intervals = [{ type: "Run", secs: p.run }]; }
    if (session === 1 && w <= 2) intervals = intervals.map((x) => ({ ...x }));
    return [{ type: "Warm-up walk", secs: 300 }, ...intervals, { type: "Cool-down walk", secs: 300 }];
  }

  /* ---------- state (unified store) ---------- */
  function sel() { if (!DB.runState) DB.runState = { selectedWeek: 0, selectedRun: 0 }; return DB.runState; }
  function prefs() { if (!DB.runPrefs) DB.runPrefs = { voiceURI: "", rate: .92 }; return DB.runPrefs; }
  function attempts() { return couchData().entries; }
  function workoutKey(w, r) { return (w + 1) + "-" + (r + 1); }
  function isDone(w, r) { return attempts().some((x) => x.key === workoutKey(w, r) && x.status !== "partial"); }

  /* ---------- voice ---------- */
  const CLIPS = {
    "Start running. Let's fucking go, my nigga!": "cue3-start.mp3",
    "Walk and recover. Nice fucking work, my nigga.": "cue3-walk.mp3",
    "Workout resumed. Let's finish this shit strong, my nigga.": "cue3-resumed.mp3",
    "Workout complete. Great fucking job, my nigga! Take your cool down nice and slow.": "cue3-complete.mp3"
  };
  function fallbackSpeak(msg) {
    try {
      if (!("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(msg);
      u.rate = Number(prefs().rate) || .92;
      if (prefs().voiceURI) { const v = speechSynthesis.getVoices().find((x) => x.voiceURI === prefs().voiceURI); if (v) u.voice = v; }
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  async function speak(msg) {
    const f = CLIPS[msg];
    if (!f) { fallbackSpeak(msg); return; }
    const r = await ForgeAudio.playClip("assets/run-coach/" + f, { rate: Number(prefs().rate) || .92, timeoutMs: 20000 });
    if (!r.ok) fallbackSpeak(msg);
  }
  function tone(freq, duration) { ForgeAudio.tone(freq || 700, (duration || .18) * 1000, "sine", 0.07); }

  /* ---------- GPS (spike-proven plumbing; original rules in gps-core) ---------- */
  let track = [], watchId = null, trackMsg = "", gpsFilter = null, liveMap = null, liveLine = null, gpsDenied = false;
  function fmtPace(spk) { if (!isFinite(spk) || spk <= 0 || spk > 3600) return "–"; const m = Math.floor(spk / 60), s = Math.round(spk % 60); return m + ":" + String(s).padStart(2, "0"); }
  function fmtClock(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
  function startTrack() {
    track = []; trackMsg = ""; gpsDenied = false; stopTrack();
    gpsFilter = window.ForgeGPS ? window.ForgeGPS.createFilter() : null;
    resetTrackCard();
    if (!("geolocation" in navigator)) { trackMsg = "Location isn't available on this device."; paintTrackMsg(); return; }
    try {
      watchId = navigator.geolocation.watchPosition((pos) => {
        if (!(running && !paused)) return;
        if (!gpsFilter) return;
        const r = gpsFilter.push(pos.coords, Date.now());
        if (r.accepted) { track.push(r.point); updateTrackUI(); }
      }, (err) => {
        gpsDenied = !!(err && err.code === 1);
        trackMsg = gpsDenied ? "Location permission denied — allow it for The Forge to get distance & pace." : "Couldn't get a GPS fix.";
        paintTrackMsg();
      }, window.ForgeGPS.WATCH_OPTS);
    } catch (e) { trackMsg = "Location isn't available."; paintTrackMsg(); }
  }
  function stopTrack() { if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch (e) {} watchId = null; } }
  function paintTrackMsg() { const e = $("rnTrackMsg"); if (e) e.textContent = trackMsg || (track.length ? "Your route is drawn as you run. It never leaves your phone." : "Waiting for GPS…"); const b = $("rnEnableLoc"); if (b) b.style.display = gpsDenied ? "" : "none"; }
  function resetTrackCard() {
    if ($("rnLiveKm")) $("rnLiveKm").textContent = "0.00";
    if ($("rnLivePace")) $("rnLivePace").textContent = "–";
    if ($("rnLiveTime")) $("rnLiveTime").textContent = "0:00";
    paintTrackMsg(); resetLiveMap();
  }
  function resetLiveMap() { try { if (liveMap) liveMap.remove(); } catch (e) {} liveMap = null; liveLine = null; const el = $("rnMap"); if (el) el.innerHTML = ""; }
  function updateTrackUI() {
    const km = window.ForgeGPS.trackKm(track), secs = elapsed || 0;
    if ($("rnLiveKm")) $("rnLiveKm").textContent = km.toFixed(2);
    if ($("rnLiveTime")) $("rnLiveTime").textContent = fmtClock(secs);
    if ($("rnLivePace")) $("rnLivePace").textContent = km > 0.02 && secs > 10 ? fmtPace(secs / km) : "–";
    paintTrackMsg();
    drawLiveMap();
  }
  function drawLiveMap() {
    const el = $("rnMap"); if (!el || !track.length) return;
    const latlngs = track.map((p) => [p.lat, p.lon]);
    if (window.L) {
      try {
        if (!liveMap) {
          el.innerHTML = "";
          liveMap = L.map(el, { zoomControl: false }).setView(latlngs[0], 15);
          L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors © CARTO" }).addTo(liveMap);
          liveLine = L.polyline(latlngs, { color: "#d4a72c", weight: 4 }).addTo(liveMap);
          L.circleMarker(latlngs[0], { radius: 6, color: "#d4a72c", fillColor: "#d4a72c", fillOpacity: 1 }).addTo(liveMap);
          setTimeout(() => { try { liveMap.invalidateSize(); } catch (e) {} }, 150);
        } else liveLine.setLatLngs(latlngs);
        liveMap.fitBounds(liveLine.getBounds(), { padding: [24, 24] });
        return;
      } catch (e) {}
    }
    drawTraceCanvas(el, track);
  }
  function drawTraceCanvas(el, pts) {
    const w = el.clientWidth || 320, h = 230;
    const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
    let a = Math.min(...lats), b = Math.max(...lats), c = Math.min(...lons), d = Math.max(...lons);
    if (b - a < 1e-6) { b += 5e-5; a -= 5e-5; } if (d - c < 1e-6) { d += 5e-5; c -= 5e-5; }
    const X = (lo) => 20 + (lo - c) / (d - c) * (w - 40), Y = (la) => 20 + (1 - (la - a) / (b - a)) * (h - 40);
    el.innerHTML = `<canvas width="${w}" height="${h}" style="width:100%;display:block;border-radius:12px;background:#1c2742"></canvas><p class="small muted" style="margin:6px 0 0">Offline — the street map needs a data connection.</p>`;
    const cv = el.querySelector("canvas"); if (!cv) return;
    const g = cv.getContext("2d");
    g.strokeStyle = "#d4a72c"; g.lineWidth = 3; g.lineJoin = "round"; g.beginPath();
    pts.forEach((p, i) => { const x = X(p.lon), y = Y(p.lat); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    g.fillStyle = "#d4a72c"; g.beginPath(); g.arc(X(pts[0].lon), Y(pts[0].lat), 5, 0, 7); g.fill();
    g.fillStyle = "#e05a5a"; const e2 = pts[pts.length - 1]; g.beginPath(); g.arc(X(e2.lon), Y(e2.lat), 5, 0, 7); g.fill();
  }

  /* ---------- engine (mirrors the original) ---------- */
  let steps = [], stepIndex = 0, remaining = 0, total = 0, elapsed = 0, interval = null, running = false, paused = false, started = false, stepEnd = 0, wakeLock = null;
  let sessionFinished = false, skippedAny = false;
  function totalFor(s) { return s.reduce((a, x) => a + x.secs, 0); }
  function calcElapsed() { let e = 0; for (let i = 0; i < stepIndex; i++) e += steps[i].secs; return e + steps[stepIndex].secs - remaining; }
  function sync() {
    const now = Date.now(); let changed = 0;
    while (now >= stepEnd) {
      stepIndex++;
      if (stepIndex >= steps.length) { finishWorkout(); return -1; }
      stepEnd += steps[stepIndex].secs * 1000; changed = 1;
    }
    remaining = Math.ceil((stepEnd - now) / 1000); elapsed = calcElapsed();
    return changed;
  }
  async function keepAwake(on) {
    try {
      if (!on) { if (wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); } return; }
      if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
    } catch (e) { wakeLock = null; }
  }
  function announceStep(silent) {
    const s = steps[stepIndex]; if (!s) return;
    if (!silent) {
      tone(s.type === "Run" ? 850 : 560, .22);
      speak(s.type === "Run" ? "Start running. Let's fucking go, my nigga!" : (s.type === "Walk" || s.type.includes("walk")) ? "Walk and recover. Nice fucking work, my nigga." : s.type);
    }
    if ($("rnPhase")) $("rnPhase").textContent = s.type;
    if ($("rnStepText")) $("rnStepText").textContent = s.type;
    if ($("rnClock")) $("rnClock").textContent = fmt(remaining);
    if ($("rnStepCount")) $("rnStepCount").textContent = "Stage " + (stepIndex + 1) + " of " + steps.length;
  }
  function updateTimer() {
    if ($("rnClock")) $("rnClock").textContent = fmt(remaining);
    if ($("rnProgress")) $("rnProgress").style.width = Math.min(100, total ? elapsed / total * 100 : 0) + "%";
    if (track.length) updateTrackUI();
  }
  function tick() {
    if (!running || paused) return;
    const r = sync();
    if (r < 0) return;
    if (r > 0) announceStep();
    updateTimer();
  }
  function beginWorkout() {
    steps = sessionSteps(sel().selectedWeek, sel().selectedRun); total = totalFor(steps); stepIndex = 0; remaining = steps[0].secs; stepEnd = Date.now() + remaining * 1000; elapsed = 0; started = true; running = true; paused = false; sessionFinished = false; skippedAny = false;
    if ($("rnProgress")) $("rnProgress").style.width = "0%";
    announceStep(); keepAwake(true); syncRunControls();
    interval = setInterval(tick, 1000); startTrack();
  }
  function resumeWorkout() {
    if (!paused) return;
    paused = false; running = true; stepEnd = Date.now() + remaining * 1000; syncRunControls(); interval = setInterval(tick, 1000); speak("Workout resumed. Let's finish this shit strong, my nigga."); keepAwake(true);
  }
  function startWorkout() {
    if ((running || paused) && !confirm("Restart this workout from the beginning?")) return;
    stopTimer(); beginWorkout();
  }
  function stopTimer() { if (interval) clearInterval(interval); interval = null; running = false; paused = false; keepAwake(false); stopTrack(); }
  function togglePause() {
    if (!started) return;
    if (!paused) {
      if (sync() < 0) return;
      paused = true; running = false; if (interval) clearInterval(interval); interval = null; keepAwake(false);
      if ($("rnPhase")) $("rnPhase").textContent = "Paused";
      if ($("rnStepText") && steps[stepIndex]) $("rnStepText").textContent = steps[stepIndex].type;
      if ($("rnStepCount")) $("rnStepCount").textContent = "Stage " + (stepIndex + 1) + " of " + steps.length;
      syncRunControls(); updateTimer();
    } else resumeWorkout();
  }
  function skipStep() {
    if (!started) return;
    skippedAny = true;
    if (running && sync() < 0) return;
    stepIndex++;
    if (stepIndex >= steps.length) { finishWorkout(); return; }
    remaining = steps[stepIndex].secs; stepEnd = Date.now() + remaining * 1000; elapsed = calcElapsed(); announceStep(); updateTimer();
  }
  function finishWorkout() {
    if (sessionFinished) return; sessionFinished = true;
    stopTimer(); tone(900, .4); speak("Workout complete. Great fucking job, my nigga! Take your cool down nice and slow.");
    elapsed = stepIndex >= steps.length ? total : calcElapsed();
    const finElapsed = Math.max(0, Math.round(elapsed));
    const status = (!skippedAny && finElapsed >= 0.9 * total) ? "completed" : "partial";
    const s = sel();
    const entry = { key: workoutKey(s.selectedWeek, s.selectedRun), week: s.selectedWeek, run: s.selectedRun, date: dateKey(), timestamp: Date.now(), minutes: Math.round(finElapsed / 60), durationSec: finElapsed, status };
    const km = window.ForgeGPS ? window.ForgeGPS.trackKm(track) : 0;
    if (km > 0.05 && track.length > 1 && finElapsed > 30) { entry.km = +km.toFixed(2); entry.paceSec = +(finElapsed / km).toFixed(0); entry.track = window.ForgeGPS.downsample(track); }
    saveNativeRun(entry);
    if ($("rnPhase")) $("rnPhase").textContent = status === "partial" ? "Session ended early" : "Workout complete";
    if ($("rnClock")) $("rnClock").textContent = "00:00";
    if ($("rnStepText")) $("rnStepText").textContent = "Great work — you've done today's session";
    if ($("rnStepCount")) $("rnStepCount").textContent = "Saved to your progress";
    if ($("rnProgress")) $("rnProgress").style.width = "100%";
    syncRunControls(); paintPlan();
  }
  function saveNativeRun(entry) {
    if (!Array.isArray(DB.imported)) DB.imported = [];
    DB.imported.push({ id: "run:" + entry.timestamp, source: "native", discipline: "run",
      title: "Week " + (entry.week + 1) + " · Run " + (entry.run + 1), ...entry });
    saveDB();
  }
  function syncRunControls() {
    const sb = $("rnStartBtn"), pb = $("rnPauseBtn"), sk = $("rnSkipBtn");
    if (!sb) return;
    sb.textContent = sessionFinished ? "Run again" : (started ? "Restart workout" : (isDone(sel().selectedWeek, sel().selectedRun) ? "Run again" : "Start workout"));
    pb.disabled = !started || sessionFinished; sk.disabled = !started || sessionFinished;
    pb.textContent = paused ? "Resume" : "Pause";
  }

  /* ---------- view ---------- */
  const CUES = [
    "Start slower than you think you need to. Walking breaks are part of the plan, not a failure.",
    "Keep your shoulders relaxed and your steps light. You should be able to speak in short sentences.",
    "Consistency beats speed. If this week feels too tough, repeat it before moving on.",
    "The run intervals are practice, not a test. Easy effort is the right effort.",
    "Finish feeling in control. You can always slow down or take an extra walk break."
  ];
  function loadWorkout() {
    if (running) { if (!confirm("Change workout and stop the current timer?")) return; stopTimer(); }
    steps = sessionSteps(sel().selectedWeek, sel().selectedRun); total = totalFor(steps); stepIndex = 0; remaining = steps[0].secs; elapsed = 0; started = false; paused = false;
    if ($("rnTitle")) $("rnTitle").textContent = "Week " + (sel().selectedWeek + 1) + " · Run " + (sel().selectedRun + 1);
    if ($("rnDuration")) $("rnDuration").textContent = "~" + Math.round(total / 60) + " min";
    if ($("rnSummary")) $("rnSummary").textContent = plans[sel().selectedWeek].desc;
    if ($("rnPhase")) $("rnPhase").textContent = "Ready when you are";
    if ($("rnClock")) $("rnClock").textContent = fmt(steps[0].secs);
    if ($("rnStepText")) $("rnStepText").textContent = steps[0].type;
    if ($("rnStepCount")) $("rnStepCount").textContent = steps.length + " stages · " + Math.round(total / 60) + " minutes";
    if ($("rnProgress")) $("rnProgress").style.width = "0%";
    if ($("rnCue")) $("rnCue").textContent = CUES[Math.min(sel().selectedWeek, 4)];
    syncRunControls(); paintPlan();
  }
  function paintPlan() {
    const el = $("rnPlan"); if (!el) return;
    el.innerHTML = plans.map((p, w) => {
      const n = [0, 1, 2].filter((r) => isDone(w, r)).length;
      return `<div class="card" style="padding:12px;margin-bottom:10px"><div style="display:flex;justify-content:space-between"><div><strong>Week ${w + 1}</strong><div class="muted" style="font-size:13px">${esc(p.desc)}</div></div><span class="pill">${n}/3 done</span></div><div class="bar" style="margin-top:8px"><i style="width:${n / 3 * 100}%"></i></div><div style="margin-top:8px;display:flex;gap:6px">${[0, 1, 2].map((r) => `<button class="btn sm rnSession" data-w="${w}" data-r="${r}" style="${isDone(w, r) ? "border-color:var(--gold,#d4a72c)" : ""} ${w === sel().selectedWeek && r === sel().selectedRun ? "background:var(--gold,#d4a72c);color:#141b2e" : ""}">${isDone(w, r) ? "✓ " : ""}Run ${r + 1}</button>`).join("")}</div></div>`;
    }).join("");
    el.querySelectorAll(".rnSession").forEach((b) => b.addEventListener("click", () => {
      sel().selectedWeek = +b.dataset.w; sel().selectedRun = +b.dataset.r; saveDB();
      const ws = $("rnWeekSel"), rs = $("rnRunSel"); if (ws) ws.value = String(sel().selectedWeek); if (rs) rs.value = String(sel().selectedRun);
      loadWorkout();
    }));
  }
  window.renderRun = function () {
    const el = $("view-run"); if (!el) return;
    resetLiveMap();
    el.innerHTML = `<div style="padding:18px;max-width:560px;margin:0 auto">
      <div class="card" style="padding:16px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center"><span id="rnTitle" style="font-weight:800;font-size:17px">Week 1 · Run 1</span><span class="pill" id="rnDuration">~30 min</span></div>
        <div id="rnSummary" class="muted" style="margin-top:4px"></div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <select id="rnWeekSel" style="flex:1">${plans.map((p, i) => `<option value="${i}">Week ${i + 1}</option>`).join("")}</select>
          <select id="rnRunSel" style="flex:1">${[0, 1, 2].map((r) => `<option value="${r}">Run ${r + 1}</option>`).join("")}</select>
        </div>
        <div id="rnCue" style="margin-top:10px;font-style:italic"></div>
      </div>
      <div class="card" style="padding:18px;text-align:center">
        <div id="rnPhase" style="color:var(--gold,#d4a72c);font-weight:700;letter-spacing:.05em">Ready when you are</div>
        <div id="rnClock" style="font-size:56px;font-weight:800;font-variant-numeric:tabular-nums">05:00</div>
        <div id="rnStepText" style="min-height:24px"></div>
        <div id="rnStepCount" class="muted" style="margin-top:2px"></div>
        <div class="bar" style="margin:14px 0"><i id="rnProgress" style="width:0%"></i></div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn" id="rnStartBtn">Start workout</button>
          <button class="btn" id="rnPauseBtn" disabled>Pause</button>
          <button class="btn" id="rnSkipBtn" disabled>Skip ›</button>
        </div>
      </div>
      <div class="card" style="padding:16px;margin-top:14px">
        <div style="font-weight:700;margin-bottom:6px">Run tracking</div>
        <div style="display:flex;gap:14px;font-variant-numeric:tabular-nums"><span><b id="rnLiveKm">0.00</b> km</span><span>pace <b id="rnLivePace">–</b></span><span>time <b id="rnLiveTime">0:00</b></span></div>
        <div id="rnMap" style="height:230px;border-radius:12px;overflow:hidden;margin-top:10px;background:#1c2742"></div>
        <div id="rnTrackMsg" class="muted" style="margin-top:8px;font-size:13px">Your route is drawn as you run. It never leaves your phone.</div>
        <button class="btn sm" id="rnEnableLoc" style="display:none;margin-top:8px">Enable location</button>
      </div>
      <div class="card" style="padding:16px;margin-top:14px">
        <div style="font-weight:700;margin-bottom:6px">Miles — coach voice</div>
        <label class="muted">Speed <span id="rnRateLabel">${(Number(prefs().rate) || .92).toFixed(2)}</span></label>
        <input type="range" id="rnRate" min="0.7" max="1.3" step="0.05" value="${Number(prefs().rate) || .92}" style="width:100%">
        <button class="btn sm" id="rnVoiceTest" style="margin-top:8px">Test voice</button>
      </div>
      <div id="rnMusic"></div>
      <h3 style="margin:18px 0 10px">The programme</h3>
      <div id="rnPlan"></div>
    </div>`;
    $("rnWeekSel").value = String(sel().selectedWeek);
    $("rnRunSel").value = String(sel().selectedRun);
    $("rnWeekSel").addEventListener("change", (e) => { sel().selectedWeek = +e.target.value; saveDB(); loadWorkout(); });
    $("rnRunSel").addEventListener("change", (e) => { sel().selectedRun = +e.target.value; saveDB(); loadWorkout(); });
    $("rnStartBtn").onclick = startWorkout;
    $("rnPauseBtn").onclick = togglePause;
    $("rnSkipBtn").onclick = skipStep;
    $("rnRate").addEventListener("input", (e) => { prefs().rate = +e.target.value; $("rnRateLabel").textContent = prefs().rate.toFixed(2); saveDB(); });
    $("rnVoiceTest").addEventListener("click", () => speak("Start running. Let's fucking go, my nigga!"));
    if (window.ForgeMusic) ForgeMusic.mount("run", document.getElementById("rnMusic"));
    $("rnEnableLoc").addEventListener("click", async () => {
      try {
        const plug = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GpsPerm;
        if (!plug) return;
        const r = await plug.request();
        if (r.state === "granted") { gpsDenied = false; trackMsg = ""; if (started && !sessionFinished) startTrack(); paintTrackMsg(); }
      } catch (e) {}
    });
    if (started && !sessionFinished) { announceStep(true); syncRunControls(); updateTrackUI(); }
    else if (sessionFinished) { if ($("rnPhase")) $("rnPhase").textContent = "Workout complete"; syncRunControls(); paintPlan(); }
    else loadWorkout();
  };

  window.RunSession = { active: () => started && !sessionFinished };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && running && !paused) { tick(); if (running) keepAwake(true); } });

  /* exposed for the U2 node tests */
  window.ForgeRun = { plans, sessionSteps, totalFor, CLIPS,
    engine: { start: beginWorkout, tick, togglePause, skip: skipStep, finish: finishWorkout, load: loadWorkout,
      state: () => ({ steps: steps.length, stepIndex, remaining, total, elapsed, running, paused, started, sessionFinished, skippedAny }),
      feedFix(c, t) { if (!(running && !paused) || !gpsFilter) return; const r = gpsFilter.push(c, t); if (r.accepted) track.push(r.point); },
      track: () => track, beginTrack: () => { gpsFilter = window.ForgeGPS.createFilter(); track = []; } } };
})();

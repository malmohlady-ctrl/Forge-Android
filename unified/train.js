"use strict";
/* Unified Forge — Train module (U1): Lace Up, ported from the standalone
   Home-Corner app @ 1551716. The builders, step data, clip map and engine
   below mirror the original's code; the adaptations are only where the
   unified app requires them, each marked [U1]:
     - clips play through ForgeAudio (the U0 audio core), never a fresh
       Audio() element [the M1 F2 fix]; clip paths resolve under assets/;
     - tones go through ForgeAudio's shared Web Audio context;
     - AppMusic ducking is gone (music is U5);
     - the completion writes ONE native record into the unified store
       (DB.imported, discipline "train") instead of basementbelt.v1;
     - prefs live in DB.trainPrefs instead of basementbelt.prefs.v1.

   ENGINE SEMANTICS SPEC (read from the original source — the U1 tests
   encode exactly these rules):
     - Timing is real-clock: each step has an absolute stepEnd; a 500 ms
       tick() derives `remaining` from Date.now(). computeElapsed() is
       STEP-DERIVED: full seconds of completed steps + (current step secs
       - remaining). It never accumulates wall time directly.
     - Pause: the pause handler first calls tick() (sync to now), then
       freezes. On resume, stepEnd = now + remaining*1000 — wall time spent
       paused is fully excluded; the step continues with its remaining secs.
     - Skip: stepIndex++, the new step starts at full secs from now; the
       skipped step's leftover time is discarded (not counted as elapsed
       beyond the full steps before it).
     - Save: finishModule() is the ONLY save path. It fires when stepIndex
       runs past the last step (natural finish or skipping through the end).
       There is NO end-early save in the original: leaving mid-session saves
       nothing. A sessionFinished flag makes finishModule idempotent —
       repeat calls are no-ops (duplicate-save prevention).
     - Record: {module, name, date, timestamp, minutes: round(total/60)
       [the PLANNED total], durationSec: round(computeElapsed()) [actual]}.
     - Restart during a session asks for confirmation first. */
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const dateKey = (d) => { d = d || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  /* ---------- prefs (unified store) ---------- */
  function prefs() { if (!DB.trainPrefs) DB.trainPrefs = { rate: .95 }; return DB.trainPrefs; }
  function savePrefs() { saveDB(); }

  /* ---------- voice ---------- */
  function fallbackSpeak(msg) {
    try {
      if (!("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(msg);
      u.rate = Number(prefs().rate) || .95;
      if (prefs().voiceURI) { const v = speechSynthesis.getVoices().find((x) => x.voiceURI === prefs().voiceURI); if (v) u.voice = v; }
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  const CLIPS = {
    "Back to work.": "coach/back-to-work.mp3",
    "Dumbbell circuit complete. Guns loaded. Go rehydrate.": "coach/done-dumbbell.mp3",
    "Championship rounds complete. You went the distance.": "coach/done-boxing.mp3",
    "Core finisher complete. Solid work.": "coach/done-core.mp3"
  };
  async function playClip(f, msg) {
    const r = await ForgeAudio.playClip("assets/" + f, { rate: Number(prefs().rate) || .95, timeoutMs: 20000 });
    if (!r.ok && msg) fallbackSpeak(msg);
  }
  function speak(msg) { const f = CLIPS[msg]; if (!f) { fallbackSpeak(msg); return; } playClip(f, msg); }
  function speakStep(s) { if (s.clip) { playClip(s.clip, s.say || ""); } else if (s.say) { fallbackSpeak(s.say); } }
  function tone(freq, duration) { ForgeAudio.tone(freq || 700, (duration || .18) * 1000, "sine", 0.07); }

  /* ---------- workout content (verbatim from the original) ---------- */
  const DUMBBELL = [
    "3X Hammer Curl + 3X Press", "Bent Over Back Rows", "Renegade Row", "Close Grip to Rotational ISO Chest Press",
    "Kneeling Front Raise", "Kneeling Inward Curls", "L-Sit Leg Raise", "Alt In and Out", "Gorilla Rows",
    "Front to Side Raise (Right)", "Front to Side Raise (Left)", "Good Morning", "Alt Upright Rows", "Chest Press + Opener",
    "ISO to Double Chest Fly", "Triceps to Tate Press", "Kneeling Curl to Press to Extension", "Pullover to Reverse Crunch",
    "Sit-Up to DB Tap", "Push-Up to Ranger to Curls", "Bent Over Twist Row (Right)", "Bent Over Twist Row (Left)",
    "Single to Double Triceps Kickback", "3X Twist Curl + Hold", "Weighted Crunches", "Skull Crusher + Flutters",
    "Concentration Curl (Right)", "Concentration Curl (Left)", "Decline Reverse Press"];
  function sayName(n) { return n.replace(/\+/g, " plus ").replace(/3X/g, "3 X").replace(/\(Right\)/g, "right").replace(/\(Left\)/g, "left"); }
  function buildDumbbell() {
    const steps = [{ label: "Get ready", sub: "First up: " + DUMBBELL[0], secs: 10, say: "Get ready. First up: " + sayName(DUMBBELL[0]), clip: "coach/get-ready.mp3" }];
    DUMBBELL.forEach((ex, i) => {
      const next = DUMBBELL[i + 1];
      const n = String(i + 1).padStart(2, "0");
      steps.push({ label: "Exercise " + (i + 1) + " of " + DUMBBELL.length, sub: ex, secs: 45, say: "Exercise " + (i + 1) + ". " + sayName(ex) + ". Go!", clip: "coach/ex-" + n + ".mp3" });
      steps.push({ label: "Rest", sub: next ? ("Next up: " + next) : "Nearly there", secs: 15, say: "Rest.", clip: "coach/rest.mp3" });
    });
    return steps;
  }
  const NUMW = { 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six" };
  function comboWords(c) { return c.split("-").map((n) => NUMW[n] || n).join(", ") + "!"; }
  const R1 = ["1-2", "1-1-2", "2-3-2", "1-2-3-2"], R2 = ["1-2-3", "3-2-3", "1-3-2", "2-4-2"], R3 = ["1-6-3-2", "5-2-3", "2-5-2-3", "1-2-5-2"];
  const R4ALL = R1.concat(R2, R3);
  function comboClip(c) { return "coach/combo-" + c + ".mp3"; }
  function buildBoxing(opts) {
    opts = opts || {};
    const steps = [];
    if (!opts.short) {
      steps.push({ label: "Warm-up", sub: "Arm circles", secs: 40, say: "Warm up. Big arm circles.", clip: "coach/warm-arms.mp3" });
      steps.push({ label: "Warm-up", sub: "Torso twists", secs: 40, say: "Torso twists. Loosen up.", clip: "coach/warm-torso.mp3" });
      steps.push({ label: "Warm-up", sub: "Bounce on your toes", secs: 40, say: "Bounce on your toes. Stay light.", clip: "coach/warm-bounce.mp3" });
    }
    const rounds = [
      { name: "Round 1 — The One-Two School", intro: "Round 1. The One-Two School. Hands up, chin down!", clip: "coach/round1-intro.mp3", list: R1, next: "Next: Round 2, Hooks" },
      { name: "Round 2 — Hooks", intro: "Round 2. Hooks. Turn those hips!", clip: "coach/round2-intro.mp3", list: R2, next: "Next: Round 3, Upstairs Downstairs" },
      { name: "Round 3 — Upstairs Downstairs", intro: "Round 3. Upstairs, downstairs. Head and body!", clip: "coach/round3-intro.mp3", list: R3, next: "Next: the Championship Round" }];
    rounds.forEach((r) => {
      steps.push({ label: r.name, sub: "Round begins", secs: 5, say: r.intro, clip: r.clip });
      for (let i = 0; i < 9; i++) { const c = r.list[i % r.list.length]; steps.push({ label: r.name, sub: "Call: " + c, secs: 20, say: comboWords(c), clip: comboClip(c) }); }
      steps.push({ label: "Rest", sub: opts.short ? "Next round coming up" : r.next, secs: opts.short ? 45 : 60, say: "Rest. Shake it out. Breathe.", clip: "coach/rest-shake.mp3" });
    });
    if (opts.short) { if (steps.length && steps[steps.length - 1].label === "Rest") steps.pop(); return steps; }
    steps.push({ label: "Round 4 — Championship Round", sub: "Freestyle power", secs: 5, say: "Championship round. Freestyle power. Leave it all in the ring!", clip: "coach/round4-intro.mp3" });
    for (let i = 0; i < 8; i++) { const c = R4ALL[Math.floor(Math.random() * R4ALL.length)]; steps.push({ label: "Round 4 — Championship Round", sub: "Freestyle: " + c, secs: 20, say: comboWords(c), clip: comboClip(c) }); }
    steps.push({ label: "Round 4 — Championship Round", sub: "EMPTY THE TANK", secs: 20, say: "Everything you've got! Final 20 seconds!", clip: "coach/empty-tank.mp3" });
    steps.push({ label: "Abs Blast", sub: "4 × 30 seconds, no rest", secs: 5, say: "Abs blast. 30 seconds each. No rest between.", clip: "coach/abs-intro.mp3" });
    const ABSCLIP = { "Crunches": "coach/abs-crunches.mp3", "Leg Raises": "coach/abs-leg-raises.mp3", "Russian Twists": "coach/abs-russian-twists.mp3", "Plank": "coach/abs-plank.mp3" };
    [["Crunches", 30], ["Leg Raises", 30], ["Russian Twists", 30], ["Plank", 30]].forEach((a) => steps.push({ label: "Abs Blast", sub: a[0], secs: a[1], say: a[0] + ". Go!", clip: ABSCLIP[a[0]] }));
    return steps;
  }
  const CORE = [["Plank", 40], ["Dead Bug", 40], ["Russian Twists", 40], ["Mountain Climbers", 40], ["Leg Raises", 40], ["Bicycle Crunches", 40], ["Side Plank — Left", 40], ["Side Plank — Right", 40]];
  function buildCore(count) {
    const LIST = CORE.slice(0, count || CORE.length);
    const steps = [{ label: "Get ready", sub: "First up: Plank", secs: 10, say: "Get ready. Core finisher. First up: plank.", clip: "coach/core-ready.mp3" }];
    const CORECLIP = { "Plank": "coach/abs-plank.mp3", "Dead Bug": "coach/core-dead-bug.mp3", "Russian Twists": "coach/abs-russian-twists.mp3", "Mountain Climbers": "coach/core-climbers.mp3", "Leg Raises": "coach/abs-leg-raises.mp3", "Bicycle Crunches": "coach/core-bicycle.mp3", "Side Plank — Left": "coach/core-side-left.mp3", "Side Plank — Right": "coach/core-side-right.mp3" };
    LIST.forEach((c, i) => {
      const next = LIST[i + 1];
      steps.push({ label: "Exercise " + (i + 1) + " of " + LIST.length, sub: c[0] + " — 40 seconds", secs: 40, say: c[0] + ". Go!", clip: CORECLIP[c[0]] });
      steps.push({ label: "Rest", sub: next ? ("Next up: " + next[0]) : "Last one done", secs: 20, say: "Rest.", clip: "coach/rest.mp3" });
    });
    return steps;
  }
  function buildLaceUp() {
    const steps = buildDumbbell();
    steps.push({ label: "Shadow Boxing", sub: "Dumbbells down — 3 rounds", secs: 20, say: "Dumbbells down. Shadow boxing next. Three rounds. Hands up, chin down!", clip: null });
    return steps.concat(buildBoxing({ short: true }), buildCore(6));
  }
  const MODULE = { name: "Lace Up", tag: "~45 min", build: buildLaceUp,
    done: "Session complete. Lift, box, core — the full distance. Laces off. You earned the couch." };

  /* ---------- timer engine (real-clock sync — mirrors the original) ---------- */
  let steps = [], stepIndex = 0, remaining = 0, total = 0, interval = null, running = false, paused = false, started = false, stepEnd = 0, wakeLock = null;
  let sessionFinished = false;
  function totalFor(s) { return s.reduce((a, x) => a + x.secs, 0); }
  function computeElapsed() { let e = 0; for (let i = 0; i < stepIndex; i++) e += steps[i].secs; if (steps[stepIndex]) e += steps[stepIndex].secs - Math.max(0, remaining); return e; }
  async function keepAwake(on) {
    try {
      if (on && "wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
      else if (!on && wakeLock) { try { await wakeLock.release(); } catch (e) {} wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }
  function announceStep(silent) {
    const s = steps[stepIndex]; if (!s) return;
    if (!silent) {
      if (s.clip || s.say) speakStep(s);
      tone(s.label === "Rest" ? 520 : 760, .18);
    }
    if ($("trPhase")) $("trPhase").textContent = s.label;
    if ($("trStepText")) $("trStepText").textContent = s.sub || s.label;
    if ($("trStepCount")) $("trStepCount").textContent = "Stage " + (stepIndex + 1) + " of " + steps.length;
    updateTimer();
  }
  function updateTimer() {
    if ($("trClock")) $("trClock").textContent = fmt(remaining);
    if ($("trProgress")) $("trProgress").style.width = Math.min(100, total ? computeElapsed() / total * 100 : 0) + "%";
  }
  function tick() {
    if (!running || paused) return;
    let guard = 0;
    while (guard++ < 80) {
      const r = (stepEnd - Date.now()) / 1000;
      if (r > 0) { remaining = r; updateTimer(); return; }
      stepIndex++;
      if (stepIndex >= steps.length) { finishModule(); return; }
      stepEnd += steps[stepIndex].secs * 1000;
      announceStep();
    }
  }
  function beginModule() {
    steps = MODULE.build(); total = totalFor(steps); stepIndex = 0; remaining = steps[0].secs; stepEnd = Date.now() + remaining * 1000;
    started = true; running = true; paused = false; sessionFinished = false;
    announceStep(); keepAwake(true);
    syncControls();
    if (interval) clearInterval(interval); interval = setInterval(tick, 500);
  }
  function startModule() {
    if ((running || paused) && !confirm("Restart this workout from the beginning?")) return;
    stopTimer(); beginModule();
  }
  function stopTimer() { if (interval) clearInterval(interval); interval = null; running = false; paused = false; keepAwake(false); }
  function togglePause() {
    if (!started) return;
    if (!paused) { tick(); paused = true; running = false; if (interval) clearInterval(interval); interval = null; keepAwake(false); if ($("trPhase")) $("trPhase").textContent = "Paused"; syncControls(); updateTimer(); }
    else { paused = false; running = true; stepEnd = Date.now() + Math.max(0, remaining) * 1000; syncControls(); interval = setInterval(tick, 500); speak("Back to work."); keepAwake(true); }
  }
  function skipStep() {
    if (!started) return;
    stepIndex++;
    if (stepIndex >= steps.length) { finishModule(); return; }
    remaining = steps[stepIndex].secs; stepEnd = Date.now() + remaining * 1000; announceStep();
  }
  function finishModule() {
    if (sessionFinished) return; sessionFinished = true;
    stopTimer();
    speak(MODULE.done); tone(900, .4);
    saveNativeCompletion();
    if ($("trPhase")) $("trPhase").textContent = "Workout complete";
    if ($("trClock")) $("trClock").textContent = "00:00";
    if ($("trStepText")) $("trStepText").textContent = MODULE.done;
    if ($("trStepCount")) $("trStepCount").textContent = "Saved to your progress";
    if ($("trProgress")) $("trProgress").style.width = "100%";
    syncControls();
  }
  /* [U1] the only save path — one native record, original field semantics */
  function saveNativeCompletion() {
    if (!Array.isArray(DB.imported)) DB.imported = [];
    const ts = Date.now();
    DB.imported.push({
      id: "train:" + ts, source: "native", discipline: "train",
      date: dateKey(), timestamp: ts,
      minutes: Math.round(total / 60), durationSec: Math.round(computeElapsed()),
      title: MODULE.name, status: "completed", module: "laceup", name: MODULE.name,
    });
    saveDB();
  }
  function syncControls() {
    const sb = $("trStartBtn"), pb = $("trPauseBtn"), sk = $("trSkipBtn");
    if (!sb) return;
    sb.textContent = started && !sessionFinished ? "Restart" : "Start workout";
    pb.disabled = !started || sessionFinished; sk.disabled = !started || sessionFinished;
    pb.textContent = paused ? "Resume" : "Pause";
  }

  /* ---------- view ---------- */
  window.renderTrain = function () {
    const el = $("view-train"); if (!el) return;
    const s0 = MODULE.build()[0];
    el.innerHTML = `<div style="padding:18px;max-width:560px;margin:0 auto">
      <div class="card" style="padding:16px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:800;font-size:17px">The Session</span><span class="pill">${MODULE.tag}</span></div>
        <div style="margin-top:8px;line-height:1.7">🏋️ <b>Lift</b> — full-body dumbbell circuit · 29 exercises<br>🥊 <b>Box</b> — shadow boxing · 3 rounds, called combos<br>🔥 <b>Core</b> — the finisher · 6 exercises</div>
      </div>
      <div class="card" style="padding:18px;text-align:center">
        <div id="trPhase" style="color:var(--gold,#d4a72c);font-weight:700;letter-spacing:.05em">${started && !sessionFinished ? "In session" : "Ready when you are"}</div>
        <div id="trClock" style="font-size:56px;font-weight:800;font-variant-numeric:tabular-nums">${fmt(remaining || s0.secs)}</div>
        <div id="trStepText" style="min-height:24px">${started ? "" : (s0.sub || s0.label)}</div>
        <div id="trStepCount" class="muted" style="margin-top:2px">${started ? "" : "Hit start when you're ready"}</div>
        <div class="bar" style="margin:14px 0"><i id="trProgress" style="width:0%"></i></div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn" id="trStartBtn">Start workout</button>
          <button class="btn" id="trPauseBtn" disabled>Pause</button>
          <button class="btn" id="trSkipBtn" disabled>Skip ›</button>
        </div>
      </div>
      <div class="card" style="padding:16px;margin-top:14px">
        <div style="font-weight:700;margin-bottom:6px">Cornerman voice</div>
        <label class="muted">Speed <span id="trRateLabel">${(Number(prefs().rate) || .95).toFixed(2)}</span></label>
        <input type="range" id="trRate" min="0.7" max="1.3" step="0.05" value="${Number(prefs().rate) || .95}" style="width:100%">
        <button class="btn sm" id="trVoiceTest" style="margin-top:8px">Test voice</button>
        <div class="muted" style="margin-top:8px;font-size:13px">Clips play through The Forge's shared audio core; anything without a clip uses the phone's voice.</div>
      </div>
    </div>`;
    $("trStartBtn").onclick = startModule;
    $("trPauseBtn").onclick = togglePause;
    $("trSkipBtn").onclick = skipStep;
    $("trRate").addEventListener("input", (e) => { prefs().rate = +e.target.value; $("trRateLabel").textContent = prefs().rate.toFixed(2); savePrefs(); });
    $("trVoiceTest").addEventListener("click", () => speak("Dumbbell circuit complete. Guns loaded. Go rehydrate.")); // [U4 fix] the original test line has no clip in ANY version — it relied on phone TTS, which is inert in the Android WebView; the test now plays a real cornerman clip like the Run/Yoga tests do
    if (started && !sessionFinished) { announceStep(true); syncControls(); }
    else if (sessionFinished) { if ($("trPhase")) $("trPhase").textContent = "Workout complete"; syncControls(); }
    else syncControls();
  };

  window.TrainSession = { active: () => started && !sessionFinished };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && running && !paused) { tick(); keepAwake(true); } });

  /* exposed for the U1 node tests */
  window.ForgeTrain = { buildLaceUp, buildDumbbell, buildBoxing, buildCore, totalFor, CLIPS,
    engine: { start: beginModule, tick, togglePause, skip: skipStep, finish: finishModule,
      state: () => ({ steps: steps.length, stepIndex, remaining, total, running, paused, started, sessionFinished }),
      computeElapsed } };
})();

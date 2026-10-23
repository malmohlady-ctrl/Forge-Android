"use strict";
/* Unified Forge — Yoga module (U3): Namastay Home, ported from the
   standalone app @ 240442c. Routine data, cues and the clip map below are
   the original's verbatim; adaptations are marked [U3]:
     - clips play through ForgeAudio from assets/guide/ (never a fresh
       Audio()); the original's cue-interruption (a new cue stops the
       current clip) is structural in the core's single persistent player;
     - the 432 Hz transition chime is ForgeAudio.chime (the shared core's
       implementation: 432 Hz sine, 900 ms — the standalone's own envelope
       was 0.6 s at lower gain; same frequency, noted in the U3 report);
     - AppMusic ducking is gone (music is U5);
     - completions write ONE native record into DB.imported (discipline
       "yoga", the original's fields); selection + prefs live in
       DB.yogaState / DB.yogaPrefs.

   TIMING + SAVE SPEC (from the original source; the U3 tests encode it):
     - sync() walks stepEnd from the real clock (tick 1 s); elapsed is
       step-derived via calcElapsed(). Pause syncs first (may finish),
       then freezes; resume sets stepEnd = now + remaining and plays the
       resume cue. Segments are per-session copies carrying midFired.
     - MID-HOLD BREATH CUE: in tick(), once (seg.secs - remaining) >=
       seg.secs / 2 and the segment's mid has not fired, speak(seg.mid)
       exactly once for that segment.
     - announceStep chimes, then speaks: rest segments speak their cue;
       other segments speak "name. cue".
     - Skip syncs first (when running), advances; past the end finishes.
       There is NO partial concept in yoga.
     - finishSession is the ONLY save path, guarded by sessionFinished.
       finElapsed = total when segIndex ran past the end, else calcElapsed().
       Record: {key: routineId + "-" + timestamp, routine, title, date,
       timestamp, minutes: round(total/60) [PLANNED], durationSec:
       round(finElapsed) [actual]}. */
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const dateKey = (d) => { d = d || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- routine data (verbatim from the original) ---------- */
const P=(name,sanskrit,secs,cue,mid)=>({type:"pose",name,sanskrit:sanskrit||"",secs,cue,mid:mid||"Inhale… and exhale."});
const B=(name,secs,cue,mid)=>({type:"breath",name,secs,cue,mid:mid||"Inhale… and exhale."});
const T=(cue)=>({type:"rest",name:"Rest",secs:10,cue:cue||"Move gently into the next pose."});
const ROUTINES=[
{id:"back",title:"Back Care Basics",tag:"~10 min",desc:"A slow, gentle back routine — the one you know. Move with your breath, and never force a stretch.",segs:[
 B("Centering Breath",45,"Sit comfortably, hands resting easy. Close your eyes if you like. Breathe in slowly through your nose… and let it all go.","Let your shoulders drop away from your ears."),
 P("Cat-Cow Flow","Marjaryasana – Bitilasana",120,"On all fours, hands under shoulders. Inhale, drop your belly and lift your gaze. Exhale, round your spine like a cat. Let your breath lead the movement.","Keep flowing gently. Inhale open, exhale round."),
 T(),
 P("Child's Pose","Balasana",120,"Knees wide, big toes touching. Fold forward and rest your forehead on the mat. Let your arms reach forward, or rest them alongside you.","Breathe into your back. Let gravity do the work."),
 T(),
 P("Sphinx Pose","Salamba Bhujangasana",90,"Lie on your belly, forearms on the mat, elbows under your shoulders. Press gently into your forearms and lift your chest. Keep your neck long and easy.","Inhale… and exhale. Let your shoulders soften."),
 T(),
 P("Supine Twist — Left","Supta Matsyendrasana",75,"Lie on your back, knees stacked over your hips, arms open in a T. Let your knees fall to the left. Keep both shoulders resting on the mat.","Breathe into the twist. No forcing."),
 T("Switch sides when you're ready."),
 P("Supine Twist — Right","Supta Matsyendrasana",75,"Let your knees fall to the right. Relax your shoulders into the mat.","One more easy breath here."),
 T(),
 B("Closing Breath",45,"Lie still. Notice how your back feels now compared to when you started. Breathe easy.","Well done. Rest here as long as you like.")
]},
{id:"foundations",title:"Foundations",tag:"~8 min",desc:"The easiest session in the app — for low-energy days, or when you're brand new. Everything is done slowly, much of it lying down.",segs:[
 B("Centering Breath",60,"Sit tall and comfortable. Close your eyes. Take a slow breath in… and a slow breath out. Arrive on your mat.","There's nowhere else to be right now."),
 P("Seated Cat-Cow","Marjaryasana – Bitilasana",90,"Stay seated. Inhale, arch gently and open your chest. Exhale, round forward and tuck your chin. Easy and slow.","Let the movement follow your breath."),
 T(),
 P("Child's Pose","Balasana",120,"Knees wide, big toes touching. Fold forward, forehead to the mat. This is a resting pose — settle in and stay a while.","With every exhale, sink a little heavier."),
 T(),
 P("Knees-to-Chest","Apanasana",90,"Lie on your back and hug your knees in toward your chest. Rock gently side to side, massaging your lower back into the mat.","Breathe easy. Let your back release."),
 T(),
 B("Savasana",120,"Lie flat, arms by your sides, palms facing up. Close your eyes. Let your whole body feel heavy and still.","You don't need to do anything at all.")
]},
{id:"reset",title:"Full Reset",tag:"~15 min",desc:"A gentle full-body flow to unwind the whole day — neck, spine, hips, legs, and a long rest at the end.",segs:[
 B("Centering Breath",45,"Stand or sit tall. Close your eyes. Take three slow breaths to arrive.","Feel your feet on the ground beneath you."),
 P("Neck Rolls",null,60,"Drop your chin to your chest. Slowly roll your right ear toward your right shoulder, then back around. Keep it gentle, no forcing.","Now change direction. Nice and slow."),
 T(),
 P("Cat-Cow Flow","Marjaryasana – Bitilasana",60,"On all fours. Inhale, belly drops, gaze lifts. Exhale, spine rounds. Warm up the whole back.","Smooth and unhurried."),
 T(),
 P("Downward Dog","Adho Mukha Svanasana",45,"Tuck your toes and lift your hips high. Pedal your feet, bending one knee then the other. Let your head hang heavy.","Press the mat away. Let your heels reach down."),
 T(),
 P("Low Lunge — Left",null,45,"Step your left foot forward between your hands. Sink your hips low. Hands can rest on the floor or on your front thigh.","Breathe into the front of your right hip."),
 T("Switch sides when you're ready."),
 P("Low Lunge — Right",null,45,"Right foot forward now. Sink in and breathe. Same ease on this side.","Steady. You're doing well."),
 T(),
 P("Warrior II — Left","Virabhadrasana II",45,"From your lunge, rise up tall. Front knee over your ankle, arms reach wide, gaze over your left fingertips. Strong legs, easy shoulders.","Root down through your feet."),
 T("Switch sides when you're ready."),
 P("Warrior II — Right","Virabhadrasana II",45,"Right side now. Knee over ankle, arms wide, gaze over your right fingertips.","Breathe wide into your chest."),
 T(),
 P("Tree — Left","Vrksasana",30,"Stand tall. Rest your left foot against your inner right leg — ankle, calf, or thigh, never on the knee. Hands at your heart, or overhead.","Find one still point to rest your eyes on."),
 T("Switch sides when you're ready."),
 P("Tree — Right","Vrksasana",30,"Right foot up. Wobbling is fine — catching yourself is the practice.","One more steady breath."),
 T(),
 P("Seated Forward Fold","Paschimottanasana",60,"Sit with your legs extended. Hinge forward from your hips, reaching toward your feet. Bend your knees as much as you like.","Let your head hang. No pulling, just folding."),
 T(),
 P("Supine Twist — Left","Supta Matsyendrasana",45,"Lie back, knees over hips, arms in a T. Let your knees fall to the left, shoulders staying down.","Twist a little deeper with your exhale."),
 T("Switch sides when you're ready."),
 P("Supine Twist — Right","Supta Matsyendrasana",45,"Knees fall to the right. Let everything soften into the mat.","Almost done. Breathe easy."),
 T(),
 B("Savasana",180,"Lie flat, arms by your sides, palms up. Close your eyes. This is the most important pose — complete rest.","Let go of the day. Just breathe.")
]}
];
const TIPS=[
 "Never force a stretch. If something feels sharp or pinchy, ease out — a gentle pull is plenty.",
 "Breathe through your nose whenever you can. Slow breath, slow movement.",
 "It's always okay to rest in Child's Pose. The routine will wait for you.",
 "Yoga is not about touching your toes. It's about what you learn on the way down.",
 "A short session you actually do beats a long one you skip. Ten minutes counts.",
 "Keep your jaw soft and your shoulders away from your ears. Tension hides in both.",
 "Finish feeling like you could do a little more. That's the sweet spot."
];

  /* ---------- state (unified store) ---------- */
  function sel() { if (!DB.yogaState) DB.yogaState = { selectedRoutine: "back" }; return DB.yogaState; }
  function prefs() { if (!DB.yogaPrefs) DB.yogaPrefs = { rate: .92 }; return DB.yogaPrefs; }
  function routine() { return ROUTINES.find((r) => r.id === sel().selectedRoutine) || ROUTINES[0]; }
  function totalFor(s) { return s.reduce((a, x) => a + x.secs, 0); }

  /* ---------- voice ---------- */
  function chime() { ForgeAudio.chime(); }
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
const CLIPS={
 "Almost done. Breathe easy.":"voice/reset-23-mid.mp3",
 "And we're back. Settle in.":"voice/fixed-resume.mp3",
 "Breathe easy. Let your back release.":"voice/found-05-mid.mp3",
 "Breathe into the front of your right hip.":"voice/reset-07-mid.mp3",
 "Breathe into the twist. No forcing.":"voice/back-07-mid.mp3",
 "Breathe into your back. Let gravity do the work.":"voice/back-03-mid.mp3",
 "Breathe in… and breathe out. Nice and easy.":"voice/fixed-test.mp3",
 "Breathe wide into your chest.":"voice/reset-13-mid.mp3",
 "Cat-Cow Flow. On all fours, hands under shoulders. Inhale, drop your belly and lift your gaze. Exhale, round your spine like a cat. Let your breath lead the movement.":"voice/back-01-name.mp3",
 "Cat-Cow Flow. On all fours. Inhale, belly drops, gaze lifts. Exhale, spine rounds. Warm up the whole back.":"voice/reset-03-name.mp3",
 "Centering Breath. Sit comfortably, hands resting easy. Close your eyes if you like. Breathe in slowly through your nose… and let it all go.":"voice/back-00-name.mp3",
 "Centering Breath. Sit tall and comfortable. Close your eyes. Take a slow breath in… and a slow breath out. Arrive on your mat.":"voice/found-00-name.mp3",
 "Centering Breath. Stand or sit tall. Close your eyes. Take three slow breaths to arrive.":"voice/reset-00-name.mp3",
 "Child's Pose. Knees wide, big toes touching. Fold forward and rest your forehead on the mat. Let your arms reach forward, or rest them alongside you.":"voice/back-03-name.mp3",
 "Child's Pose. Knees wide, big toes touching. Fold forward, forehead to the mat. This is a resting pose — settle in and stay a while.":"voice/found-03-name.mp3",
 "Closing Breath. Lie still. Notice how your back feels now compared to when you started. Breathe easy.":"voice/back-11-name.mp3",
 "Downward Dog. Tuck your toes and lift your hips high. Pedal your feet, bending one knee then the other. Let your head hang heavy.":"voice/reset-05-name.mp3",
 "Feel your feet on the ground beneath you.":"voice/reset-00-mid.mp3",
 "Find one still point to rest your eyes on.":"voice/reset-15-mid.mp3",
 "Inhale… and exhale. Let your shoulders soften.":"voice/back-05-mid.mp3",
 "Keep flowing gently. Inhale open, exhale round.":"voice/back-01-mid.mp3",
 "Knees-to-Chest. Lie on your back and hug your knees in toward your chest. Rock gently side to side, massaging your lower back into the mat.":"voice/found-05-name.mp3",
 "Let go of the day. Just breathe.":"voice/reset-25-mid.mp3",
 "Let the movement follow your breath.":"voice/found-01-mid.mp3",
 "Let your head hang. No pulling, just folding.":"voice/reset-19-mid.mp3",
 "Let your shoulders drop away from your ears.":"voice/back-00-mid.mp3",
 "Low Lunge — Left. Step your left foot forward between your hands. Sink your hips low. Hands can rest on the floor or on your front thigh.":"voice/reset-07-name.mp3",
 "Low Lunge — Right. Right foot forward now. Sink in and breathe. Same ease on this side.":"voice/reset-09-name.mp3",
 "Move gently into the next pose.":"voice/rest-move-gently.mp3",
 "Neck Rolls. Drop your chin to your chest. Slowly roll your right ear toward your right shoulder, then back around. Keep it gentle, no forcing.":"voice/reset-01-name.mp3",
 "Now change direction. Nice and slow.":"voice/reset-01-mid.mp3",
 "One more easy breath here.":"voice/back-09-mid.mp3",
 "One more steady breath.":"voice/reset-17-mid.mp3",
 "Press the mat away. Let your heels reach down.":"voice/reset-05-mid.mp3",
 "Root down through your feet.":"voice/reset-11-mid.mp3",
 "Savasana. Lie flat, arms by your sides, palms facing up. Close your eyes. Let your whole body feel heavy and still.":"voice/found-07-name.mp3",
 "Savasana. Lie flat, arms by your sides, palms up. Close your eyes. This is the most important pose — complete rest.":"voice/reset-25-name.mp3",
 "Seated Cat-Cow. Stay seated. Inhale, arch gently and open your chest. Exhale, round forward and tuck your chin. Easy and slow.":"voice/found-01-name.mp3",
 "Seated Forward Fold. Sit with your legs extended. Hinge forward from your hips, reaching toward your feet. Bend your knees as much as you like.":"voice/reset-19-name.mp3",
 "Session complete. Well done. Take one more deep breath.":"voice/fixed-complete.mp3",
 "Smooth and unhurried.":"voice/reset-03-mid.mp3",
 "Sphinx Pose. Lie on your belly, forearms on the mat, elbows under your shoulders. Press gently into your forearms and lift your chest. Keep your neck long and easy.":"voice/back-05-name.mp3",
 "Steady. You're doing well.":"voice/reset-09-mid.mp3",
 "Supine Twist — Left. Lie back, knees over hips, arms in a T. Let your knees fall to the left, shoulders staying down.":"voice/reset-21-name.mp3",
 "Supine Twist — Left. Lie on your back, knees stacked over your hips, arms open in a T. Let your knees fall to the left. Keep both shoulders resting on the mat.":"voice/back-07-name.mp3",
 "Supine Twist — Right. Knees fall to the right. Let everything soften into the mat.":"voice/reset-23-name.mp3",
 "Supine Twist — Right. Let your knees fall to the right. Relax your shoulders into the mat.":"voice/back-09-name.mp3",
 "Switch sides when you're ready.":"voice/rest-switch-sides.mp3",
 "There's nowhere else to be right now.":"voice/found-00-mid.mp3",
 "Tree — Left. Stand tall. Rest your left foot against your inner right leg — ankle, calf, or thigh, never on the knee. Hands at your heart, or overhead.":"voice/reset-15-name.mp3",
 "Tree — Right. Right foot up. Wobbling is fine — catching yourself is the practice.":"voice/reset-17-name.mp3",
 "Twist a little deeper with your exhale.":"voice/reset-21-mid.mp3",
 "Warrior II — Left. From your lunge, rise up tall. Front knee over your ankle, arms reach wide, gaze over your left fingertips. Strong legs, easy shoulders.":"voice/reset-11-name.mp3",
 "Warrior II — Right. Right side now. Knee over ankle, arms wide, gaze over your right fingertips.":"voice/reset-13-name.mp3",
 "Well done. Rest here as long as you like.":"voice/back-11-mid.mp3",
 "With every exhale, sink a little heavier.":"voice/found-03-mid.mp3",
 "You don't need to do anything at all.":"voice/found-07-mid.mp3"
};

  async function playClip(f, msg) {
    const r = await ForgeAudio.playClip("assets/guide/" + f.split("/").pop(), { rate: Number(prefs().rate) || .92, timeoutMs: 20000 });
    if (!r.ok && msg) fallbackSpeak(msg);
  }
  function speak(msg) { const f = CLIPS[msg]; if (!f) { fallbackSpeak(msg); return; } playClip(f, msg); }

  /* ---------- engine (mirrors the original) ---------- */
  let segments = [], segIndex = 0, remaining = 0, total = 0, elapsed = 0, interval = null, running = false, paused = false, started = false, stepEnd = 0, wakeLock = null;
  let sessionFinished = false;
  function calcElapsed() { let e = 0; for (let i = 0; i < segIndex; i++) e += segments[i].secs; return e + segments[segIndex].secs - remaining; }
  function sync() {
    const now = Date.now(); let changed = 0;
    while (now >= stepEnd) {
      segIndex++;
      if (segIndex >= segments.length) { finishSession(); return -1; }
      stepEnd += segments[segIndex].secs * 1000; changed = 1;
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
    const s = segments[segIndex]; if (!s) return;
    s.midFired = false;
    if (!silent) { chime(); speak(s.type === "rest" ? s.cue : (s.name + ". " + s.cue)); }
    if ($("ygPhase")) $("ygPhase").textContent = "Step " + (segIndex + 1) + " of " + segments.length;
    if ($("ygStepText")) $("ygStepText").textContent = s.name + (s.sanskrit ? " · " + s.sanskrit : "");
    if ($("ygBreath")) $("ygBreath").textContent = s.cue || "";
    if ($("ygClock")) $("ygClock").textContent = fmt(remaining);
    if ($("ygStepCount")) $("ygStepCount").textContent = "Step " + (segIndex + 1) + " of " + segments.length + " · " + routine().title;
  }
  function updateTimer() {
    if ($("ygClock")) $("ygClock").textContent = fmt(remaining);
    if ($("ygProgress")) $("ygProgress").style.width = Math.min(100, total ? elapsed / total * 100 : 0) + "%";
  }
  function tick() {
    if (!running || paused) return;
    const r = sync();
    if (r < 0) return;
    if (r > 0) announceStep();
    const s = segments[segIndex];
    if (s && !s.midFired && (s.secs - remaining) >= s.secs / 2) { s.midFired = true; if (s.mid) speak(s.mid); }
    updateTimer();
  }
  function beginSession() {
    const r = routine();
    segments = r.segs.map((s) => ({ ...s, midFired: false })); total = totalFor(segments);
    segIndex = 0; remaining = segments[0].secs; stepEnd = Date.now() + remaining * 1000; elapsed = 0;
    started = true; running = true; paused = false; sessionFinished = false;
    if ($("ygProgress")) $("ygProgress").style.width = "0%";
    announceStep(); keepAwake(true); syncYogaControls();
    interval = setInterval(tick, 1000);
  }
  function resumeSession() {
    if (!paused) return;
    paused = false; running = true; stepEnd = Date.now() + remaining * 1000; syncYogaControls(); interval = setInterval(tick, 1000); speak("And we're back. Settle in."); keepAwake(true);
  }
  function startSession() {
    if ((running || paused) && !confirm("Restart this session from the beginning?")) return;
    stopTimer(); beginSession();
  }
  function stopTimer() { if (interval) clearInterval(interval); interval = null; running = false; paused = false; keepAwake(false); }
  function togglePause() {
    if (!started) return;
    if (!paused) {
      if (sync() < 0) return;
      paused = true; running = false; if (interval) clearInterval(interval); interval = null; keepAwake(false);
      if ($("ygPhase")) $("ygPhase").textContent = "Paused";
      if ($("ygBreath")) $("ygBreath").textContent = "Take a breath. Resume whenever you're ready.";
      syncYogaControls(); updateTimer();
    } else resumeSession();
  }
  function skipStep() {
    if (!started) return;
    if (running && sync() < 0) return;
    segIndex++;
    if (segIndex >= segments.length) { finishSession(); return; }
    remaining = segments[segIndex].secs; stepEnd = Date.now() + remaining * 1000; elapsed = calcElapsed(); announceStep(); updateTimer();
  }
  function finishSession() {
    if (sessionFinished) return; sessionFinished = true;
    stopTimer(); chime(); speak("Session complete. Well done. Take one more deep breath.");
    const r = routine();
    const finElapsed = segIndex >= segments.length ? total : calcElapsed();
    saveNativeYoga(r, finElapsed);
    if ($("ygPhase")) $("ygPhase").textContent = "Session complete";
    if ($("ygClock")) $("ygClock").textContent = "00:00";
    if ($("ygStepText")) $("ygStepText").textContent = "Well done — session saved";
    if ($("ygBreath")) $("ygBreath").textContent = "Come back tomorrow. The mat will be here.";
    if ($("ygStepCount")) $("ygStepCount").textContent = "Saved to your progress";
    if ($("ygProgress")) $("ygProgress").style.width = "100%";
    syncYogaControls();
  }
  function saveNativeYoga(r, finElapsed) {
    if (!Array.isArray(DB.imported)) DB.imported = [];
    const ts = Date.now();
    DB.imported.push({ id: "yoga:" + ts, source: "native", discipline: "yoga",
      key: r.id + "-" + ts, routine: r.id, title: r.title, date: dateKey(), timestamp: ts,
      minutes: Math.round(total / 60), durationSec: Math.round(finElapsed), status: "completed" });
    saveDB();
  }
  function syncYogaControls() {
    const sb = $("ygStartBtn"), pb = $("ygPauseBtn"), sk = $("ygSkipBtn");
    if (!sb) return;
    sb.textContent = sessionFinished ? "Practice again" : (started ? "Restart session" : "Begin session");
    pb.disabled = !started || sessionFinished; sk.disabled = !started || sessionFinished;
    pb.textContent = paused ? "Resume" : "Pause";
  }
  function loadRoutine() {
    const r = routine();
    segments = r.segs.map((s) => ({ ...s, midFired: false })); total = totalFor(segments);
    segIndex = 0; remaining = segments[0].secs; elapsed = 0; started = false; paused = false;
    if ($("ygPhase")) $("ygPhase").textContent = r.title.toUpperCase();
    if ($("ygClock")) $("ygClock").textContent = fmt(segments[0].secs);
    if ($("ygStepText")) $("ygStepText").textContent = segments[0].name;
    if ($("ygBreath")) $("ygBreath").textContent = segments[0].cue || "";
    if ($("ygStepCount")) $("ygStepCount").textContent = segments.length + " steps · ~" + Math.round(total / 60) + " minutes";
    if ($("ygProgress")) $("ygProgress").style.width = "0%";
    if ($("ygTip")) $("ygTip").textContent = TIPS[new Date().getDate() % TIPS.length];
    syncYogaControls(); paintRoutines();
  }
  function selectRoutine(id, andStart) {
    if (running && !confirm("Change routine and stop the current session?")) return;
    stopTimer(); sel().selectedRoutine = id; saveDB();
    loadRoutine();
    if (andStart) beginSession();
  }
  function paintRoutines() {
    const el = $("ygRoutines"); if (!el) return;
    el.innerHTML = ROUTINES.map((r) => {
      const mins = Math.round(totalFor(r.segs) / 60);
      const poses = r.segs.filter((s) => s.type !== "rest").map((s) => {
        const mm = Math.floor(s.secs / 60), ss = s.secs % 60;
        const dur = mm ? mm + " min" + (ss ? " " + ss + "s" : "") : ss + " sec";
        return `<div style="padding:8px 0;border-bottom:1px solid var(--line,#2c3a5e)"><div style="display:flex;justify-content:space-between"><span>${esc(s.name)}</span><span class="pill">${dur}</span></div>${s.sanskrit ? `<div class="muted" style="font-style:italic">${esc(s.sanskrit)}</div>` : ""}<div class="muted" style="font-size:13px">${esc(s.cue)}</div></div>`;
      }).join("");
      return `<div class="card" style="padding:16px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center"><h3 class="yg-serif" style="margin:0">${esc(r.title)}</h3><span class="pill">~${mins} min</span></div><p class="muted">${esc(r.desc)}</p>${poses}<button class="btn block ygStartRoutine" data-r="${r.id}" style="margin-top:12px">Start this routine</button></div>`;
    }).join("");
    el.querySelectorAll(".ygStartRoutine").forEach((b) => b.addEventListener("click", () => { selectRoutine(b.dataset.r, true); window.scrollTo(0, 0); }));
  }
  window.renderYoga = function () {
    const el = $("view-yoga"); if (!el) return;
    el.innerHTML = `<div style="padding:18px;max-width:560px;margin:0 auto">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${ROUTINES.map((r) => `<button class="btn ygPick" data-r="${r.id}" style="${r.id === sel().selectedRoutine ? "background:var(--gold,#d4a72c);color:#141b2e" : ""}">${esc(r.title)} · ~${Math.round(totalFor(r.segs) / 60)}m</button>`).join("")}</div>
      <div class="card" style="padding:18px;text-align:center">
        <div id="ygPhase" class="yg-serif" style="color:var(--gold,#d4a72c);font-weight:700;letter-spacing:.05em">Namastay</div>
        <div id="ygClock" style="font-size:56px;font-weight:800;font-variant-numeric:tabular-nums">00:45</div>
        <div id="ygStepText" class="yg-serif" style="min-height:24px;font-size:18px"></div>
        <div id="ygBreath" class="muted" style="min-height:40px;margin-top:4px"></div>
        <div id="ygStepCount" class="muted" style="margin-top:2px"></div>
        <div class="bar" style="margin:14px 0"><i id="ygProgress" style="width:0%"></i></div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn" id="ygStartBtn">Begin session</button>
          <button class="btn" id="ygPauseBtn" disabled>Pause</button>
          <button class="btn" id="ygSkipBtn" disabled>Skip ›</button>
        </div>
        <div id="ygTip" class="muted" style="margin-top:12px;font-style:italic"></div>
      </div>
      <div class="card" style="padding:16px;margin-top:14px">
        <div style="font-weight:700;margin-bottom:6px">Guide voice</div>
        <label class="muted">Speed <span id="ygRateLabel">${(Number(prefs().rate) || .92).toFixed(2)}</span></label>
        <input type="range" id="ygRate" min="0.7" max="1.3" step="0.05" value="${Number(prefs().rate) || .92}" style="width:100%">
        <button class="btn sm" id="ygVoiceTest" style="margin-top:8px">Test voice</button>
      </div>
      <div id="ygMusic"></div>
      <h3 class="yg-serif" style="margin:18px 0 10px">Routines</h3>
      <div id="ygRoutines"></div>
    </div>`;
    el.querySelectorAll(".ygPick").forEach((b) => b.addEventListener("click", () => selectRoutine(b.dataset.r, false)));
    $("ygStartBtn").onclick = startSession;
    $("ygPauseBtn").onclick = togglePause;
    $("ygSkipBtn").onclick = skipStep;
    $("ygRate").addEventListener("input", (e) => { prefs().rate = +e.target.value; $("ygRateLabel").textContent = prefs().rate.toFixed(2); saveDB(); });
    $("ygVoiceTest").addEventListener("click", () => speak("Breathe in… and breathe out. Nice and easy."));
    if (window.ForgeMusic) ForgeMusic.mount("yoga", document.getElementById("ygMusic"));
    if (started && !sessionFinished) { announceStep(true); syncYogaControls(); }
    else if (sessionFinished) { if ($("ygPhase")) $("ygPhase").textContent = "Session complete"; syncYogaControls(); paintRoutines(); }
    else loadRoutine();
  };

  window.YogaSession = { active: () => started && !sessionFinished };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && running && !paused) { tick(); if (running) keepAwake(true); } });

  /* exposed for the U3 node tests */
  window.ForgeYoga = { ROUTINES, TIPS, CLIPS, totalFor,
    engine: { start: beginSession, tick, togglePause, skip: skipStep, finish: finishSession, load: loadRoutine,
      select: selectRoutine, speak,
      state: () => ({ segs: segments.length, segIndex, remaining, total, elapsed, running, paused, started, sessionFinished }) } };
})();

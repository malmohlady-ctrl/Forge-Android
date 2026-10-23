"use strict";
/* U3 acceptance tests (Node). Timing/save semantics encoded here are the
   spec read from the original Namastay source (see yoga.js header). The
   clip manifest is the pinned app's own sw.js cache list @ 240442c. */
const fs = require("fs"), path = require("path"), assert = require("assert"), { execFileSync } = require("child_process");
const U = path.join(__dirname, "..", "unified");
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log("  ✓ " + name); };

let now = 1_760_000_000_000;
Date.now = () => now;
const els = {};
const mkEl = () => ({ textContent: "", innerHTML: "", style: {}, disabled: false, value: "0", dataset: {},
  addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], clientWidth: 320 });
global.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
global.DB = { imported: [], sessions: [], settings: { weekStart: 1 } };
global.saveDB = () => {};
global.confirm = () => true;
const clipCalls = [], chimeCalls = { n: 0 }, ttsCalls = [];
global.ForgeAudio = { playClip: async (url) => { clipCalls.push(url); return { ok: true }; },
  tone: () => {}, chime: () => { chimeCalls.n++; }, unlock: () => {} };
global.speechSynthesis = { cancel: () => {}, getVoices: () => [], speak: (u) => ttsCalls.push(u.text) };
global.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
global.setInterval = () => 1; global.clearInterval = () => {};
global.document = { getElementById: (id) => (els[id] = els[id] || mkEl()),
  addEventListener: () => {}, visibilityState: "visible", querySelector: () => null, querySelectorAll: () => [] };
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } };

require(path.join(U, "yoga.js"));
const FY = global.ForgeYoga;
assert.ok(FY, "ForgeYoga exposed");
const E = FY.engine;
const count = (suffix) => clipCalls.filter((u) => u.endsWith(suffix)).length;

ok("routines recomputed from the ported source data: back 12 segs/620 s, foundations 8/510 s, reset 26/900 s", () => {
  const want = { back: [12, 620], foundations: [8, 510], reset: [26, 900] };
  assert.strictEqual(FY.ROUTINES.length, 3);
  for (const r of FY.ROUTINES) {
    assert.strictEqual(r.segs.length, want[r.id][0], r.id + " segs");
    assert.strictEqual(FY.totalFor(r.segs), want[r.id][1], r.id + " total");
  }
});
ok("start: name cue + chime fire; at 20 s into the 45 s opener, elapsed 20 / remaining 25, mid cue NOT yet fired", () => {
  E.start();
  assert.strictEqual(count("back-00-name.mp3"), 1);
  assert.strictEqual(chimeCalls.n, 1);
  now += 20000; E.tick();
  const st = E.state();
  assert.strictEqual(st.segIndex, 0); assert.strictEqual(Math.round(st.remaining), 25); assert.strictEqual(Math.round(st.elapsed), 20);
  assert.strictEqual(count("back-00-mid.mp3"), 0);
});
ok("mid-hold breath cue fires exactly ONCE when the segment passes its halfway point", () => {
  now += 5000; E.tick();                       // 25 s in, past the 22.5 s halfway
  assert.strictEqual(count("back-00-mid.mp3"), 1);
  E.tick(); E.tick();
  assert.strictEqual(count("back-00-mid.mp3"), 1);
});
ok("segment transition: chime + next name cue; state advances", () => {
  now += 20000; E.tick();                      // opener ends at 45 s
  const st = E.state();
  assert.strictEqual(st.segIndex, 1);
  assert.strictEqual(count("back-01-name.mp3"), 1);
  assert.strictEqual(chimeCalls.n, 2);
});
ok("60-second lock simulation: no ticks while locked; on return, sync lands exactly right (seg 1, 60 s elapsed in segment)", () => {
  now += 60000;                                // locked: timers throttled, no tick calls
  E.tick();                                    // the visibilitychange return tick
  const st = E.state();
  assert.strictEqual(st.segIndex, 1);
  assert.strictEqual(Math.round(st.remaining), 60);
  assert.strictEqual(Math.round(st.elapsed), 105);
});
ok("pause excludes wall time (600 s paused changes nothing) and resume plays the resume cue", () => {
  E.togglePause();
  now += 600000; E.tick();
  assert.strictEqual(Math.round(E.state().elapsed), 105);
  E.togglePause();
  assert.strictEqual(count("fixed-resume.mp3"), 1);
  assert.strictEqual(Math.round(E.state().remaining), 60);
});
ok("skip-through finish: exactly ONE record — minutes 10 (planned), durationSec 620, no partial status anywhere", () => {
  let guard = 0;
  while (!E.state().sessionFinished && guard++ < 100) E.skip();
  assert.strictEqual(DB.imported.length, 1);
  const r = DB.imported[0];
  assert.strictEqual(r.discipline, "yoga"); assert.strictEqual(r.routine, "back");
  assert.strictEqual(r.minutes, 10); assert.strictEqual(r.durationSec, 620);
  assert.ok(!JSON.stringify(r).includes("partial"));
  E.finish(); E.finish();
  assert.strictEqual(DB.imported.length, 1);
});
ok("direct early finish: durationSec is the ACTUAL elapsed (100 s) while minutes stays PLANNED (9 for foundations)", () => {
  E.select("foundations", false);
  E.start();
  now += 100000; E.tick();
  E.finish();
  const r = DB.imported.find((x) => x.routine === "foundations");
  assert.ok(r, "record saved");
  assert.strictEqual(r.durationSec, 100); assert.strictEqual(r.minutes, 9);
  assert.strictEqual(count("fixed-complete.mp3") >= 1, true);
});
ok("interruption without finish writes NO record", () => {
  const before = DB.imported.length;
  E.select("reset", false);
  E.start();
  now += 60000; E.tick();
  assert.strictEqual(DB.imported.length, before);
});
ok("TTS fallback: an unscripted line goes to speechSynthesis; a scripted line goes to its clip only", () => {
  ttsCalls.length = 0; const clipsBefore = clipCalls.length;
  E.speak("Some unscripted line.");
  assert.ok(ttsCalls.includes("Some unscripted line."));
  E.speak("Session complete. Well done. Take one more deep breath.");
  assert.ok(clipCalls.length > clipsBefore && ttsCalls.length === 1);
});
ok("cue routing is through the shared core only — no fresh Audio() anywhere in yoga.js", () => {
  const src = fs.readFileSync(path.join(U, "yoga.js"), "utf8");
  assert.ok(!src.includes("new Audio("));
  assert.ok(src.includes("ForgeAudio.playClip") && src.includes("ForgeAudio.chime"));
});

const MANIFEST = ["back-00-mid.mp3", "back-00-name.mp3", "back-01-mid.mp3", "back-01-name.mp3", "back-03-mid.mp3", "back-03-name.mp3", "back-05-mid.mp3", "back-05-name.mp3", "back-07-mid.mp3", "back-07-name.mp3", "back-09-mid.mp3", "back-09-name.mp3", "back-11-mid.mp3", "back-11-name.mp3", "fixed-complete.mp3", "fixed-resume.mp3", "fixed-test.mp3", "found-00-mid.mp3", "found-00-name.mp3", "found-01-mid.mp3", "found-01-name.mp3", "found-03-mid.mp3", "found-03-name.mp3", "found-05-mid.mp3", "found-05-name.mp3", "found-07-mid.mp3", "found-07-name.mp3", "reset-00-mid.mp3", "reset-00-name.mp3", "reset-01-mid.mp3", "reset-01-name.mp3", "reset-03-mid.mp3", "reset-03-name.mp3", "reset-05-mid.mp3", "reset-05-name.mp3", "reset-07-mid.mp3", "reset-07-name.mp3", "reset-09-mid.mp3", "reset-09-name.mp3", "reset-11-mid.mp3", "reset-11-name.mp3", "reset-13-mid.mp3", "reset-13-name.mp3", "reset-15-mid.mp3", "reset-15-name.mp3", "reset-17-mid.mp3", "reset-17-name.mp3", "reset-19-mid.mp3", "reset-19-name.mp3", "reset-21-mid.mp3", "reset-21-name.mp3", "reset-23-mid.mp3", "reset-23-name.mp3", "reset-25-mid.mp3", "reset-25-name.mp3", "rest-move-gently.mp3", "rest-switch-sides.mp3"];
ok("all 57 guide clips: manifest (pinned sw.js) == CLIPS map == files on disk; headers valid; decode where tooling permits", () => {
  const dir = path.join(U, "assets", "guide");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mp3")).sort();
  assert.deepStrictEqual(files, [...MANIFEST].sort());
  const clipFiles = Object.values(FY.CLIPS).map((f) => f.split("/").pop()).sort();
  assert.deepStrictEqual(clipFiles, [...MANIFEST].sort());
  let have = true;
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch (e) { have = false; }
  if (!have) console.log("    NOTE: ffmpeg unavailable here — headers asserted; decode evidence from the sandbox run");
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    assert.ok(buf.length > 1000, f + " non-trivial size");
    assert.ok((buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0), f + " header");
    if (have) execFileSync("ffmpeg", ["-v", "error", "-i", path.join(dir, f), "-f", "null", "-"], { stdio: "pipe" });
  }
});
ok("U3's Georgia rule is scoped to the Yoga view (the only 2 other Georgia uses are pre-existing Forge chassis styles)", () => {
  const html = fs.readFileSync(path.join(U, "index.html"), "utf8");
  assert.ok(html.includes('#view-yoga .yg-serif{font-family:Georgia'));
  // pre-existing chassis: --serif variable + .wcnum numerals (FIT-HQ's own design, untouched by U3)
  assert.strictEqual((html.match(/Georgia/g) || []).length, 3);
  assert.ok(!/font-family:Georgia/.test(html.replace('#view-yoga .yg-serif{font-family:Georgia,"Times New Roman",serif}', "").replace('--serif:Georgia,"Times New Roman",serif;', "").replace('.wcnum{font-family:Georgia,serif;', "")), "no unscoped Georgia font-family rule was added");
  assert.ok(html.includes('src="yoga.js"'));
});
ok("mixed-store regression: native Train + Run records and the yoga record all count together", () => {
  const today = new Date(); const dk = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  DB.imported.push({ id: "train:1", source: "native", discipline: "train", date: dk, timestamp: Date.now(), minutes: 46, durationSec: 2785, title: "Lace Up", status: "completed" });
  DB.imported.push({ id: "run:1", source: "native", discipline: "run", key: "1-1", week: 0, run: 0, date: dk, timestamp: Date.now(), minutes: 30, durationSec: 1800, title: "Week 1 · Run 1", status: "completed" });
  const appSrc = fs.readFileSync(path.join(U, "app.js"), "utf8");
  const grabConst = (name) => { const i = appSrc.indexOf("const " + name + " ="); let dep = 0, k = i; while (true) { const ch = appSrc[k]; if (ch === "{" || ch === "(" || ch === "[") dep++; if (ch === "}" || ch === ")" || ch === "]") dep--; if (ch === ";" && dep === 0) break; k++; } return appSrc.slice(i, k + 1); };
  const wI = appSrc.indexOf("function weekDates("); let dd = 0, j = appSrc.indexOf("{", wI);
  while (true) { if (appSrc[j] === "{") dd++; if (appSrc[j] === "}") { dd--; if (!dd) break; } j++; }
  require("vm").runInThisContext("globalThis.S = () => DB.settings;\n" + ["parseKey", "addDays", "todayKey", "dateKey", "pad2"].map(grabConst).join("\n") + "\n" + appSrc.slice(wI, j + 1));
  require("vm").runInThisContext(fs.readFileSync(path.join(U, "adapters.js"), "utf8"), { filename: "adapters.js" });
  const hist = global.unifiedHistory();
  for (const srcName of ["corner", "couch", "yoga"]) assert.ok(hist.some((h) => h.source === srcName), srcName + " in history");
  assert.ok(global.yogaData().total >= 2, "yogaData counts native yoga records");
  assert.ok(global.weekActivity().count >= 3, "week counts all three disciplines");
});

console.log("U3 tests: " + pass + " passed");

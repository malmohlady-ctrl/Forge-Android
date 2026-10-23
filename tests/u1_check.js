"use strict";
/* U1 acceptance tests (Node). Engine semantics encoded here are the spec
   read from the original Lace Up source (see train.js header). */
const fs = require("fs"), path = require("path"), assert = require("assert"), { execFileSync } = require("child_process");
const U = path.join(__dirname, "..", "unified");
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log("  ✓ " + name); };
const okAsync = async (name, fn) => { await fn(); pass++; console.log("  ✓ " + name); };

/* ---------- environment stubs ---------- */
let now = 1_760_000_000_000;
Date.now = () => now;
const els = {};
global.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
global.DB = { imported: [] };
global.saveDB = () => {};
global.confirm = () => true;
global.ForgeAudio = { playClip: async () => ({ ok: true }), tone: () => {}, unlock: () => {} };
global.setInterval = () => 1; global.clearInterval = () => {};
global.document = {
  getElementById: (id) => (els[id] = els[id] || { textContent: "", style: {}, disabled: false, addEventListener: () => {} }),
  addEventListener: () => {}, visibilityState: "visible", querySelector: () => null, querySelectorAll: () => [],
};
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } };

require(path.join(U, "train.js"));
const FT = global.ForgeTrain;
assert.ok(FT, "ForgeTrain exposed");

/* ---------- Safeguard 5: recompute steps/duration from the builder ---------- */
const steps = FT.buildLaceUp();
const total = FT.totalFor(steps);
console.log("  builder recomputation: " + steps.length + " steps, " + total + "s = " + (total / 60).toFixed(2) + " min");
ok("session = 105 steps / 2785 s (~46.4 min), recomputed from the source builder", () => {
  assert.strictEqual(steps.length, 105);
  assert.strictEqual(total, 2785);
});
ok("segments: dumbbell 59 steps/1750 s, transition 1/20 s, boxing 32/645 s, core 13/370 s", () => {
  const d = FT.buildDumbbell(), b = FT.buildBoxing({ short: true }), c = FT.buildCore(6);
  assert.strictEqual(d.length, 59); assert.strictEqual(FT.totalFor(d), 1750);
  assert.strictEqual(b.length, 32); assert.strictEqual(FT.totalFor(b), 645);
  assert.strictEqual(c.length, 13); assert.strictEqual(FT.totalFor(c), 370);
  assert.strictEqual(steps.filter((s) => s.sub === "Round begins").length, 3);
  assert.strictEqual(steps[59].label, "Shadow Boxing"); assert.strictEqual(steps[59].clip, null);
});

/* ---------- Safeguard 3: clip integrity + decode ---------- */
function mp3HeaderOk(buf) {
  return buf.length > 100 && ((buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0));
}
const referenced = new Set();
for (const s of [...FT.buildDumbbell(), ...FT.buildBoxing({ short: true }), ...FT.buildBoxing(), ...FT.buildCore(), ...FT.buildCore(6)])
  if (s.clip) referenced.add(s.clip);
Object.values(FT.CLIPS).forEach((f) => referenced.add(f));
const coachDir = path.join(U, "assets", "coach");
const files = fs.readdirSync(coachDir).filter((f) => f.endsWith(".mp3"));
ok("all 67 coach clips present; every cue-referenced clip exists and has a valid MP3 header", () => {
  assert.strictEqual(files.length, 67);
  for (const rel of referenced) {
    const p = path.join(U, "assets", rel);
    assert.ok(fs.existsSync(p), "missing clip " + rel);
    assert.ok(mp3HeaderOk(fs.readFileSync(p)), "bad MP3 header " + rel);
  }
  for (const f of files) assert.ok(mp3HeaderOk(fs.readFileSync(path.join(coachDir, f))), "bad MP3 header " + f);
  const unref = files.filter((f) => ![...referenced].some((r) => r.endsWith("/" + f)));
  console.log("    referenced clips: " + referenced.size + "; unreferenced files (as in the original): " + (unref.join(", ") || "none"));
});
ok("full decode pass with ffprobe/ffmpeg (skipped with a note if tooling absent)", () => {
  let have = true;
  try { execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); } catch (e) { have = false; }
  if (!have) { console.log("    NOTE: ffprobe not available in this environment — decode assurance deferred to the device pass"); return; }
  for (const f of files) {
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(coachDir, f)], { stdio: "pipe" });
    execFileSync("ffmpeg", ["-v", "error", "-i", path.join(coachDir, f), "-f", "null", "-"], { stdio: "pipe" });
  }
  console.log("    decoded all 67 clips with ffmpeg — no errors");
});

/* ---------- Safeguard 2: engine semantics on a fake clock ---------- */
const E = FT.engine;
ok("start: 105 steps loaded, running, elapsed 0", () => {
  E.start();
  const st = E.state();
  assert.strictEqual(st.steps, 105); assert.strictEqual(st.running, true); assert.strictEqual(E.computeElapsed(), 0);
});
ok("tick: after 30 s the engine is in step 2 with elapsed exactly 30 (step-derived)", () => {
  now += 30000; E.tick();
  const st = E.state();
  assert.strictEqual(st.stepIndex, 1); assert.strictEqual(Math.round(st.remaining), 25);
  assert.strictEqual(Math.round(E.computeElapsed()), 30);
});
ok("pause: 600 s of wall time while paused changes nothing; resume continues the step", () => {
  E.togglePause();
  assert.strictEqual(E.state().paused, true);
  now += 600000; E.tick();
  assert.strictEqual(Math.round(E.computeElapsed()), 30);
  E.togglePause();
  assert.strictEqual(E.state().paused, false);
  assert.strictEqual(Math.round(E.state().remaining), 25);
});
ok("skip: advances a step and discards the leftover (elapsed = completed steps only)", () => {
  E.skip();
  const st = E.state();
  assert.strictEqual(st.stepIndex, 2); assert.strictEqual(Math.round(st.remaining), 15);
  assert.strictEqual(Math.round(E.computeElapsed()), 55);
});
ok("finish via skips saves exactly ONE native record: minutes 46 (planned), durationSec 2785 (actual)", () => {
  let guard = 0;
  while (!E.state().sessionFinished && guard++ < 300) E.skip();
  assert.strictEqual(E.state().sessionFinished, true);
  assert.strictEqual(DB.imported.length, 1);
  const r = DB.imported[0];
  assert.strictEqual(r.discipline, "train"); assert.strictEqual(r.source, "native");
  assert.strictEqual(r.minutes, 46); assert.strictEqual(r.durationSec, 2785);
  assert.strictEqual(r.status, "completed");
});
ok("duplicate-save prevention: finish again + restart guard — record count stays 1 until a new session completes", () => {
  E.finish(); E.finish();
  assert.strictEqual(DB.imported.length, 1);
  E.start();
  let guard = 0;
  while (!E.state().sessionFinished && guard++ < 300) E.skip();
  assert.strictEqual(DB.imported.length, 2);
});

/* ---------- native counting through the adapters ---------- */
ok("adapters: the native Train record appears in unifiedHistory as Lace Up and counts in weekActivity", () => {
  DB.sessions = []; DB.settings = { weekStart: 1 };
  /* app.js helpers adapters relies on at call time — extracted verbatim */
  const appSrc = fs.readFileSync(path.join(U, "app.js"), "utf8");
  const grabConst = (name) => { const i = appSrc.indexOf("const " + name + " ="); let dep = 0, k = i; while (true) { const ch = appSrc[k]; if (ch === "{" || ch === "(" || ch === "[") dep++; if (ch === "}" || ch === ")" || ch === "]") dep--; if (ch === ";" && dep === 0) break; k++; } return appSrc.slice(i, k + 1); };
  const wI = appSrc.indexOf("function weekDates("); let d = 0, j = appSrc.indexOf("{", wI);
  while (true) { if (appSrc[j] === "{") d++; if (appSrc[j] === "}") { d--; if (!d) break; } j++; }
  const helperSrc = ["parseKey", "addDays", "todayKey", "dateKey", "pad2"].map(grabConst).join("\n") + "\n" + appSrc.slice(wI, j + 1);
  require("vm").runInThisContext("globalThis.S = () => DB.settings;\n" + helperSrc);
  require("vm").runInThisContext(fs.readFileSync(path.join(U, "adapters.js"), "utf8"), { filename: "adapters.js" });
  const hist = global.unifiedHistory ? global.unifiedHistory() : null;
  assert.ok(hist, "unifiedHistory available");
  const mine = hist.filter((h) => h.source === "corner" && h.durationSec === 2785);
  assert.ok(mine.length >= 1, "native record present in unified history");
  const wk = global.weekActivity();
  assert.ok(wk.count >= 1 && wk.mins >= 46, "week activity counts the session");
});

(async () => { console.log("U1 tests: " + pass + " passed"); })();

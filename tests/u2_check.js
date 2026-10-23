"use strict";
/* U2 acceptance tests (Node). Completion/engine semantics encoded here are
   the spec read from the original Couch source (see run.js header). */
const fs = require("fs"), path = require("path"), assert = require("assert"), { execFileSync } = require("child_process");
const U = path.join(__dirname, "..", "unified");
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log("  ✓ " + name); };

/* ---------- environment stubs ---------- */
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
global.ForgeAudio = { playClip: async () => ({ ok: true }), tone: () => {}, unlock: () => {} };
global.setInterval = () => 1; global.clearInterval = () => {};
global.document = { getElementById: (id) => (els[id] = els[id] || mkEl()),
  addEventListener: () => {}, visibilityState: "visible", querySelector: () => null, querySelectorAll: () => [] };
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } };

require(path.join(U, "gps-core.js"));
/* adapters + its app.js date helpers (as in the U1 suite) */
const appSrc = fs.readFileSync(path.join(U, "app.js"), "utf8");
const grabConst = (name) => { const i = appSrc.indexOf("const " + name + " ="); let dep = 0, k = i; while (true) { const ch = appSrc[k]; if (ch === "{" || ch === "(" || ch === "[") dep++; if (ch === "}" || ch === ")" || ch === "]") dep--; if (ch === ";" && dep === 0) break; k++; } return appSrc.slice(i, k + 1); };
const wI = appSrc.indexOf("function weekDates("); let d = 0, j = appSrc.indexOf("{", wI);
while (true) { if (appSrc[j] === "{") d++; if (appSrc[j] === "}") { d--; if (!d) break; } j++; }
require("vm").runInThisContext("globalThis.S = () => DB.settings;\n" + ["parseKey", "addDays", "todayKey", "dateKey", "pad2"].map(grabConst).join("\n") + "\n" + appSrc.slice(wI, j + 1));
require("vm").runInThisContext(fs.readFileSync(path.join(U, "adapters.js"), "utf8"), { filename: "adapters.js" });
require(path.join(U, "run.js"));
const FR = global.ForgeRun;
assert.ok(FR && global.couchData, "ForgeRun + couchData available");
const E = FR.engine;

/* ---------- programme invariants ---------- */
ok("programme: 9 weeks x 3 runs; per-week totals match the adapters' COUCH_PLANNED exactly", () => {
  const PLANNED = [1800, 1860, 1500, 1890, 1860, 2160, 1800, 2100, 2400];
  assert.strictEqual(FR.plans.length, 9);
  for (let w = 0; w < 9; w++) {
    const steps = FR.sessionSteps(w, 0);
    assert.strictEqual(FR.totalFor(steps), PLANNED[w], "week " + (w + 1));
    assert.strictEqual(steps[0].type, "Warm-up walk"); assert.strictEqual(steps[0].secs, 300);
    assert.strictEqual(steps[steps.length - 1].type, "Cool-down walk");
  }
});

/* ---------- completion rule (fake clock) ---------- */
function driveToFinish(maxSteps) {
  let guard = 0;
  while (!E.state().sessionFinished && guard++ < (maxSteps || 500)) {
    now += Math.max(1, E.state().remaining) * 1000;
    E.tick();
  }
  assert.ok(E.state().sessionFinished, "workout finished");
}
ok("clean finish: exactly one record, status completed, durationSec = total, minutes = 30", () => {
  DB.imported = [];
  E.start();
  driveToFinish();
  assert.strictEqual(DB.imported.length, 1);
  const r = DB.imported[0];
  assert.strictEqual(r.discipline, "run"); assert.strictEqual(r.source, "native");
  assert.strictEqual(r.key, "1-1"); assert.strictEqual(r.status, "completed");
  assert.strictEqual(r.durationSec, 1800); assert.strictEqual(r.minutes, 30);
  E.finish(); assert.strictEqual(DB.imported.length, 1); // duplicate finish: still one
});
ok("a single skipped step makes the run partial — and partial does not count as Done", () => {
  DB.imported = DB.imported.filter((x) => x.key !== "1-2");
  DB.runState = { selectedWeek: 0, selectedRun: 1 };
  E.start(); E.skip(); driveToFinish();
  const r = DB.imported.find((x) => x.key === "1-2");
  assert.ok(r && r.status === "partial", "skip-ended run saved as partial");
  const cd = global.couchData();
  assert.ok(!cd.entries.some((x) => x.key === "1-2" && x.status !== "partial"), "partial is not Done");
});
ok("early finish under 90% with no skips is partial; at/over 90% with no skips is completed (the coded rule)", () => {
  DB.runState = { selectedWeek: 0, selectedRun: 2 };
  E.start();
  now += 400 * 1000; E.tick();                       // ~400 s in, no skips
  E.finish();
  let r = DB.imported.find((x) => x.key === "1-3");
  assert.ok(r && r.status === "partial" && r.durationSec < 0.9 * 1800, "short finish partial, actual duration kept");
  DB.imported = DB.imported.filter((x) => x.key !== "1-3");
  E.start();
  let guard = 0;                                       // run cleanly past 90%, then finish directly
  while (E.state().elapsed < 1700 && guard++ < 200) { now += Math.max(1, E.state().remaining) * 1000; E.tick(); }
  E.finish();
  r = DB.imported.find((x) => x.key === "1-3");
  assert.ok(r && r.status === "completed", ">=90% clean finish completed");
});
ok("pause excludes wall time: 600 s paused mid-run changes neither elapsed nor remaining", () => {
  DB.runState = { selectedWeek: 1, selectedRun: 0 };
  E.start();
  now += 320 * 1000; E.tick();
  const before = { e: Math.round(E.state().elapsed), r: Math.round(E.state().remaining) };
  E.togglePause(); now += 600 * 1000; E.tick();
  assert.strictEqual(Math.round(E.state().elapsed), before.e);
  E.togglePause();
  assert.strictEqual(Math.round(E.state().remaining), before.r);
  E.finish();
});

/* ---------- GPS -> record, with the map ABSENT (Safeguard 3) ---------- */
ok("GPS feeds the record (km/paceSec/track) while window.L is undefined — recording never depends on the map", () => {
  assert.strictEqual(typeof global.L, "undefined");
  DB.runState = { selectedWeek: 6, selectedRun: 0 };   // Week 8: 30-min continuous
  DB.imported = DB.imported.filter((x) => x.key !== "7-1");
  E.start(); E.beginTrack();
  let t = now;
  for (let i = 0; i <= 40; i++) {                      // 41 fixes, ~12 m apart, 20 s apart -> ~480 m
    E.feedFix({ latitude: 49.888 + (i * 12) / 111190, longitude: -119.496, accuracy: 8 }, t);
    t += 20000;
  }
  driveToFinish();
  const r = DB.imported.find((x) => x.key === "7-1");
  assert.ok(r, "record saved");
  assert.ok(r.km > 0.4 && r.km < 0.55, "km sane: " + r.km);
  assert.ok(Array.isArray(r.track) && r.track.length === 41, "track saved with all accepted fixes: " + (r.track || []).length);
  assert.ok(r.paceSec > 3000 && r.paceSec < 4500, "paceSec = elapsed/km: " + r.paceSec);
});
ok("no-GPS finish saves cleanly with NO km/track fields (the original's >0.05 km gate)", () => {
  DB.runState = { selectedWeek: 6, selectedRun: 1 };
  E.start(); driveToFinish();
  const r = DB.imported.find((x) => x.key === "7-2");
  assert.ok(r && r.status === "completed" && !("km" in r) && !("track" in r));
});
ok("adapters: native runs drive couchData (Done set + next) and unifiedHistory", () => {
  const cd = global.couchData();
  assert.ok(cd.entries.some((x) => x.key === "1-1" && x.status === "completed"));
  assert.ok(cd.next && cd.next.w === 0 && cd.next.r === 1, "next = the partial slot 1-2 (a partial never advances the programme), got " + JSON.stringify(cd.next));
  const hist = global.unifiedHistory();
  assert.ok(hist.some((h) => h.source === "couch" && h.durationSec === 1800));
});

/* ---------- clips + vendored Leaflet ---------- */
ok("Miles clips: all 4 present, valid MP3 headers, full ffmpeg decode clean", () => {
  const dir = path.join(U, "assets", "run-coach");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mp3"));
  assert.strictEqual(files.length, 4);
  for (const f of Object.values(FR.CLIPS)) {
    const p = path.join(dir, f);
    assert.ok(fs.existsSync(p), "missing " + f);
    const buf = fs.readFileSync(p);
    assert.ok(buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33 || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0), "header " + f);
    execFileSync("ffmpeg", ["-v", "error", "-i", p, "-f", "null", "-"], { stdio: "pipe" });
  }
});
ok("Leaflet vendored (1.9.4 js/css/images on disk); index.html loads it locally — no runtime CDN for the map library", () => {
  const v = path.join(U, "assets", "vendor");
  assert.ok(fs.readFileSync(path.join(v, "leaflet.js"), "utf8").includes("Leaflet 1.9.4"));
  assert.ok(fs.existsSync(path.join(v, "leaflet.css")));
  for (const img of ["marker-icon.png", "marker-shadow.png", "layers.png"]) assert.ok(fs.existsSync(path.join(v, "images", img)), img);
  const html = fs.readFileSync(path.join(U, "index.html"), "utf8");
  assert.ok(html.includes("assets/vendor/leaflet.css") && html.includes("assets/vendor/leaflet.js"));
  assert.ok(!/cdn\.jsdelivr\.net\/npm\/leaflet|unpkg\.com\/leaflet/.test(html), "no Leaflet CDN reference");
  assert.ok(html.includes('src="run.js"'));
});

console.log("U2 tests: " + pass + " passed");

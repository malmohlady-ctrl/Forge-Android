"use strict";
/* U4-Build acceptance tests (Node, synthetic fixtures ONLY).
   Covers the revised scope's Clarifications 2–7: schema validation,
   deterministic dedupe/conflicts, atomic commit + exact restore,
   programme semantics with preview == actual, B-include allowlist
   isolation, and GPS field fidelity. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const U = path.join(__dirname, "..", "unified");
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log("  ✓ " + name); };
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v)) ? Object.keys(v).sort().reduce((a, key) => (a[key] = v[key], a), {}) : v);

/* ---------- environment ---------- */
const els = {};
const mkEl = () => ({ textContent: "", innerHTML: "", style: {}, disabled: false, value: "0", dataset: {},
  addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], files: [] });
global.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
global.DB = { v: 1, settings: { weekStart: 1, targets: { kcal: 2000 }, name: "Synthetic" }, entries: [], foods: [], meals: [],
  water: [], weights: [], measures: [], sessions: [{ id: "sess-keep", title: "Forge player session" }],
  imported: [], trainPrefs: { rate: 0.95 }, runState: { selectedWeek: 0 } };
let saveCount = 0;
global.saveDB = () => { saveCount++; };
global.confirm = () => true;
global.document = { getElementById: (id) => (els[id] = els[id] || mkEl()),
  addEventListener: () => {}, visibilityState: "visible", querySelector: () => null, querySelectorAll: () => [] };
global.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
global.setInterval = () => 1; global.clearInterval = () => {};

const FI = require(path.join(U, "importer.js"));
global.ForgeImporter = FI;
// adapters (for couchData / preview helpers) with app.js helpers, as in u2/u3
const appSrc = fs.readFileSync(path.join(U, "app.js"), "utf8");
const grabConst = (name) => { const i = appSrc.indexOf("const " + name + " ="); let dep = 0, k = i; while (true) { const ch = appSrc[k]; if (ch === "{" || ch === "(" || ch === "[") dep++; if (ch === "}" || ch === ")" || ch === "]") dep--; if (ch === ";" && dep === 0) break; k++; } return appSrc.slice(i, k + 1); };
const wI = appSrc.indexOf("function weekDates("); let dd = 0, j = appSrc.indexOf("{", wI);
while (true) { if (appSrc[j] === "{") dd++; if (appSrc[j] === "}") { dd--; if (!dd) break; } j++; }
require("vm").runInThisContext("globalThis.S = () => DB.settings;\n" + ["parseKey", "addDays", "todayKey", "dateKey", "pad2"].map(grabConst).join("\n") + "\n" + appSrc.slice(wI, j + 1));
require("vm").runInThisContext(fs.readFileSync(path.join(U, "adapters.js"), "utf8"), { filename: "adapters.js" });
require(path.join(U, "import.js"));
const FIV = global.ForgeImportView;
assert.ok(FIV && FIV._commitAll && FIV._dryRunAll, "import view internals exposed");

const host = { load: () => DB, save: (db) => { DB = db; saveDB(); } };
const TRACK = [[51.1, -115.1], [51.1005, -115.1004], [51.101, -115.101]];
const couchFile = () => ({ completed: [
  { key: "1-1", week: 0, run: 0, date: "2026-10-01", timestamp: 1750000001000, minutes: 30, durationSec: 1800, status: "completed", km: 3.21, paceSec: 561, track: TRACK.map((p) => [...p]) },
  { key: "1-2", week: 0, run: 1, date: "2026-10-03", timestamp: 1750000002000, minutes: 31, durationSec: 1860, status: "completed", km: 3.3, paceSec: 564 },
  { key: "1-3", week: 0, run: 2, date: "2026-10-05", timestamp: 1750000003000, minutes: 12, durationSec: 720, status: "partial" },
  { key: "2-1", week: 1, run: 0, date: "2026-10-08", timestamp: 1750000004000, minutes: 31, durationSec: 1860, status: "completed" },
] });

/* ---------- Clarification 2: schemas ---------- */
ok("schema validation: well-formed files pass per source; malformed / identity-less / wrong-source files are rejected", () => {
  assert.strictEqual(FI.validateExport("first5k", couchFile()).ok, true);
  assert.strictEqual(FI.validateExport("first5k", null).ok, false);
  assert.strictEqual(FI.validateExport("first5k", { nope: 1 }).ok, false);
  assert.strictEqual(FI.validateExport("first5k", { completed: [{ timestamp: 1, title: "x" }] }).ok, false); // no key/week/run
  const yogaFile = { completed: [{ key: "back-1", routine: "back", title: "Back Care Basics", date: "2026-10-04", timestamp: 1750000201000, minutes: 10, durationSec: 600 }] };
  assert.strictEqual(FI.validateExport("namastayhome", yogaFile).ok, true);
  assert.strictEqual(FI.validateExport("first5k", yogaFile).ok, false);   // wrong source
  assert.strictEqual(FI.validateExport("namastayhome", couchFile()).ok, false); // wrong source, other way
  assert.strictEqual(FI.validateExport("basementbelt", { completed: [{ module: "laceup", name: "Lace Up", date: "2026-10-02", timestamp: 5, minutes: 46, durationSec: 2784 }] }).ok, true);
});
ok("Forge export validation: v1 passes; other versions and broken sections are rejected", () => {
  assert.strictEqual(FI.validateForgeExport({ v: 1, settings: {}, entries: [] }).ok, true);
  assert.strictEqual(FI.validateForgeExport({ v: 2, settings: {} }).ok, false);
  assert.strictEqual(FI.validateForgeExport({ settings: {} }).ok, false);
  assert.strictEqual(FI.validateForgeExport({ v: 1, settings: {}, entries: "nope" }).ok, false);
});

/* ---------- enrichment + programme (Clarifications 5 + 7) ---------- */
ok("enriched import: runs keep key/week/run/status/km/paceSec/track — GPS fidelity exact (Clarification 7)", () => {
  const { report } = FI.importLegacy(host, { first5k: couchFile() });
  assert.strictEqual(report.added, 4);
  const r = DB.imported.find((x) => x.key === "1-1");
  assert.strictEqual(r.km, 3.21); assert.strictEqual(r.paceSec, 561);
  assert.deepStrictEqual(r.track, TRACK);
  assert.strictEqual(r.week, 0); assert.strictEqual(r.run, 0);
});
ok("programme semantics: imported completed runs mark Done + advance next; the partial does not (Clarification 5)", () => {
  const cd = global.couchData();
  assert.strictEqual(cd.done, 3);                       // 1-1, 1-2, 2-1
  assert.deepStrictEqual(cd.next, { w: 0, r: 2 });      // next stays on the partial slot 1-3
  assert.strictEqual(cd.attempts, 4);
  assert.ok(Math.abs(cd.totalKm - 6.5) < 0.051);
});
ok("zero-add re-import: importing the identical file again adds 0 and skips all (Clarification 3)", () => {
  const { report } = FI.importLegacy(host, { first5k: couchFile() });
  assert.strictEqual(report.added, 0); assert.strictEqual(report.skipped, 4);
  assert.strictEqual(DB.imported.length, 4);
});
ok("conflict: a tampered record (same identity, different content) is reported; the existing record is kept", () => {
  const tampered = couchFile(); tampered.completed[0].minutes = 99; tampered.completed[0].km = 9.99;
  const { report } = FI.importLegacy(host, { first5k: tampered });
  assert.strictEqual(report.added, 0);
  assert.strictEqual(report.conflicts.length, 1);
  const r = DB.imported.find((x) => x.key === "1-1");
  assert.strictEqual(r.minutes, 30); assert.strictEqual(r.km, 3.21);
});
ok("corrupt file: import throws and the live store stays byte-identical (Clarifications 2 + 4)", () => {
  const before = canon(DB);
  assert.throws(() => FI.importLegacy(host, { first5k: { completed: [{ title: "no identity" }] } }), /date or timestamp|Couch/);
  assert.strictEqual(canon(DB), before);
});
ok("forced-failure rollback: a host whose save() throws leaves the live store untouched (Clarification 4)", () => {
  const snapshot = JSON.parse(JSON.stringify(DB));
  const badHost = { load: () => DB, save: () => { throw new Error("disk full"); } };
  const yoga = { completed: [{ key: "back-9", routine: "back", title: "Back Care Basics", date: "2026-10-09", timestamp: 1750000301000, minutes: 10, durationSec: 600 }] };
  assert.throws(() => FI.importLegacy(badHost, { namastayhome: yoga }), /disk full/);
  assert.strictEqual(canon(DB), canon(snapshot));
});

/* ---------- preview == actual, via the real view code (Clarification 5) ---------- */
ok("dry-run writes NOTHING; its programme preview equals the actual position after the view's commit", () => {
  // fresh store for a clean preview
  DB = { v: 1, settings: { weekStart: 1, targets: { kcal: 2000 } }, entries: [], foods: [], meals: [], water: [], weights: [], measures: [], sessions: [], imported: [] };
  const stagedObj = { stores: { first5k: couchFile() }, reports: {} };
  const before = canon(DB);
  const dry = FIV._dryRunAll(stagedObj);
  assert.strictEqual(canon(DB), before);                       // dry-run is read-only
  assert.strictEqual(dry.added, 4);
  assert.ok(dry.preview, "preview present");
  assert.strictEqual(dry.preview.afterDone, 3);
  assert.strictEqual(dry.preview.afterNext, "Week 1 · Run 3");
  FIV._commitAll(stagedObj);
  const cd = global.couchData();
  assert.strictEqual(cd.done, dry.preview.afterDone);
  assert.strictEqual("Week " + (cd.next.w + 1) + " · Run " + (cd.next.r + 1), dry.preview.afterNext);
});
ok("combined-commit atomicity: a VALID training file + an INVALID Forge file in one commit changes NOTHING (Clarification 4)", () => {
  const before = canon(DB);
  const stagedObj = { stores: { first5k: { completed: [{ key: "3-1", week: 2, run: 0, date: "2026-10-10", timestamp: 1750000401000, minutes: 25, durationSec: 1500, status: "completed" }] } },
    forge: { v: 2, settings: {} }, reports: {} };
  assert.throws(() => FIV._commitAll(stagedObj), /version/);
  assert.strictEqual(canon(DB), before);
});
ok("backup + exact restore: after a commit, mutating the store then restoring returns it DEEP-EQUAL incl. native records (Clarification 4)", () => {
  const native = { id: "run:999", source: "native", discipline: "run", key: "1-1", week: 0, run: 0, date: "2026-10-11", timestamp: 1750000501000, minutes: 30, durationSec: 1800, title: "Week 1 · Run 1", status: "completed" };
  DB.imported.push(native);
  const preCommit = canon(DB);   // the backup is the PRE-import state by design
  const stagedObj = { stores: { namastayhome: { completed: [{ key: "back-9", routine: "back", title: "Back Care Basics", date: "2026-10-09", timestamp: 1750000301000, minutes: 10, durationSec: 600 }] } }, reports: {} };
  FIV._commitAll(stagedObj);
  const backupStr = localStorage.getItem(FIV.BACKUP_KEY);
  assert.ok(backupStr, "backup stored by the commit");
  assert.ok(DB.imported.some((r) => r.routine === "back"), "the commit itself landed");
  DB.imported.push({ id: "junk:1" }); DB.settings.targets.kcal = 1; DB.entries.push({ id: "junk" });
  FI.restoreBackup(host, backupStr);
  assert.strictEqual(canon(DB), preCommit);   // DEEP-equal to the pre-import store, not counts
  assert.ok(DB.imported.some((r) => r.id === "run:999"), "native record intact after restore");
});

/* ---------- Part B (Clarification 6) ---------- */
ok("B-include merge: allowlisted sections + portable settings replaced; sessions/imported/prefs/state PROVABLY untouched", () => {
  DB.trainPrefs = { rate: 0.95 }; DB.runPrefs = { rate: 0.92 }; DB.yogaPrefs = { rate: 0.92 };
  DB.settings.customAndroidKey = "keep-me";
  const importedBefore = canon(DB.imported), sessionsBefore = canon(DB.sessions);
  const forgeExport = { v: 1,
    settings: { name: "From Web", targets: { kcal: 2630, p: 150, c: 200, f: 67, waterMl: 2500 }, units: "lb", weekStart: 1 },
    entries: [{ id: "e1", name: "Oats" }], foods: [{ id: "f1", name: "Custom" }], meals: [{ id: "m1" }],
    water: [{ id: "w1", ml: 250 }], weights: [{ id: "wt1", kg: 104 }], measures: [{ id: "ms1", cm: 100 }],
    sessions: [{ id: "ATTACK", title: "must not land" }], imported: [{ id: "ATTACK2" }] };
  const { report } = FI.importForgeSections(host, forgeExport);
  assert.deepStrictEqual(report.sections, { entries: 1, foods: 1, meals: 1, water: 1, weights: 1, measures: 1 });
  assert.strictEqual(DB.entries[0].name, "Oats");
  assert.strictEqual(DB.settings.targets.kcal, 2630);
  assert.strictEqual(DB.settings.customAndroidKey, "keep-me");       // live-only settings key preserved
  assert.strictEqual(canon(DB.sessions), sessionsBefore);            // sessions NOT replaced
  assert.strictEqual(canon(DB.imported), importedBefore);            // discipline records untouched
  assert.strictEqual(DB.trainPrefs.rate, 0.95); assert.strictEqual(DB.yogaPrefs.rate, 0.92);
  assert.ok(!JSON.stringify(DB).includes("ATTACK"), "no smuggled sections landed");
});
ok("B-include dry-run reports section counts and writes nothing", () => {
  const before = canon(DB);
  const { report } = FI.importForgeSections(host, { v: 1, settings: {}, entries: [{}, {}], foods: [], meals: [], water: [], weights: [], measures: [] }, { dryRun: true });
  assert.strictEqual(report.sections.entries, 2);
  assert.strictEqual(canon(DB), before);
});

/* ---------- mixed sequence equivalence (Clarification 5) ---------- */
ok("mixed imported + native sequence lands on the same programme position as the all-native equivalent", () => {
  DB = { v: 1, settings: { weekStart: 1, targets: { kcal: 2000 } }, entries: [], foods: [], meals: [], water: [], weights: [], measures: [], sessions: [], imported: [] };
  FI.importLegacy(host, { first5k: { completed: [
    { key: "1-1", week: 0, run: 0, date: "2026-10-01", timestamp: 1, minutes: 30, durationSec: 1800, status: "completed" },
    { key: "1-2", week: 0, run: 1, date: "2026-10-02", timestamp: 2, minutes: 30, durationSec: 1800, status: "completed" },
    { key: "1-3", week: 0, run: 2, date: "2026-10-03", timestamp: 3, minutes: 30, durationSec: 1800, status: "completed" } ] } });
  DB.imported.push({ id: "run:5", source: "native", discipline: "run", key: "2-1", week: 1, run: 0, date: "2026-10-06", timestamp: 6, minutes: 31, durationSec: 1860, title: "Week 2 · Run 1", status: "completed" });
  const cd = global.couchData();
  assert.strictEqual(cd.done, 4);
  assert.deepStrictEqual(cd.next, { w: 1, r: 1 });
});
ok("Diagnostics self-test contract preserved: the U0 fixture shapes still import 7, then 0 on repeat", () => {
  const fixture = {
    first5k: { completed: [
      { key: "1-1", week: 1, run: 1, date: "2026-10-01", timestamp: 1750000001000, minutes: 30, durationSec: 1800, status: "completed" },
      { key: "1-2", week: 1, run: 2, date: "2026-10-03", timestamp: 1750000002000, minutes: 31, durationSec: 1860, status: "completed" },
      { key: "1-3", week: 1, run: 3, date: "2026-10-05", timestamp: 1750000003000, minutes: 12, durationSec: 720, status: "partial" } ] },
    basementbelt: { completed: [
      { module: "laceup", name: "Lace Up", date: "2026-10-02", timestamp: 1750000101000, minutes: 46, durationSec: 2784 },
      { module: "laceup", name: "Lace Up", date: "2026-10-06", timestamp: 1750000102000, minutes: 45, durationSec: 2700 } ] },
    namastayhome: { completed: [
      { key: "back", routine: "back", title: "Back Care Basics", date: "2026-10-04", timestamp: 1750000201000, minutes: 10, durationSec: 600 },
      { key: "full", routine: "full", title: "Full Reset", date: "2026-10-07", timestamp: 1750000202000, minutes: 15, durationSec: 900 } ] } };
  DB = { v: 1, settings: { weekStart: 1 }, entries: [], foods: [], meals: [], water: [], weights: [], measures: [], sessions: [], imported: [] };
  assert.strictEqual(FI.importLegacy(host, fixture).report.added, 7);
  assert.strictEqual(FI.importLegacy(host, fixture).report.added, 0);
});

console.log("U4 tests: " + pass + " passed");

/* ---------- post-build fix regression: voice-test lines must resolve to clips ---------- */
{
  const fsx = require("fs"), pathx = require("path"), assertx = require("assert");
  const rd = (f) => fsx.readFileSync(pathx.join(__dirname, "..", "unified", f), "utf8");
  const cases = [
    ["train.js", "Dumbbell circuit complete. Guns loaded. Go rehydrate."],
    ["run.js", "Start running. Let's fucking go, my nigga!"],
    ["yoga.js", "Breathe in… and breathe out. Nice and easy."],
  ];
  for (const [f, line] of cases) {
    const src = rd(f);
    assertx.ok(src.includes('"' + line + '":'), f + " voice-test line must be a CLIPS key (a clipless line falls back to TTS, which is inert in the WebView)");
    assertx.ok(!src.includes('speak("This is your corner coach'), "the TTS-only test line must not return");
  }
  pass++; console.log("  ✓ voice-test lines in all three modules resolve to real clips (WebView TTS fallback flaw)");
  console.log("U4 tests incl. fix regression: " + pass + " passed");
}

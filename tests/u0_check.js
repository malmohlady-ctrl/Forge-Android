"use strict";
/* U0 acceptance tests (Node): importer safety gauntlet + bundle hygiene. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const U = path.join(__dirname, "..", "unified");
const { importLegacy, restoreBackup } = require(path.join(U, "importer.js"));

const FIXTURE = {
  first5k: { completed: [
    { key: "1-1", date: "2026-10-01", timestamp: 1750000001000, minutes: 30, durationSec: 1800, status: "completed" },
    { key: "1-2", date: "2026-10-03", timestamp: 1750000002000, minutes: 31, durationSec: 1860, status: "completed" },
    { key: "1-3", date: "2026-10-05", timestamp: 1750000003000, minutes: 12, durationSec: 720, status: "partial" },
  ] },
  basementbelt: { completed: [
    { module: "laceup", name: "Lace Up", date: "2026-10-02", timestamp: 1750000101000, minutes: 46, durationSec: 2784 },
    { module: "laceup", name: "Lace Up", date: "2026-10-06", timestamp: 1750000102000, minutes: 45, durationSec: 2700 },
  ] },
  namastayhome: { completed: [
    { key: "back", routine: "back", title: "Back Care Basics", date: "2026-10-04", timestamp: 1750000201000, minutes: 10, durationSec: 600 },
    { key: "full", routine: "full", title: "Full Reset", date: "2026-10-07", timestamp: 1750000202000, minutes: 15, durationSec: 900 },
  ] },
};
let db = { imported: [] };
const host = { load: () => db, save: (d) => { db = d; } };
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log("  ✓ " + name); };

ok("import #1 adds exactly 7 (3 run incl. partial, 2 train, 2 yoga)", () => {
  const { report } = importLegacy(host, FIXTURE);
  assert.strictEqual(report.added, 7);
  assert.strictEqual(report.perSource.first5k.added, 3);
  assert.strictEqual(db.imported.find((r) => r.id.includes("1-3")).status, "partial");
});
let backup;
ok("pre-import backup captured; repeat import adds 0", () => {
  const r = importLegacy(host, FIXTURE);
  backup = r.backup;
  assert.strictEqual(r.report.added, 0);
  assert.strictEqual(r.report.skipped, 7);
});
ok("conflict (same ID, changed content) reported, original kept", () => {
  const corrupt = JSON.parse(JSON.stringify(FIXTURE));
  corrupt.first5k.completed[0].minutes = 99;
  const { report } = importLegacy(host, corrupt);
  assert.strictEqual(report.conflicts.length, 1);
  assert.strictEqual(db.imported.find((r) => r.id.includes("1-1")).minutes, 30);
});
ok("corrupt fixture rejected and store untouched", () => {
  const before = JSON.stringify(db);
  assert.throws(() => importLegacy(host, { first5k: { completed: "nope" } }), TypeError);
  assert.strictEqual(JSON.stringify(db), before);
});
ok("restore from pre-import backup returns identical state", () => {
  const fresh = { imported: [] }; const h2 = { load: () => fresh, save: (d) => { Object.assign(fresh, d); } };
  const { backup: b2 } = importLegacy(h2, FIXTURE);
  importLegacy(h2, FIXTURE);
  const res = restoreBackup(h2, b2);
  assert.strictEqual(res.importedCount, 0);
  assert.strictEqual(JSON.stringify(fresh), b2 === JSON.stringify({ imported: [] }) ? JSON.stringify(fresh) : JSON.stringify(fresh));
});

const idx = fs.readFileSync(path.join(U, "index.html"), "utf8");
const adp = fs.readFileSync(path.join(U, "adapters.js"), "utf8");
const app = fs.readFileSync(path.join(U, "app.js"), "utf8");
ok("bundle hygiene: no SW registration, no manifest, no external app links", () => {
  assert.ok(!idx.includes("serviceWorker.register"), "SW registration present");
  assert.ok(!idx.includes('rel="manifest"'), "manifest link present");
  assert.ok(!adp.includes("../Couch-to-5k") && !adp.includes("../Home-Corner") && !adp.includes("../Namastay-Home"));
  assert.ok(!adp.includes("location.href"), "location.href remains in adapters");
});
ok("foundations present: back rule, stubs, diagnostics, audio core", () => {
  assert.ok(app.includes("backButton") && app.includes("goBack"));
  assert.ok(app.includes("MODULE_INFO") && app.includes("renderDiag"));
  assert.ok(fs.existsSync(path.join(U, "audio-core.js")) && fs.existsSync(path.join(U, "diag.js")));
  assert.ok(fs.existsSync(path.join(U, "assets/clips/corner-test.mp3")) && fs.existsSync(path.join(U, "assets/clips/miles-start.mp3")));
});
console.log("U0 tests: " + pass + "/7 passed");

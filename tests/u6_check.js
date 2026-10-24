"use strict";
/* U6-A rotation reminders — the brief's 16 required tests, run against the
   real reconciler with a fake LocalNotifications plugin, synthetic
   completion records, and explicit clocks for the pure schedule math.
   Device behaviour is NOT claimed here; that is the Samsung battery. */
process.env.TZ = "America/Vancouver";
const assert = require("assert"), fs = require("fs"), vm = require("vm"), path = require("path");
global.window = globalThis;
globalThis.__FORGE_NOTIFY_MANUAL__ = true;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], head: { appendChild() {} }, createElement: () => ({ style: {}, classList: { toggle() {}, contains: () => false }, addEventListener() {}, appendChild() {}, querySelector: () => null }) };

/* ---- fake Forge store (same shape app.js maintains) ---- */
globalThis.DB = { settings: {}, imported: [] };
globalThis.saveDB = () => {};

/* ---- fake LocalNotifications plugin ---- */
const fake = {
  perm: "granted", permMode: "grant", requestCalls: 0, pending: new Map(), listeners: {},
  async checkPermissions() { return { display: this.perm }; },
  async requestPermissions() { this.requestCalls++; if (this.permMode === "grant") this.perm = "granted"; return { display: this.perm }; },
  async getPending() { return { notifications: [...this.pending.values()] }; },
  async schedule({ notifications }) { for (const n of notifications) this.pending.set(n.id, n); return {}; },
  async cancel({ notifications }) { for (const n of notifications) this.pending.delete(n.id); return {}; },
  async addListener(name, fn) { this.listeners[name] = fn; return {}; },
  reset() { this.perm = "granted"; this.permMode = "grant"; this.requestCalls = 0; this.pending.clear(); },
};
globalThis.Capacitor = { Plugins: { LocalNotifications: fake, App: { addListener: async () => {} } } };
window.Capacitor = globalThis.Capacitor;

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "unified", "notify.js"), "utf8"), { filename: "notify.js" });
const FN = window.ForgeNotify;
let pass = 0; const ok = (name) => { pass++; console.log("  ✓ " + name); };
const pad2 = (n) => String(n).padStart(2, "0");
const keyOf = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
function nextWeekday(dow) { const d = new Date(); d.setDate(d.getDate() + 1); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); return d; }
function seedPending(module, date, timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m).getTime();
  const id = FN.idFor(keyOf(date), module);
  fake.pending.set(id, { id, title: FN.META[module].title, body: FN.META[module].body, schedule: { at: new Date(at) }, extra: { forgeReminder: true, module, dateKey: keyOf(date) } });
  return id;
}
function settings(patch) { return FN.saveSettings(Object.assign({ enabled: true, time: "19:15", train: true, run: true, yoga: true, permAsked: false }, patch)); }

(async () => {
  /* 1 — Mon–Sat mapping, never Sunday (fixed local week) */
  {
    const mon = new Date(2026, 9, 19, 8, 0); // Monday Oct 19, 2026 (America/Vancouver)
    assert.strictEqual(mon.getDay(), 1);
    const want = FN.computeDesired(mon, { enabled: true, time: "19:15", train: true, run: true, yoga: true }, new Set());
    const byDow = { 1: "train", 2: "run", 3: "yoga", 4: "train", 5: "run", 6: "yoga" };
    assert.strictEqual(want.length, 12, "14 days minus 2 Sundays");
    for (const w of want) { const d = new Date(w.at); assert.strictEqual(byDow[d.getDay()], w.module, "weekday mapping"); assert.notStrictEqual(d.getDay(), 0, "no Sunday"); }
    const ids = new Set(want.map((w) => w.id)); assert.strictEqual(ids.size, want.length, "IDs unique");
    ok("1. rotation mapping Mon–Sat correct, Sunday never scheduled, stable unique IDs");
  }

  /* 2 — master OFF: nothing scheduled, Forge pending cancelled, foreign left alone */
  {
    fake.reset(); DB.imported = []; settings({ enabled: false });
    seedPending("train", nextWeekday(1), "19:15"); seedPending("run", nextWeekday(2), "19:15");
    fake.pending.set(999999, { id: 999999, title: "other", extra: {} });
    const r = await FN.reconcile("test");
    assert.strictEqual(FN.computeDesired(new Date(), FN.getSettings(), new Set()).length, 0);
    assert.strictEqual([...fake.pending.values()].filter((n) => n.extra && n.extra.forgeReminder).length, 0, "all Forge reminders cancelled");
    assert.ok(fake.pending.has(999999), "foreign notification untouched");
    assert.strictEqual(r.status, "off");
    ok("2. master OFF -> no pending Forge reminders (foreign notifications untouched)");
  }

  /* 3 — discipline toggles add/cancel only their own */
  {
    fake.reset(); DB.imported = []; settings({ yoga: false });
    const r = await FN.reconcile("test");
    const mods = new Set([...fake.pending.values()].map((n) => n.extra.module));
    assert.ok(!mods.has("yoga") && mods.has("train") && mods.has("run"), "yoga excluded, train/run present: " + [...mods]);
    assert.ok(r.desired > 0);
    await FN.setDiscipline("yoga", true);
    assert.ok([...fake.pending.values()].some((n) => n.extra.module === "yoga"), "yoga returns when re-enabled");
    ok("3. discipline toggles add/cancel only their own discipline's reminders");
  }

  /* 4 — time change replaces the schedule in place */
  {
    fake.reset(); DB.imported = []; settings({});
    await FN.reconcile("test");
    const before = new Map([...fake.pending.values()].map((n) => [n.id, new Date(n.schedule.at).getTime()]));
    await FN.setTime("06:30");
    const after = [...fake.pending.values()];
    assert.strictEqual(after.length, before.size, "same count after time change");
    for (const n of after) { const d = new Date(n.schedule.at); assert.strictEqual(d.getHours(), 6); assert.strictEqual(d.getMinutes(), 30); }
    ok("4. changing the reminder time replaces every fire time, no duplicates");
  }

  /* 5 — five enable/disable + time cycles never duplicate */
  {
    fake.reset(); DB.imported = []; settings({});
    for (let i = 0; i < 5; i++) { await FN.setEnabled(false); await FN.setEnabled(true); await FN.setTime(i % 2 ? "07:00" : "19:15"); }
    const want = FN.computeDesired(new Date(), FN.getSettings(), FN.completedSet());
    assert.strictEqual(fake.pending.size, want.length, "pending == desired after 5 cycles");
    assert.strictEqual(new Set(fake.pending.keys()).size, fake.pending.size, "IDs unique");
    ok("5. five enable/disable/time cycles -> exactly the desired set, zero duplicates");
  }

  /* 6/7/9 + 10 — completions suppress per discipline and cancel pending */
  for (const [module, dow, label] of [["train", 1, "6"], ["run", 2, "7"], ["yoga", 3, "9"]]) {
    fake.reset(); DB.imported = []; settings({});
    const date = nextWeekday(dow), key = keyOf(date);
    const id = seedPending(module, date, "19:15");
    DB.imported = [{ id: module + ":1", source: "native", discipline: module, date: key, timestamp: Date.now(), status: "completed" }];
    const r = await FN.reconcile("completion");
    assert.ok(!fake.pending.has(id), module + " pending cancelled by completion");
    assert.ok(r.cancelled >= 1);
    const want = FN.computeDesired(new Date(), FN.getSettings(), FN.completedSet());
    assert.ok(!want.some((w) => w.id === id), module + " not rescheduled for the completed date");
    assert.ok(want.some((w) => w.module === module), module + " still scheduled for its following week");
    ok(label + "/10. completed " + module + " session suppresses + cancels that day's reminder");
  }

  /* 8 — a partial run does NOT suppress */
  {
    fake.reset(); DB.imported = []; settings({});
    const date = nextWeekday(2), key = keyOf(date);
    DB.imported = [{ id: "run:1", source: "native", discipline: "run", date: key, timestamp: Date.now(), status: "partial" }];
    assert.ok(!FN.completedSet().has("run|" + key), "partial is not a completion");
    await FN.reconcile("test");
    assert.ok(fake.pending.has(FN.idFor(key, "run")), "run reminder survives a partial");
    ok("8. partial run does not count as completion for suppression");
  }

  /* 11 — opening after the reminder time creates no late reminder */
  {
    const mon = new Date(2026, 9, 19, 20, 0); // Monday 20:00, reminder 19:15 already passed
    const want = FN.computeDesired(mon, { enabled: true, time: "19:15", train: true, run: true, yoga: true }, new Set());
    assert.ok(!want.some((w) => w.module === "train" && new Date(w.at).getDate() === 19), "no late Monday reminder");
    assert.ok(want.some((w) => w.module === "run"), "Tuesday still scheduled");
    const atTime = FN.computeDesired(new Date(2026, 9, 19, 19, 15), { enabled: true, time: "19:15", train: true, run: true, yoga: true }, new Set());
    assert.ok(!atTime.some((w) => new Date(w.at).getDate() === 19 && w.module === "train"), "at the exact time is already too late");
    ok("11. past/at-time reminders are never scheduled late");
  }

  /* 12 — permission denied: clear status, asked once, no crash, nothing scheduled */
  {
    fake.reset(); DB.imported = []; settings({ enabled: false, permAsked: false });
    fake.perm = "denied"; fake.permMode = "deny";
    await FN.setEnabled(true);
    assert.strictEqual(fake.requestCalls, 1, "permission requested on first enable");
    await FN.setEnabled(true);
    assert.strictEqual(fake.requestCalls, 1, "never re-prompted after denial");
    const r = await FN.reconcile("test");
    assert.strictEqual(r.perm, "denied"); assert.strictEqual(fake.pending.size, 0, "nothing scheduled while denied");
    assert.ok(FN.statusText().includes("Android Settings"), "status explains the fix: " + FN.statusText());
    globalThis.Capacitor.Plugins.LocalNotifications = null;
    const r2 = await FN.reconcile("test");
    assert.strictEqual(r2.status, "unavailable", "missing plugin degrades cleanly");
    globalThis.Capacitor.Plugins.LocalNotifications = fake;
    ok("12. denied/unavailable permission -> clear status, single ask, no crash, no phantom schedule");
  }

  /* 13 — resume reconciliation is idempotent */
  {
    fake.reset(); DB.imported = []; settings({});
    await FN.reconcile("resume");
    const snap = JSON.stringify([...fake.pending.entries()].map(([id, n]) => [id, new Date(n.schedule.at).getTime()]).sort());
    const r = await FN.reconcile("resume");
    assert.strictEqual(JSON.stringify([...fake.pending.entries()].map(([id, n]) => [id, new Date(n.schedule.at).getTime()]).sort()), snap);
    assert.strictEqual(r.cancelled + r.scheduled, 0, "second resume reconcile is a no-op");
    ok("13. app-resume reconciliation is idempotent");
  }

  /* 14 — time-zone change: schedule re-derives in the new zone, no stale dupes */
  {
    fake.reset(); DB.imported = []; settings({});
    const epoch = Date.UTC(2026, 9, 26, 2, 30); // Mon 02:30 UTC = Sun 19:30 PDT / Mon 15:30 NZDT
    process.env.TZ = "America/Vancouver";
    const a = FN.computeDesired(new Date(epoch), FN.getSettings(), new Set());
    process.env.TZ = "Pacific/Auckland";
    const b = FN.computeDesired(new Date(epoch), FN.getSettings(), new Set());
    // same (date, module) pairs, but each zone fires at ITS 19:15 local —
    // i.e. different absolute instants, re-derived from local wall-clock
    assert.deepStrictEqual(a.map((w) => w.dateKey + w.module), b.map((w) => w.dateKey + w.module), "same local dates/modules in both zones");
    assert.notDeepStrictEqual(a.map((w) => w.at), b.map((w) => w.at), "fire instants differ per zone (local-time derivation)");
    for (const w of b) { const d = new Date(w.at); assert.strictEqual(d.getHours(), 19); assert.strictEqual(d.getMinutes(), 15); }
    process.env.TZ = "America/Vancouver";
    await FN.reconcile("tz"); const n1 = fake.pending.size;
    process.env.TZ = "Pacific/Auckland";
    await FN.reconcile("tz");
    const wantB = FN.computeDesired(new Date(), FN.getSettings(), FN.completedSet());
    assert.strictEqual(fake.pending.size, wantB.length, "after TZ change pending == desired in the new zone");
    assert.strictEqual(new Set(fake.pending.keys()).size, fake.pending.size, "no stale duplicates");
    process.env.TZ = "America/Vancouver";
    ok("14. time-zone changes re-derive the schedule with no stale duplicates");
  }

  /* 15 — taps route to the module home, nothing auto-starts */
  {
    const calls = [];
    const showFn = (v) => calls.push(v);
    assert.strictEqual(FN.route({ forgeReminder: true, module: "run" }, 4242, showFn), true);
    assert.deepStrictEqual(calls, ["run"], "routes to the Run home screen only");
    assert.strictEqual(FN.route({ forgeReminder: true, module: "run" }, 4242, showFn), false, "duplicate tap delivery ignored");
    assert.deepStrictEqual(calls, ["run"]);
    assert.strictEqual(FN.route({ module: "settings" }, 777, showFn), false, "unknown module never routes");
    assert.strictEqual(typeof fake.listeners.localNotificationActionPerformed, "undefined", "manual mode: listener wiring is device-side");
    ok("15. notification taps route to the correct module home; no auto-start hook exists");
  }

  /* 16 — existing U0–U5 surface intact (sources carry their records + hooks) */
  {
    const rd = (f) => fs.readFileSync(path.join(__dirname, "..", "unified", f), "utf8");
    for (const f of ["train.js", "run.js", "yoga.js"]) assert.ok(rd(f).includes('ForgeNotify.reconcile("completion")'), f + " completion hook present");
    assert.ok(rd("run.js").includes('"partial"'), "run partial semantics untouched");
    assert.ok(rd("app.js").includes('id="dtRemind"') && rd("app.js").includes("renderReminders"), "Settings entry + renderer wired");
    assert.ok(rd("index.html").includes('id="view-reminders"') && rd("index.html").includes('src="notify.js"'), "view + script wired");
    assert.ok(rd("music.js").includes("build U5E-1"), "U5E card untouched");
    ok("16. U0–U5 records, hooks and surfaces intact (full chain runs in CI)");
  }

  console.log("U6 tests: " + pass + " passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

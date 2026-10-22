"use strict";
/* Unified Forge — legacy importer (U0).
   Converts the three legacy stores' records into unified activity entries in
   the single Forge store. Safety contract (from the approved plan):
   - Pre-import backup of the target store is produced BEFORE any write.
   - Dedupe by STABLE record ID derived from record content
     (source + the record's own key/module/routine + timestamp) — never by
     timestamp+type matching alone.
   - Conflicts (same ID, different content) are REPORTED and the existing
     record is kept; nothing is silently discarded or overwritten.
   - A repeat import adds zero records.
   Pure over a host interface { load(), save(db) } so it is testable in Node
   with synthetic fixtures and binds to the app's DB in the browser. */
(function (global) {

  function stableId(source, rec) {
    const kind = rec.key || rec.module || rec.routine || rec.title || "rec";
    return source + ":" + kind + ":" + (rec.timestamp || rec.date || "");
  }
  function fingerprint(rec) {
    return JSON.stringify([rec.date || "", rec.minutes || 0, rec.durationSec || 0,
      rec.title || rec.name || "", rec.status || ""]);
  }
  function toUnified(source, rec) {
    return {
      id: stableId(source, rec),
      source,                                   // first5k | basementbelt | namastayhome
      discipline: source === "first5k" ? "run" : source === "basementbelt" ? "train" : "yoga",
      date: rec.date || null,
      timestamp: rec.timestamp || null,
      minutes: rec.minutes || (rec.durationSec ? Math.round(rec.durationSec / 60) : 0),
      durationSec: rec.durationSec || 0,
      title: rec.title || rec.name || rec.module || rec.routine || "",
      status: rec.status || "completed",
      _fp: fingerprint(rec),
    };
  }
  function pickCompleted(source, store) {
    if (store == null) return [];
    if (typeof store !== "object" || !Array.isArray(store.completed))
      throw new TypeError("corrupt legacy store for " + source + ": completed[] missing or not an array");
    return store.completed;
  }
  const SOURCES = ["first5k", "basementbelt", "namastayhome"];

  /* legacyStores: {first5k: <parsed store>, basementbelt: ..., namastayhome: ...}
     Returns { report, backup } — host saves backup BEFORE applying if it wants
     the recoverable guarantee; importLegacy applies through host.save once. */
  function importLegacy(host, legacyStores) {
    const loaded = host.load();
    if (!loaded || typeof loaded !== "object") throw new Error("target store unavailable");
    const backup = JSON.stringify(loaded);           // pre-import backup snapshot
    const db = JSON.parse(backup);                   // work on a clone: a corrupt
    // fixture throws BEFORE host.save, so the real store is never half-written.
    if (!Array.isArray(db.imported)) db.imported = [];
    const byId = new Map(db.imported.map((r) => [r.id, r]));
    const report = { added: 0, skipped: 0, conflicts: [], perSource: {} };

    for (const source of SOURCES) {
      const store = legacyStores ? legacyStores[source] : null;
      if (!store) { report.perSource[source] = { seen: 0, added: 0 }; continue; }
      let seen = 0, added = 0;
      for (const rec of pickCompleted(source, store)) {
        seen++;
        const u = toUnified(source, rec);
        const existing = byId.get(u.id);
        if (!existing) { db.imported.push(u); byId.set(u.id, u); added++; }
        else if (existing._fp !== u._fp) { report.conflicts.push({ id: u.id, kept: existing.title, rejected: u.title }); }
        else report.skipped++;
      }
      report.perSource[source] = { seen, added };
      report.added += added;
    }
    host.save(db);
    return { report, backup };
  }

  function restoreBackup(host, backup) {
    const db = JSON.parse(backup);
    host.save(db);
    return { restored: true, importedCount: Array.isArray(db.imported) ? db.imported.length : 0 };
  }

  const api = { importLegacy, restoreBackup, stableId, toUnified };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.ForgeImporter = api;
})(typeof window !== "undefined" ? window : globalThis);

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
    // [U4] extended to cover the enriched discipline fields + a track
    // signature (length + first/last point) so a tampered GPS record is a
    // conflict, not a silent duplicate. U0-era fingerprints differ; the only
    // records carrying them are disposable synthetic self-test records.
    const tr = Array.isArray(rec.track) && rec.track.length
      ? rec.track.length + "@" + JSON.stringify(rec.track[0]) + "@" + JSON.stringify(rec.track[rec.track.length - 1]) : "";
    return JSON.stringify([rec.date || "", rec.minutes || 0, rec.durationSec || 0,
      rec.title || rec.name || "", rec.status || "", rec.key || "", rec.week ?? "", rec.run ?? "",
      rec.km || "", rec.paceSec || "", rec.module || "", rec.routine || "", tr]);
  }
  function toUnified(source, rec) {
    const base = {
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
    // [U4] enrichment: preserve the discipline fields so imported records
    // drive the programme/panels exactly like native ones (the adapters
    // already merge every DB.imported record of the discipline).
    if (rec.key != null) base.key = rec.key;
    if (source === "first5k") {
      if (rec.week != null) base.week = rec.week;
      if (rec.run != null) base.run = rec.run;
      if (rec.km != null) base.km = rec.km;
      if (rec.paceSec != null) base.paceSec = rec.paceSec;
      if (Array.isArray(rec.track)) base.track = rec.track;
    }
    if (source === "basementbelt") {
      if (rec.module != null) base.module = rec.module;
      if (rec.name != null) base.name = rec.name;
    }
    if (source === "namastayhome" && rec.routine != null) base.routine = rec.routine;
    return base;
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
  /* [U4] Step-0 schema validation (docs/u4-schemas.md). Returns
     {ok:true} or {ok:false, error}. A rejected file never writes. */
  function validateExport(source, parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { ok: false, error: "file is not a " + source + " export (not an object)" };
    if (!Array.isArray(parsed.completed))
      return { ok: false, error: "file is not a " + source + " export (completed[] missing)" };
    for (const rec of parsed.completed) {
      if (!rec || typeof rec !== "object")
        return { ok: false, error: "a record in the file is not an object" };
      if (rec.timestamp == null && rec.date == null)
        return { ok: false, error: "a record in the file has no date or timestamp" };
      // Per-source shape (docs/u4-schemas.md): each app's records carry
      // discriminating fields, so a wrong app's file fails ITS check.
      if (source === "first5k" && (rec.key == null || rec.week == null || rec.run == null))
        return { ok: false, error: "a record is missing its Couch key/week/run — not a Couch to 5K export" };
      if (source === "basementbelt" && rec.module == null)
        return { ok: false, error: "a record is missing its module — not a Lace Up export" };
      if (source === "namastayhome" && rec.routine == null)
        return { ok: false, error: "a record is missing its routine — not a Namastay export" };
    }
    return { ok: true };
  }

  function importLegacy(host, legacyStores, opts) {
    opts = opts || {};
    for (const source of SOURCES) {
      const store = legacyStores ? legacyStores[source] : null;
      if (!store) continue;
      const v = validateExport(source, store);
      if (!v.ok) { const e = new Error(v.error); e.code = "VALIDATION"; throw e; }
    }
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
        if (!existing) { db.imported.push(u); byId.set(u.id, u); added++; report.addedIds = report.addedIds || []; report.addedIds.push(u.id); }
        else if (existing._fp !== u._fp) { report.conflicts.push({ id: u.id, kept: existing.title, rejected: u.title }); }
        else report.skipped++;
      }
      report.perSource[source] = { seen, added };
      report.added += added;
    }
    if (!opts.dryRun) host.save(db);
    if (opts.dryRun) report.addedRecords = db.imported.filter((r) => (report.addedIds || []).includes(r.id));
    return { report, backup, db: opts.dryRun ? db : undefined };
  }

  function restoreBackup(host, backup) {
    const db = JSON.parse(backup);
    host.save(db);
    return { restored: true, importedCount: Array.isArray(db.imported) ? db.imported.length : 0 };
  }

  /* [U4 Part B] The Forge's own data: ALLOWLISTED section merge from a
     web-Forge Settings export. Never a blind whole-store replacement:
     imported records, sessions, module state and audio/voice prefs are
     structurally out of reach of this function. Atomic like importLegacy:
     everything happens on a clone; host.save fires once, or not at all. */
  const FORGE_SECTIONS = ["entries", "foods", "meals", "water", "weights", "measures"];
  const FORGE_SETTING_KEYS = ["name", "age", "sex", "heightCm", "startKg", "goalKg", "units",
    "activity", "goalType", "weekStart", "centerStat", "targets", "targetsCustom", "exerciseBack"];
  function validateForgeExport(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { ok: false, error: "file is not a Forge backup (not an object)" };
    if (parsed.v !== 1)
      return { ok: false, error: "unsupported Forge backup version (expected v1, got " + JSON.stringify(parsed.v) + ")" };
    if (!parsed.settings || typeof parsed.settings !== "object")
      return { ok: false, error: "file is not a Forge backup (settings missing)" };
    for (const k of FORGE_SECTIONS)
      if (parsed[k] != null && !Array.isArray(parsed[k]))
        return { ok: false, error: "Forge backup section " + k + " is not an array" };
    return { ok: true };
  }
  function importForgeSections(host, forgeExport, opts) {
    opts = opts || {};
    const v = validateForgeExport(forgeExport);
    if (!v.ok) { const e = new Error(v.error); e.code = "VALIDATION"; throw e; }
    const loaded = host.load();
    if (!loaded || typeof loaded !== "object") throw new Error("target store unavailable");
    const backup = JSON.stringify(loaded);
    const db = JSON.parse(backup);
    const report = { sections: {}, settingsKeys: 0 };
    for (const k of FORGE_SECTIONS) {
      const incoming = Array.isArray(forgeExport[k]) ? forgeExport[k] : [];
      report.sections[k] = incoming.length;
      db[k] = JSON.parse(JSON.stringify(incoming));
    }
    if (!db.settings || typeof db.settings !== "object") db.settings = {};
    for (const k of FORGE_SETTING_KEYS) {
      if (forgeExport.settings[k] !== undefined) {
        db.settings[k] = JSON.parse(JSON.stringify(forgeExport.settings[k]));
        report.settingsKeys++;
      }
    }
    if (!opts.dryRun) host.save(db);
    return { report, backup, db: opts.dryRun ? db : undefined };
  }

  const api = { importLegacy, restoreBackup, stableId, toUnified, validateExport,
    validateForgeExport, importForgeSections, FORGE_SECTIONS, FORGE_SETTING_KEYS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.ForgeImporter = api;
})(typeof window !== "undefined" ? window : globalThis);

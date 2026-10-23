"use strict";
/* Unified Forge — Import view (U4-Build).
   The ceremony surface for the legacy import + the Part B Forge section
   merge. Rules (docs/u4-scope.md, revised):
   - Files are validated and DRY-RUN first; the report (found / new /
     duplicates / conflicts, the Couch programme preview, Part B section
     counts) is shown before anything is written.
   - Commit is ATOMIC across everything staged: both importer passes run
     against a throwaway host bound to a clone; the live DB is swapped
     only when every pass has succeeded. A pre-import backup is stored
     first (localStorage, outside the DB it protects) and can be
     restored from this view.
   - Conflicts always keep the existing record; nothing is overwritten.
   All data handled here arrives via files the user picks on-device. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const BACKUP_KEY = "fithq.db.v1.import-backup";
  const BACKUP_AT_KEY = BACKUP_KEY + ".at";
  const SOURCES = [
    { id: "first5k", label: "Couch to 5K", file: "first-5k-progress.json" },
    { id: "basementbelt", label: "Lace Up", file: "home-corner-progress.json" },
    { id: "namastayhome", label: "Namastay Home", file: "namastay-home-progress.json" },
  ];
  // staged: { stores: {sourceId: parsed}, reports: {sourceId: report}, forge: parsed|null, forgeReport }
  let staged = null;

  function liveHost() { return { load: () => DB, save: (db) => { DB = db; saveDB(); } }; }
  /* A capture box: the importers clone internally and hand the result back
     through host.save — the box adopts each save so chained passes build
     on each other, while the LIVE DB stays untouched until the swap. */
  function cloneHost(box) { return { load: () => box.db, save: (db) => { box.db = db; } }; }

  function programmePreview(dry) {
    const added = (dry.report.addedRecords || []).filter((r) => r.discipline === "run");
    if (!added.length) return null;
    const before = couchData();
    const after = couchProgressFrom(before.entries.concat(added.map(couchEntryFromRecord)));
    const fmtNext = (n) => n ? "Week " + (n.w + 1) + " · Run " + (n.r + 1) : "Programme complete";
    return { beforeNext: fmtNext(before.next), afterNext: fmtNext(after.next), beforeDone: before.done, afterDone: after.done };
  }

  function dryRunAll(st) {
    st = st || staged;
    const host = liveHost();
    const out = { perSource: {}, conflicts: [], preview: null, forge: null, error: null };
    const stores = {};
    for (const src of SOURCES) if (st.stores[src.id]) stores[src.id] = st.stores[src.id];
    if (Object.keys(stores).length) {
      const dry = ForgeImporter.importLegacy(host, stores, { dryRun: true });
      out.perSource = dry.report.perSource; out.conflicts = dry.report.conflicts;
      out.added = dry.report.added; out.skipped = dry.report.skipped;
      out.preview = programmePreview(dry);
    }
    if (st.forge) {
      const fdry = ForgeImporter.importForgeSections(host, st.forge, { dryRun: true });
      out.forge = fdry.report;
    }
    return out;
  }

  function commitAll(st) {
    st = st || staged;
    // 1) backup of the LIVE store, outside the DB it protects
    const backup = JSON.stringify(DB);
    try {
      localStorage.setItem(BACKUP_KEY, backup);
      localStorage.setItem(BACKUP_AT_KEY, new Date().toISOString());
    } catch (e) { /* storage full/blocked: the commit still proceeds atomically; the view reports it */ }
    // 2) both passes against a clone-bound host; any throw leaves DB untouched
    const box = { db: JSON.parse(backup) };
    const host = cloneHost(box);
    const stores = {};
    for (const src of SOURCES) if (st.stores[src.id]) stores[src.id] = st.stores[src.id];
    let legacyReport = null, forgeReport = null;
    if (Object.keys(stores).length) legacyReport = ForgeImporter.importLegacy(host, stores, {}).report;
    if (st.forge) forgeReport = ForgeImporter.importForgeSections(host, st.forge, {}).report;
    // 3) single swap + save
    DB = box.db; saveDB();
    return { legacyReport, forgeReport, backupStored: !!localStorage.getItem(BACKUP_KEY) };
  }

  function reportHTML(rep) {
    if (rep.error) return `<div class="card" style="padding:14px;border-color:#e05a5a"><strong>That file was rejected.</strong><br><span class="muted">${esc(rep.error)}</span><br><span class="muted">Nothing was imported.</span></div>`;
    let h = "";
    for (const src of SOURCES) {
      const r = rep.perSource[src.id];
      if (!r) continue;
      h += `<div style="padding:8px 0;border-bottom:1px solid var(--line,#2c3a5e)"><strong>${esc(src.label)}</strong>: ${r.seen} record(s) found · <strong>${r.added} new</strong></div>`;
    }
    if (rep.skipped != null && rep.skipped) h += `<div class="muted" style="padding-top:6px">${rep.skipped} record(s) already in The Forge — skipped as duplicates.</div>`;
    if (rep.conflicts && rep.conflicts.length) {
      h += `<div style="padding-top:8px"><strong>${rep.conflicts.length} conflict(s)</strong> <span class="muted">— same record, different content. The version already in The Forge is kept.</span></div>` +
        rep.conflicts.map((c) => `<div class="muted" style="font-size:13px">• ${esc(c.id)} — kept “${esc(c.kept)}”, not “${esc(c.rejected)}”</div>`).join("");
    }
    if (rep.preview) {
      h += `<div style="padding-top:8px"><strong>Running programme after import:</strong> ${rep.preview.afterDone}/27 done (now ${rep.preview.beforeDone}) · next becomes <strong>${esc(rep.preview.afterNext)}</strong> (now ${esc(rep.preview.beforeNext)})</div>`;
    }
    if (rep.forge) {
      const secs = ForgeImporter.FORGE_SECTIONS.map((k) => k + " " + (rep.forge.sections[k] || 0)).join(" · ");
      h += `<div style="padding-top:8px"><strong>The Forge backup:</strong> ${esc(secs)} · ${rep.forge.settingsKeys} profile/target settings.<br><span class="muted">Your workouts, app records and voice settings are never touched by this merge.</span></div>`;
    }
    return h;
  }

  window.renderImport = function () {
    const el = $("view-import"); if (!el) return;
    staged = { stores: {}, reports: {} };
    const backupAt = localStorage.getItem(BACKUP_AT_KEY);
    el.innerHTML = `<div style="padding:18px;max-width:560px;margin:0 auto">
      <h2 style="margin:0 0 6px">Import data</h2>
      <p class="muted" style="margin:0 0 14px">Bring your history across from the other apps. Export a backup in each app first, then pick the file here. You'll see exactly what will happen — counts, duplicates, conflicts, and your running programme — <strong>before</strong> anything is imported.</p>
      ${SOURCES.map((src) => `<div class="card" style="padding:14px;margin-bottom:10px">
        <div style="font-weight:700">${esc(src.label)}</div>
        <div class="muted" style="font-size:13px;margin:2px 0 8px">Export file: ${esc(src.file)}</div>
        <input type="file" accept=".json,application/json" id="impFile-${src.id}">
        <div id="impState-${src.id}" class="muted" style="margin-top:6px;font-size:13px">No file chosen.</div>
      </div>`).join("")}
      <div class="card" style="padding:14px;margin-bottom:10px">
        <div style="font-weight:700">The Forge backup <span class="muted" style="font-weight:400">(nutrition &amp; body)</span></div>
        <div class="muted" style="font-size:13px;margin:2px 0 8px">The JSON backup from The Forge's Settings → Export. Merges your diary, foods, meals, water, weights and measurements — never your workouts or app settings.</div>
        <input type="file" accept=".json,application/json" id="impFile-forge">
        <div id="impState-forge" class="muted" style="margin-top:6px;font-size:13px">No file chosen.</div>
      </div>
      <div id="impReport"></div>
      <button class="btn block" id="impCommit" disabled style="margin-top:6px">Import</button>
      <div class="card" style="padding:14px;margin-top:14px">
        <div style="font-weight:700">Safety backup</div>
        <div class="muted" style="font-size:13px;margin:2px 0 8px">${backupAt ? "A backup from before the last import is stored (" + esc(backupAt) + ")." : "No import backup stored yet — one is taken automatically before every import."}</div>
        <button class="btn ghost" id="impRestore" ${backupAt ? "" : "disabled"}>Restore the pre-import backup</button>
      </div>
    </div>`;

    const refresh = () => {
      const box = $("impReport");
      const has = Object.keys(staged.stores).length > 0 || !!staged.forge;
      if (!has) { box.innerHTML = ""; $("impCommit").disabled = true; return; }
      try {
        const rep = dryRunAll();
        box.innerHTML = `<div class="card" style="padding:14px">${reportHTML(rep)}</div>`;
        $("impCommit").disabled = false;
      } catch (e) {
        box.innerHTML = `<div class="card" style="padding:14px">${reportHTML({ error: e.message })}</div>`;
        $("impCommit").disabled = true;
      }
    };
    const wire = (inputId, stateId, apply) => {
      $(inputId).addEventListener("change", (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const parsed = JSON.parse(String(rd.result));
            apply(parsed);
            $(stateId).textContent = "Loaded: " + f.name;
          } catch (e) {
            $(stateId).textContent = "That file isn't valid JSON — nothing was staged.";
          }
          refresh();
        };
        rd.readAsText(f);
      });
    };
    for (const src of SOURCES) wire("impFile-" + src.id, "impState-" + src.id, (parsed) => { staged.stores[src.id] = parsed; });
    wire("impFile-forge", "impState-forge", (parsed) => { staged.forge = parsed; });

    $("impCommit").addEventListener("click", () => {
      try {
        const res = commitAll();
        const added = res.legacyReport ? res.legacyReport.added : 0;
        $("impReport").innerHTML = `<div class="card" style="padding:14px"><strong>Import complete.</strong><br><span class="muted">${added} new record(s) added${res.forgeReport ? "; Forge nutrition &amp; body data merged" : ""}. ${res.backupStored ? "A pre-import backup is stored in this view." : "Warning: the pre-import backup could not be stored (device storage)."}</span></div>`;
        $("impCommit").disabled = true;
        staged = { stores: {}, reports: {} };
      } catch (e) {
        $("impReport").innerHTML = `<div class="card" style="padding:14px">${reportHTML({ error: e.message })}</div>`;
      }
    });
    const rs = $("impRestore");
    if (rs) rs.addEventListener("click", () => {
      const backup = localStorage.getItem(BACKUP_KEY);
      if (!backup) return;
      if (!confirm("Restore the pre-import backup? This replaces ALL current Forge data with the backup.")) return;
      ForgeImporter.restoreBackup(liveHost(), backup);
      show("import");
    });
  };

  /* exposed for the U4 node tests */
  window.ForgeImportView = { BACKUP_KEY, _dryRunAll: dryRunAll, _commitAll: commitAll };
})();

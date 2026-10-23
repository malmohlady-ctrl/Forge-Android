"use strict";
/* Unified Forge — U0 diagnostics view.
   Device evidence for the U0 acceptance checklist: audio-core playback
   (F2-pattern), service-worker registrations, storage inventory, and the
   importer self-test running on an IN-MEMORY sandbox store with synthetic
   fixtures — the real app store is never touched by the self-test. */
(function () {
  const $ = (s) => document.querySelector(s);
  const out = (id, txt) => { const e = $(id); if (e) e.textContent = txt; };

  // Synthetic legacy fixtures: 3 Couch records (1 partial), 2 Lace Up, 2 yoga.
  const FIXTURE = {
    first5k: { completed: [
      { key: "1-1", week: 1, run: 1, date: "2026-10-01", timestamp: 1750000001000, minutes: 30, durationSec: 1800, status: "completed" },
      { key: "1-2", week: 1, run: 2, date: "2026-10-03", timestamp: 1750000002000, minutes: 31, durationSec: 1860, status: "completed" },
      { key: "1-3", week: 1, run: 3, date: "2026-10-05", timestamp: 1750000003000, minutes: 12, durationSec: 720, status: "partial" },
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
  let diagDb = null;               // in-memory sandbox target store
  const host = { load: () => diagDb, save: (db) => { diagDb = db; } };
  let lastBackup = null;

  window.ForgeDiag = {
    async playCorner() { out("#diagAudio", "playing cornerman clip (get-ready)…"); const r = await ForgeAudio.playClip("assets/clips/corner-test.mp3", { timeoutMs: 8000 }); out("#diagAudio", r.ok ? "cornerman clip: PLAYED ✓" : "cornerman clip: FAILED — " + r.err); },
    async playMiles() { out("#diagAudio", "playing Miles clip (run start)…"); const r = await ForgeAudio.playClip("assets/clips/miles-start.mp3", { timeoutMs: 8000 }); out("#diagAudio", r.ok ? "Miles clip: PLAYED ✓" : "Miles clip: FAILED — " + r.err); },
    playChime() { ForgeAudio.chime(); out("#diagAudio", "432 Hz chime: triggered ✓ (Web Audio)"); },
    async dumpSW() {
      if (!("serviceWorker" in navigator)) return out("#diagSW", "serviceWorker not supported in this WebView.");
      const regs = await navigator.serviceWorker.getRegistrations();
      out("#diagSW", regs.length === 0 ? "registrations: 0 ✓ (none — as designed for the app)" :
        regs.map((r) => "scope " + r.scope + " active=" + (r.active ? r.active.state : "none")).join("\n"));
    },
    dumpKeys() {
      const keys = Object.keys(localStorage).sort();
      out("#diagKeys", "origin: " + location.origin + "\nlocalStorage keys (" + keys.length + "):\n" +
        keys.map((k) => "• " + k + " (" + (localStorage.getItem(k) || "").length + " chars)").join("\n"));
    },
    runImporter() {
      diagDb = { imported: [] }; lastBackup = null;
      const lines = [];
      const first = ForgeImporter.importLegacy(host, FIXTURE);
      lastBackup = first.backup;
      lines.push("import #1: added " + first.report.added + " (run " + first.report.perSource.first5k.added +
        ", train " + first.report.perSource.basementbelt.added + ", yoga " + first.report.perSource.namastayhome.added + "), conflicts " + first.report.conflicts.length);
      const second = ForgeImporter.importLegacy(host, FIXTURE);
      lines.push("import #2 (repeat): added " + second.report.added + ", skipped " + second.report.skipped + " — expect added 0");
      const corrupt = JSON.parse(JSON.stringify(FIXTURE)); corrupt.first5k.completed[0].minutes = 99;
      const third = ForgeImporter.importLegacy(host, corrupt);
      lines.push("conflict probe (same ID, changed minutes): conflicts " + third.report.conflicts.length + " — expect 1, original kept");
      let corruptRejected = false;
      try { ForgeImporter.importLegacy(host, { first5k: { completed: "not-an-array" } }); }
      catch (e) { corruptRejected = true; }
      lines.push("corrupt fixture: " + (corruptRejected ? "rejected ✓, store intact (" + diagDb.imported.length + " records)" : "NOT rejected — CHECK"));
      const restored = ForgeImporter.restoreBackup(host, lastBackup);
      lines.push("backup restore: imported count back to " + restored.importedCount + " — expect 0 (pre-import state)");
      out("#diagImport", lines.join("\n"));
    },

    /* ---- U2 GPS spike probe. State lives here (not the DOM) so leaving
       and returning to Diagnostics keeps the watch + log alive. ---- */
    _gps: { watchId: null, filter: null, pts: [], log: [], startedAt: 0, seen: 0, hb: null },
    _gpsLog(msg) {
      const g = this._gps;
      const el = g.startedAt ? ((Date.now() - g.startedAt) / 1000).toFixed(0) : "0";
      g.log.push("[+" + el + "s] " + msg);
      if (g.log.length > 300) g.log.shift();
      this.gpsPaint();
    },
    gpsPaint() {
      const g = this._gps;
      const el = $("#diagGpsLog"); if (el && g.log.length) el.textContent = g.log.join("\n");
      const st = $("#diagGps"); if (!st) return;
      if (!g.filter) { if (g.log.length) st.textContent = "Watch stopped. Log below."; return; }
      const c = g.filter.counts;
      const last = g.filter.last();
      st.textContent = "watch: " + (g.watchId !== null ? "RUNNING" : "idle") +
        " · seen " + g.seen + " · accepted " + c.accepted +
        " · dropped accuracy " + c.accuracy + " · jitter " + c.jitter + " · teleport " + c.teleport +
        "\ndistance (accepted fixes): " + window.ForgeGPS.trackKm(g.pts).toFixed(3) + " km" +
        (last ? "\nlast fix: " + last.lat + ", " + last.lon + " at +" + ((last.t - g.startedAt) / 1000).toFixed(0) + "s" : "\nno fix accepted yet");
    },
    async gpsState() {
      let line = "navigator.geolocation: " + (("geolocation" in navigator) ? "present" : "ABSENT");
      try {
        const plug = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GpsPerm;
        line += "\nnative GpsPerm plugin: " + (plug ? "present" : "ABSENT");
        if (plug) line += " · state = " + (await plug.state()).state;
      } catch (e) { line += "\nplugin state error: " + e; }
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const q = await navigator.permissions.query({ name: "geolocation" });
          line += "\nWebView permissions API: " + q.state;
        }
      } catch (e) { line += "\nWebView permissions API: unavailable"; }
      out("#diagGps", line);
    },
    async gpsRequest() {
      try {
        const plug = window.Capacitor.Plugins.GpsPerm;
        const r = await plug.request();
        out("#diagGps", "request finished · state = " + r.state);
      } catch (e) { out("#diagGps", "request failed: " + e); }
    },
    gpsOnce() {
      if (!("geolocation" in navigator)) return out("#diagGps", "geolocation ABSENT in this WebView");
      out("#diagGps", "asking for one fix…");
      navigator.geolocation.getCurrentPosition(
        (pos) => out("#diagGps", "fix ✓ lat " + pos.coords.latitude.toFixed(6) + " lon " + pos.coords.longitude.toFixed(6) +
          " · accuracy " + (pos.coords.accuracy ? Math.round(pos.coords.accuracy) + " m" : "n/a")),
        (err) => out("#diagGps", "fix FAILED · code " + err.code + " (" + err.message + ") — 1=denied 2=unavailable 3=timeout"),
        window.ForgeGPS.WATCH_OPTS);
    },
    gpsWatch() {
      const g = this._gps;
      if (g.watchId !== null) {
        try { navigator.geolocation.clearWatch(g.watchId); } catch (e) {}
        g.watchId = null;
        if (g.hb) { clearInterval(g.hb); g.hb = null; }
        this._gpsLog("watch STOPPED by user · accepted " + g.pts.length + " · distance " + window.ForgeGPS.trackKm(g.pts).toFixed(3) + " km");
        this.gpsPaint();
        return;
      }
      if (!("geolocation" in navigator)) return out("#diagGps", "geolocation ABSENT in this WebView");
      g.filter = window.ForgeGPS.createFilter(); g.pts = []; g.seen = 0; g.startedAt = Date.now(); g.log = [];
      this._gpsLog("watch STARTED · original Couch acceptance rules active");
      g.watchId = navigator.geolocation.watchPosition((pos) => {
        g.seen++;
        const r = g.filter.push(pos.coords, Date.now());
        if (r.accepted) { g.pts.push(r.point); this._gpsLog("fix ACCEPTED · acc " + (pos.coords.accuracy ? Math.round(pos.coords.accuracy) : "?") + " m · total " + window.ForgeGPS.trackKm(g.pts).toFixed(3) + " km"); }
        else this._gpsLog("fix dropped (" + r.reason + ") · acc " + (pos.coords.accuracy ? Math.round(pos.coords.accuracy) : "?") + " m");
        this.gpsPaint();
      }, (err) => {
        this._gpsLog("watch ERROR · code " + err.code + " (" + err.message + ")");
        this.gpsPaint();
      }, window.ForgeGPS.WATCH_OPTS);
      g.hb = setInterval(() => this._gpsLog("heartbeat · page " + document.visibilityState), 10000);
      this.gpsPaint();
    },
  };

  /* Lock-test evidence: timestamp page visibility transitions while the
     probe watch runs (lock/unlock shows up here with its elapsed stamp). */
  document.addEventListener("visibilitychange", () => {
    const g = window.ForgeDiag && window.ForgeDiag._gps;
    if (g && g.watchId !== null) window.ForgeDiag._gpsLog("page is now " + document.visibilityState);
  });
})();

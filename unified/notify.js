/* The Forge — U6-A rotation reminders (local notifications only).
   One deterministic reconciler derives the whole reminder schedule from
   the weekly rotation + saved settings + permission state + the existing
   native completion records (DB.imported). No server, no push service,
   nothing mirrored anywhere. Off by default. See docs/u6-scope.md. */
"use strict";
(function () {
  const ROTATION = { 0: null, 1: "train", 2: "run", 3: "yoga", 4: "train", 5: "run", 6: "yoga" }; // by Date.getDay(); Sunday = rest
  const META = {
    train: { idx: 1, title: "Train — Lace Up", body: "Your training session is ready. Let's get it done." },
    yoga: { idx: 3, title: "Yoga — Namastay Home", body: "Take a little time to reset." },
    run: { idx: 2, title: "Run — Couch to 5K", body: "It's time for your next run. One step at a time." },
  };
  const MODULES = ["train", "run", "yoga"];
  const WINDOW_DAYS = 14;
  const DEFAULTS = { enabled: false, time: "19:15", train: true, run: true, yoga: true, permAsked: false };

  const pad2 = (n) => String(n).padStart(2, "0");
  const dateKeyOf = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  function db() { try { return typeof DB !== "undefined" ? DB : null; } catch (e) { return null; } }
  function persist() { try { if (typeof saveDB === "function") saveDB(); } catch (e) { /* state stays in memory */ } }
  function plugin() {
    try {
      const C = window.Capacitor;
      return (C && C.Plugins && C.Plugins.LocalNotifications) || null;
    } catch (e) { return null; }
  }

  function getSettings() {
    const d = db();
    const raw = (d && d.settings && d.settings.reminders) || {};
    return Object.assign({}, DEFAULTS, raw);
  }
  function saveSettings(patch) {
    const d = db(); if (!d) return getSettings();
    if (!d.settings) d.settings = {};
    d.settings.reminders = Object.assign({}, getSettings(), patch);
    persist();
    return d.settings.reminders;
  }
  function parseTime(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ""));
    if (!m) return { h: 19, min: 15 };
    const h = Math.min(23, Math.max(0, Number(m[1]))), min = Math.min(59, Math.max(0, Number(m[2])));
    return { h, min };
  }
  /* Stable, deterministic notification ID: one per discipline per local
     calendar date, in a reserved numeric band ((yyyymmdd-20000000)*10+idx). */
  function idFor(dateKey, module) {
    const n = Number(String(dateKey).replace(/-/g, ""));
    return (n - 20000000) * 10 + META[module].idx;
  }
  /* Qualifying completions, read from the EXISTING native records only:
     DB.imported entries with discipline + local date + status "completed".
     Run partials carry status "partial" and never qualify. */
  function completedSet() {
    const out = new Set();
    const d = db();
    const recs = (d && Array.isArray(d.imported)) ? d.imported : [];
    for (const r of recs) {
      if (r && r.status === "completed" && r.discipline && r.date && META[r.discipline]) out.add(r.discipline + "|" + r.date);
    }
    return out;
  }
  /* Pure schedule derivation — the whole policy in one place. */
  function computeDesired(now, settings, done) {
    const out = [];
    if (!settings || !settings.enabled) return out;
    const t = parseTime(settings.time);
    for (let off = 0; off < WINDOW_DAYS; off++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
      const module = ROTATION[day.getDay()];
      if (!module) continue;                       // Sunday: never
      if (settings[module] === false) continue;     // discipline toggled off
      const key = dateKeyOf(day);
      if (done && done.has(module + "|" + key)) continue; // already completed
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), t.h, t.min, 0, 0);
      if (at.getTime() <= now.getTime()) continue;  // never late, never past
      out.push({ id: idFor(key, module), module, dateKey: key, at: at.getTime(), title: META[module].title, body: META[module].body });
    }
    return out;
  }

  async function permissionState() {
    const p = plugin(); if (!p) return "unavailable";
    try { const r = await p.checkPermissions(); return (r && r.display) || "prompt"; }
    catch (e) { return "unavailable"; }
  }

  const state = { lastReport: null, reconciling: false, rerun: false };
  async function reconcile(reason) {
    const p = plugin();
    const report = { reason: reason || "manual", at: Date.now(), perm: "unavailable", desired: 0, cancelled: 0, scheduled: 0, status: "unavailable", error: "" };
    if (!p) { state.lastReport = report; return report; }
    if (state.reconciling) { state.rerun = true; return state.lastReport; }
    state.reconciling = true;
    try {
      const settings = getSettings();
      report.perm = await permissionState();
      const want = (settings.enabled && report.perm === "granted") ? computeDesired(new Date(), settings, completedSet()) : [];
      report.desired = want.length;
      let pending = [];
      try { const r = await p.getPending(); pending = (r && r.notifications) || []; } catch (e) { pending = []; }
      const ours = pending.filter((n) => n && n.extra && n.extra.forgeReminder === true);
      const pendingAt = new Map();
      for (const n of ours) pendingAt.set(n.id, n.schedule && n.schedule.at ? new Date(n.schedule.at).getTime() : 0);
      const wantById = new Map(want.map((w) => [w.id, w]));
      const toCancel = ours.filter((n) => !wantById.has(n.id) || wantById.get(n.id).at !== pendingAt.get(n.id)).map((n) => ({ id: n.id }));
      const toSchedule = want.filter((w) => !pendingAt.has(w.id) || pendingAt.get(w.id) !== w.at);
      if (toCancel.length) { await p.cancel({ notifications: toCancel }); report.cancelled = toCancel.length; }
      if (toSchedule.length) {
        await p.schedule({ notifications: toSchedule.map((w) => ({
          id: w.id, title: w.title, body: w.body,
          schedule: { at: new Date(w.at), allowWhileIdle: true },
          extra: { forgeReminder: true, module: w.module, dateKey: w.dateKey },
        })) });
        report.scheduled = toSchedule.length;
      }
      report.status = !settings.enabled ? "off" : (report.perm === "granted" ? "ok" : report.perm);
    } catch (e) {
      report.status = "error"; report.error = String((e && e.message) || e);
    }
    state.reconciling = false;
    state.lastReport = report;
    if (state.rerun) { state.rerun = false; return reconcile("rerun"); }
    return report;
  }

  /* Enabling is the ONLY path that may ask for permission, and it asks at
     most once: after a denial the toggle still flips, the status explains,
     and Android's own Settings path is documented in the view. */
  async function setEnabled(on) {
    const settings = saveSettings({ enabled: !!on });
    if (on) {
      const p = plugin();
      const perm = await permissionState();
      if (p && perm !== "granted" && !settings.permAsked) {
        saveSettings({ permAsked: true });
        try { await p.requestPermissions(); } catch (e) { /* denied or dismissed */ }
      }
    }
    return reconcile(on ? "enable" : "disable");
  }
  async function setTime(str) { const t = parseTime(str); saveSettings({ time: pad2(t.h) + ":" + pad2(t.min) }); return reconcile("settings"); }
  async function setDiscipline(module, on) { if (!META[module]) return state.lastReport; const patch = {}; patch[module] = !!on; saveSettings(patch); return reconcile("settings"); }

  function statusText() {
    const settings = getSettings();
    const r = state.lastReport;
    if (!plugin()) return "Notifications aren't available in this build.";
    if (!settings.enabled) return "Reminders are off. Turn them on and The Forge will keep the rotation for you — on this phone only, never in chat or on a calendar.";
    if (r && r.perm === "denied") return "Android has notifications turned off for The Forge, so no reminders can fire. To allow them: Android Settings → Apps → The Forge → Notifications. Your settings here are saved and will take effect as soon as permission is granted.";
    if (r && r.perm === "unavailable") return "Notification permission couldn't be checked. Your settings are saved; reminders will reconcile next time the app opens.";
    if (r && r.status === "error") return "The last scheduling attempt hit an error (" + r.error + "). Your settings are saved; reminders reconcile again on the next app start.";
    if (r && r.perm === "granted") return "Reminders on — " + r.desired + " scheduled over the next " + WINDOW_DAYS + " days at " + settings.time + ". Completing a session cancels its reminder.";
    return "Reminders on at " + settings.time + ". Completing a session cancels its reminder.";
  }

  /* Notification taps: navigate to the module's home screen. Never start
     a workout, never mark anything complete. Duplicate deliveries of the
     same tap are ignored. */
  const lastRoute = { id: null, ts: 0 };
  function route(extra, notifId, showFn) {
    const module = extra && extra.module;
    if (!module || !META[module]) return false;
    const now = Date.now();
    if (notifId != null && lastRoute.id === notifId && now - lastRoute.ts < 5000) return false;
    lastRoute.id = notifId; lastRoute.ts = now;
    let tries = 0;
    const attempt = () => {
      const fn = showFn || (typeof show === "function" ? show : null);
      if (fn && db()) { fn(module); return true; }
      if (++tries <= 12) setTimeout(attempt, 250);
      return false;
    };
    return attempt();
  }

  /* ---------- Settings → 🔔 Reminders view ---------- */
  let rendering = false;
  window.renderReminders = function () {
    const host = document.getElementById("view-reminders");
    if (!host) return;
    const s = getSettings();
    const chk = (b) => (b ? "checked" : "");
    host.innerHTML =
      '<div style="padding:22px 18px;max-width:560px;margin:0 auto">' +
      '<div class="card" style="padding:16px"><h3>🔔 Reminders</h3>' +
      '<p class="small muted" style="line-height:1.5">' + statusText() + "</p>" +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="rmMaster" style="width:auto" ' + chk(s.enabled) + '> <span><b>Rotation reminders</b> — one per session day</span></label>' +
      '<label style="display:block;margin-top:14px">Reminder time</label>' +
      '<input type="time" id="rmTime" value="' + s.time + '">' +
      '<div style="margin-top:14px">' +
      '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="rmTrain" style="width:auto" ' + chk(s.train) + '> <span>Train — Mon &amp; Thu</span></label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" id="rmRun" style="width:auto" ' + chk(s.run) + '> <span>Run — Tue &amp; Fri</span></label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" id="rmYoga" style="width:auto" ' + chk(s.yoga) + '> <span>Yoga — Wed &amp; Sat</span></label>' +
      "</div>" +
      '<p class="small muted" style="margin-top:12px;line-height:1.5">Sunday is always off. One honest limitation: if a session finishes at the exact moment a reminder fires, Android may already have shown it — pending reminders are always cancelled, but one already on screen can\'t be pulled back.</p>' +
      "</div>" +
      '<button class="btn block" style="margin-top:14px" onclick="show(\'settings\')">‹ Settings</button>' +
      '<p class="small muted" style="margin-top:10px">The Forge · build U6-1</p>' +
      "</div>";
    const on = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener("change", fn); };
    on("rmMaster", async (e) => { await setEnabled(e.target.checked); window.renderReminders(); });
    on("rmTime", async (e) => { await setTime(e.target.value); window.renderReminders(); });
    on("rmTrain", async (e) => { await setDiscipline("train", e.target.checked); window.renderReminders(); });
    on("rmRun", async (e) => { await setDiscipline("run", e.target.checked); window.renderReminders(); });
    on("rmYoga", async (e) => { await setDiscipline("yoga", e.target.checked); window.renderReminders(); });
    if (!rendering) { rendering = true; reconcile("view").then(() => { rendering = false; const h = document.getElementById("view-reminders"); if (h && h.classList && h.classList.contains("on")) window.renderReminders(); }); }
  };

  /* ---------- wiring ---------- */
  function init() {
    const p = plugin();
    if (p && p.addListener) {
      try { p.addListener("localNotificationActionPerformed", (a) => { const n = (a && a.notification) || {}; route(n.extra, n.id); }); } catch (e) { /* listener best-effort */ }
    }
    try {
      const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (App && App.addListener) App.addListener("appStateChange", (st) => { if (st && st.isActive) reconcile("resume"); });
    } catch (e) { /* resume reconcile is best-effort */ }
    reconcile("startup");
  }
  window.ForgeNotify = {
    ROTATION, META, DEFAULTS, getSettings, saveSettings, parseTime, idFor, completedSet, computeDesired,
    permissionState, reconcile, setEnabled, setTime, setDiscipline, statusText, route,
    _test: { state },
  };
  if (!window.__FORGE_NOTIFY_MANUAL__) init();
})();

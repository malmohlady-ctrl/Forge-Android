# U6-A — Forge Local Notifications: Rotation Reminders Only (FINAL — authorized)

Authorized by Malcolm 2026-10-23 ("U6-A — Forge Local Notifications:
Rotation Reminders Only"). Part A only. NOT authorized: Part B
background-survival spike, production merge, production app identity,
release signing, changes to the web apps, anything outside this scope.

Branch `u6-notifications` from `u5-player` @ 7be70df (verified before
branch creation). Test app identity unchanged
(com.malmohlady.theforge.u0test). Cost: $0.

## Deliverable

Local Android notifications for the weekly rotation — Mon Train, Tue Run,
Wed Yoga, Thu Train, Fri Run, Sat Yoga, Sun none — at one shared editable
time (default 7:15 PM local). Settings → 🔔 Reminders: master toggle
(default OFF), time editor, per-discipline toggles (Train/Run/Yoga),
clear permission status. Permission requested only on first enable,
never re-prompted after denial; Settings explains the Android Settings
path. Denied/unavailable degrades cleanly; nothing else in Forge breaks.

Single new dependency: `@capacitor/local-notifications` (v8 line, matched
to Capacitor 8.5.3). No server, push service, account, analytics, or
tracking. Notifications are never mirrored to chat, email, or calendar.
No workout-history import/export/migration in this phase.

## Rules baked into the implementation

- One deterministic reconciler runs on startup, on settings change, on
  session completion, and on app resume. Stable IDs derive from
  discipline + local calendar date; re-running never duplicates.
- The schedule derives from the rotation, saved settings, local date and
  time, permission state, and the existing native completion records in
  `DB.imported` (discipline + date + status). No second definition of
  completion: Run partials (status "partial") never suppress.
- Completion cancels that day's pending reminder; a session completed
  before its reminder time never triggers it; opening Forge after the
  reminder time never creates a late reminder; nothing is ever scheduled
  for a past time or for Sunday.
- Master OFF cancels every pending Forge reminder; a discipline OFF
  cancels only its own. Unrelated notifications are never touched (all
  Forge reminders carry `extra.forgeReminder` and reserved IDs).
- Titles: "Train — Lace Up" / "Run — Couch to 5K" / "Yoga — Namastay
  Home". Bodies: Train "Your training session is ready. Let's get it
  done." · Run "It's time for your next run. One step at a time." ·
  Yoga "Take a little time to reset."
- Tapping a notification opens Forge on that module's home screen —
  never auto-starts a workout, never marks anything complete. Cold-start
  and already-open taps both route; duplicates are suppressed.
- Known race (documented, unavoidable): Android may display a
  notification at the very moment a session completes; pending ones are
  cancelled, an already-displayed one cannot be reliably retracted.
- Reboot persistence is a plugin feature (its manifest declares
  RECEIVE_BOOT_COMPLETED + a restore receiver; verified in the merged
  APK manifest) but is claimed only when the device battery demonstrates
  it on the Samsung.

## Tests

`tests/u6_check.js` covers the brief's 16 required tests against the
scheduler/reconciler with synthetic data and injected clocks; the full
U0–U5 chain must stay green. Device behaviour is NOT claimed from unit
tests — the Samsung battery (fire while closed, reboot survival,
completion cancels, 5× toggle dedupe, denied-permission behaviour,
Optimized vs Unrestricted fire times, reinstall, backup/restore where
safely testable) is recorded separately as PASS / FAIL / NOT TESTED.

## Stop gate

After the final report: no Part B, no production merge, no identity
change, no U7 — each needs Malcolm's separate explicit authorization.

# U2 — Run Module: Implementation Scope & Acceptance Checklist (REVISED 2026-10-22)

Status: planning only. U2 starts only on Malcolm's explicit "start U2".
Builds on: U0 foundations (closed) + U1 Train (closed, device-passed 2026-10-22).
Revision adds Malcolm's five safeguards (permission lifecycle, GPS quality,
map independence, location privacy, spike-gate reporting/approval).

## Recorded baselines (re-verified at U2 start AND end)
- `main`: dfaf3b0848949825d5777b3dfb5dcf7371e23c26
- `m1-compat`: 92e2ab9a975d75115d986fa0c98129c4c162677f
- `u0-foundations`: 5b04eee2566ffd36e7c783bba3b8c230a7d4856c
- `u1-train`: 7a8909d59faa0e3a39678ef0a9586628d3921f07  <- U2 branches from THIS commit
- New branch `u2-run` is the only branch that changes; upstream repos/websites untouched.

## Identity & budget
Same: appId `com.malmohlady.theforge.u0test`, label "Forge U0 Test" (in-place
update). $0. No new dependencies without prior approval. Synthetic data only;
automated tests use synthetic coordinates; the physical GPS test is a short walk.

## GATE 1 — the GPS spike (before any porting; report + approval to proceed)
Wire ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION into the manifest, the
WebView geolocation grant (MainActivity / WebChromeClient), and the Android
runtime-permission request. A temporary Diagnostics probe shows live
lat/lng/accuracy and a fix counter. Device evidence on Malcolm's Samsung
must cover, and the spike report must state, BEFORE the port proceeds:
- permission behaviour across the lifecycle (Safeguard 1 cases below);
- fix quality (rate, typical accuracy standing/walking);
- foreground recording (distance accumulating while walking);
- 60-second screen-lock behaviour (does the watch survive, pause, or die —
  reported as observed, with timestamps).
If GPS is wholly blocked: STOP for Malcolm's decision. If lock-screen GPS
fails: STOP — document the result and the proposed fallback, and proceed
only with his explicit approval of that fallback. No fallback is assumed
acceptable in advance.

### Safeguard 1 — permission lifecycle (device tests + required app behaviour)
- First-time grant: prompt appears on first GPS use -> Allow -> fixes stream.
- Denial: prompt -> Deny -> the run still works timer-only; the player shows
  a plain "Location off — distance won't be tracked" state with a Retry
  affordance; no crash, no prompt loop.
- Recovery after denial: Retry re-prompts or routes to Android Settings
  (if the OS requires it); once granted, tracking starts without an app
  restart and the run in progress begins accumulating from that point.
- Revocation via Android Settings (idle and mid-run): mid-run revocation
  surfaces as a "GPS lost" state; the timer/engine continue; the saved
  record keeps whatever track exists; no corruption, no lost run.
Each case's observed behaviour is recorded in the U2 report against this
expected behaviour.

## What gets built (Forge-Android, branch u2-run only)
- `unified/run.js` — the Couch to 5K engine ported from the pinned source
  (0015723): the 9-week x 3-run programme, the real-clock interval engine,
  Miles' voice (4 cue clips + TTS with the original patter, through
  ForgeAudio; speed pref in DB.runPrefs), wake lock, pause/resume/skip.
- GPS tracking with the original's rules (see Safeguard 2), live km/pace,
  downsampled track saved with the record.
- Map: Leaflet VENDORED into unified/assets/vendor/ (library files copied
  once; NO runtime JavaScript CDN dependency). Tiles load from OpenStreetMap
  online as in the original; the original's canvas fallback covers offline.
- Completion semantics preserved EXACTLY (read from the source, written into
  the tests): a run saves on finish as "completed" only when no step was
  skipped AND elapsed >= 90% of the planned total; otherwise "partial".
  Partials are saved, shown honestly, and do NOT advance the programme or
  count as Done. (The 85% rule in the adapters is legacy-inference only and
  stays that way.) One save per finish; the sessionFinished guard applies.
- Native record in DB.imported (discipline "run", week/run, status,
  durationSec, km, paceSec, downsampled track); adapters merge it as
  Couch to 5K (source "couch") so the hub, programme progress, and Progress
  count it natively. Programme position derives from native + imported
  records with the partial rule applied.
- Run view replaces the stub: next-run card, the week grid, the player
  (phase, clock, live km/pace, map, GPS state line), voice settings.
  Back mid-run is a no-op. No Music tab (U5). Diagnostics keeps the GPS probe.

### Safeguard 2 — GPS quality rules: verify against source, preserve, test
Before porting, the original's exact fix-handling rules are read from the
pinned source and written into the test file as the spec (confirmed so far:
watchPosition, enableHighAccuracy, maximumAge 2000 ms, fixes with accuracy
worse than 40 m discarded, track downsampled before saving). Automated tests
then feed SYNTHETIC fix streams through the ported logic:
- poor-accuracy fixes (>40 m) are dropped exactly as the original drops them;
- missing fixes (a gap in the stream) credit no phantom distance;
- duplicate timestamps do not double-count distance;
- implausible jumps (a teleporting fix) are handled EXACTLY as the original
  handles them — if the original has no jump rule, that absence is documented
  in the U2 report and any proposed filter is a separate decision for
  Malcolm, never silently added.

### Safeguard 3 — the run never depends on the map
Recording, distance calculation, and saving are independent of Leaflet and
of tile availability, by construction (GPS engine has no map dependency)
and by test:
- automated: a run simulated with Leaflet absent and tile loading failing
  still accumulates distance and saves a complete record;
- device: an airplane-mode run (no tiles) completes via the canvas fallback
  and saves with km/track intact;
- a map failure shows "Map unavailable" in the player — it can never
  silently corrupt or discard a run.

### Safeguard 4 — location privacy
GPS coordinates and route history stay ON-DEVICE (the app's own local
store). No location data is uploaded anywhere; no analytics, tracking
services, paid services, or new dependencies. The only network the Run
module touches is OpenStreetMap tile images, as in the original (tile
requests inherently reveal the viewed area to OSM — stated openly; the
canvas fallback works without them).

## Explicitly NOT in U2
Yoga engine, Spotify, notifications, signing, real-data import, background
GPS service promises, any change to the standalone Couch app (the port
preserves its behaviour, never patches it).

## Acceptance checklist (evidence at the U2 stop)
1. Baselines re-verified unchanged (the four SHAs above); changes confined to u2-run.
2. GATE 1 spike report delivered and approved before the port (permission
   lifecycle, fix quality, foreground recording, 60-s lock — as observed).
3. Automated tests green locally + in CI: programme invariants, completion
   rule, GPS quality (Safeguard 2), map-independence (Safeguard 3), clip
   integrity + ffmpeg decode (4 clips), native counting; u0 + u1 suites green.
4. End-to-end device test: Home -> Run -> start -> short walk (km/pace sane
   vs the map) -> pause/resume -> lock 60 s -> return -> finish -> Progress
   shows it immediately; a skip-ended run saves as partial and does NOT
   advance the programme; airplane-mode run saves intact (Safeguard 3).
5. APK identity re-verified from the binary; in-place update of Forge U0 Test.
6. Cost $0; dependency delta: none (Leaflet vendored as static files).

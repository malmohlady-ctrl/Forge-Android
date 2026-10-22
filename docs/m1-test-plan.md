# M1 Device Checklist — Forge M1 Test (Samsung)

App under test: **Forge M1 Test** (installs beside The Forge; its data is separate and disposable).
Data rule: synthetic only. Never sign into Spotify, never import a real backup in this app.
Evidence: screenshot anything that fails, plus the probe dumps where noted. Note the time of any failure.

## Install
- [ ] Install the APK (My Files → Downloads → tap → Allow from this source → Install).
- [ ] App drawer shows **Forge M1 Test** with the flame icon, beside the M0 **The Forge**.
- [ ] Open it: The Forge hub loads. A gold **M1 PROBE** button sits bottom-right (test harness only).

## LS — localStorage (probe page: tap M1 PROBE)
- [ ] LS-1: Probe shows `location.origin`. Screenshot it. Record the value: ______
- [ ] LS-1: Tap **Write probe key**, then **Jump: Lace Up** (real app), open back to the hub and tap M1 PROBE → **Dump ALL keys**. The `m1probe` value is still there, alongside `basementbelt.v1`-family keys if Lace Up wrote any.
- [ ] LS-2: After visiting all three apps once, Dump shows keys from all four families (`fithq.db.v1`, `first5k.v1`, `basementbelt.v1`, `namastayhome.v1` + prefs/appmusic keys). Count: ______
- [ ] LS-4: Force-stop the app (Settings → Apps → Forge M1 Test → Force stop), relaunch, Dump again — probe value and keys intact. Then restart the phone, relaunch, Dump — still intact.

## NAV — navigation
- [ ] NAV-1: From the hub, open each app via the hub's Workouts triangle, and return with the Android **Back** button. Five round trips, no white screens or 404s.
- [ ] NAV-3: In each app, use the probe-equivalent reload (close from Recents, relaunch) — app re-enters at the hub; navigate again into each app; state (any test sessions) still present.

## AUD — audio
- [ ] AUD-1 (Lace Up): Start the session. Coach speaks the first cues. Pause it, note the clock.
- [ ] AUD-1 (Namastay): Start a routine. Guide voice + chime audible.
- [ ] AUD-1 (Couch): Open a run screen; start; the start cue plays (full run NOT required).
- [ ] AUD-2: In a Lace Up session, lock the phone for 60 seconds. Unlock, return: the session clock is correct (not frozen at lock time) and audio resumes.
- [ ] AUD-3: Mid-session, press Home, use another app ~2 minutes, return. Record what happened to the timer/audio (caught up / paused / other): ______
- [ ] AUD-4 (optional): Mid-session, play music in another app — note any conflict or crash: ______

## ADP — adapters (use REAL app flows, not the probe)
- [ ] ADP-1 (Lace Up): Complete the full Lace Up session if willing — or start it, let it run a few minutes, and use Skip to reach the end so it saves. Return to the hub (Back). The session appears in The Forge (Workouts centre / Progress) **without restarting the app**.
- [ ] ADP-1 (Namastay): Complete any short routine; back to hub; it appears.
- [ ] ADP-2 (Couch): Start a run, end it early (partial). Back at the hub it is marked partial, not complete.

## OFF — offline
- [ ] OFF-3: Turn on **airplane mode**. Cold-open Forge M1 Test (force-stop first). Hub renders; open all three apps; start a Lace Up session — coach audio plays offline; log nothing real.
- [ ] OFF-3 (Couch map): Open a run screen in airplane mode. Note what the map area shows (blank / fallback / error text): ______
- [ ] OFF-4: Probe → **List service worker registrations**. Screenshot the result (scopes/states).

## Cleanup (after results are sent)
- [ ] Uninstall **Forge M1 Test** (its test data dies with it). The M0 **The Forge** app is untouched.

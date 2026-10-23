# U1 — Train Module: Implementation Scope & Acceptance Checklist (REVISED 2026-10-22)

Status: planning only. U1 starts only on Malcolm's explicit "start U1".
Builds on: U0 foundations (closed, device-passed 2026-10-22).
Revision adds Malcolm's five safeguards (baseline pinning, engine-semantics
tests, audio validation, end-to-end device test, duration validation).

## Recorded baselines (verified 2026-10-22 at U0 close; re-verified at U1 start AND end)
- `main`: dfaf3b0848949825d5777b3dfb5dcf7371e23c26
- `m1-compat`: 92e2ab9a975d75115d986fa0c98129c4c162677f
- `u0-foundations`: 5b04eee2566ffd36e7c783bba3b8c230a7d4856c  <- U1 branches from THIS commit
- `u1-train` is the only branch that changes. The four upstream repos/websites stay untouched.

## Identity & budget
Same test identity: appId `com.malmohlady.theforge.u0test`, label "Forge U0 Test"
(in-place update of his U0 install). Production ID reserved. $0 budget. No new
dependencies without Malcolm's prior approval. Synthetic data only; no real-data import.

## What gets built (Forge-Android, branch u1-train only)
- `unified/train.js` — the Lace Up engine ported from the pinned Home-Corner source
  (1551716): buildLaceUp() session (29-exercise circuit 45/15 -> transition ->
  3 called-combo boxing rounds -> 6-exercise core finisher), the real-clock step
  engine, pause/resume/skip, wake lock, end-session confirm.
- `unified/assets/coach/` — all 67 cornerman clips from the pinned source. Every cue
  plays through the U0 audio core (ForgeAudio); TTS fallback for clipless steps;
  speed control drives clip playbackRate, as in the original.
- Train view replaces the U0 stub: the single session card (Lift / Box / Core) + the
  full player screen. No Music tab (Spotify is U5), no separate Progress tab.
- Native completion record in the unified store (discipline "train", program
  "laceup", elapsed-based duration, date, timestamp, status), surfacing in hub
  stats, Workouts centre, and Progress via the native path.
- Back rule completed: hardware Back during an active session is a no-op.
- Train prefs (voice on/off, speed) in the unified store.
- `.github/workflows/unified.yml` — add `u1-train` to the branch triggers.
- `docs/u1-scope.md` — this document, committed with the phase.

## Safeguard 2 — engine semantics verified against the original, then tested
Before porting, the original's exact rules are read from its source and written
into the test file as the spec: how computeElapsed() treats paused time, what an
early termination saves, and when the save fires. Automated tests then cover:
- pause/resume: elapsed excludes (or includes) paused time EXACTLY as the original;
- skip: advances the step, elapsed behaviour matches the original;
- end early: exactly one record, elapsed-based, matching the original's semantics;
- duplicate-save prevention: finish fired twice, double-tap, and interruption
  during the save path each yield exactly ONE record (save is idempotent per session).

## Safeguard 3 — audio validation (67 clips)
Automated: every clip referenced by the cue map exists in unified/assets/coach/;
every file is non-empty with a valid MP3 frame header; full decode pass with
ffmpeg/ffprobe IF the tooling is present in the environment (no new dependencies
installed for this — if unavailable, that fact is reported and decode assurance
comes from the device pass instead). Device: clips sampled across all three
segments play through the audio core; TTS fallback demonstrated on a clipless
step; playback-speed control verified audibly. Any check that cannot be
automated is listed as such in the U1 report.

## Safeguard 5 — duration/step-count validation (source wins)
The claimed 105 steps / ~46.4 min are recomputed from the source builder and
its timing rules in an automated test. If the source produces a different
figure, the discrepancy is documented in the U1 report and the SOURCE's real
behaviour is preserved — the workout is never tuned to match a number.

## Explicitly NOT in U1
Run and Yoga engines, Spotify, GPS, notifications, signing, real-data import,
the standalone's unused full-length modules, any change to The Forge's built-in
player or nutrition.

## Acceptance checklist (evidence at the U1 stop)
1. Baselines re-verified unchanged (the three SHAs above); all changes confined to u1-train.
2. APK identity re-verified from the binary (.u0test, debug cert); in-place update of Forge U0 Test.
3. Automated tests green locally + in CI: builder invariants, clip integrity (Safeguard 3),
   engine semantics incl. pause/skip/early-end/duplicate-save (Safeguard 2),
   step/duration recomputation (Safeguard 5), native hub counting.
4. Safeguard 4 — end-to-end device test, in this order: Home -> Train -> start ->
   pause -> resume -> screen lock 60 s -> return -> finish -> Progress shows the
   record immediately, no restart. Plus: hardware Back mid-session is a no-op;
   force-stop mid-session and reopen — no duplicate or corrupted record appears.
5. Device audio pass (Safeguard 3): voice throughout a session, TTS fallback,
   speed control, 2-min background behaviour documented honestly (deep survival
   remains U6's spike; no claims made here).
6. Cost $0; dependency delta: none (any exception reported BEFORE use, for approval).

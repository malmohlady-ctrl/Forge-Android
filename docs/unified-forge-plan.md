# The Unified Forge — Design & Build Plan (DRAFT for Malcolm's review)

Status: planning only. Nothing in this document authorizes a build. Each phase below
starts only on Malcolm's explicit approval of the previous phase's evidence.
Supersedes: the M2 bundle-promotion milestone (rejected by Malcolm 2026-10-21 after
M1 device session 1). Evidence base: M1 findings F1–F4 (docs/m1-results.md).

## 1. The product

One app: **The Forge**, app ID `com.malmohlady.theforge`. The hex hub is home.
Run, Train (Lace Up), and Yoga stop being separate apps and become modules inside
The Forge — one navigation, one data engine, one audio core, one Spotify
connection, one Back rule. Nutrition, Plan, Body, Progress, and Settings are
already Forge-native and stay. The four websites remain live and untouched as the
web edition throughout; nothing in this plan modifies them.

What "cohesive" means concretely:
- The Workouts triangle stops launching other apps; it routes inside The Forge.
- A completion in any module is a Forge record the moment it happens — no
  adapters reading foreign stores; Progress, Up Next, and the hub read one data
  engine.
- The agreed weekly rotation (Mon Train, Tue Run, Wed Yoga, Thu Train, Fri Run,
  Sat Yoga, Sun off) drives Up Next natively.

## 2. What carries over vs what gets rebuilt

Carries over (ported, not reinvented):
- The three engines' logic: C25K plan + interval engine + GPS track recording;
  the Lace Up session builder (29-exercise circuit -> 3 boxing rounds -> 6-move
  core, ~45 min); Namastay's three routine definitions + pose/breath timing.
- Every coach asset: 4 Miles clips, 67 cornerman clips, 57 guide clips, and each
  app's artwork. Each discipline KEEPS its own voice (standing rule) — the audio
  plumbing is shared, the voices are not.
- The Forge's existing UI, nutrition system, progress views, and data.

Rebuilt:
- Navigation: single in-app routing + an explicit Android Back rule (fixes F3).
- Audio core: one persistent, gesture-unlocked player for clips + Web Audio for
  chimes, and the WebView media setting relaxed natively (fixes F2's whole class).
- Spotify: one connection with an in-app auth return (fixes F4).
- Data layer: one store; the legacy stores enter only through a verified
  importer (Section 4).
- Android shell behaviour: no service workers inside the app (offline is native —
  bundled assets); the web build keeps its service worker.

## 3. Architecture decisions (recommendations marked; Malcolm decides)

- **D1 — Codebase.** (A) Evolve The Forge's codebase into the unified app, shipped
  to BOTH the web (the FIT-HQ site becomes the unified app) and Android.
  (B) Android-only fork; the web stays as four sites forever.
  **Recommend (A):** one codebase, one maintenance burden, web and phone never
  drift. Cost of (A): the live Forge site changes shape (modules come home);
  mitigated by phased rollout and Malcolm's design sign-off at each step.
- **D2 — Data.** Single Forge store extended with native run/train/yoga records,
  plus a permanent "Import legacy backup" tool in Settings.
  **Recommend: yes.** The alternative (three internal stores forever) keeps the
  adapter patchwork that made the bundle feel bolted together.
- **D3 — Phase order.** Train first (it carries the F2 audio finding and the
  largest engine), then Run, then Yoga. Alternative: Run first.
- **D4 — Notifications.** The rotation as opt-in local notifications (off by
  default), built late (U6) behind a device test battery; described as
  "scheduled" until proven on the Samsung.
- **D5 — M1 test app.** Keep or uninstall — no bearing on this plan.

## 4. Data safety (unchanged standing rules)

- The PWAs and their data are never touched by the build.
- Until U4, all testing uses synthetic data only.
- U4 imports Malcolm's real data ONLY from his own export file, with the full
  ceremony: pre-import backup of the app's store, counts shown before and after,
  dedupe by stable record IDs (never timestamp matching), and a proven
  double-import = zero-new / zero-lost run on synthetic data first.

## 5. Phases (each ends with a device APK + evidence; next phase needs approval)

- **U0 — Foundations.** Unified shell on the production app ID: in-app routing +
  Back rule (Back = previous view; at Home = exit; during a session = no-op),
  the new audio core, the extended data layer + importer proven on synthetic
  legacy exports. Acceptance: shell APK; importer round-trip counts exact.
- **U1 — Train module.** Lace Up ported in full; cornerman voice through the new
  audio core. Acceptance: complete ~45-min session on device; F2 retest passes
  (voice incl. 60-s lock test); completion appears in Progress natively.
- **U2 — Run module.** C25K + Miles + GPS. WebView geolocation permission wiring
  is a named work item; v1 target is foreground tracking (as the PWA does today).
  Acceptance: a real outdoor run recorded with track/distance/pace; the 85%
  partial rule intact.
- **U3 — Yoga module.** Namastay's routines + guide voice + 432 Hz chime.
  Acceptance: all three routines play end-to-end; completions native.
- **U4 — Cohesion + real data.** Hub/Progress/Plan fully native (adapters
  retired inside the app); rotation-driven Up Next; design unification review
  with Malcolm (visual previews, as usual); then the real-data import ceremony.
- **U5 — Spotify.** One registration (free, Malcolm's account) with a custom
  scheme return (com.malmohlady.theforge://spotify-callback); the three existing
  playlists selectable per module. Acceptance: connect once, control playback
  from each module, reconnect silently thereafter.
- **U6 — Notifications + background spike.** Rotation reminders (opt-in) and the
  session background-survival work (foreground-service spike), each behind its
  device test battery (fires with app closed, completion cancels, reboot,
  reschedule dedupe, permission denied, Samsung battery settings). No delivery
  claims before the battery passes on the Samsung.
- **U7 — Release readiness.** Export -> wipe -> restore drill with identical
  counts; signed release pipeline (keystore + secrets enter ONLY here, on a
  separate approval); distribution decision (direct APK vs Play internal track).

## 6. Costs and unknowns

- **$0 throughout** — same toolchain, same free Actions builds. The only new
  account item is the free Spotify app registration in U5 (Malcolm's own action,
  guided).
- Honest unknowns: Android WebView GPS permission plumbing (U2 work item);
  background session survival (unproven until U6); Spotify deep-link auth on
  Samsung (standard pattern, device-verified in U5); total scope — this is a
  phased project measured in weeks of build sessions, not one sitting.

## 7. Decisions needed from Malcolm

1. D1: evolve The Forge (web + Android, one app) or Android-only fork?
2. D2: single store + legacy importer — approve?
3. D3: Train first, or Run first?
4. D4: notifications in scope at U6 (opt-in), or dropped entirely?
5. Approve this plan as the roadmap (phases still gated individually)?

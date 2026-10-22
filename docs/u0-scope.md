# U0 — Implementation Scope & Acceptance Checklist (REVISED 2026-10-22)

Revision: at Malcolm's direction, U0 uses the TEMPORARY app ID
`com.malmohlady.theforge.u0test` (label "Forge U0 Test") so the U0 APK installs
ALONGSIDE the M0 app. The production app ID `com.malmohlady.theforge` stays
reserved for a later, separately approved build. Nothing else changed from the
original scope. Status: awaiting Malcolm's explicit "start U0".

## Branches
- `main` — frozen M0 baseline. Zero changes in U0; remote HEAD verified unchanged at phase end.
- `m1-compat` — M1 evidence record. Zero changes.
- `u0-foundations` — new branch off `main`. All U0 work lands here.
- Four upstream repos: read-only. Chassis = one-time snapshot copy of FIT-HQ @ 201aec2.

## Identity (branch only)
- capacitor.config.json (on u0-foundations): appId `com.malmohlady.theforge.u0test`, appName "Forge U0 Test".
- android/app/build.gradle: applicationId `com.malmohlady.theforge.u0test`.
- android/app/src/main/res/values/strings.xml: label "Forge U0 Test".
- Production identity on `main` untouched. Different applicationId = a different
  Android app: separate install, separate storage container; M0 remains installed
  and functional throughout; U0 data can never read or overwrite M0's. When a
  production build is later approved, the u0test app is uninstalled and its
  synthetic data discarded; the importer/exporter is the only data bridge, by design.

## Files that change (Forge-Android, u0-foundations only)
- New `unified/` — app source from the FIT-HQ snapshot; sw.js + PWA manifest excluded from the app build.
- New `unified/audio-core.js` — shared clip player (one persistent element, gesture-unlocked) + diagnostics hooks.
- New data-layer additions — extended single store (native run/train/yoga record types).
- New `unified/importer.js` — legacy importer (three stores' record shapes), pre-import backup, count report, stable-ID dedupe.
- New `scripts/build-unified.mjs` — assembles www/ from unified/.
- New `.github/workflows/unified.yml` — builds only from u0-foundations; artifact `forge-unified-u0-apk`.
- New `tests/` — importer fixture tests (synthetic), data-layer tests.
- New `docs/u0-scope.md` — this document.
- Changed `package.json`/`package-lock.json` — one new dependency: `@capacitor/app` (official, free) for Back wiring.
- Changed `android/.../MainActivity.java` — WebView media setting (F2 fix) only.

## Explicitly NOT in U0
Train/Run/Yoga modules (labelled route stubs only), Spotify, GPS, notifications,
signing/keystore, real-data import, any website change.

## Acceptance checklist (evidence at the U0 stop)
1. `main` + `m1-compat` HEADs unchanged; all changes confined to `u0-foundations`.
2. APK (appId .u0test, label "Forge U0 Test") installs BESIDE M0; both apps in the drawer; M0 still opens to its shell, unchanged, after U0 testing.
3. All hub/workout navigation routes internally — no external page loads.
4. Back rule on device: sub-view -> previous view; Home -> exit.
5. Audio core retest (F2 pattern): diagnostics plays a cornerman clip, a Miles clip, and the chime — incl. after a 60-s screen lock.
6. Importer, synthetic fixtures: exact counts before/after; second import adds 0; corrupted fixture rejected, store undamaged; pre-import backup produced; restore returns identical counts.
7. Zero service-worker registrations in-app (diagnostics proof).
8. Cost $0; dependency delta = @capacitor/app only; failures listed as-is.

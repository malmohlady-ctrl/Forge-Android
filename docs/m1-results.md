# M1 Results Log

## Finding F1 — NAV-1 FAIL on harness build 1 (run 39724388404), root cause found, harness corrected

- **Observed (device, Malcolm):** tapping any app icon in The Forge's Workouts tab opened a completely empty page.
- **Root cause (verified in Capacitor 8.5.3 source, WebViewLocalServer.java):** any request whose last path segment has no "." is routed to the bundle ROOT index.html when html5mode is on (the default). The hub's `../Couch-to-5k/` links therefore served The Forge's HTML at the app-folder URL; Forge's own relative JS assets then resolved under the folder and 404'd, leaving its empty JS-rendered skeleton. Not an upstream app defect; the same links are correct on the web.
- **Correction (harness only):** the sync script rewrites the COPIED Forge JS links `../<App>/` -> `../<App>/index.html` (explicit file = served directly). Probe page links updated the same way. Upstream sources untouched; NAV acceptance criteria unchanged.
- **M2 note (for the M2 report, not decided here):** the production bundle needs the same link handling, or an equivalent (e.g. html5mode off — untested trade-offs).
- **Status:** corrected build pending device retest of NAV-1 before the remaining checklist continues.

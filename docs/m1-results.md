# M1 Results Log

## Finding F1 — NAV-1 FAIL on harness build 1 (run 39724388404), root cause found, harness corrected

- **Observed (device, Malcolm):** tapping any app icon in The Forge's Workouts tab opened a completely empty page.
- **Root cause (verified in Capacitor 8.5.3 source, WebViewLocalServer.java):** any request whose last path segment has no "." is routed to the bundle ROOT index.html when html5mode is on (the default). The hub's `../Couch-to-5k/` links therefore served The Forge's HTML at the app-folder URL; Forge's own relative JS assets then resolved under the folder and 404'd, leaving its empty JS-rendered skeleton. Not an upstream app defect; the same links are correct on the web.
- **Correction (harness only):** the sync script rewrites the COPIED Forge JS links `../<App>/` -> `../<App>/index.html` (explicit file = served directly). Probe page links updated the same way. Upstream sources untouched; NAV acceptance criteria unchanged.
- **M2 note (for the M2 report, not decided here):** the production bundle needs the same link handling, or an equivalent (e.g. html5mode off — untested trade-offs).
- **Status:** corrected build pending device retest of NAV-1 before the remaining checklist continues.

## Device session 1 (Malcolm, 2026-10-21) — findings F2–F4 + direction decision

- **F2 — AUD-1 FAIL (Lace Up coach voice silent).** Mechanism identified from pinned source: Lace Up's playClip() creates a fresh `new Audio(f)` element per cue and plays it programmatically from the timer engine; Android WebView's default media policy (playback requires a user gesture) rejects exactly that pattern. Namastay/Couch route audio differently (Web Audio present in both). Candidate remedies (for the unified build, not patched here): one persistent audio element unlocked by the first tap, and/or the WebView mediaPlaybackRequiresUserGesture=false setting.
- **F3 — NAV FAIL (no way back).** Once inside any standalone app, Android Back does not return to the hub. Capacitor 8 core ships no automatic WebView-history back handling in what we bundle; back behaviour must be wired deliberately (App plugin backButton listener -> history.back(), or in-app navigation). The web original relies on browser chrome, which the app doesn't have.
- **F4 — Spotify does not work in any bundled app (observe-only item, result: fail).** As anticipated in the M1 plan: the PKCE redirect URIs registered with Spotify are the live github.io URLs; the auth return cannot land inside the app origin (https://localhost). A unified app needs a designed in-app auth flow (deep link / custom scheme).
- **Direction decision (Malcolm, 2026-10-21):** the four-apps-in-one-container bundle is REJECTED as the product. He wants ONE cohesive app — everything under one roof in The Forge, interconnected, navigated as a single app. M2 (bundle promotion) is therefore superseded and will not be proposed. M1 closes with the bundle mechanically viable (post-F1) but product-rejected; F1–F4 become design requirements for the unified app.

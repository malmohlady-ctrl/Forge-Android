# U5 Phase A — Spotify authentication spike

Branch: `u5-spike`, based on the ceremony-accepted U4 build `20210f4e`
(the dtImp-fix build; `2d71bad5` named in the authorization was the pre-fix
U4 build head — the fix build superseded it as the accepted baseline during
the ceremony, so the spike stands on the corrected code).

## Research (verified 2026-10-22 against Spotify's live docs + reporting)

1. **Flow**: Authorization Code with **PKCE** is Spotify's current documented
   flow for apps like this one (S256 challenge, `accounts.spotify.com/authorize`
   + `/api/token`, `state` strongly recommended). No client secret exists in
   this flow. Sources: developer.spotify.com PKCE + code-flow guides.
2. **Redirect URIs — THE open question.** Spotify's current Redirect URIs page
   requires **HTTPS** (or loopback-IP HTTP) and gives no custom-scheme example
   or allowance. Custom schemes (`com.malmohlady.theforge://spotify-callback`)
   were historically standard for mobile, but Spotify tightened the rules
   (2025–2026) and the dashboard may REJECT the scheme for a newly created app.
   The spike's first device-side step is therefore the decisive experiment:
   try to register the exact prescribed callback; the result — accepted or
   rejected — is a primary spike finding either way. The POC takes the
   redirect URI as configuration, so if Spotify forces an HTTPS redirect the
   same build can test the fallback without code changes.
3. **Development mode (Feb 2026 rules, multiple sources incl. TechCrunch)**:
   the app OWNER must hold **Premium** (dev-mode apps stop working if it
   lapses); max **5 allowlisted users** (the owner must add their own account
   under the app's Users and Access, or calls return 403); **one** dev-mode
   client ID per developer for NEW creations — Malcolm already holds three
   (the web apps'), which are grandfathered, but a fourth creation may be
   refused. If refused: stop and report (modifying an existing app's config is
   outside the spike safeguards). Extended quota is organizations-only
   (250k MAU) — not applicable and not needed for a personal app.
4. **Playback control reality**: Web API player endpoints
   (`user-modify-playback-state` etc.) were NOT in the Feb 2026 removed-endpoint
   lists (those hit metadata endpoints). Playback control additionally requires
   the ACCOUNT to be Premium and an active Spotify device to exist — Premium
   does not by itself guarantee a device is reachable. Scopes for the planned
   experience mirror the web apps' proven set: `user-read-playback-state`,
   `user-modify-playback-state`, `user-read-currently-playing`. Selecting among
   three FIXED playlist IDs needs no extra scope; browsing private playlist
   contents would need `playlist-read-private` (Phase B decision).
5. **Reconnection**: the web apps prove the pattern (refresh_token grant,
   silent). NEW platform limit: **refresh tokens live 6 months** from the
   user's original authorization (new apps since Jun 2026; existing apps since
   Jul 2026). Design: store refresh token on-device, refresh silently on
   expiry; after ~6 months the user re-authorizes once. No silent-reconnection
   claim is made until the device test exercises the refresh button.

## POC design (this branch)

- `unified/spotify-spike.js`: isolated module + Diagnostics-reached view.
  Client ID + redirect URI are runtime config (entered on-device, stored in
  the spike's own localStorage keys) — NO client ID is committed to source,
  and there is no secret anywhere in the flow. Tokens in
  `spotify.spike.tokens` (localStorage), never in the Forge DB, never logged,
  never displayed. State-verified callbacks; `access_denied` handled as a
  first-class result.
- Manifest: VIEW/BROWSABLE intent filter, scheme `com.malmohlady.theforge`,
  host `spotify-callback`. NOTE: the scheme intentionally uses the PRODUCTION
  appId string (per the authorization) while the test package is `.u0test`, so
  one Spotify registration serves both; at production the same filter ships in
  the production build. Never have two builds claiming the scheme installed at
  once (Android would offer a chooser).
- Auth launch uses `window.open(url, "_system")` (no new dependency). If the
  Samsung opens it in-WebView instead of the system browser, that is a spike
  finding; the Phase B fix would be the @capacitor/browser plugin, which needs
  Malcolm's dependency approval.

## Malcolm's dashboard setup (his hands only)

1. developer.spotify.com/dashboard → Create app (name e.g. "The Forge",
   description free text, website optional).
2. Redirect URIs: add EXACTLY `com.malmohlady.theforge://spotify-callback` →
   note whether the dashboard accepts it (screenshot any refusal verbatim).
3. Users and Access: add your own Spotify account (name + the email on the
   account) — required under the 5-user dev-mode allowlist.
4. Copy the app's **Client ID** (an identifier, safe to share — it is NOT the
   secret; never open the secret, the spike has no use for it).
5. In the spike APK: Diagnostics → "Open the Spotify auth spike" → paste the
   Client ID → Save configuration.

## Device test script (in order)

1. Connect → expect the system browser to open Spotify's login/consent page
   listing the three scopes → approve → browser hands back to the app → log
   shows "code exchanged — tokens stored". Then **Test API call** → expect
   "/me OK — account … · product: premium".
2. Cancel path: Disconnect → Connect again → on Spotify's page choose
   Cancel/deny → expect the callback logged as access_denied, cleanly, no
   crash, no tokens.
3. Silent reconnection: after a successful connect, tap **Test silent
   refresh** → expect a new access token with NO login UI. (Full cold-start
   proof: force-stop the app, reopen, Test API — the stored access may have
   expired only after 1 h; the refresh button is the on-demand proof.)
4. Failure path: with Wi-Fi off, Connect → expect a logged failure, app
   intact, retry works when back online.

## Stop rule

Report after the spike; Phase B (the unified player) starts only on
Malcolm's explicit authorization after reviewing the spike report.

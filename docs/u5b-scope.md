# U5 Phase B — the unified Spotify player (scope)

Authorized by Malcolm 2026-10-22 ("move to the next step" after the Phase A
report). Branch `u5-player` off `u5-spike` @ abdc64f (the device-proven auth).

## What gets built

1. **`unified/music.js` — `window.ForgeMusic`**, one shared service:
   - Auth = the Phase A implementation, productized (same PKCE, same
     `window.open(_system)` launch, same state-verified deep-link callback,
     same scopes as the proven web player: `user-read-playback-state`,
     `user-modify-playback-state`, `user-read-currently-playing`).
   - Storage: `spotify.music.cfg` / `spotify.music.tokens`; on first init,
     a one-time copy migrates the spike's `spotify.spike.*` values (his Forge
     client ID + the tokens from the spike session) so nothing is re-entered.
     Disconnect clears both namespaces.
   - Player core = a faithful port of the web `player.js` behaviour: playlist
     track list (limit 100, fields-filtered), playback-state polling (5 s,
     visible only) + 1 s progress tick, play (context + offset / resume),
     pause, next, previous, seek, shuffle, repeat (context→track→off),
     volume (self-disables on 403/404 like the original), device selection
     (active → smartphone → first) with the original's "open the Spotify app
     once" guidance on no-device/404.
2. **Per-module cards** on each module's home screen (Train / Run / Yoga),
   same card UI, each bound to its module's playlist — extracted verbatim
   from the web apps' configs:
   - Train (Lace Up): `2oOPWpO9fqJUGhjunEAj6h`
   - Run (Couch to 5K): `3ETB46pxe9p8uaCgji0xbY`
   - Yoga (Namastay): `1jltX5L6gM6SKfYAuE2sLx`
   Switching modules rebinds the card's playlist context; playback state is
   shared (it's the same Spotify account/device).
3. **Settings → "🎧 Spotify" view** (replaces the spike screen and its
   Settings button): connection status, client ID / redirect config (carried
   from the spike), Connect / Disconnect, the three module playlists listed.
   The spike file `spotify-spike.js` is deleted; the manifest deep link stays.
4. Tests: the spike's auth tests re-pointed at music.js, plus playlist
   mapping, request construction for every control, token migration, and
   hygiene (no secret, no token logging). All prior suites stay green.

## Known limits (stated up front)

- **v1 mounts cards on module home screens, not inside live sessions.**
  Mid-session, Spotify's own notification/lock-screen controls are the
  surface (playback itself is in the Spotify app and continues with the
  screen off). In-session mounts are a possible fast follow, not Phase B v1.
- Track lists load with the web-proven scopes (the playlists loaded fine in
  the web apps). If a playlist proves private under the new app, the fix is
  one added scope (`playlist-read-private`) + one re-connect — noted, not
  pre-emptively added.
- Playback control requires an active Spotify device: open the Spotify app
  once if the card says no device found (the original's behaviour, kept).
- Client IDs of the three web apps are NOT used; the unified app runs solely
  on Malcolm's new "The Forge" Spotify registration from Phase A.

## Stop rule

Deliver the test APK + a per-module playback checklist, then stop for his
device results. U6 is not started.

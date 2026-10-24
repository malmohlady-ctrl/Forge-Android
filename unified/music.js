"use strict";
/* Unified Forge — U5 Phase B: ForgeMusic, the unified Spotify player.
   ONE service for the whole app: the Phase A-proven PKCE auth (external
   browser + state-verified deep-link callback) and a faithful port of the
   web apps' remote-control player (playback happens in the Spotify app via
   the Web API — no SDK, no in-app streaming). Each module's home screen
   mounts the same card bound to that module's playlist:
     Train 2oOPWpO9fqJUGhjunEAj6h · Run 3ETB46pxe9p8uaCgji0xbY ·
     Yoga 1jltX5L6gM6SKfYAuE2sLx   (extracted from the web apps' configs)
   Storage: spotify.music.cfg / spotify.music.tokens (localStorage), with a
   one-time migration from the Phase A spike's spotify.spike.* keys.
   Tokens are never logged, displayed, or written to the Forge DB; PKCE has
   no client secret. */
(function () {
  const API = "https://api.spotify.com/v1";
  const AUTH_URL = "https://accounts.spotify.com/authorize";
  const TOKEN_URL = "https://accounts.spotify.com/api/token";
  const DEFAULT_REDIRECT = "com.malmohlady.theforge://spotify-callback";
  const SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative";
  const PLAYLISTS = {
    train: { id: "2oOPWpO9fqJUGhjunEAj6h", label: "Train — Lace Up" },
    run: { id: "3ETB46pxe9p8uaCgji0xbY", label: "Run — Couch to 5K" },
    yoga: { id: "1jltX5L6gM6SKfYAuE2sLx", label: "Yoga — Namastay Home" },
  };
  const CFG_KEY = "spotify.music.cfg", TOK_KEY = "spotify.music.tokens", PKCE_KEY = "spotify.music.pkce";
  const SPIKE_CFG = "spotify.spike.cfg", SPIKE_TOK = "spotify.spike.tokens";

  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    getRaw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setRaw(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  function migrate() {
    if (!store.getRaw(CFG_KEY) && store.getRaw(SPIKE_CFG)) store.setRaw(CFG_KEY, store.getRaw(SPIKE_CFG));
    if (!store.getRaw(TOK_KEY) && store.getRaw(SPIKE_TOK)) store.setRaw(TOK_KEY, store.getRaw(SPIKE_TOK));
  }
  const cfg = () => Object.assign({ clientId: "", redirectUri: DEFAULT_REDIRECT }, store.get(CFG_KEY) || {});
  const tokens = () => store.get(TOK_KEY);

  /* ---------- PKCE (Phase A, verbatim behaviour) ---------- */
  function b64url(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function randomStr(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"[b % 66]).join(""); }
  async function sha256b64url(text) { const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return b64url(new Uint8Array(buf)); }
  function buildAuthorizeUrl(c, challenge, state) {
    return AUTH_URL + "?" + new URLSearchParams({ response_type: "code", client_id: c.clientId, scope: SCOPES, code_challenge_method: "S256", code_challenge: challenge, redirect_uri: c.redirectUri, state }).toString();
  }
  function parseCallback(url, redirectUri) {
    if (!url || !redirectUri || !url.startsWith(redirectUri)) return { kind: "ignore" };
    let q = {};
    try { q = Object.fromEntries(new URL(url).searchParams.entries()); }
    catch (e) { const m = /[?&]([^#]+)/.exec(url); if (!m) return { kind: "ignore" }; q = Object.fromEntries(new URLSearchParams(m[1]).entries()); }
    if (q.error) return { kind: "error", error: q.error, state: q.state || "" };
    if (q.code) return { kind: "code", code: q.code, state: q.state || "" };
    return { kind: "ignore" };
  }

  /* ---------- token + API core (web player semantics) ---------- */
  async function tokenPost(params) {
    const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("token endpoint " + r.status + (j.error ? " (" + j.error + ")" : ""));
    return j;
  }
  function storeAuth(j) {
    const prev = tokens();
    store.set(TOK_KEY, { access: j.access_token, refresh: j.refresh_token || (prev && prev.refresh) || "", expires: Date.now() + (j.expires_in || 3600) * 1000 });
  }
  async function refresh() {
    const t = tokens();
    if (!t || !t.refresh) throw new Error("no refresh token");
    const j = await tokenPost({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: cfg().clientId });
    storeAuth(j);
    return tokens().access;
  }
  async function accessToken() {
    const t = tokens();
    if (t && t.access && Date.now() < t.expires - 30000) return t.access;
    return refresh();
  }
  async function api(path, method, body) {
    const tok = await accessToken();
    const call = (tk) => fetch(API + path, { method: method || "GET", headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let r = await call(tok);
    if (r.status === 401) r = await call(await refresh());
    return r;
  }

  /* ---------- auth flow ---------- */
  const authListeners = [];
  function notifyAuth() { for (const f of authListeners.slice()) { try { f(); } catch (e) {} } }
  async function connect() {
    const c = cfg();
    if (!c.clientId) throw new Error("no client ID configured");
    const verifier = randomStr(64), state = randomStr(16);
    const challenge = await sha256b64url(verifier);
    store.set(PKCE_KEY, { verifier, state });
    window.open(buildAuthorizeUrl(c, challenge, state), "_system");
  }
  async function handleCallback(url) {
    const c = cfg();
    const r = parseCallback(url, c.redirectUri);
    if (r.kind === "ignore") return false;
    const pend = store.get(PKCE_KEY);
    if (!pend || pend.state !== r.state) { store.del(PKCE_KEY); notifyAuth(); return true; }
    store.del(PKCE_KEY);
    if (r.kind === "error") { notifyAuth(); return true; }
    try {
      const j = await tokenPost({ grant_type: "authorization_code", code: r.code, redirect_uri: c.redirectUri, client_id: c.clientId, code_verifier: pend.verifier });
      storeAuth(j);
    } catch (e) { /* surfaced via status: no tokens stored */ }
    notifyAuth();
    return true;
  }
  let hookInstalled = false;
  function installHook() {
    if (hookInstalled) return; hookInstalled = true;
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App) return;
    App.addListener("appUrlOpen", (ev) => { if (ev && ev.url) handleCallback(ev.url); });
    if (App.getLaunchUrl) App.getLaunchUrl().then((r) => { if (r && r.url) handleCallback(r.url); }).catch(() => {});
  }
  function disconnect() {
    store.del(TOK_KEY); store.del(PKCE_KEY); store.del("spotify.spike.tokens"); store.del("spotify.spike.pkce");
    S.tracks = []; S.currentUri = null; S.isPlaying = false;
    notifyAuth();
  }
  const connected = () => { const t = tokens(); return !!(t && t.refresh); };

  /* ---------- player state + behaviour (web player port) ---------- */
  const S = {
    module: null, tracks: [], deviceId: null, isPlaying: false, currentUri: null,
    progressMs: 0, anchorAt: 0, durationMs: 0, shuffle: false, repeat: "off",
    volume: 90, volDead: false, seeking: false, pollTimer: 0, tickTimer: 0, root: null,
    selSeq: 0, selLog: [], lastSel: null, listKey: "",
  };
  const playlistId = () => (PLAYLISTS[S.module] || {}).id || "";
  function applyPlayback(p) {
    if (!p) return;
    if (p.device) { S.deviceId = p.device.id; S.deviceName = p.device.name || ""; S.wakeUri = null; }
    S.contextUri = (p.context && p.context.uri) || "";
    S.isPlaying = !!p.is_playing;
    S.shuffle = !!p.shuffle_state;
    S.repeat = p.repeat_state || "off";
    if (p.item) { S.currentUri = p.item.uri; S.durationMs = p.item.duration_ms || 0; S.nowTitle = p.item.name || ""; S.nowArtist = (p.item.artists || []).map((a) => a.name).join(", "); S.artUrl = (p.item.album && p.item.album.images && p.item.album.images[0]) ? p.item.album.images[0].url : ""; } else { S.artUrl = ""; }
    S.progressMs = p.progress_ms || 0;
    S.anchorAt = Date.now();
  }
  function pickDevice(devs) {
    return devs.filter((d) => d.is_active)[0] || devs.filter((d) => d.type === "Smartphone")[0] || devs[0] || null;
  }
  async function fetchState() {
    const r = await api("/me/player");
    if (r.status === 204) { S.isPlaying = false; paint(); return null; }
    if (!r.ok) return null;
    const p = await r.json();
    applyPlayback(p);
    paint();
    return p;
  }
  async function refreshPlayback() { try { await fetchState(); } catch (e) {} }
  async function chooseDevice() {
    try {
      const r = await api("/me/player/devices");
      const j = r.ok ? await r.json() : { devices: [] };
      const pick = pickDevice(j.devices || []);
      S.deviceId = pick ? pick.id : null;
    } catch (e) { S.deviceId = null; }
    return S.deviceId;
  }
  async function fetchPlaylistTracks() {
    // Feb 2026 migration: NEW dev-mode apps must use /playlists/{id}/items —
    // /tracks returns 403 for them (grandfathered apps keep /tracks, which is
    // why the web players still work). Try /items first, /tracks as fallback.
    let r = await api("/playlists/" + playlistId() + "/items?limit=100");
    if (r.status === 403 || r.status === 404) {
      const r2 = await api("/playlists/" + playlistId() + "/tracks?limit=100&fields=items(track(uri,name,duration_ms,artists(name)))");
      if (r2.ok) r = r2;
    }
    return r;
  }
  async function loadPlaylist() {
    try {
      const r = await fetchPlaylistTracks();
      if (!r.ok) {
        S.tracks = []; S.lastStatus = "Playlist didn't load (Spotify said " + r.status + "). Playback info still shows above.";
        setStatus(S.lastStatus); paint(); return;
      }
      const j = await r.json();
      S.tracks = (j.items || []).map((it) => {
        const t = it.item || it.track || {};
        return { uri: t.uri, title: t.name || "Unknown", artist: (t.artists || []).map((a) => a.name).join(", "), duration: Math.round((t.duration_ms || 0) / 1000) };
      }).filter((t) => t.uri);
      if (!S.tracks.length) { S.lastStatus = "Spotify returned an empty track list for this playlist."; setStatus(S.lastStatus); }
    } catch (e) { S.tracks = []; S.lastStatus = "Couldn't load the playlist. Check your connection."; setStatus(S.lastStatus); }
    paint();
  }
  function resolveTitle() {
    const t = S.tracks.filter((x) => x.uri === S.currentUri)[0] || null;
    if (t) return { title: t.title, artist: t.artist };
    if (S.nowTitle) return { title: S.nowTitle, artist: S.nowArtist || "" };
    return { title: S.tracks.length ? "Your playlist" : "Loading…", artist: "" };
  }
  function isPlaylistContext() { return S.tracks.some((t) => t.uri === S.currentUri); }
  function playBody(uri) {
    if (uri) return { context_uri: "spotify:playlist:" + playlistId(), offset: { uri } };
    if (S.currentUri && isPlaylistContext()) return undefined; // resume in place
    return { context_uri: "spotify:playlist:" + playlistId() };
  }
  async function errText(r) { try { const j = await r.json(); return (j && j.error && j.error.message) || ""; } catch (e) { return ""; } }
  function failStatus(what, status, msg) { S.lastStatus = what + " failed (" + status + (msg ? ": " + msg : "") + ")."; setStatus(S.lastStatus); }
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  let verifyDelays = [1200, 2500];
  function describeAttempt(label, r) {
    if (!r) return label + ": not tried";
    if (r.status === -1) return label + ": network error (" + (r.msg || "request failed") + ")";
    if (r.status === 0) return label + ": no Spotify device available";
    if (r.status === 401) return label + ": session expired (401) — reconnect in Settings → 🎧 Spotify";
    if (r.status === 403) return label + ": refused by Spotify (403" + (r.msg ? ": " + r.msg : "") + ")";
    if (r.status === 404) return label + ": no active Spotify device (404) — open the Spotify app once";
    if (r.status === 429) return label + ": rate limited by Spotify (429) — wait a few seconds and retry";
    return label + ": failed (" + r.status + (r.msg ? ": " + r.msg : "") + ")";
  }
  async function tryPlay(body, withDevice) {
    let path = "/me/player/play";
    if (withDevice) {
      const id = S.deviceId || (await chooseDevice());
      if (!id) return { ok: false, status: 0, msg: "" };
      path += "?device_id=" + encodeURIComponent(id);
    }
    try {
      const r = await api(path, "PUT", body);
      if (r.ok || r.status === 204) return { ok: true, status: r.status };
      return { ok: false, status: r.status, msg: await errText(r) };
    } catch (e) { return { ok: false, status: -1, msg: e.message }; }
  }
  async function verifySelected(sel) {
    for (const d of verifyDelays) {
      await wait(d);
      if (sel.seq !== S.selSeq) return "superseded";
      const p = await fetchState().catch(() => null);
      if (sel.seq !== S.selSeq) return "superseded";
      if (p && S.currentUri === sel.uri) return "confirmed";
    }
    return "unconfirmed";
  }
  /* Track selection (U5 fix): the tapped URI is captured with its module's
     playlist and preserved through every attempt. Ladder: playlist-context +
     offset, then direct track play. Generic playlist playback is NEVER
     substituted for the requested song. Success means the playback state
     confirms the URI — an accepted HTTP response alone does not count. */
  async function selectTrack(uri) {
    const mod = S.module, pl = PLAYLISTS[mod];
    if (!pl || !uri) return;
    const sel = { seq: ++S.selSeq, uri, module: mod, pid: pl.id };
    const title = (S.tracks.filter((t) => t.uri === uri)[0] || {}).title || "that track";
    S.selLog = [];
    const mine = () => sel.seq === S.selSeq && S.module === mod;
    setStatus("Starting " + title + "…");
    logAction("Last tap: " + title + " — trying…");
    // U5D — built ONLY on what the U5C panel proved on his phone: with an
    // active device, implicit playlist-jump (B) and implicit direct (A) both
    // return 204 and the tapped track plays. Naming a device_id (C) or
    // transferring playback (D) returns 204 while EMPTYING the session —
    // so no play call ever names a device, and nothing transfers.
    let a = await tryPlay({ context_uri: "spotify:playlist:" + sel.pid, offset: { uri } }, false);
    S.selLog.push("playlist jump -> " + a.status);
    if (!mine()) return;
    if (a.ok) {
      const v = await verifySelected(sel);
      if (!mine()) return;
      if (v === "confirmed") { S.wakeUri = null; S.lastSel = { uri, via: "playlist", playing: S.isPlaying }; S.lastStatus = "✓ Playing: " + title; setStatus(S.lastStatus); logAction("Last tap: " + title + " → ✓ playing (playlist, HTTP " + a.status + ")"); setTimeout(refreshPlayback, 400); return; }
      S.selLog.push("playlist jump accepted, track not confirmed");
    }
    if (!mine()) return;
    let b = await tryPlay({ uris: [uri] }, false);
    S.selLog.push("direct -> " + b.status);
    if (!mine()) return;
    if (b.ok) {
      const v2 = await verifySelected(sel);
      if (!mine()) return;
      if (v2 === "confirmed") { S.wakeUri = null; S.lastSel = { uri, via: "direct", playing: S.isPlaying }; S.lastStatus = "✓ Playing: " + title + " (direct)"; setStatus(S.lastStatus); logAction("Last tap: " + title + " → ✓ playing (direct, HTTP " + b.status + ")"); setTimeout(refreshPlayback, 400); return; }
      S.lastSel = { uri, via: null, result: "unconfirmed" };
      S.lastStatus = "Spotify accepted the request but didn't start \"" + title + "\". Give it a second and tap again.";
      setStatus(S.lastStatus);
      logAction("Last tap: " + title + " → accepted, but Spotify never started it (" + S.selLog.join(", ") + ")");
      return;
    }
    // Both refused. The panel-proven asleep case (404 NO_ACTIVE_DEVICE, zero
    // devices) gets the one-tap wake link instead of a dead-end error.
    let devCount = -1;
    try { const dr = await rawApi("GET", "/me/player/devices"); const dj = JSON.parse(dr.text); devCount = ((dj && dj.devices) || []).length; } catch (e) { /* unknown — plain error below */ }
    if (!mine()) return;
    if (devCount === 0 || a.status === 404 || b.status === 404) {
      S.wakeUri = uri; S.wakeTitle = title;
      S.lastSel = { uri, via: "wake", result: "no-device" };
      S.lastStatus = "Spotify is asleep — one tap below opens it on \"" + title + "\".";
      setStatus(S.lastStatus);
      logAction("Last tap: " + title + " → Spotify asleep (no device) — wake link shown");
      paint();
      return;
    }
    S.lastSel = { uri, via: null, result: "failed" };
    S.lastStatus = "Couldn't start \"" + title + "\" — " + describeAttempt("playlist jump", a) + "; " + describeAttempt("direct play", b) + ".";
    setStatus(S.lastStatus);
    logAction("Last tap: " + title + " → failed (" + S.selLog.join(", ") + ")");
  }
  async function play(uri) {
    if (uri) return selectTrack(uri);
    // Resume / start-the-playlist (the play button): unchanged semantics,
    // with the same implicit-first device route and error surfacing.
    try {
      setStatus("");
      const body = playBody(undefined);
      let r = await tryPlay(body, false);
      if (!r.ok) {
        if (r.status === 404 || r.status === 0) { S.wakeUri = "spotify:playlist:" + PLAYLISTS[S.module].id; S.wakeTitle = PLAYLISTS[S.module].label; setStatus("Spotify is asleep — one tap below opens the playlist in Spotify."); paint(); }
        else failStatus("Play", r.status, r.msg);
        return;
      }
      S.wakeUri = null;
      setTimeout(refreshPlayback, 700);
    } catch (e) { S.lastStatus = "Play failed: " + e.message; setStatus(S.lastStatus); }
  }
  async function pausePlayback() {
    try { const r = await api("/me/player/pause", "PUT"); if (!r.ok && r.status !== 204) failStatus("Pause", r.status, await errText(r)); } catch (e) { S.lastStatus = "Pause failed: " + e.message; setStatus(S.lastStatus); }
    setTimeout(refreshPlayback, 400);
  }

  /* ---------- card UI ---------- */
  let styleDone = false;
  function injectStyle() {
    if (styleDone) return; styleDone = true;
    const st = document.createElement("style");
    st.textContent = ".fm{margin-top:14px}.fm .fm-bar{display:flex;align-items:center;gap:8px}.fm .fm-btn{background:#2c3a5e;color:var(--ink,#f5eeda);border:none;border-radius:10px;padding:9px 12px;font-size:16px;cursor:pointer}.fm .fm-btn.main{background:var(--gold,#d4a72c);color:#141b2e;font-weight:700}.fm .fm-meta{flex:1;min-width:0}.fm .fm-title{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fm .fm-artist{color:var(--muted,#a8b4d4);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fm .fm-prog{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:var(--muted,#a8b4d4)}.fm .fm-prog input{flex:1}.fm .fm-row{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}.fm .fm-tog{background:#10182b;color:var(--muted,#a8b4d4);border:1px solid #2c3a5e;border-radius:999px;padding:6px 12px;cursor:pointer;font-size:13px}.fm .fm-tog.on{color:var(--gold,#d4a72c);border-color:var(--gold,#d4a72c)}.fm .fm-status{margin-top:10px;color:var(--gold,#d4a72c);font-size:13px}.fm .fm-log{margin-top:6px;color:var(--muted,#a8b4d4);font-size:12px}.fm .fm-wake a{display:inline-block;margin-top:8px;background:var(--gold,#d4a72c);color:#141b2e;font-weight:700;border-radius:10px;padding:9px 14px;text-decoration:none}.fm ol.fm-list{margin:12px 0 0;padding-left:20px;max-height:260px;overflow:auto}.fm .fm-track{display:flex;justify-content:space-between;gap:10px;padding:6px 4px;cursor:pointer;border-radius:8px}.fm .fm-track.current{color:var(--gold,#d4a72c);font-weight:700}.fm .fm-note{color:var(--muted,#a8b4d4);font-size:12px;margin-top:10px}";
    document.head.appendChild(st);
  }
  const fmt = (s) => { if (!isFinite(s) || s < 0) s = 0; s = Math.round(s); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); };
  const q = (cls) => (S.root ? S.root.querySelector("." + cls) : null);
  function setStatus(msg) { const e = q("fm-status"); if (e) e.textContent = msg || ""; }
  function logAction(msg) { S.lastAction = msg; const e = q("fm-log"); if (e) e.textContent = msg; }
  function progressNow() { return S.isPlaying ? Math.min(S.durationMs, S.progressMs + (Date.now() - S.anchorAt)) : S.progressMs; }
  function paint() {
    const lg = q("fm-log"); if (lg && S.lastAction) lg.textContent = S.lastAction;
    const wk = q("fm-wake");
    if (wk) {
      if (S.wakeUri) { const isPl = S.wakeUri.indexOf("playlist:") > -1; const wid = S.wakeUri.split(":").pop(); wk.innerHTML = '<a href="https://open.spotify.com/' + (isPl ? "playlist/" : "track/") + wid + '">▶ Open in Spotify — it was asleep</a>'; }
      else if (wk.innerHTML) wk.innerHTML = "";
    }
    if (!S.root) return;
    const setup = q("fm-setup"), body = q("fm-body");
    if (!connected()) { if (setup) setup.style.display = "block"; if (body) body.style.display = "none"; return; }
    if (setup) setup.style.display = "none"; if (body) body.style.display = "";
    const rt = resolveTitle();
    const title = q("fm-title"), artist = q("fm-artist");
    if (title) title.textContent = rt.title;
    if (artist) artist.textContent = rt.artist;
    const info = q("fm-info");
    if (info) info.textContent = (S.deviceName ? "Device: " + S.deviceName : "") + (S.contextUri ? (S.deviceName ? " · " : "") + "Playing from: " + S.contextUri.replace("spotify:", "") : "");
    const play = q("fm-play"); if (play) play.textContent = S.isPlaying ? "⏸" : "▶";
    const sh = q("fm-shuffle"); if (sh) sh.classList.toggle("on", S.shuffle);
    const rp = q("fm-repeat");
    if (rp) { rp.textContent = S.repeat === "track" ? "🔂 One" : S.repeat === "off" ? "🔁 Off" : "🔁 All"; rp.classList.toggle("on", S.repeat !== "off"); }
    const art = q("fm-art");
    if (art) { const u = S.artUrl || ""; if (u && art.getAttribute("src") !== u) art.src = u; art.style.display = u ? "block" : "none"; }
  }
  function drawProgress() {
    if (!S.root || S.seeking) return;
    const seek = q("fm-seek"), cur = q("fm-cur"), dur = q("fm-dur");
    if (!seek) return;
    const d = S.durationMs / 1000, p = progressNow() / 1000;
    seek.value = d > 0 ? Math.round((p / d) * 1000) : 0;
    if (cur) cur.textContent = fmt(p);
    if (dur) dur.textContent = fmt(d);
  }
  function startTimers() {
    stopTimers();
    S.pollTimer = setInterval(() => { if (document.visibilityState === "visible") refreshPlayback(); }, 5000);
    S.tickTimer = setInterval(drawProgress, 1000);
  }
  function stopTimers() { if (S.pollTimer) clearInterval(S.pollTimer); if (S.tickTimer) clearInterval(S.tickTimer); S.pollTimer = S.tickTimer = 0; }

  function mount(module, el) {
    if (!el || !PLAYLISTS[module]) return;
    migrate(); installHook();
    injectStyle();
    S.module = module; S.tracks = []; S.root = el; S.wakeUri = null;
    el.innerHTML = "";
    const card = document.createElement("div");
    card.className = "card fm";
    card.style.padding = "16px";
    card.innerHTML =
      '<div style="font-weight:700;margin-bottom:8px">🎧 Music — Spotify</div>' +
      '<div class="fm-setup" style="display:none"><p class="muted" style="font-size:13px;line-height:1.5">One-time setup: connect The Forge to your Spotify. After that it reconnects on its own — no button. Playback happens in your Spotify app.</p>' +
      '<button class="btn fm-connect">Set up Spotify once</button>' +
      '<p class="muted fm-cfghint" style="font-size:12px;margin-top:8px;display:none">First add your Spotify app in Settings → 🎧 Spotify.</p></div>' +
      '<div class="fm-body">' +
      '<img class="fm-art" alt="" style="display:none;width:100%;border-radius:12px;margin-bottom:12px">' +
      '<div class="fm-meta" style="text-align:center;margin-bottom:10px"><div class="fm-title">Loading…</div><div class="fm-artist"></div></div>' +
      '<div class="fm-bar" style="justify-content:center;gap:12px">' +
      '<button class="fm-tog fm-shuffle" aria-label="Shuffle">🔀</button>' +
      '<button class="fm-btn fm-prev" aria-label="Previous track">⏮</button>' +
      '<button class="fm-btn main fm-play" aria-label="Play or pause" style="font-size:20px;padding:12px 18px">▶</button>' +
      '<button class="fm-btn fm-next" aria-label="Next track">⏭</button>' +
      '<button class="fm-tog fm-repeat" aria-label="Repeat">🔁 All</button></div>' +
      '<div class="fm-status"></div><div class="fm-log"></div><div class="fm-wake"></div>' +
      '<div class="fm-info muted" style="font-size:12px;margin-top:4px"></div>' +
      '<p class="fm-note">Plays in your Spotify app · playlist: ' + PLAYLISTS[module].label + ' · build U5E-1</p>' +
      "</div>";
    el.appendChild(card);
    S.root = card;
    card.querySelector(".fm-connect").addEventListener("click", async () => {
      if (!cfg().clientId) { const h = card.querySelector(".fm-cfghint"); if (h) h.style.display = "block"; return; }
      try { await connect(); } catch (e) { setStatus("Connect failed: " + e.message); }
    });
    card.querySelector(".fm-play").addEventListener("click", () => { S.isPlaying ? pausePlayback() : play(); });
    card.querySelector(".fm-next").addEventListener("click", async () => { try { const r = await api("/me/player/next", "POST"); if (!r.ok && r.status !== 204) failStatus("Next", r.status, await errText(r)); } catch (e) { setStatus("Next failed: " + e.message); } setTimeout(refreshPlayback, 600); });
    card.querySelector(".fm-prev").addEventListener("click", async () => { try { const r = await api("/me/player/previous", "POST"); if (!r.ok && r.status !== 204) failStatus("Previous", r.status, await errText(r)); } catch (e) { setStatus("Previous failed: " + e.message); } setTimeout(refreshPlayback, 600); });
    card.querySelector(".fm-shuffle").addEventListener("click", async () => { S.shuffle = !S.shuffle; paint(); await api("/me/player/shuffle?state=" + S.shuffle, "PUT"); });
    card.querySelector(".fm-repeat").addEventListener("click", async () => {
      S.repeat = S.repeat === "context" ? "track" : S.repeat === "track" ? "off" : "context";
      paint(); await api("/me/player/repeat?state=" + S.repeat, "PUT");
    });
    paint();
    if (connected()) {
      (async () => { try { await accessToken(); } catch (e) { disconnect(); paint(); return; } refreshPlayback(); startTimers(); })();
    }
  }
  function unmount() { stopTimers(); S.root = null; }

  authListeners.push(() => { if (S.root) mount(S.module, S.root.parentElement || S.root); else if (window.__forgeMusicViewOpen) window.renderMusic(); });

  window.ForgeMusic = {
    PLAYLISTS, SCOPES, DEFAULT_REDIRECT,
    mount, unmount, connect, disconnect, connected, cfg,
    pause: () => { if (connected()) pausePlayback(); },
    isPlaying: () => S.isPlaying,
    _test: { buildAuthorizeUrl, parseCallback, sha256b64url, randomStr, playBody, pickDevice, applyPlayback, migrate, store, S, refresh, api, play, pausePlayback, loadPlaylist, chooseDevice, resolveTitle, fetchPlaylistTracks, selectTrack, rawApi, diagLoadTargets, setVerifyDelays: (d) => { verifyDelays = d; } },
  };

  /* ---------- Settings view: connection management ---------- */
  window.renderMusic = function () {
    migrate(); installHook();
    window.__forgeMusicViewOpen = true;
    const c = cfg(), t = tokens();
    const rows = Object.keys(PLAYLISTS).map((k) => `<p class="small" style="margin:4px 0">${PLAYLISTS[k].label}: <span class="muted">playlist ${PLAYLISTS[k].id}</span></p>`).join("");
    document.getElementById("view-music").innerHTML = `<div style="padding:22px 18px;max-width:560px;margin:0 auto">
      <h2 style="margin:4px 0">🎧 Spotify</h2>
      <p class="muted" style="line-height:1.5">One connection for the whole app. Each module's screen plays its own playlist in your Spotify app. Reconnection is silent while the refresh token lives (Spotify now caps it at ~6 months from your last full connect — after that, Connect once more).</p>
      <div class="card" style="padding:16px">
        <div style="font-weight:700;margin-bottom:6px">Status</div>
        <p class="small" style="margin:4px 0">${connected() ? "Connected ✓ — tokens stored on this device (values never shown)" : "Not connected"}</p>
        <p class="small muted" style="margin:4px 0">Client ID: ${c.clientId ? "set (" + c.clientId.slice(0, 4) + "…)" : "NOT set"} · Redirect: ${c.redirectUri}</p>
        <div class="row" style="margin-top:10px">
          <button class="btn grow" id="muConnect">Connect to Spotify</button>
          <button class="btn ghost grow" id="muDisconnect">Disconnect</button>
        </div>
      </div>
      <div class="card" style="padding:16px;margin-top:14px">
        <div style="font-weight:700;margin-bottom:6px">Your Spotify app (one-time)</div>
        <label class="muted">Client ID — an identifier from your developer dashboard, not a secret</label>
        <input id="muClientId" type="text" value="${c.clientId}" style="width:100%;padding:10px;border-radius:10px;background:#10182b;color:var(--ink,#f5eeda);border:1px solid #2c3a5e;margin-top:6px" autocomplete="off">
        <label class="muted" style="display:block;margin-top:10px">Redirect URI — must exactly match the dashboard</label>
        <input id="muRedirect" type="text" value="${c.redirectUri}" style="width:100%;padding:10px;border-radius:10px;background:#10182b;color:var(--ink,#f5eeda);border:1px solid #2c3a5e;margin-top:6px" autocomplete="off">
        <button class="btn block" id="muSave" style="margin-top:10px">Save configuration</button>
      </div>
      <div class="card" style="padding:16px;margin-top:14px">
        <div style="font-weight:700;margin-bottom:6px">Module playlists</div>
        ${rows}
      </div>
      <div class="card" style="padding:16px;margin-top:14px">
        <div style="font-weight:700;margin-bottom:6px">Selection diagnostics — U5C</div>
        <p class="small muted" style="line-height:1.5;margin:4px 0">Measurement only — nothing here is the finished player. Pick a target DIFFERENT from what's playing in Spotify, then run the probes one at a time. Every answer Spotify gives is printed RAW in the log below. For E, tap a link, watch what Spotify does, come back and tap State.</p>
        <div id="dgTargets" style="margin:8px 0"></div>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <button class="btn grow" id="dgState">① State + devices</button>
          <button class="btn grow" id="dgA">A · Direct play</button>
          <button class="btn grow" id="dgB">B · Playlist jump</button>
          <button class="btn grow" id="dgC">C · Direct + device</button>
          <button class="btn grow" id="dgD">D · Transfer, then play</button>
          <button class="btn grow" id="dgF">F · Queue + next</button>
          <button class="btn grow" id="dgG">G · Pause, then play</button>
          <button class="btn grow" id="dgH">H · Play, wait 6s, play again</button>
          <button class="btn ghost grow" id="dgClear">Clear log</button>
        </div>
        <p class="small" style="margin:10px 0 4px">E · Open the target in the Spotify app itself:</p>
        <div class="row" style="gap:8px">
          <a class="btn grow" id="dgLinkApp" href="#" style="text-align:center;text-decoration:none">E1 · spotify: link</a>
          <a class="btn grow" id="dgLinkWeb" href="#" style="text-align:center;text-decoration:none">E2 · open.spotify.com link</a>
        </div>
        <pre id="dgLog" style="margin-top:12px;background:#10182b;border:1px solid #2c3a5e;border-radius:10px;padding:10px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto"></pre>
      </div>
      <button class="btn block" style="margin-top:14px" onclick="show('settings')">‹ Settings</button>
    </div>`;
    document.getElementById("muSave").addEventListener("click", () => {
      store.set(CFG_KEY, { clientId: (document.getElementById("muClientId").value || "").trim(), redirectUri: (document.getElementById("muRedirect").value || "").trim() || DEFAULT_REDIRECT });
      window.renderMusic();
    });
    document.getElementById("muConnect").addEventListener("click", async () => { try { await connect(); } catch (e) { alert("Set the client ID first (below), then Connect."); } });
    document.getElementById("muDisconnect").addEventListener("click", () => { disconnect(); window.renderMusic(); });
    wireDiagnostics();
  };

  /* ---------- U5C selection diagnostics (throwaway measurement panel) ----------
     Every button performs ONE mechanism and prints Spotify's RAW answer
     (HTTP status + body text) to a persistent on-screen log. No verification
     ladders, no fallbacks, no interpretation — measurement only. */
  const DIAG_LOG_KEY = "spotify.diag.log";
  let diagTarget = null;
  function diagLog(line) {
    const stamp = new Date().toTimeString().slice(0, 8);
    const next = ((localStorage.getItem(DIAG_LOG_KEY) || "") + "\n" + stamp + "  " + line).slice(-7000);
    try { localStorage.setItem(DIAG_LOG_KEY, next); } catch (e) {}
    const e = document.getElementById("dgLog");
    if (e) { e.textContent = next.trim(); e.scrollTop = e.scrollHeight; }
  }
  async function rawApi(method, path, body) {
    let tk = await accessToken();
    const send = (t) => fetch(API + path, { method, headers: { Authorization: "Bearer " + t, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let r = await send(tk);
    let note = "";
    if (r.status === 401) { await refresh(); tk = await accessToken(); r = await send(tk); note = " (after 401 + token refresh)"; }
    const text = await r.text().catch(() => "");
    return { status: r.status, text: text.slice(0, 200000), note };
  }
  const dgWait = (ms) => new Promise((res) => setTimeout(res, ms));
  async function diagNowPlaying(prefix) {
    try {
      const r = await rawApi("GET", "/me/player");
      if (r.status === 204 || !r.text) { diagLog(prefix + " -> Spotify reports NOTHING playing (HTTP " + r.status + ")"); return; }
      const j = JSON.parse(r.text);
      const it = j.item;
      diagLog(prefix + " -> now: " + (it ? "\"" + it.name + "\" (" + it.uri + ")" : "no item") + " · playing=" + !!j.is_playing + " · device=" + (j.device ? j.device.name : "?") + " · context=" + (j.context ? j.context.uri : "none"));
    } catch (e) { diagLog(prefix + " -> state read failed: " + (e && e.message || e)); }
  }
  async function diagLoadTargets() {
    const r = await rawApi("GET", "/playlists/" + PLAYLISTS.run.id + "/items?limit=8");
    if (r.status !== 200) throw new Error("playlist read HTTP " + r.status + ": " + r.text.slice(0, 200));
    const j = JSON.parse(r.text);
    return (j.items || []).map((it) => it.track || it.item || it).filter((t) => t && t.uri).map((t) => ({ uri: t.uri, title: t.name, artist: (t.artists || []).map((a) => a.name).join(", ") }));
  }
  async function diagDevices() {
    const r = await rawApi("GET", "/me/player/devices");
    if (r.status !== 200) { diagLog("devices: HTTP " + r.status + " " + r.text.slice(0, 200)); return []; }
    const devs = (JSON.parse(r.text).devices) || [];
    diagLog("DEVICES: HTTP " + r.status + " · " + devs.length + " in list" + (devs.length ? "" : " — Spotify is not active anywhere"));
    devs.forEach((d) => diagLog("device: \"" + d.name + "\" · type=" + d.type + " · active=" + d.is_active + " · restricted=" + d.is_restricted + " · id=" + d.id));
    return devs;
  }
  function pickPhone(devs) { return devs.filter((d) => d.is_active)[0] || devs.filter((d) => d.type === "Smartphone")[0] || devs[0] || null; }
  function setDiagTarget(t) {
    diagTarget = t;
    const id = t.uri.replace("spotify:track:", "");
    const a1 = document.getElementById("dgLinkApp"); if (a1) a1.href = "spotify:track:" + id;
    const a2 = document.getElementById("dgLinkWeb"); if (a2) a2.href = "https://open.spotify.com/track/" + id;
    diagLog("target: \"" + t.title + "\" — " + t.artist + " (" + t.uri + ")");
    document.querySelectorAll(".dg-tgt").forEach((b) => { b.style.borderColor = b.dataset.uri === t.uri ? "var(--gold,#d4a72c)" : ""; });
  }
  function wireDiagnostics() {
    const pre = document.getElementById("dgLog");
    if (!pre) return;
    pre.textContent = (localStorage.getItem(DIAG_LOG_KEY) || "— log empty —").trim();
    if (!connected()) { diagLog("not connected — Connect above first, then re-open this screen."); return; }
    const on = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener("click", async () => { try { await fn(); } catch (err) { diagLog("ERROR: " + (err && err.message || err)); } }); };
    on("dgClear", async () => { localStorage.removeItem(DIAG_LOG_KEY); pre.textContent = "— log cleared —"; });
    on("dgState", async () => {
      const r = await rawApi("GET", "/me/player");
      diagLog("STATE: HTTP " + r.status + r.note + " " + (r.text ? r.text.slice(0, 300) : "(empty body)"));
      await diagNowPlaying("STATE");
      await diagDevices();
    });
    const needTarget = () => { if (!diagTarget) { diagLog("no target yet — the playlist is still loading or failed; see log above."); return false; } return true; };
    on("dgA", async () => { if (!needTarget()) return; const r = await rawApi("PUT", "/me/player/play", { uris: [diagTarget.uri] }); diagLog("A direct {uris}: HTTP " + r.status + r.note + " " + (r.text.slice(0, 300) || "(empty body)")); await dgWait(2500); await diagNowPlaying("A"); });
    on("dgB", async () => { if (!needTarget()) return; const r = await rawApi("PUT", "/me/player/play", { context_uri: "spotify:playlist:" + PLAYLISTS.run.id, offset: { uri: diagTarget.uri } }); diagLog("B playlist jump {context+offset}: HTTP " + r.status + r.note + " " + (r.text.slice(0, 300) || "(empty body)")); await dgWait(2500); await diagNowPlaying("B"); });
    on("dgC", async () => { if (!needTarget()) return; const devs = await diagDevices(); const d = pickPhone(devs); if (!d) { diagLog("C: no device in the list — open Spotify once and retry."); return; } const r = await rawApi("PUT", "/me/player/play?device_id=" + encodeURIComponent(d.id), { uris: [diagTarget.uri] }); diagLog("C direct + device_id (" + d.name + "): HTTP " + r.status + r.note + " " + (r.text.slice(0, 300) || "(empty body)")); await dgWait(2500); await diagNowPlaying("C"); });
    on("dgD", async () => { if (!needTarget()) return; const devs = await diagDevices(); const d = pickPhone(devs); if (!d) { diagLog("D: no device in the list — open Spotify once and retry."); return; } const t = await rawApi("PUT", "/me/player", { device_ids: [d.id], play: false }); diagLog("D transfer to " + d.name + ": HTTP " + t.status + t.note + " " + (t.text.slice(0, 300) || "(empty body)")); await dgWait(1500); const r = await rawApi("PUT", "/me/player/play", { uris: [diagTarget.uri] }); diagLog("D then direct play: HTTP " + r.status + r.note + " " + (r.text.slice(0, 300) || "(empty body)")); await dgWait(2500); await diagNowPlaying("D"); });
    on("dgF", async () => { if (!needTarget()) return; const q = await rawApi("POST", "/me/player/queue?uri=" + encodeURIComponent(diagTarget.uri)); diagLog("F queue add: HTTP " + q.status + q.note + " " + (q.text.slice(0, 300) || "(empty body)")); await dgWait(800); const n = await rawApi("POST", "/me/player/next"); diagLog("F next: HTTP " + n.status + n.note + " " + (n.text.slice(0, 300) || "(empty body)")); await dgWait(2500); await diagNowPlaying("F"); });
    on("dgG", async () => { if (!needTarget()) return; const pz = await rawApi("PUT", "/me/player/pause"); diagLog("G pause: HTTP " + pz.status + pz.note + " " + (pz.text.slice(0, 300) || "(empty body)")); await dgWait(2000); const r = await rawApi("PUT", "/me/player/play", { uris: [diagTarget.uri] }); diagLog("G then direct play: HTTP " + r.status + r.note + " " + (r.text.slice(0, 300) || "(empty body)")); await dgWait(2500); await diagNowPlaying("G"); });
    on("dgH", async () => { if (!needTarget()) return; const r1 = await rawApi("PUT", "/me/player/play", { uris: [diagTarget.uri] }); diagLog("H play #1: HTTP " + r1.status + r1.note + " " + (r1.text.slice(0, 300) || "(empty body)")); await dgWait(6000); await diagDevices(); const r2 = await rawApi("PUT", "/me/player/play", { uris: [diagTarget.uri] }); diagLog("H play #2 (6s later): HTTP " + r2.status + r2.note + " " + (r2.text.slice(0, 300) || "(empty body)")); await dgWait(2500); await diagNowPlaying("H"); });
    diagLoadTargets().then((tracks) => {
      const host = document.getElementById("dgTargets");
      if (host) {
        host.innerHTML = "";
        tracks.forEach((t) => { const b = document.createElement("button"); b.className = "btn ghost dg-tgt"; b.dataset.uri = t.uri; b.style.margin = "0 6px 6px 0"; b.textContent = t.title; b.addEventListener("click", () => setDiagTarget(t)); host.appendChild(b); });
      }
      if (tracks.length) setDiagTarget(tracks[2] || tracks[0]);
      diagLog("panel ready — " + tracks.length + " target songs loaded from the Run playlist.");
    }).catch((e) => diagLog("target load FAILED: " + (e && e.message || e)));
  }
})();

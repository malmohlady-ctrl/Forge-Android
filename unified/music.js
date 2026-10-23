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
  };
  const playlistId = () => (PLAYLISTS[S.module] || {}).id || "";
  function applyPlayback(p) {
    if (!p) return;
    if (p.device) S.deviceId = p.device.id;
    S.isPlaying = !!p.is_playing;
    S.shuffle = !!p.shuffle_state;
    S.repeat = p.repeat_state || "off";
    if (p.item) { S.currentUri = p.item.uri; S.durationMs = p.item.duration_ms || 0; S.nowTitle = p.item.name || ""; S.nowArtist = (p.item.artists || []).map((a) => a.name).join(", "); }
    S.progressMs = p.progress_ms || 0;
    S.anchorAt = Date.now();
  }
  function pickDevice(devs) {
    return devs.filter((d) => d.is_active)[0] || devs.filter((d) => d.type === "Smartphone")[0] || devs[0] || null;
  }
  async function refreshPlayback() {
    try {
      const r = await api("/me/player");
      if (r.status === 204) { S.isPlaying = false; paint(); return; }
      if (!r.ok) return;
      applyPlayback(await r.json());
      paint();
    } catch (e) {}
  }
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
  async function play(uri) {
    try {
      let id = S.deviceId || (await chooseDevice());
      if (!id) { setStatus("No Spotify device found. Open the Spotify app on your phone once, then tap play again."); return; }
      setStatus("");
      const body = playBody(uri);
      const r = await api("/me/player/play?device_id=" + encodeURIComponent(id), "PUT", body);
      if (r.status === 404) { S.deviceId = null; setStatus("Spotify device went away. Open the Spotify app, then tap play again."); return; }
      if (!r.ok && r.status !== 204) {
        const msg = await errText(r);
        if (uri && body && body.offset) {
          // Track jump refused: still start the module's playlist, and say why.
          const r2 = await api("/me/player/play?device_id=" + encodeURIComponent(id), "PUT", { context_uri: "spotify:playlist:" + playlistId() });
          if (r2.ok || r2.status === 204) { S.lastStatus = "Track jump refused (" + r.status + (msg ? ": " + msg : "") + ") — started the playlist instead."; setStatus(S.lastStatus); }
          else failStatus("Play", r2.status, await errText(r2));
        } else failStatus("Play", r.status, msg);
      }
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
    st.textContent = ".fm{margin-top:14px}.fm .fm-bar{display:flex;align-items:center;gap:8px}.fm .fm-btn{background:#2c3a5e;color:var(--ink,#f5eeda);border:none;border-radius:10px;padding:9px 12px;font-size:16px;cursor:pointer}.fm .fm-btn.main{background:var(--gold,#d4a72c);color:#141b2e;font-weight:700}.fm .fm-meta{flex:1;min-width:0}.fm .fm-title{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fm .fm-artist{color:var(--muted,#a8b4d4);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fm .fm-prog{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:var(--muted,#a8b4d4)}.fm .fm-prog input{flex:1}.fm .fm-row{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}.fm .fm-tog{background:#10182b;color:var(--muted,#a8b4d4);border:1px solid #2c3a5e;border-radius:999px;padding:6px 12px;cursor:pointer;font-size:13px}.fm .fm-tog.on{color:var(--gold,#d4a72c);border-color:var(--gold,#d4a72c)}.fm .fm-status{margin-top:10px;color:var(--gold,#d4a72c);font-size:13px}.fm ol.fm-list{margin:12px 0 0;padding-left:20px;max-height:260px;overflow:auto}.fm .fm-track{display:flex;justify-content:space-between;gap:10px;padding:6px 4px;cursor:pointer;border-radius:8px}.fm .fm-track.current{color:var(--gold,#d4a72c);font-weight:700}.fm .fm-note{color:var(--muted,#a8b4d4);font-size:12px;margin-top:10px}";
    document.head.appendChild(st);
  }
  const fmt = (s) => { if (!isFinite(s) || s < 0) s = 0; s = Math.round(s); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); };
  const q = (cls) => (S.root ? S.root.querySelector("." + cls) : null);
  function setStatus(msg) { const e = q("fm-status"); if (e) e.textContent = msg || ""; }
  function progressNow() { return S.isPlaying ? Math.min(S.durationMs, S.progressMs + (Date.now() - S.anchorAt)) : S.progressMs; }
  function paint() {
    if (!S.root) return;
    const setup = q("fm-setup"), body = q("fm-body");
    if (!connected()) { if (setup) setup.style.display = "block"; if (body) body.style.display = "none"; return; }
    if (setup) setup.style.display = "none"; if (body) body.style.display = "";
    const rt = resolveTitle();
    const title = q("fm-title"), artist = q("fm-artist");
    if (title) title.textContent = rt.title;
    if (artist) artist.textContent = rt.artist;
    const play = q("fm-play"); if (play) play.textContent = S.isPlaying ? "⏸" : "▶";
    const sh = q("fm-shuffle"); if (sh) sh.classList.toggle("on", S.shuffle);
    const rp = q("fm-repeat");
    if (rp) { rp.textContent = S.repeat === "track" ? "🔂 One" : S.repeat === "off" ? "🔁 Off" : "🔁 All"; rp.classList.toggle("on", S.repeat !== "off"); }
    const list = q("fm-list");
    if (list) {
      list.innerHTML = "";
      for (const tr of S.tracks) {
        const li = document.createElement("li");
        li.className = "fm-track" + (tr.uri === S.currentUri ? " current" : "");
        const n = document.createElement("span"); n.textContent = tr.title + (tr.artist ? " — " + tr.artist : "");
        const d = document.createElement("span"); d.textContent = tr.duration ? fmt(tr.duration) : "";
        li.appendChild(n); li.appendChild(d);
        li.addEventListener("click", () => play(tr.uri));
        list.appendChild(li);
      }
    }
    drawProgress();
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
    S.module = module; S.tracks = []; S.root = el;
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
      '<div class="fm-bar"><button class="fm-btn fm-prev" aria-label="Previous track">⏮</button>' +
      '<button class="fm-btn main fm-play" aria-label="Play or pause">▶</button>' +
      '<button class="fm-btn fm-next" aria-label="Next track">⏭</button>' +
      '<div class="fm-meta"><div class="fm-title">Loading…</div><div class="fm-artist"></div></div></div>' +
      '<div class="fm-prog"><span class="fm-cur">0:00</span><input type="range" class="fm-seek" min="0" max="1000" value="0" aria-label="Seek"><span class="fm-dur">0:00</span></div>' +
      '<div class="fm-row"><button class="fm-tog fm-shuffle">🔀 Shuffle</button><button class="fm-tog fm-repeat">🔁 All</button>' +
      '<label class="muted" style="font-size:13px">Volume <input type="range" class="fm-vol" min="0" max="100" value="90" style="vertical-align:middle"></label></div>' +
      '<div class="fm-status"></div>' +
      '<ol class="fm-list"></ol>' +
      '<p class="fm-note">Plays in your Spotify app · playlist: ' + PLAYLISTS[module].label + '</p>' +
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
    let volTimer = 0;
    const vol = card.querySelector(".fm-vol");
    vol.value = S.volume;
    vol.addEventListener("input", (e) => {
      S.volume = Number(e.target.value);
      if (S.volDead) return;
      clearTimeout(volTimer);
      volTimer = setTimeout(async () => {
        const r = await api("/me/player/volume?volume_percent=" + S.volume, "PUT").catch(() => null);
        if (r && (r.status === 403 || r.status === 404)) { S.volDead = true; vol.disabled = true; vol.title = "Volume is controlled in the Spotify app for this device"; }
      }, 250);
    });
    const seek = card.querySelector(".fm-seek");
    seek.addEventListener("input", () => { S.seeking = true; });
    seek.addEventListener("change", async () => {
      S.seeking = false;
      if (S.durationMs > 0) {
        const ms = Math.round((seek.value / 1000) * S.durationMs);
        S.progressMs = ms; S.anchorAt = Date.now(); drawProgress();
        await api("/me/player/seek?position_ms=" + ms, "PUT");
        setTimeout(refreshPlayback, 500);
      }
    });
    paint();
    if (connected()) {
      (async () => { try { await accessToken(); } catch (e) { disconnect(); paint(); return; } loadPlaylist(); refreshPlayback(); chooseDevice(); startTimers(); })();
    }
  }
  function unmount() { stopTimers(); S.root = null; }

  authListeners.push(() => { if (S.root) mount(S.module, S.root.parentElement || S.root); else if (window.__forgeMusicViewOpen) window.renderMusic(); });

  window.ForgeMusic = {
    PLAYLISTS, SCOPES, DEFAULT_REDIRECT,
    mount, unmount, connect, disconnect, connected, cfg,
    pause: () => { if (connected()) pausePlayback(); },
    isPlaying: () => S.isPlaying,
    _test: { buildAuthorizeUrl, parseCallback, sha256b64url, randomStr, playBody, pickDevice, applyPlayback, migrate, store, S, refresh, api, play, pausePlayback, loadPlaylist, chooseDevice, resolveTitle, fetchPlaylistTracks },
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
      <button class="btn block" style="margin-top:14px" onclick="show('settings')">‹ Settings</button>
    </div>`;
    document.getElementById("muSave").addEventListener("click", () => {
      store.set(CFG_KEY, { clientId: (document.getElementById("muClientId").value || "").trim(), redirectUri: (document.getElementById("muRedirect").value || "").trim() || DEFAULT_REDIRECT });
      window.renderMusic();
    });
    document.getElementById("muConnect").addEventListener("click", async () => { try { await connect(); } catch (e) { alert("Set the client ID first (below), then Connect."); } });
    document.getElementById("muDisconnect").addEventListener("click", () => { disconnect(); window.renderMusic(); });
  };
})();

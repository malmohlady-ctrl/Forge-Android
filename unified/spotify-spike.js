"use strict";
/* Unified Forge — U5 Phase A: Spotify authentication SPIKE (proof of concept only).
   Question it answers: can Spotify's Authorization Code + PKCE flow return to
   this installed app on the Samsung via the redirect URI
   "com.malmohlady.theforge://spotify-callback" (configurable — whatever the
   developer dashboard actually accepts is what gets tested)?
   Deliberately NOT the player: no playback control, no playlists, no DB writes.
   Tokens live ONLY in localStorage under spotify.spike.* (never in the Forge
   DB, never logged — log lines carry event names and results, never codes,
   tokens, or the client secret; PKCE has no secret). */
(function () {
  const AUTH_URL = "https://accounts.spotify.com/authorize";
  const TOKEN_URL = "https://accounts.spotify.com/api/token";
  const DEFAULT_REDIRECT = "com.malmohlady.theforge://spotify-callback";
  const SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing"; // the web apps' proven set
  const CFG_KEY = "spotify.spike.cfg", PKCE_KEY = "spotify.spike.pkce", TOK_KEY = "spotify.spike.tokens";

  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const cfg = () => Object.assign({ clientId: "", redirectUri: DEFAULT_REDIRECT }, store.get(CFG_KEY) || {});
  const tokens = () => store.get(TOK_KEY);

  function b64url(bytes) {
    let s = ""; for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomStr(n) {
    const a = new Uint8Array(n); crypto.getRandomValues(a);
    return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"[b % 66]).join("");
  }
  async function sha256b64url(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return b64url(new Uint8Array(buf));
  }
  function buildAuthorizeUrl(c, challenge, state) {
    const p = new URLSearchParams({
      response_type: "code", client_id: c.clientId, scope: SCOPES,
      code_challenge_method: "S256", code_challenge: challenge,
      redirect_uri: c.redirectUri, state,
    });
    return AUTH_URL + "?" + p.toString();
  }
  /* Classify an incoming URL against the configured redirect URI.
     -> {kind:"code",code,state} | {kind:"error",error,state} | {kind:"ignore"} */
  function parseCallback(url, redirectUri) {
    if (!url || !redirectUri || !url.startsWith(redirectUri)) return { kind: "ignore" };
    let q = {};
    try { q = Object.fromEntries(new URL(url).searchParams.entries()); }
    catch (e) {
      const m = /[?&]([^#]+)/.exec(url); if (!m) return { kind: "ignore" };
      q = Object.fromEntries(new URLSearchParams(m[1]).entries());
    }
    if (q.error) return { kind: "error", error: q.error, state: q.state || "" };
    if (q.code) return { kind: "code", code: q.code, state: q.state || "" };
    return { kind: "ignore" };
  }
  function tokenBody(params) { return new URLSearchParams(params).toString(); }
  async function tokenPost(params) {
    const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: tokenBody(params) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("token endpoint " + r.status + (j.error ? " (" + j.error + ")" : ""));
    return j;
  }
  function saveTokens(j, prev) {
    store.set(TOK_KEY, {
      access: j.access_token,
      refresh: j.refresh_token || (prev && prev.refresh) || "",
      expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
    });
  }

  let logLines = [];
  function log(msg) {
    const line = new Date().toTimeString().slice(0, 8) + "  " + msg;
    logLines.push(line); if (logLines.length > 60) logLines.shift();
    const e = document.getElementById("spkLog"); if (e) e.textContent = logLines.join("\n");
    refreshStatus();
  }
  function refreshStatus() {
    const e = document.getElementById("spkStatus"); if (!e) return;
    const c = cfg(), t = tokens();
    e.textContent =
      "client ID: " + (c.clientId ? "set (" + c.clientId.slice(0, 4) + "…)" : "NOT set") +
      "\nredirect URI: " + c.redirectUri +
      "\ntokens: " + (t ? "stored · access " + (t.expiresAt > Date.now() ? "valid until " + new Date(t.expiresAt).toLocaleTimeString() : "EXPIRED (refresh available)") : "none") +
      "\nrefresh token: " + (t && t.refresh ? "present (value never shown)" : "absent");
  }

  async function handleCallback(url) {
    const c = cfg();
    const r = parseCallback(url, c.redirectUri);
    if (r.kind === "ignore") return false;
    log("callback received: " + (r.kind === "code" ? "authorization code" : "error"));
    const pend = store.get(PKCE_KEY);
    if (!pend || pend.state !== r.state) { log("✗ state mismatch — callback rejected (possible forgery or stale attempt)"); store.del(PKCE_KEY); return true; }
    store.del(PKCE_KEY);
    if (r.kind === "error") { log("✗ authorization failed/denied: " + r.error + (r.error === "access_denied" ? " (you tapped Cancel/Deny — the flow handles this cleanly)" : "")); return true; }
    try {
      const j = await tokenPost({ grant_type: "authorization_code", code: r.code, redirect_uri: c.redirectUri, client_id: c.clientId, code_verifier: pend.verifier });
      saveTokens(j, null);
      log("✓ code exchanged — access + refresh tokens stored (values never shown)");
    } catch (e) { log("✗ token exchange failed: " + e.message); }
    refreshStatus();
    return true;
  }

  let hookInstalled = false;
  function installHook() {
    if (hookInstalled) return; hookInstalled = true;
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App) { return; }
    App.addListener("appUrlOpen", (ev) => { if (ev && ev.url) handleCallback(ev.url); });
    if (App.getLaunchUrl) App.getLaunchUrl().then((r) => { if (r && r.url) handleCallback(r.url); }).catch(() => {});
    log("deep-link listener installed (appUrlOpen)");
  }

  window.SpotifySpike = {
    DEFAULT_REDIRECT, SCOPES,
    _test: { buildAuthorizeUrl, parseCallback, sha256b64url, randomStr, tokenBody, cfg, tokens },
    saveConfig() {
      const id = (document.getElementById("spkClientId").value || "").trim();
      const ru = (document.getElementById("spkRedirect").value || "").trim() || DEFAULT_REDIRECT;
      store.set(CFG_KEY, { clientId: id, redirectUri: ru });
      log("config saved (client ID " + (id ? "set" : "still empty") + " · redirect " + ru + ")");
      refreshStatus();
    },
    async connect() {
      const c = cfg();
      if (!c.clientId) { log("✗ set the client ID first (from your Spotify dashboard)"); return; }
      const verifier = randomStr(64), state = randomStr(16);
      const challenge = await sha256b64url(verifier);
      store.set(PKCE_KEY, { verifier, state });
      const url = buildAuthorizeUrl(c, challenge, state);
      log("opening Spotify authorization in the system browser…");
      const w = window.open(url, "_system");
      if (!w) log("note: window.open returned null — if no browser opened, tell Treyvon (the launch route becomes a spike finding)");
    },
    async testApi() {
      const t = tokens();
      if (!t) { log("✗ no tokens — connect first"); return; }
      try {
        const r = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: "Bearer " + t.access } });
        if (!r.ok) { log("✗ API /me returned " + r.status + (r.status === 401 ? " (access token expired/invalid — try silent refresh)" : "")); return; }
        const j = await r.json();
        log("✓ API proof: /me OK — account \"" + (j.display_name || j.id) + "\" · product: " + (j.product || "?") + " (token never shown)");
      } catch (e) { log("✗ API call failed: " + e.message); }
    },
    async testRefresh() {
      const t = tokens();
      if (!t || !t.refresh) { log("✗ no refresh token stored"); return; }
      try {
        const j = await tokenPost({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: cfg().clientId });
        saveTokens(j, t);
        log("✓ silent refresh OK — new access token issued WITHOUT any login prompt (reconnection works while the refresh token lives)");
      } catch (e) { log("✗ refresh failed: " + e.message + " (refresh token may be expired/revoked — re-authentication would be required)"); }
      refreshStatus();
    },
    disconnect() { store.del(TOK_KEY); store.del(PKCE_KEY); log("tokens cleared on this device"); refreshStatus(); },
  };

  window.renderSpike = function () {
    installHook();
    const c = cfg();
    document.getElementById("view-spike").innerHTML = `<div style="padding:22px 18px;max-width:560px;margin:0 auto">
      <h2 style="margin:4px 0">U5 Spotify — auth spike</h2>
      <p style="color:var(--muted,#a8b4d4);line-height:1.5">Proof of concept ONLY: can Spotify login return to this app via the redirect URI below? No player, no playlists, no fitness data touched. Tokens stay in this spike's own storage and are never displayed or logged.</p>
      <h3>Configuration</h3>
      <label style="display:block;margin:8px 0 4px;color:var(--muted,#a8b4d4)">Client ID (from your Spotify developer dashboard — an identifier, not a secret)</label>
      <input id="spkClientId" type="text" value="${c.clientId}" style="width:100%;padding:10px;border-radius:10px;background:#10182b;color:var(--ink,#f5eeda);border:1px solid #2c3a5e" autocomplete="off">
      <label style="display:block;margin:10px 0 4px;color:var(--muted,#a8b4d4)">Redirect URI (must EXACTLY match the dashboard)</label>
      <input id="spkRedirect" type="text" value="${c.redirectUri}" style="width:100%;padding:10px;border-radius:10px;background:#10182b;color:var(--ink,#f5eeda);border:1px solid #2c3a5e" autocomplete="off">
      <button class="btn block" style="margin-top:10px" onclick="SpotifySpike.saveConfig()">Save configuration</button>
      <h3>Status</h3>
      <pre id="spkStatus" style="white-space:pre-wrap;background:#10182b;padding:10px;border-radius:10px">…</pre>
      <h3>Tests</h3>
      <button class="btn block" onclick="SpotifySpike.connect()">1 · Connect to Spotify</button>
      <button class="btn block" style="margin-top:8px" onclick="SpotifySpike.testApi()">2 · Test API call (GET /me)</button>
      <button class="btn block" style="margin-top:8px" onclick="SpotifySpike.testRefresh()">3 · Test silent refresh (no login)</button>
      <button class="btn block" style="margin-top:8px" onclick="SpotifySpike.disconnect()">Disconnect (clear tokens)</button>
      <h3>Event log</h3>
      <pre id="spkLog" style="white-space:pre-wrap;background:#10182b;padding:10px;border-radius:10px;max-height:300px;overflow:auto">No events yet. Tip: also try the Cancel path — start Connect, then deny on Spotify's page, and watch the callback handle it.</pre>
      <button class="btn block" style="margin-top:14px" onclick="show('diag')">‹ Diagnostics</button>
    </div>`;
    refreshStatus();
    if (logLines.length) { const e = document.getElementById("spkLog"); if (e) e.textContent = logLines.join("\n"); }
  };
})();

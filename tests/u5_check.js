"use strict";
/* U5 checks — the auth core now lives in unified/music.js (Phase B):
   PKCE math (RFC 7636 vector), authorize-URL construction, callback
   classification, token-form encoding, defaults, bundle hygiene, and the
   manifest deep link that Phase A proved on the Samsung. */
const assert = require("assert"), fs = require("fs"), vm = require("vm"), path = require("path");
global.window = globalThis;
const lsData = {};
global.localStorage = { getItem: (k) => (k in lsData ? lsData[k] : null), setItem: (k, v) => { lsData[k] = String(v); }, removeItem: (k) => { delete lsData[k]; } };
global.document = { getElementById: () => null, querySelector: () => null, head: { appendChild() {} }, createElement: () => ({ style: {}, classList: { toggle() {} }, addEventListener() {}, appendChild() {}, querySelector: () => null }) };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "unified", "music.js"), "utf8"), { filename: "music.js" });

let pass = 0; const ok = (name) => { pass++; console.log("  ✓ " + name); };
const FM = window.ForgeMusic, T = FM._test;
const RU = "com.malmohlady.theforge://spotify-callback";

(async () => {
  assert.strictEqual(FM.DEFAULT_REDIRECT, RU); ok("default redirect = prescribed production-scheme callback");
  assert.ok(FM.SCOPES.includes("user-modify-playback-state") && FM.SCOPES.includes("user-read-playback-state")); ok("scopes mirror the web apps' proven set");

  const ch = await T.sha256b64url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.strictEqual(ch, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"); ok("PKCE S256 challenge matches the RFC 7636 test vector");
  assert.strictEqual(T.randomStr(64).length, 64); ok("verifier generation (64 chars)");

  const url = T.buildAuthorizeUrl({ clientId: "cid123", redirectUri: RU }, ch, "st8");
  const u = new URL(url);
  assert.strictEqual(u.origin + u.pathname, "https://accounts.spotify.com/authorize");
  assert.strictEqual(u.searchParams.get("response_type"), "code");
  assert.strictEqual(u.searchParams.get("code_challenge_method"), "S256");
  assert.strictEqual(u.searchParams.get("redirect_uri"), RU);
  assert.strictEqual(u.searchParams.get("state"), "st8");
  ok("authorize URL: code flow + S256 + exact redirect + state");

  assert.deepStrictEqual(T.parseCallback(RU + "?code=ABC&state=st8", RU), { kind: "code", code: "ABC", state: "st8" }); ok("callback: code classified");
  assert.deepStrictEqual(T.parseCallback(RU + "?error=access_denied&state=st8", RU), { kind: "error", error: "access_denied", state: "st8" }); ok("callback: access_denied classified");
  assert.strictEqual(T.parseCallback("https://example.com/?code=X", RU).kind, "ignore"); ok("callback: foreign URLs ignored");
  assert.strictEqual(T.parseCallback(RU, RU).kind, "ignore"); ok("callback: bare redirect ignored");

  const music = fs.readFileSync(path.join(__dirname, "..", "unified", "music.js"), "utf8");
  assert.ok(!/client_secret/i.test(music), "no client_secret anywhere in music.js");
  assert.ok(!/console\.log|log\([^)]*access_token/.test(music), "token values are never logged");
  const manifest = fs.readFileSync(path.join(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  assert.ok(manifest.includes('android:scheme="com.malmohlady.theforge"') && manifest.includes('android:host="spotify-callback"')); ok("manifest deep link intact");
  const html = fs.readFileSync(path.join(__dirname, "..", "unified", "index.html"), "utf8");
  assert.ok(html.includes('id="view-music"') && html.includes("music.js") && !html.includes("spotify-spike")); ok("music view + script wired; spike retired");
  const app = fs.readFileSync(path.join(__dirname, "..", "unified", "app.js"), "utf8");
  assert.strictEqual((app.match(/id="dtMusic"/g) || []).length, 1); assert.ok(app.includes('$("#dtMusic"); if (dtS) dtS.onclick = () => show("music");')); ok("Settings entry: dtMusic -> Spotify view (unique, bound)");
  console.log("U5 tests: " + pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });

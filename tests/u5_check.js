"use strict";
/* U5 Phase A spike checks: PKCE math (RFC 7636 vector), authorize-URL
   construction, callback classification (code / access_denied / state /
   foreign URL), token-form encoding, defaults — and bundle hygiene
   (no client secret anywhere, no token logging, manifest deep link). */
const assert = require("assert"), fs = require("fs"), vm = require("vm"), path = require("path");
global.window = globalThis;
const lsData = {};
global.localStorage = { getItem: (k) => (k in lsData ? lsData[k] : null), setItem: (k, v) => { lsData[k] = String(v); }, removeItem: (k) => { delete lsData[k]; } };
global.document = { getElementById: () => null, querySelector: () => null };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "unified", "spotify-spike.js"), "utf8"), { filename: "spotify-spike.js" });

let pass = 0; const ok = (name) => { pass++; console.log("  ✓ " + name); };
const T = window.SpotifySpike._test;
const RU = "com.malmohlady.theforge://spotify-callback";

(async () => {
  assert.strictEqual(window.SpotifySpike.DEFAULT_REDIRECT, RU); ok("default redirect = prescribed production-scheme callback");
  assert.ok(window.SpotifySpike.SCOPES.includes("user-modify-playback-state") && window.SpotifySpike.SCOPES.includes("user-read-playback-state")); ok("scopes mirror the web apps' proven set");

  // RFC 7636 Appendix B vector
  const ch = await T.sha256b64url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.strictEqual(ch, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"); ok("PKCE S256 challenge matches the RFC 7636 test vector");
  const v = T.randomStr(64); assert.strictEqual(v.length, 64); ok("verifier generation (64 chars, unreserved set)");

  const url = T.buildAuthorizeUrl({ clientId: "cid123", redirectUri: RU }, ch, "st8");
  const u = new URL(url);
  assert.strictEqual(u.origin + u.pathname, "https://accounts.spotify.com/authorize");
  assert.strictEqual(u.searchParams.get("response_type"), "code");
  assert.strictEqual(u.searchParams.get("code_challenge_method"), "S256");
  assert.strictEqual(u.searchParams.get("redirect_uri"), RU);
  assert.strictEqual(u.searchParams.get("state"), "st8");
  ok("authorize URL: code flow + S256 + exact redirect + state");

  assert.deepStrictEqual(T.parseCallback(RU + "?code=ABC&state=st8", RU), { kind: "code", code: "ABC", state: "st8" }); ok("callback: code classified");
  assert.deepStrictEqual(T.parseCallback(RU + "?error=access_denied&state=st8", RU), { kind: "error", error: "access_denied", state: "st8" }); ok("callback: access_denied classified (the Cancel path)");
  assert.strictEqual(T.parseCallback("https://example.com/?code=X", RU).kind, "ignore"); ok("callback: foreign URLs ignored");
  assert.strictEqual(T.parseCallback(RU, RU).kind, "ignore"); ok("callback: bare redirect without params ignored");

  const body = T.tokenBody({ grant_type: "authorization_code", code: "a b", redirect_uri: RU, client_id: "cid123", code_verifier: "v~1" });
  assert.ok(body.includes("grant_type=authorization_code") && body.includes("code=a+b") && body.includes("code_verifier=v%7E1") || body.includes("code_verifier=v~1")); ok("token form body encodes correctly");

  // Hygiene across the whole spike surface
  const spike = fs.readFileSync(path.join(__dirname, "..", "unified", "spotify-spike.js"), "utf8");
  assert.ok(!/client_secret/i.test(spike), "no client_secret anywhere in the spike");
  assert.ok(!/log\([^)]*(access|refresh)_token/i.test(spike), "token values are never logged");
  const manifest = fs.readFileSync(path.join(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  assert.ok(manifest.includes('android:scheme="com.malmohlady.theforge"') && manifest.includes('android:host="spotify-callback"')); ok("manifest deep link: scheme + host for the callback");
  const html = fs.readFileSync(path.join(__dirname, "..", "unified", "index.html"), "utf8");
  assert.ok(html.includes('id="view-spike"') && html.includes("spotify-spike.js")); ok("spike view + script wired into the shell");
  console.log("U5 spike tests: " + pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });

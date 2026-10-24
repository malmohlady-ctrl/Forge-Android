"use strict";
/* U5C diagnostics checks: the measurement panel's raw plumbing — rawApi must
   return Spotify's status and body text VERBATIM (no interpretation), retry
   once after a 401 + refresh while flagging that it did, and the target
   loader must parse the /items shape the panel's buttons depend on. */
const assert = require("assert"), fs = require("fs"), vm = require("vm"), path = require("path");
global.window = globalThis;
const lsData = {};
global.localStorage = { getItem: (k) => (k in lsData ? lsData[k] : null), setItem: (k, v) => { lsData[k] = String(v); }, removeItem: (k) => { delete lsData[k]; } };
global.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], head: { appendChild() {} }, createElement: () => ({ style: {}, classList: { toggle() {} }, addEventListener() {}, appendChild() {}, querySelector: () => null }) };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "unified", "music.js"), "utf8"), { filename: "music.js" });

let pass = 0; const ok = (name) => { pass++; console.log("  ✓ " + name); };
const FM = window.ForgeMusic, T = FM._test;

lsData["spotify.music.cfg"] = JSON.stringify({ clientId: "cid", redirectUri: "com.malmohlady.theforge://spotify-callback" });
lsData["spotify.music.tokens"] = JSON.stringify({ access: "tok1", refresh: "ref", expires: Date.now() + 3600e3 });

(async () => {
  // raw passthrough: a 403 with an error body comes back exactly as sent
  global.fetch = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: { status: 403, message: "Restriction violated" } }), json: async () => ({}) });
  let r = await T.rawApi("PUT", "/me/player/play", { uris: ["spotify:track:X"] });
  assert.strictEqual(r.status, 403);
  assert.ok(r.text.includes("Restriction violated"), "raw body text preserved: " + r.text);
  assert.strictEqual(r.note, "");
  ok("rawApi: status + body text returned verbatim (403 case)");

  // 401 -> refresh -> retry, flagged in the note; the retried call uses the new token
  const auths = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("accounts.spotify.com")) return { ok: true, status: 200, text: async () => "", json: async () => ({ access_token: "tok2", expires_in: 3600 }) };
    auths.push((opts.headers || {}).Authorization);
    if (auths.length === 1) return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "The access token expired" } }), json: async () => ({}) };
    return { ok: true, status: 204, text: async () => "", json: async () => ({}) };
  };
  r = await T.rawApi("PUT", "/me/player/play", { uris: ["spotify:track:X"] });
  assert.strictEqual(r.status, 204);
  assert.ok(r.note.includes("401"), "the refresh is flagged, not hidden: " + r.note);
  assert.deepStrictEqual(auths, ["Bearer tok1", "Bearer tok2"], "retry carried the refreshed token");
  ok("rawApi: 401 triggers one refresh + retry and says so");

  // target loader parses /items (item.track shape) into picker entries
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ items: [
    { item: { uri: "spotify:track:A", name: "Song A", artists: [{ name: "Artist A" }] } },
    { track: { uri: "spotify:track:B", name: "Song B", artists: [{ name: "B1" }, { name: "B2" }] } },
    { item: null },
  ] }), json: async () => ({}) });
  const targets = await T.diagLoadTargets();
  assert.strictEqual(targets.length, 2);
  assert.deepStrictEqual(targets[0], { uri: "spotify:track:A", title: "Song A", artist: "Artist A" });
  assert.strictEqual(targets[1].artist, "B1, B2");
  ok("diagLoadTargets: /items parsed (both item shapes), null entries dropped");

  // regression (device-found, 2026-10-23): an /items payload larger than
  // 8000 chars must still parse — rawApi truncation corrupted it on-device
  const bigItem = { item: { uri: "spotify:track:BIG", name: "Big " + "x".repeat(12000), artists: [{ name: "A" }] } };
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ items: [bigItem] }), json: async () => ({}) });
  const big = await T.diagLoadTargets();
  assert.strictEqual(big.length, 1);
  assert.strictEqual(big[0].uri, "spotify:track:BIG");
  ok("diagLoadTargets: oversized (>8000 char) payload parses — truncation regression closed");

  console.log("U5C tests: " + pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });

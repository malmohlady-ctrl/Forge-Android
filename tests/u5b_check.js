"use strict";
/* U5 Phase B checks: playlist mapping (extracted from the web apps),
   spike->music storage migration, play-body semantics (context+offset /
   resume / fresh context), device picking (the original's order), playback
   state application, and live request construction for play/pause through a
   stubbed fetch — plus mount-point wiring in all three module renderers. */
const assert = require("assert"), fs = require("fs"), vm = require("vm"), path = require("path");
global.window = globalThis;
const lsData = {};
global.localStorage = { getItem: (k) => (k in lsData ? lsData[k] : null), setItem: (k, v) => { lsData[k] = String(v); }, removeItem: (k) => { delete lsData[k]; } };
global.document = { getElementById: () => null, querySelector: () => null, head: { appendChild() {} }, createElement: () => ({ style: {}, classList: { toggle() {} }, addEventListener() {}, appendChild() {}, querySelector: () => null }) };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "unified", "music.js"), "utf8"), { filename: "music.js" });

let pass = 0; const ok = (name) => { pass++; console.log("  ✓ " + name); };
const FM = window.ForgeMusic, T = FM._test, S = T.S;

(async () => {
  assert.strictEqual(FM.PLAYLISTS.train.id, "2oOPWpO9fqJUGhjunEAj6h");
  assert.strictEqual(FM.PLAYLISTS.run.id, "3ETB46pxe9p8uaCgji0xbY");
  assert.strictEqual(FM.PLAYLISTS.yoga.id, "1jltX5L6gM6SKfYAuE2sLx");
  ok("playlist IDs match the web apps' extracted configs (train/run/yoga)");

  // migration: spike keys seed music keys, music keys win when both exist
  lsData["spotify.spike.cfg"] = JSON.stringify({ clientId: "spikeCID", redirectUri: "com.malmohlady.theforge://spotify-callback" });
  lsData["spotify.spike.tokens"] = JSON.stringify({ access: "a", refresh: "r", expires: Date.now() + 3600e3 });
  T.migrate();
  assert.strictEqual(JSON.parse(lsData["spotify.music.cfg"]).clientId, "spikeCID");
  assert.strictEqual(JSON.parse(lsData["spotify.music.tokens"]).refresh, "r");
  lsData["spotify.music.cfg"] = JSON.stringify({ clientId: "musicCID", redirectUri: "x" });
  T.migrate();
  assert.strictEqual(JSON.parse(lsData["spotify.music.cfg"]).clientId, "musicCID");
  ok("migration: spike cfg+tokens copied once; existing music values never overwritten");

  // play-body semantics (the web player's rules)
  S.module = "run"; S.tracks = [{ uri: "spotify:track:T1" }, { uri: "spotify:track:T2" }]; S.currentUri = "spotify:track:T1";
  assert.deepStrictEqual(T.playBody("spotify:track:T2"), { context_uri: "spotify:playlist:3ETB46pxe9p8uaCgji0xbY", offset: { uri: "spotify:track:T2" } });
  assert.strictEqual(T.playBody(undefined), undefined, "resume in place when current track is in this playlist");
  S.currentUri = "spotify:track:ELSEWHERE";
  assert.deepStrictEqual(T.playBody(undefined), { context_uri: "spotify:playlist:3ETB46pxe9p8uaCgji0xbY" });
  ok("play body: track tap = context+offset · resume = no body · foreign context = fresh playlist context");

  // device picking order: active > smartphone > first
  assert.strictEqual(T.pickDevice([{ id: "a", type: "Computer", is_active: false }, { id: "b", type: "Smartphone", is_active: false }]).id, "b");
  assert.strictEqual(T.pickDevice([{ id: "a", type: "Computer", is_active: false }, { id: "c", type: "TV", is_active: true }]).id, "c");
  assert.strictEqual(T.pickDevice([]), null);
  ok("device picking: active first, then smartphone, then first, none -> null");

  // playback-state application
  T.applyPlayback({ device: { id: "dev9" }, is_playing: true, shuffle_state: true, repeat_state: "track", progress_ms: 42000, item: { uri: "spotify:track:T2", duration_ms: 201000 } });
  assert.strictEqual(S.deviceId, "dev9"); assert.strictEqual(S.isPlaying, true); assert.strictEqual(S.shuffle, true);
  assert.strictEqual(S.repeat, "track"); assert.strictEqual(S.currentUri, "spotify:track:T2"); assert.strictEqual(S.durationMs, 201000); assert.strictEqual(S.progressMs, 42000);
  ok("applyPlayback maps the /me/player payload onto player state");

  // live request construction through a stubbed fetch (tokens seeded above)
  lsData["spotify.music.cfg"] = JSON.stringify({ clientId: "cid", redirectUri: "com.malmohlady.theforge://spotify-callback" });
  lsData["spotify.music.tokens"] = JSON.stringify({ access: "tok", refresh: "ref", expires: Date.now() + 3600e3 });
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", body: opts.body || null, auth: (opts.headers || {}).Authorization });
    if (url.includes("/me/player/devices")) return { ok: true, status: 200, json: async () => ({ devices: [{ id: "dev9", type: "Smartphone", is_active: true }] }) };
    if (url.includes("/me/player") && (opts.method || "GET") === "GET") return { ok: true, status: 200, json: async () => ({ device: { id: "dev9" }, is_playing: true, progress_ms: 1000, item: { uri: "spotify:track:T2", duration_ms: 201000 } }) };
    return { ok: true, status: 204, json: async () => ({}) };
  };
  S.deviceId = "dev9"; S.module = "run"; S.tracks = [{ uri: "spotify:track:T2" }]; S.currentUri = null;
  await T.play("spotify:track:T2");
  const playCall = calls.find((c) => c.url.includes("/me/player/play"));
  assert.ok(playCall && playCall.method === "PUT" && playCall.url.includes("device_id=dev9") && playCall.auth === "Bearer tok");
  assert.deepStrictEqual(JSON.parse(playCall.body), { context_uri: "spotify:playlist:3ETB46pxe9p8uaCgji0xbY", offset: { uri: "spotify:track:T2" } });
  ok("play(): PUT /me/player/play?device_id with context+offset body and bearer token");
  await T.pausePlayback();
  const pauseCall = calls.find((c) => c.url.endsWith("/me/player/pause"));
  assert.ok(pauseCall && pauseCall.method === "PUT");
  ok("pause(): PUT /me/player/pause");
  await T.loadPlaylist();
  const plCall = calls.find((c) => c.url.includes("/playlists/3ETB46pxe9p8uaCgji0xbY/items"));
  assert.ok(plCall, "playlist tracks requested for the active module");
  ok("loadPlaylist(): GET the module playlist's items (Feb 2026 endpoint)");

  // now-playing title resolution: playlist match > /me item > playlist/loading
  T.applyPlayback({ device: { id: "dev9" }, is_playing: false, progress_ms: 5000, item: { uri: "spotify:track:NP", duration_ms: 200000, name: "Rich Flex", artists: [{ name: "Drake" }, { name: "21 Savage" }] } });
  assert.strictEqual(S.nowTitle, "Rich Flex");
  let rt = T.resolveTitle();
  assert.strictEqual(rt.title, "Rich Flex"); assert.strictEqual(rt.artist, "Drake, 21 Savage");
  S.tracks = [{ uri: "spotify:track:NP", title: "Rich Flex (list)", artist: "Drake" }];
  rt = T.resolveTitle();
  assert.strictEqual(rt.title, "Rich Flex (list)", "playlist entry wins over the /me copy");
  S.tracks = []; S.nowTitle = ""; S.currentUri = "spotify:track:NP";
  assert.strictEqual(T.resolveTitle().title, "Loading…");
  ok("title resolution: now-playing name shows even when the track list can't load");

  // loadPlaylist failure surfaces the HTTP status instead of failing silently
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes("/playlists/")) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  S.module = "train"; S.tracks = [{ uri: "x" }];
  await T.loadPlaylist();
  assert.strictEqual(S.tracks.length, 0);
  assert.ok(S.lastStatus && S.lastStatus.includes("403"), "status carries the HTTP code: " + S.lastStatus);
  ok("loadPlaylist: a Spotify refusal is surfaced with its status code, never silent");

  // Feb-2026 endpoint migration: /items parses (item shape), /tracks fallback parses (track shape)
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/items")) return { ok: true, status: 200, json: async () => ({ items: [{ item: { uri: "spotify:track:I1", name: "Items Song", duration_ms: 187000, artists: [{ name: "A One" }] } }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  S.module = "yoga";
  await T.loadPlaylist();
  assert.strictEqual(S.tracks.length, 1); assert.strictEqual(S.tracks[0].title, "Items Song"); assert.strictEqual(S.tracks[0].duration, 187);
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/items")) return { ok: false, status: 403, json: async () => ({}) };
    if (u.includes("/tracks")) return { ok: true, status: 200, json: async () => ({ items: [{ track: { uri: "spotify:track:T9", name: "Legacy Song", duration_ms: 201000, artists: [{ name: "B Two" }] } }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await T.loadPlaylist();
  assert.strictEqual(S.tracks.length, 1); assert.strictEqual(S.tracks[0].title, "Legacy Song");
  ok("playlist fetch: /items primary (item shape), /tracks fallback (track shape) — Feb 2026 migration handled");

  // mount wiring in the three module renderers
  for (const [file, mod, mountId] of [["train.js", "train", "trMusic"], ["run.js", "run", "rnMusic"], ["yoga.js", "yoga", "ygMusic"]]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "unified", file), "utf8");
    assert.ok(src.includes('id="' + mountId + '"'), file + " has the mount point");
    assert.ok(src.includes('ForgeMusic.mount("' + mod + '"'), file + " mounts ForgeMusic for " + mod);
  }
  ok("all three module views carry a music mount point + mount call");
  console.log("U5B tests: " + pass + " passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

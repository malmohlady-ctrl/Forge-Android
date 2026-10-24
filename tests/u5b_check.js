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
T.setVerifyDelays([0, 0]);

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
  T.applyPlayback({ device: { id: "dev9", name: "Malcolm's Phone" }, context: { uri: "spotify:playlist:PLX", type: "playlist" }, is_playing: true, shuffle_state: true, repeat_state: "track", progress_ms: 42000, item: { uri: "spotify:track:T2", duration_ms: 201000 } });
  assert.strictEqual(S.deviceName, "Malcolm's Phone"); assert.strictEqual(S.contextUri, "spotify:playlist:PLX");
  assert.strictEqual(S.deviceId, "dev9"); assert.strictEqual(S.isPlaying, true); assert.strictEqual(S.shuffle, true);
  assert.strictEqual(S.repeat, "track"); assert.strictEqual(S.currentUri, "spotify:track:T2"); assert.strictEqual(S.durationMs, 201000); assert.strictEqual(S.progressMs, 42000);
  ok("applyPlayback maps the /me/player payload onto player state (+ device/context telemetry)");

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
  assert.ok(playCall && playCall.method === "PUT" && !playCall.url.includes("device_id") && playCall.auth === "Bearer tok", "first play attempt addresses the active device implicitly, like pause/next");
  assert.deepStrictEqual(JSON.parse(playCall.body), { context_uri: "spotify:playlist:3ETB46pxe9p8uaCgji0xbY", offset: { uri: "spotify:track:T2" } });
  ok("play(): PUT /me/player/play with the playlist-jump body and bearer auth (implicit device, always)");
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

  // selection ladder: context refused -> DIRECT play of the exact URI (never a bare playlist start)
  {
    const bodies = [];
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("/me/player/play")) {
        bodies.push(opts.body ? JSON.parse(opts.body) : null);
        if (opts.body && opts.body.includes("offset")) return { ok: false, status: 403, json: async () => ({ error: { status: 403, message: "Restriction violated" } }) };
        return { ok: true, status: 204, json: async () => ({}) };
      }
      if (u.includes("/me/player/devices")) return { ok: true, status: 200, json: async () => ({ devices: [{ id: "dev9", type: "Smartphone", is_active: true }] }) };
      if (u.includes("/me/player")) return { ok: true, status: 200, json: async () => ({ device: { id: "dev9" }, is_playing: true, progress_ms: 1, item: { uri: "spotify:track:T2", duration_ms: 1000 } }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    S.module = "run"; S.deviceId = "dev9"; S.tracks = [{ uri: "spotify:track:T2", title: "T2" }]; S.currentUri = null; S.lastStatus = "";
    await T.play("spotify:track:T2");
    assert.strictEqual(bodies.length, 2, "playlist jump + direct attempt");
    assert.ok(bodies[0].offset && bodies[0].offset.uri === "spotify:track:T2" && bodies[0].context_uri === "spotify:playlist:3ETB46pxe9p8uaCgji0xbY", "attempt A is the run playlist jump to the exact tapped URI");
    assert.deepStrictEqual(bodies[1], { uris: ["spotify:track:T2"] }, "attempt B is a direct play of the exact same URI");
    assert.ok(!bodies.some((b) => b && b.context_uri && !b.offset && !b.uris), "a bare playlist start is NEVER substituted for the requested song");
    assert.strictEqual(S.lastSel.via, "direct");
    assert.ok(S.selLog.join(" ").includes("playlist jump -> 403") && S.selLog.join(" ").includes("direct -> 204"), "per-attempt statuses captured: " + S.selLog.join(", "));
    console.log("  ✓ selection ladder: playlist jump refused (403) -> direct play of the exact URI, confirmed; no playlist substitution");
    pass++;
  }

  // U5D (panel-proven): a 404 with zero devices -> the WAKE outcome, and no
  // play call ever names a device_id (explicit device targeting empties the
  // session on his phone — U5C buttons C/D)
  {
    const playUrls = [];
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("/me/player/play")) { playUrls.push(u); return { ok: false, status: 404, text: async () => "{}", json: async () => ({ error: { status: 404, message: "No active device found" } }) }; }
      if (u.includes("/me/player/devices")) return { ok: true, status: 200, text: async () => JSON.stringify({ devices: [] }), json: async () => ({ devices: [] }) };
      if (u.includes("/me/player")) return { ok: true, status: 200, text: async () => "", json: async () => ({ device: { id: "dev9" }, is_playing: false, progress_ms: 0, item: null }) };
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    };
    S.module = "run"; S.deviceId = null; S.tracks = [{ uri: "spotify:track:T2", title: "T2" }]; S.currentUri = null; S.wakeUri = null;
    await T.play("spotify:track:T2");
    assert.strictEqual(playUrls.length, 2, "playlist jump + direct, both implicit");
    assert.ok(!playUrls.some((x) => x.includes("device_id")), "no play call ever names a device: " + playUrls.join(" | "));
    assert.strictEqual(S.lastSel.via, "wake");
    assert.strictEqual(S.wakeUri, "spotify:track:T2");
    assert.ok(S.lastStatus.includes("asleep"), "the wake is explained in the status line: " + S.lastStatus);
    console.log("  ✓ selection: 404 + zero devices -> wake outcome; device_id never sent");
    pass++;
  }

  /* ================= acceptance: track selection (U5 fix brief) ================= */
  function installWorld(behavior = {}) {
    const world = { current: behavior.current || null, playing: !!behavior.playing, bodies: [], playCalls: 0, getCount: 0 };
    global.fetch = async (url, opts = {}) => {
      const u = String(url), m = opts.method || "GET";
      if (u.includes("accounts.spotify.com")) return { ok: true, status: 200, json: async () => ({ access_token: "tok-fresh", refresh_token: "ref", expires_in: 3600 }) };
      if (u.includes("/me/player/play") && m === "PUT") {
        world.playCalls++;
        const body = opts.body ? JSON.parse(opts.body) : null;
        world.bodies.push(body);
        if (behavior.onPlay) { const r = behavior.onPlay(body, world); if (r) return r; }
        world.current = (body && body.offset && body.offset.uri) || (body && body.uris && body.uris[0]) || world.current;
        world.playing = true;
        return { ok: true, status: 204, json: async () => ({}) };
      }
      if (u.includes("/me/player/devices")) return { ok: true, status: 200, json: async () => ({ devices: [{ id: "dev9", type: "Smartphone", is_active: true, name: "Phone" }] }) };
      if (u.includes("/me/player") && m === "GET") {
        world.getCount++;
        const cur = behavior.state ? behavior.state(world) : world.current;
        if (!cur) return { ok: true, status: 200, json: async () => ({ device: { id: "dev9", name: "Phone" }, is_playing: world.playing, progress_ms: 0, item: null }) };
        return { ok: true, status: 200, json: async () => ({ device: { id: "dev9", name: "Phone" }, is_playing: world.playing, progress_ms: 0, item: { uri: cur, duration_ms: 180000, name: "Song", artists: [{ name: "Artist" }] } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    return world;
  }
  const seedSel = (mod, tracks) => { S.module = mod; S.tracks = tracks; S.deviceId = "dev9"; };

  // first / middle / last track in EACH module, with the module's own playlist context
  for (const mod of ["train", "run", "yoga"]) {
    const tracks = [0, 1, 2].map((i) => ({ uri: "spotify:track:" + mod + i, title: mod + " song " + i, artist: "A", duration: 180 }));
    for (const idx of [0, 1, 2]) {
      const w = installWorld({ current: "spotify:track:other", playing: true });
      seedSel(mod, tracks);
      await T.play(tracks[idx].uri);
      assert.strictEqual(w.bodies.length, 1, mod + " idx " + idx + ": one playlist-jump attempt");
      assert.strictEqual(w.bodies[0].context_uri, "spotify:playlist:" + FM.PLAYLISTS[mod].id, mod + " uses its OWN playlist");
      assert.strictEqual(w.bodies[0].offset.uri, tracks[idx].uri);
      assert.strictEqual(S.lastSel.via, "playlist");
    }
  }
  ok("acceptance: first/middle/last track selectable in Train, Run and Yoga — each with its own playlist context");

  // selecting while playing, while paused, and selecting the currently-playing track
  {
    const tracks = [{ uri: "spotify:track:N1", title: "N1" }, { uri: "spotify:track:N2", title: "N2" }];
    let w = installWorld({ current: "spotify:track:N1", playing: true });
    seedSel("train", tracks); await T.play("spotify:track:N2");
    assert.strictEqual(S.lastSel.via, "playlist"); assert.strictEqual(S.currentUri, "spotify:track:N2");
    w = installWorld({ current: "spotify:track:N1", playing: false });
    seedSel("train", tracks); await T.play("spotify:track:N2");
    assert.strictEqual(S.lastSel.via, "playlist"); assert.strictEqual(S.lastSel.playing, true);
    w = installWorld({ current: "spotify:track:N1", playing: true });
    seedSel("train", tracks); await T.play("spotify:track:N1");
    assert.strictEqual(S.lastSel.via, "playlist"); assert.strictEqual(w.bodies.length, 1);
  }
  ok("acceptance: select while playing, while paused, and the already-playing track");

  // accepted, but playback state lags: second verify poll confirms — no direct attempt
  {
    let polls = 0;
    const w = installWorld({ current: "spotify:track:OLD", playing: true, onPlay: () => { polls = 0; }, state: () => (++polls < 2 ? "spotify:track:OLD" : "spotify:track:LAG") });
    seedSel("run", [{ uri: "spotify:track:LAG", title: "Lag" }]);
    await T.play("spotify:track:LAG");
    assert.strictEqual(S.lastSel.via, "playlist");
    assert.strictEqual(w.bodies.length, 1, "lagging state must not trigger a needless second attempt");
  }
  ok("acceptance: accepted request with lagging playback state confirms via polling (stale state tolerated)");

  // accepted, never reflected: direct fallback of the SAME uri confirms
  {
    let direct = false;
    const w = installWorld({ current: "spotify:track:OLD", playing: true, onPlay: (body) => { if (body && body.uris) direct = true; }, state: () => (direct ? "spotify:track:NV" : "spotify:track:OLD") });
    seedSel("yoga", [{ uri: "spotify:track:NV", title: "NV" }]);
    await T.play("spotify:track:NV");
    assert.strictEqual(S.lastSel.via, "direct");
    assert.strictEqual(w.bodies.length, 2);
    assert.deepStrictEqual(w.bodies[1], { uris: ["spotify:track:NV"] });
  }
  ok("acceptance: accepted-but-not-reflected playlist jump falls back to direct play of the same URI");

  // both attempts fail: clear error, no substitution, no fake success
  {
    const w = installWorld({ current: "spotify:track:OLD", playing: true, onPlay: () => ({ ok: false, status: 403, json: async () => ({ error: { status: 403, message: "Restriction violated" } }) }) });
    seedSel("train", [{ uri: "spotify:track:F1", title: "F Song" }]);
    await T.play("spotify:track:F1");
    assert.strictEqual(S.lastSel.result, "failed");
    assert.ok(S.lastStatus.includes("Couldn't start") && S.lastStatus.includes("403"), "clear error shown: " + S.lastStatus);
    assert.ok(!w.bodies.some((b) => b && b.context_uri && !b.offset), "no bare playlist start was substituted");
  }
  ok("acceptance: playlist jump + direct both fail -> explicit error, requested track never faked");

  // rapid consecutive selections: the LAST tap wins, the superseded one goes silent
  {
    const w = installWorld({ current: "spotify:track:OLD", playing: true });
    seedSel("run", [{ uri: "spotify:track:RA", title: "RA" }, { uri: "spotify:track:RB", title: "RB" }]);
    const pa = T.play("spotify:track:RA");
    const pb = T.play("spotify:track:RB");
    await Promise.all([pa, pb]);
    assert.strictEqual(S.lastSel.uri, "spotify:track:RB");
    assert.strictEqual(S.currentUri, "spotify:track:RB");
  }
  ok("acceptance: rapid consecutive selections — latest tap wins, earlier attempt cannot overwrite state");

  // network loss on the play requests
  {
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("/me/player/play")) throw new TypeError("Failed to fetch");
      if (u.includes("/me/player")) return { ok: true, status: 200, json: async () => ({ device: { id: "dev9" }, is_playing: false, progress_ms: 0, item: null }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    seedSel("train", [{ uri: "spotify:track:NET", title: "Net" }]);
    await T.play("spotify:track:NET");
    assert.strictEqual(S.lastSel.result, "failed");
    assert.ok(S.lastStatus.includes("network error"), "network failure described: " + S.lastStatus);
  }
  ok("acceptance: network loss -> explicit network error (no silent failure)");

  // expired access token: 401 -> silent refresh -> retry succeeds
  {
    let playAttempts = 0;
    const w = installWorld({ current: "spotify:track:OLD", playing: true, onPlay: () => { playAttempts++; if (playAttempts === 1) return { ok: false, status: 401, json: async () => ({ error: { status: 401, message: "The access token expired" } }) }; } });
    seedSel("yoga", [{ uri: "spotify:track:TOK", title: "Tok" }]);
    await T.play("spotify:track:TOK");
    assert.strictEqual(playAttempts, 2, "the request was retried after the token refresh");
    assert.strictEqual(S.lastSel.via, "playlist");
  }
  ok("acceptance: expired token (401) refreshes silently and the selection completes");

  // rate limiting: 429 on both attempts -> explicit rate-limit error
  {
    installWorld({ current: "spotify:track:OLD", playing: true, onPlay: () => ({ ok: false, status: 429, json: async () => ({ error: { status: 429, message: "API rate limit exceeded" } }) }) });
    seedSel("run", [{ uri: "spotify:track:RL", title: "RL" }]);
    await T.play("spotify:track:RL");
    assert.strictEqual(S.lastSel.result, "failed");
    assert.ok(S.lastStatus.includes("429") && S.lastStatus.toLowerCase().includes("rate limited"), "rate limit described: " + S.lastStatus);
  }
  ok("acceptance: Spotify 429 -> explicit rate-limit error");

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

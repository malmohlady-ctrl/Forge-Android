"use strict";
/* U7 Part A — production identity + cleanup. Static checks only: no device
   behaviour is claimed here. The Samsung battery (drill, migration, device
   pass) is Malcolm's, per the U7 brief. Part B (keystore, distribution) is
   NOT covered here — it is unauthorized and untouched. */
const assert = require("assert"), fs = require("fs"), path = require("path");
const R = (...p) => path.join(__dirname, "..", ...p);
const read = (p) => fs.readFileSync(R(...p), "utf8");
let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log("  ✓ " + name); };

const app = read(["unified", "app.js"]);
const music = read(["unified", "music.js"]);
const cfg = JSON.parse(read(["capacitor.config.json"]));
const gradle = read(["android", "app", "build.gradle"]);
const strings = read(["android", "app", "src", "main", "res", "values", "strings.xml"]);
const workflow = read([".github", "workflows", "unified.yml"]);

ok("U5C panel gone from the Spotify view", () => {
  for (const bad of ["Selection diagnostics", "wireDiagnostics", "dgLog", "dgTargets",
    "spotify.diag.log", "diagDevices", "diagNowPlaying", "setDiagTarget", "pickPhone", "dgWait"]) {
    assert.ok(!music.includes(bad), "panel marker still present: " + bad);
  }
  assert.ok(music.includes("🎧 Spotify") && music.includes("Module playlists"),
    "Spotify view lost its kept cards");
});

ok("U5C plumbing kept, not orphaned: rawApi + diagLoadTargets still exported", () => {
  assert.ok(music.includes("async function rawApi(method, path, body)"));
  assert.ok(music.includes("async function diagLoadTargets()"));
  assert.ok(music.includes("rawApi,") && music.includes("diagLoadTargets"));
});

ok("U0 Diagnostics unreachable from the production interface", () => {
  assert.ok(!app.includes("show('diag')"), "Diagnostics button still routes");
  assert.ok(!app.includes('diag: "U0 Diagnostics"'), "Diagnostics title still routed");
  assert.ok(!app.includes("diag: window.renderDiag"), "Diagnostics still in render map");
  assert.ok(!app.includes("test him in Diagnostics"), "dangling Diagnostics blurb");
  // Deliberately kept: the function + diag.js are test infrastructure, not UI.
  assert.ok(app.includes("window.renderDiag = function"), "renderDiag removed (u0_check needs it)");
  assert.ok(fs.existsSync(R("unified", "diag.js")));
});

ok("Production identity: appId, label, version agree everywhere", () => {
  assert.strictEqual(cfg.appId, "com.malmohlady.theforge");
  assert.strictEqual(cfg.appName, "The Forge");
  assert.ok(gradle.includes('applicationId "com.malmohlady.theforge"'));
  assert.ok(!gradle.includes("u0test"), "test appId still in build.gradle");
  assert.ok(gradle.includes('versionName "1.0.0"'));
  assert.ok(strings.includes('<string name="app_name">The Forge</string>'));
  assert.ok(strings.includes('<string name="title_activity_main">The Forge</string>'));
  assert.ok(!strings.includes("Forge U0 Test"));
  assert.ok(!read(["capacitor.config.json"]).includes("u0test"));
});

ok("Spotify redirect unchanged (production string by design)", () => {
  const manifest = read(["android", "app", "src", "main", "AndroidManifest.xml"]);
  assert.ok(manifest.includes('android:scheme="com.malmohlady.theforge"'));
  assert.ok(music.includes('const DEFAULT_REDIRECT = "com.malmohlady.theforge://spotify-callback"'));
});

ok("FE1 launcher icon present at every density, adaptive-safe", () => {
  // Pixel sizes read from each PNG's IHDR (a solid-black PNG compresses tiny).
  const dims = (p) => { const b = fs.readFileSync(p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const want = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
  for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
    for (const f of ["ic_launcher.png", "ic_launcher_round.png"]) {
      const p = R("android", "app", "src", "main", "res", "mipmap-" + d, f);
      assert.ok(fs.existsSync(p), "missing " + p);
      assert.deepStrictEqual(dims(p), [want[d][0], want[d][0]], "wrong size " + p);
    }
    for (const f of ["ic_launcher_foreground.png", "ic_launcher_background.png"]) {
      const p = R("android", "app", "src", "main", "res", "mipmap-" + d, f);
      assert.ok(fs.existsSync(p), "missing " + p);
      assert.deepStrictEqual(dims(p), [want[d][1], want[d][1]], "wrong size " + p);
    }
  }
  const bg = read(["android", "app", "src", "main", "res", "values", "ic_launcher_background.xml"]);
  assert.ok(bg.includes("#000000"), "adaptive background not seamless black");
  const ad = read(["android", "app", "src", "main", "res", "mipmap-anydpi-v26", "ic_launcher.xml"]);
  assert.ok(ad.includes("@mipmap/ic_launcher_foreground") && ad.includes("@color/ic_launcher_background"));
});

ok("CI builds u7-release and uploads a distinctly named Part A artifact", () => {
  assert.ok(workflow.includes("u7-release"), "u7-release not in workflow branches");
  assert.ok(workflow.includes("forge-u7-part-a-apk"), "Part A artifact name missing");
  assert.ok(workflow.includes("node tests/u7_check.js"), "u7_check not in CI");
  assert.ok(workflow.includes("assembleDebug"), "Part A must stay debug-signed (Part B locked)");
});

ok("Part B untouched: no release signing config, no store artifacts", () => {
  assert.ok(!gradle.includes("signingConfig") && !gradle.includes("keystore"));
  assert.ok(!read(["android", "app", "build.gradle"]).includes("releaseSigning"));
});

console.log("U7 Part A checks: " + pass + " ok-lines green");

"use strict";
/* U2 spike tests (Node, synthetic coordinates only).
   The acceptance rules tested here are the original Couch rules — see
   gps-core.js's header for the spec read from the pinned source. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const U = path.join(__dirname, "..", "unified");
const ROOT = path.join(__dirname, "..");
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log("  ✓ " + name); };

global.window = globalThis;
require(path.join(U, "gps-core.js"));
const G = global.ForgeGPS;
assert.ok(G, "ForgeGPS exposed");

const BASE = { latitude: 49.888, longitude: -119.496, accuracy: 8 };
// ~111.19 m per 0.001 deg of latitude
const north = (m) => ({ latitude: BASE.latitude + m / 111190, longitude: BASE.longitude, accuracy: 8 });

ok("haversine: 0.001 deg latitude = ~111.2 m; identical points = 0", () => {
  const d = G.havKm({ lat: 49.888, lon: -119.496 }, { lat: 49.889, lon: -119.496 }) * 1000;
  assert.ok(Math.abs(d - 111.19) < 0.5, "got " + d);
  assert.strictEqual(G.havKm({ lat: 1, lon: 1 }, { lat: 1, lon: 1 }), 0);
});
ok("accuracy rule: 40 m accepted, 41 m dropped, missing accuracy accepted", () => {
  const f = G.createFilter();
  assert.strictEqual(f.push({ ...BASE, accuracy: 40 }, 0).accepted, true);
  assert.strictEqual(f.push({ ...north(100), accuracy: 41 }, 10000).reason, "accuracy");
  const f2 = G.createFilter();
  assert.strictEqual(f2.push({ latitude: 49.888, longitude: -119.496 }, 0).accepted, true);
});
ok("jitter rule: <8 m AND <15 s drops; either condition false accepts", () => {
  const f = G.createFilter();
  f.push(BASE, 0);
  assert.strictEqual(f.push(north(5), 10000).reason, "jitter");       // 5 m, 10 s -> dropped
  assert.strictEqual(f.push(north(5), 20000).accepted, true);          // 5 m, 20 s -> accepted
  const f2 = G.createFilter();
  f2.push(BASE, 0);
  assert.strictEqual(f2.push(north(9), 5000).accepted, true);         // 9 m, 5 s -> accepted
});
ok("teleport rule: >16.7 m/s drops; plausible speed accepts", () => {
  const f = G.createFilter();
  f.push(BASE, 0);
  assert.strictEqual(f.push(north(200), 5000).reason, "teleport");    // 40 m/s
  assert.strictEqual(f.push(north(200), 20000).accepted, true);       // 10 m/s (running+, plausible)
});
ok("duplicate timestamps: dt=0 same spot drops as jitter; dt=0 far fix ACCEPTED (documented original quirk)", () => {
  const f = G.createFilter();
  f.push(BASE, 1000);
  assert.strictEqual(f.push(north(2), 1000).reason, "jitter");
  const f2 = G.createFilter();
  f2.push(BASE, 1000);
  assert.strictEqual(f2.push(north(100), 1000).accepted, true);       // dt=0: teleport check cannot fire
});
ok("gap: a 120 s silence credits only the straight line between bracketing fixes — no phantom distance", () => {
  const f = G.createFilter(); const pts = [];
  const a = f.push(BASE, 0); if (a.accepted) pts.push(a.point);
  const b = f.push(north(300), 120000); if (b.accepted) pts.push(b.point);
  assert.ok(Math.abs(G.trackKm(pts) - 0.3) < 0.005, "distance " + G.trackKm(pts));
});
ok("downsample caps a saved track at 300 points (every k-th)", () => {
  const pts = Array.from({ length: 900 }, (_, i) => ({ lat: 49 + i * 1e-5, lon: -119, t: i }));
  assert.strictEqual(G.downsample(pts).length, 300);
  assert.strictEqual(G.downsample(pts.slice(0, 10)).length, 10);
});
ok("spike wiring: manifest permissions, plugin registration, probe presence", () => {
  const man = fs.readFileSync(path.join(ROOT, "android/app/src/main/AndroidManifest.xml"), "utf8");
  assert.ok(man.includes("ACCESS_FINE_LOCATION") && man.includes("ACCESS_COARSE_LOCATION"));
  const ma = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/com/malmohlady/theforge/MainActivity.java"), "utf8");
  assert.ok(ma.includes("registerPlugin(GpsPermPlugin.class)"));
  const plug = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/com/malmohlady/theforge/GpsPermPlugin.java"), "utf8");
  assert.ok(plug.includes('@Permission(alias = "location"') && plug.includes("ACCESS_FINE_LOCATION"));
  assert.ok(fs.readFileSync(path.join(U, "index.html"), "utf8").includes('src="gps-core.js"'));
  const diag = fs.readFileSync(path.join(U, "diag.js"), "utf8");
  assert.ok(diag.includes("gpsWatch") && diag.includes("ForgeGPS.createFilter"));
  const app = fs.readFileSync(path.join(U, "app.js"), "utf8");
  assert.ok(app.includes("GPS probe (U2 spike)"));
});

console.log("U2 spike tests: " + pass + " passed");

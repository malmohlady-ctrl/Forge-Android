"use strict";
/* Unified Forge — GPS core (U2 spike).
   The fix-acceptance rules below are the ORIGINAL Couch to 5K rules, read
   from the pinned source (Couch-to-5k @ 0015723, index.html GPS block) and
   preserved exactly:
     - watch options: enableHighAccuracy, maximumAge 2000, timeout 20000
       (applied by the caller starting the watch);
     - a fix is dropped when its accuracy is present and worse than 40 m;
     - an accepted point is {lat, lon} rounded to 6 dp, timestamped with
       Date.now() at callback time (NOT pos.timestamp);
     - vs the last ACCEPTED point: dropped when dM < 8 m AND dt < 15 s
       (stationary jitter), and dropped when dt > 0 and dM/dt > 16.7 m/s
       (~60 km/h teleport filter);
     - documented quirk, preserved: with dt = 0 the teleport check cannot
       fire, so a same-millisecond fix >= 8 m away is accepted.
     - the running/paused gate lives in the caller, as in the original.
   Saved tracks are downsampled to at most 300 points (every k-th point).
   Everything is computed and stored on-device. */
(function () {
  function havKm(a, b) { const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
  function trackKm(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += havKm(pts[i - 1], pts[i]); return d; }
  function downsample(pts, max) { max = max || 300; if (pts.length <= max) return pts; const st = Math.ceil(pts.length / max); return pts.filter((_, i) => i % st === 0); }
  function createFilter() {
    let last = null;
    const counts = { accepted: 0, accuracy: 0, jitter: 0, teleport: 0 };
    return {
      counts,
      last: () => last,
      push(c, tNow) {
        if (c.accuracy && c.accuracy > 40) { counts.accuracy++; return { accepted: false, reason: "accuracy" }; }
        const p = { lat: +(+c.latitude).toFixed(6), lon: +(+c.longitude).toFixed(6), t: tNow };
        if (last) {
          const dM = havKm(last, p) * 1000, dt = (p.t - last.t) / 1000;
          if (dM < 8 && dt < 15) { counts.jitter++; return { accepted: false, reason: "jitter" }; }
          if (dt > 0 && dM / dt > 16.7) { counts.teleport++; return { accepted: false, reason: "teleport" }; }
        }
        last = p; counts.accepted++;
        return { accepted: true, point: p };
      },
    };
  }
  window.ForgeGPS = { havKm, trackKm, downsample, createFilter, WATCH_OPTS: { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 } };
})();

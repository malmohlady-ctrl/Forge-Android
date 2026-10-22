"use strict";
/* Unified Forge — shared audio core (U0).
   One persistent <audio> element for coach clips, unlocked by the first user
   gesture; Web Audio for chimes/beeps. Fixes the M1 F2 class: no fresh
   Audio() elements created programmatically per cue (Android WebView's
   gesture policy rejects those). The native shell also sets
   mediaPlaybackRequiresUserGesture=false (MainActivity) as a second layer.
   Each discipline keeps its OWN clips/voice — this is plumbing only. */
(function (global) {
  let el = null, ctx = null, unlocked = false;

  function ensureEl() {
    if (el) return el;
    el = document.createElement("audio");
    el.preload = "auto";
    el.style.display = "none";
    document.body.appendChild(el);
    return el;
  }
  function ensureCtx() {
    if (!ctx) { const AC = global.AudioContext || global.webkitAudioContext; if (AC) ctx = new AC(); }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function unlock() {
    ensureEl(); ensureCtx();
    if (!unlocked) {
      // A muted micro-play inside the gesture handler marks the element as
      // gesture-blessed for the rest of the session.
      el.muted = true;
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
      el.pause(); el.muted = false;
      unlocked = true;
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", unlock, { passive: true });
    document.addEventListener("keydown", unlock);
  }

  function playClip(url, opts) {
    opts = opts || {};
    ensureEl(); ensureCtx();
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok, err) => { if (!done) { done = true; resolve({ ok, err: err || null }); } };
      el.onended = () => finish(true);
      el.onerror = () => finish(false, "audio element error");
      el.src = url;
      if (opts.rate) { try { el.playbackRate = opts.rate; } catch (e) {} }
      const p = el.play();
      if (p && p.then) p.then(() => { if (el.paused) finish(true); }).catch((e) => finish(false, String(e && e.name || e)));
      // If the clip is very short or already cached, 'ended' resolves; a
      // safety timeout keeps callers from hanging on a stalled element.
      setTimeout(() => { if (!el.paused && !el.ended) return; finish(el.ended); }, (opts.timeoutMs || 15000));
    });
  }
  function stop() { if (el) { try { el.pause(); } catch (e) {} } }

  function tone(freq, durMs, type, gainVal, when) {
    const ac = ensureCtx(); if (!ac) return;
    const t0 = ac.currentTime + (when || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainVal || 0.15, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + durMs / 1000 + 0.05);
  }
  const chime = () => tone(432, 900, "sine", 0.18);          // Namastay transition chime
  const beep = () => tone(880, 120, "sine", 0.10);            // UI tick

  global.ForgeAudio = { unlock, playClip, stop, tone, chime, beep, _state: () => ({ unlocked, hasCtx: !!ctx }) };
})(typeof window !== "undefined" ? window : globalThis);

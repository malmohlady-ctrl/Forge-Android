/* FIT HQ extras: Open Food Facts search + barcode (optional, online-only,
   manual logging never depends on it) and the Insights panel.
   Only the search text / barcode number is sent to Open Food Facts —
   never diary, weight, or profile data. */
"use strict";
/* ---------- Open Food Facts ---------- */
const OFF_FIELDS = "product_name,brands,nutriments,serving_size,serving_quantity,code";
function offPer(nut) {
  const kj = Number(nut["energy_100g"]);
  const kcal100 = Number(nut["energy-kcal_100g"]) || (kj ? kj / 4.184 : 0);
  const g = k => Number(nut[k]) || 0;
  return {kcal: Math.round(kcal100), p: r1(g("proteins_100g")), c: r1(g("carbohydrates_100g")),
    f: r1(g("fat_100g")), fiber: r1(g("fiber_100g")), sugar: r1(g("sugars_100g")),
    satfat: r1(g("saturated-fat_100g")), sodium: Math.round(g("sodium_100g") * 1000)};
}
function offServingPer(p) {
  const nut = p.nutriments || {};
  const sk = Number(nut["energy-kcal_serving"]);
  if (sk && p.serving_size) {
    const ratio = sk / (Number(nut["energy-kcal_100g"]) || sk);
    const base = offPer(nut), o = {};
    NUT_KEYS.forEach(k => o[k] = Math.round(base[k] * ratio * 10) / 10);
    o.kcal = Math.round(sk);
    return {per: o, unit: p.serving_size};
  }
  return {per: offPer(nut), unit: "100 g"};
}
function renderOffSlot() {
  const slot = document.getElementById("offSlot"); if (!slot) return;
  slot.innerHTML = `<div class="card tight">
    <div class="row"><input id="offQ" placeholder="Search packaged foods (Open Food Facts)…" class="grow">
    <button class="btn sm" id="offGo">Search</button>
    <button class="btn sm ghost" id="offScan">📷 Scan</button></div>
    <div id="offOut"><p class="small dim" style="margin-top:6px">Free community database — great for packaged foods, thinner for Canadian store brands. Manual entry always works.</p></div>
  </div>`;
  const mealNow = () => { const h = new Date().getHours(); return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snacks"; };
  const go = () => offSearch($("#offQ").value.trim(), mealNow());
  $("#offGo").onclick = go;
  $("#offQ").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  $("#offScan").onclick = () => openScanner(mealNow());
}
function offRow(p, meal) {
  const {per, unit} = offServingPer(p);
  const name = (p.product_name || "Unnamed product").trim();
  const brand = (p.brands || "").split(",")[0].trim();
  return `<div class="item"><div class="grow" style="cursor:pointer" onclick='offPick(${JSON.stringify(p.code || "")}, "${meal}")'>
    <div class="t">${esc(name)}${brand ? ` <span class="dim">· ${esc(brand)}</span>` : ""}</div>
    <div class="s">per ${esc(unit)} · P ${r0(per.p)} C ${r0(per.c)} F ${r0(per.f)} · Open Food Facts</div></div>
    <div class="kc">${r0(per.kcal)}</div></div>`;
}
const _offCache = {};
async function offSearch(q, meal) {
  const out = $("#offOut"); if (!out) return;
  if (!q) { out.innerHTML = `<p class="small muted" style="margin-top:6px">Type a product name first.</p>`; return; }
  if (!navigator.onLine) { out.innerHTML = `<div class="err">You're offline — food search needs internet. Manual entry below works fine.</div>`; return; }
  out.innerHTML = `<p class="small muted" style="margin-top:8px">Searching Open Food Facts…</p>`;
  try {
    const url = "https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=12&fields=" +
      encodeURIComponent(OFF_FIELDS) + "&search_terms=" + encodeURIComponent(q);
    const r = await fetch(url, {headers: {"Accept": "application/json"}});
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    const prods = (j.products || []).filter(p => p.product_name && (((p.nutriments || {})["energy-kcal_100g"] != null) || ((p.nutriments || {})["energy_100g"] != null)));
    if (!prods.length) { out.innerHTML = `<p class="small muted" style="margin-top:8px">No matches with nutrition data. Try a shorter name, or add it manually — it'll be in your library for next time.</p>`; return; }
    prods.forEach(p => { if (p.code) _offCache[p.code] = p; });
    out.innerHTML = `<div class="list">${prods.map(p => offRow(p, meal)).join("")}</div>
      <p class="small dim">Values are per serving as listed by Open Food Facts contributors — sanity-check against the label.</p>`;
  } catch (e) {
    out.innerHTML = `<div class="err">Search failed (network or database unavailable). Your diary is unaffected — manual entry works as always.</div>`;
  }
}
async function offPick(code, meal) {
  let p = _offCache[code];
  if (!p && code) {
    try {
      const r = await fetch("https://world.openfoodfacts.org/api/v2/product/" + encodeURIComponent(code) + ".json?fields=" + encodeURIComponent(OFF_FIELDS));
      const j = await r.json();
      if (j.status === 1) p = j.product;
    } catch (e) {}
  }
  if (!p) { toast("Couldn't load that product — try again or enter manually"); return; }
  const {per, unit} = offServingPer(p);
  openEntryEditor({preset: {name: (p.product_name || "").trim(), brand: (p.brands || "").split(",")[0].trim(),
    unit, per, qty: 1, source: "off"}, meal});
}
/* barcode: camera via BarcodeDetector where supported; manual code entry everywhere */
function openScanner(meal) {
  openSheet(`<h3>Scan barcode</h3>
  <div id="scanBox"><video id="scanvid" playsinline muted></video>
  <p class="small muted" style="margin:6px 0" id="scanMsg">Starting camera…</p></div>
  <label>Or type the barcode number</label>
  <div class="row"><input id="scanCode" inputmode="numeric" placeholder="e.g. 3017620422003" class="grow">
  <button class="btn sm" id="scanLook">Look up</button></div>
  <button class="btn ghost block" style="margin-top:10px" onclick="closeSheet()">Cancel</button>`);
  $("#scanLook").onclick = async () => {
    const code = $("#scanCode").value.trim(); if (!code) return;
    closeSheet(); offPick(code, meal);
  };
  (async () => {
    const msg = $("#scanMsg");
    if (!("BarcodeDetector" in window)) { if (msg) msg.textContent = "This browser can't scan barcodes — type the number below instead."; return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "environment"}});
    } catch (e) { if (msg) msg.textContent = "Camera permission denied — type the barcode number below instead."; return; }
    const vid = $("#scanvid"); if (!vid) { stream.getTracks().forEach(t => t.stop()); return; }
    vid.srcObject = stream; await vid.play().catch(() => {});
    if (msg) msg.textContent = "Point at the barcode…";
    const det = new BarcodeDetector({formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]});
    let stopped = false;
    window._scanStop = () => { stopped = true; stream.getTracks().forEach(t => t.stop()); };
    (async function loop() {
      while (!stopped) {
        try {
          const codes = await det.detect(vid);
          if (codes && codes.length) { window._scanStop && window._scanStop(); closeSheet(); offPick(codes[0].rawValue, meal); return; }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 350));
      }
    })();
  })();
}
/* ---------- Insights ---------- */
function renderInsights() {
  const slot = document.getElementById("insightsSlot"); if (!slot) return;
  const s = S(), tg = s.targets;
  const last = n => Array.from({length: n}, (_, i) => addDays(todayKey(), -i));
  const d14 = last(14), d28 = last(28);
  const food14 = d14.filter(d => dayEntries(d).length);
  const avg = (arr, k) => arr.length ? arr.reduce((a, d) => a + dayTotals(d)[k], 0) / arr.length : 0;
  const cards = [];
  if (food14.length >= 4) {
    const a = avg(food14, "kcal"), p = avg(food14, "p");
    cards.push(`<div class="item"><div class="grow"><div class="t">🍽️ Calories: ${r0(a)}/day vs ${tg.kcal} target</div>
      <div class="s">${a <= tg.kcal ? "On the right side of your target on average — that's the pattern that moves the trend." : "A bit above target on average. One smaller swap a day closes most of that gap."}</div></div></div>`);
    cards.push(`<div class="item"><div class="grow"><div class="t">🥩 Protein: ${r0(p)}g/day vs ${tg.p}g target</div>
      <div class="s">${p >= tg.p * 0.9 ? "Strong — protein at this level helps protect muscle while you lose." : "Protein is the macro most worth nudging up while cutting; it protects muscle and keeps you full."}</div></div></div>`);
  } else cards.push(`<div class="item"><div class="grow"><div class="t">🍽️ Food insights unlock soon</div><div class="s">Log food on at least 4 of the last 14 days and this panel starts reading your patterns. (${food14.length}/4 so far)</div></div></div>`);
  const ws = sortedWeights();
  if (ws.length >= 3) {
    const firstW = rollingAvg(ws)[0]?.[1], lastW = rollingAvg(ws).slice(-1)[0]?.[1];
    const diff = lastW - firstW;
    cards.push(`<div class="item"><div class="grow"><div class="t">⚖️ Weight trend: ${diff <= 0 ? "▼" : "▲"} ${dispW(Math.abs(diff))} on the weekly average</div>
      <div class="s">${diff < -0.2 ? "Trending down steadily — exactly what the averages are for." : diff > 0.2 ? "The average is drifting up. Worth a look at the calorie pattern above — small leaks, not single days, drive this." : "Holding steady. Maintenance is a skill too — and the base for the next push."}</div></div></div>`);
  }
  const sess28 = DB.sessions.filter(x => d28.includes(x.date));
  const runs28 = sess28.filter(x => x.type === "run").length;
  cards.push(`<div class="item"><div class="grow"><div class="t">🏋️ ${sess28.length} workouts in 28 days${runs28 ? ` · ${runs28} runs` : ""}</div>
    <div class="s">${sess28.length >= 12 ? "Serious consistency — that's an athlete's calendar." : sess28.length >= 6 ? "A solid rhythm. One more session a week is the next level, if life allows." : "Every session counts, including short ones. The calendar builds one checkmark at a time."}</div></div></div>`);
  const waterDays = d14.filter(d => waterFor(d) >= tg.waterMl).length;
  cards.push(`<div class="item"><div class="grow"><div class="t">💧 Water goal hit on ${waterDays} of the last 14 days</div>
    <div class="s">${waterDays >= 10 ? "Hydration is basically a habit now." : "The +250 button on Home is the fastest log in the app — one tap with each meal does it."}</div></div></div>`);
  const diaryDays = d28.filter(d => dayEntries(d).length).length;
  cards.push(`<div class="item"><div class="grow"><div class="t">📓 Diary completed on ${diaryDays} of the last 28 days</div>
    <div class="s">Logged days are the data everything else here stands on. An honest rough day beats a skipped one.</div></div></div>`);
  slot.innerHTML = `<div class="card"><h3>🧭 Insights</h3>
    <p class="small muted">Patterns from your own records — correlations, not verdicts. Bodies are complicated; trends over weeks beat any single day.</p>
    <div class="list">${cards.join("")}</div></div>`;
}

/* ---------- Meal photo logging (Forge 2.0, Part 5) ----------
   The photo is downscaled on-device and never stored in the DB.
   It leaves the device ONLY if the user has added their own free
   OpenRouter key in Settings AND taps Analyse. Without a key the
   same review screen works as photo-assisted manual logging.
   Nothing is written to the diary until the user confirms. */
let PH = null;
function phDefaultMeal() { const h = new Date().getHours(); return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snacks"; }
function openPhotoLog() {
  PH = {dataUrl: null, items: [], meal: phDefaultMeal(), busy: false, note: ""};
  renderPhotoOverlay();
}
function closePhotoLog() { PH = null; const o = document.getElementById("photoOverlay"); if (o) { o.style.display = "none"; o.innerHTML = ""; } }
function renderPhotoOverlay() {
  const o = document.getElementById("photoOverlay"); if (!o) return;
  o.style.display = "block";
  const hasKey = !!(S().orKey || "").trim();
  if (!PH.dataUrl) {
    o.innerHTML = `<div class="card"><div class="row between"><h3>📸 Log a meal from a photo</h3>
      <button class="iconbtn" onclick="closePhotoLog()">✕</button></div>
      <p class="small muted" style="margin:8px 0">Take a photo of your meal. ${hasKey
        ? "With your OpenRouter key set, the photo is sent to OpenRouter for analysis — only the image, nothing else from your diary. Estimates are rough: portions, oils, sauces and hidden ingredients can't be seen in a photo, so you'll review and correct everything before it's logged."
        : "No AI key is set, so this works as photo-assisted logging: the photo stays open while you add the items yourself from your food library. To enable AI estimates, add a free OpenRouter key in Settings → AI meal photos."}</p>
      <button class="btn block" onclick="document.getElementById('phCam').click()">📷 Take photo</button>
      <button class="btn ghost block" style="margin-top:8px" onclick="document.getElementById('phGal').click()">🖼 Choose from gallery</button>
      <input type="file" id="phCam" accept="image/*" capture="environment" style="display:none" onchange="phFile(this)">
      <input type="file" id="phGal" accept="image/*" style="display:none" onchange="phFile(this)">
      <p class="small dim" style="margin-top:10px">The photo is shrunk on this device and never saved to your diary or The Forge's data.</p></div>`;
    return;
  }
  const tot = PH.items.reduce((a, i) => ({kcal: a.kcal + (+i.per.kcal || 0), p: a.p + (+i.per.p || 0), c: a.c + (+i.per.c || 0), f: a.f + (+i.per.f || 0)}), {kcal: 0, p: 0, c: 0, f: 0});
  o.innerHTML = `<div class="card"><div class="row between"><h3>📸 Review this meal</h3>
    <button class="iconbtn" onclick="closePhotoLog()">✕</button></div>
    <img src="${PH.dataUrl}" style="width:100%;border-radius:12px;margin:10px 0" alt="Your meal photo">
    <p class="small" style="background:#3a2c12;border:1px solid #8f6a14;border-radius:10px;padding:8px 10px">⚠️ Photo estimates can be well off — portion sizes, cooking oil, dressings and hidden ingredients are guesses. Correct anything that looks wrong; nothing is logged until you confirm.</p>
    ${PH.note ? `<p class="small muted" style="margin-top:8px">${esc(PH.note)}</p>` : ""}
    ${PH.busy ? `<p class="small" style="margin-top:10px">Analysing… this can take up to a minute on the free tier.</p>` : ""}
    <div class="list" style="margin-top:10px">${PH.items.map((i, ix) => `
      <div class="item" style="display:block">
        <div class="row" style="gap:8px"><input class="grow" value="${esc(i.name)}" data-ix="${ix}" data-f="name" onchange="phEdit(this)" placeholder="Food name">
        <span class="small" style="flex:none">${i.conf >= 0.75 ? "🟢 likely" : i.conf >= 0.5 ? "🟡 uncertain" : i.conf > 0 ? "🔴 guess — check" : ""}</span>
        <button class="iconbtn" onclick="phRemove(${ix})">✕</button></div>
        <div class="row" style="gap:6px;margin-top:6px">
          <input style="flex:1.4" value="${esc(i.portion || "")}" data-ix="${ix}" data-f="portion" onchange="phEdit(this)" placeholder="Portion (e.g. ~1 cup)">
          <input style="flex:1" type="number" inputmode="decimal" value="${i.per.kcal}" data-ix="${ix}" data-f="kcal" onchange="phEdit(this)" aria-label="kcal">
          <input style="flex:1" type="number" inputmode="decimal" value="${i.per.p}" data-ix="${ix}" data-f="p" onchange="phEdit(this)" aria-label="protein g">
          <input style="flex:1" type="number" inputmode="decimal" value="${i.per.c}" data-ix="${ix}" data-f="c" onchange="phEdit(this)" aria-label="carbs g">
          <input style="flex:1" type="number" inputmode="decimal" value="${i.per.f}" data-ix="${ix}" data-f="f" onchange="phEdit(this)" aria-label="fat g"></div>
        <div class="s dim" style="margin-top:4px">kcal · protein g · carbs g · fat g — ${esc(i.source || "estimate")}</div>
      </div>`).join("") || `<div class="empty">No items yet. ${S().orKey ? "Tap Analyse to let AI have a go, or add items manually." : "Add the items from this meal manually."}</div>`}</div>
    <div class="row" style="gap:8px;margin-top:10px">
      ${S().orKey ? `<button class="btn grow" onclick="phAnalyse()" ${PH.busy ? "disabled" : ""}>🤖 Analyse photo</button>` : ""}
      <button class="btn ghost grow" onclick="phAddBlank()">＋ Add item</button></div>
    <div class="row" style="gap:8px;margin-top:10px;align-items:center">
      <label style="flex:none">Meal</label>
      <select id="phMeal" class="grow">${MEALS.map(([k, l]) => `<option value="${k}" ${PH.meal === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <p class="small" style="margin-top:10px">Total: <b>${r0(tot.kcal)} kcal</b> · P ${r0(tot.p)}g · C ${r0(tot.c)}g · F ${r0(tot.f)}g</p>
    <button class="btn block" style="margin-top:8px" onclick="phConfirm()" ${PH.items.length ? "" : "disabled"}>✓ Confirm &amp; log to diary</button>
    <button class="btn ghost block" style="margin-top:8px" onclick="openPhotoLog()">↩ Retake photo</button></div>`;
}
function phFile(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const img = new Image();
  img.onload = () => {
    const sc = Math.min(1, 1024 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(img.src);
    PH.dataUrl = cv.toDataURL("image/jpeg", 0.85);
    PH.note = S().orKey ? "Tap Analyse when ready — or add items yourself." : "No AI key set: add the items below yourself (your food library values apply when you log via the normal diary too).";
    renderPhotoOverlay();
  };
  img.onerror = () => toast("Couldn't read that image");
  img.src = URL.createObjectURL(file);
}
function phEdit(el) {
  const i = PH.items[+el.dataset.ix]; if (!i) return;
  if (el.dataset.f === "name") i.name = el.value;
  else if (el.dataset.f === "portion") i.portion = el.value;
  else i.per[el.dataset.f] = Math.max(0, Number(el.value) || 0);
}
function phRemove(ix) { PH.items.splice(ix, 1); renderPhotoOverlay(); }
function phAddBlank() { PH.items.push({name: "", portion: "", per: {kcal: 0, p: 0, c: 0, f: 0}, conf: 0, source: "entered by you"}); renderPhotoOverlay(); }
function phMatchFood(name) {
  const toks = String(name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2);
  if (!toks.length) return null;
  let best = null, bestScore = 0;
  for (const f of DB.foods) {
    const fn = (f.name + " " + (f.brand || "")).toLowerCase();
    const score = toks.filter(t => fn.includes(t)).length / toks.length;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return bestScore >= 0.6 ? best : null;
}
async function phAnalyse() {
  const key = (S().orKey || "").trim(); if (!key || !PH.dataUrl || PH.busy) return;
  PH.busy = true; PH.note = ""; renderPhotoOverlay();
  const prompt = "You are a nutrition estimator. Look at this meal photo. Identify each distinct food item and estimate its portion and nutrition. " +
    "Respond with ONLY a JSON object, no other text: {\"items\":[{\"name\":\"...\",\"portion\":\"e.g. ~150 g\",\"kcal\":0,\"p\":0,\"c\":0,\"f\":0,\"confidence\":0.0}],\"notes\":\"...\"} " +
    "confidence is 0..1 per item — be honest: lower it for mixed dishes, sauces, oils, or anything partly hidden. Put portion uncertainty and hidden-ingredient warnings in notes. Never claim exact weights from a photo.";
  const models = ["google/gemma-4-31b-it:free", "openrouter/free"];
  let lastErr = "";
  for (const model of models) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {"Authorization": "Bearer " + key, "Content-Type": "application/json", "X-Title": "The Forge"},
        body: JSON.stringify({model, max_tokens: 900, messages: [{role: "user", content: [
          {type: "text", text: prompt}, {type: "image_url", image_url: {url: PH.dataUrl}}]}]})
      });
      if (!resp.ok) { lastErr = "HTTP " + resp.status; continue; }
      const data = await resp.json();
      let txt = data.choices?.[0]?.message?.content || "";
      txt = txt.replace(/```json|```/g, "");
      const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
      if (a < 0) { lastErr = "Unreadable reply"; continue; }
      const parsed = JSON.parse(txt.slice(a, b + 1));
      PH.items = (parsed.items || []).map(it => {
        const m = phMatchFood(it.name);
        if (m) return {name: m.name, portion: it.portion || m.unit, per: Object.assign({}, m.per), conf: Number(it.confidence) || 0.5, source: "matched your food library — check the portion", foodId: m.id};
        return {name: it.name || "Food", portion: it.portion || "", per: {kcal: +it.kcal || 0, p: +it.p || 0, c: +it.c || 0, f: +it.f || 0}, conf: Number(it.confidence) || 0.4, source: "AI estimate — not from a label"};
      });
      PH.note = (parsed.notes ? "AI notes: " + parsed.notes + " " : "") + "Model: " + model + ". Check every line before confirming.";
      PH.busy = false; renderPhotoOverlay(); return;
    } catch (e) { lastErr = String(e && e.message || e); }
  }
  PH.busy = false;
  PH.note = "Analysis failed (" + lastErr + "). The free tier can be busy or rate-limited — add the items manually below, or try again in a bit. Manual logging is unaffected.";
  renderPhotoOverlay();
}
function phConfirm() {
  if (!PH || !PH.items.length) return;
  const meal = document.getElementById("phMeal")?.value || PH.meal;
  let n = 0;
  for (const i of PH.items) {
    if (!i.name.trim()) continue;
    DB.entries.push({id: uid(), source: "photo", foodId: i.foodId || null, name: i.name.trim(), brand: "",
      qty: 1, unit: i.portion || "1 serving",
      per: {kcal: +i.per.kcal || 0, p: +i.per.p || 0, c: +i.per.c || 0, f: +i.per.f || 0, fiber: 0, sugar: 0, satfat: 0, sodium: 0},
      meal, date: nutDate, note: "Photo estimate — reviewed & confirmed"});
    n++;
  }
  if (!n) { toast("Add at least one named item"); return; }
  saveDB(); closePhotoLog(); renderNutrition(); toast(`Logged ${n} item${n === 1 ? "" : "s"} from photo`);
}

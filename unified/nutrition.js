/* FIT HQ Nutrition: diary, food library, saved meals/recipes, water.
   Entries snapshot their nutrition at log time — editing a saved food
   never rewrites history. Manual entry always works offline. */
"use strict";
let nutDate = todayKey();
const MEALS = [["breakfast","🍳 Breakfast"],["lunch","🥪 Lunch"],["dinner","🍽️ Dinner"],["snacks","🍎 Snacks"]];
window.nutDate = () => nutDate;

function nutTotalsHTML(date) {
  const t = dayTotals(date), tg = S().targets;
  return `<div class="card">
    <div class="row between"><div><span class="kcal-num">${r0(t.kcal)}</span> <span class="muted">/ ${tg.kcal} kcal</span></div>
    <div class="small" style="text-align:right"><b style="color:${tg.kcal - t.kcal < 0 ? "var(--red)" : "var(--grn)"}">${r0(Math.abs(tg.kcal - t.kcal))} ${tg.kcal - t.kcal < 0 ? "over" : "left"}</b></div></div>
    ${bar(tg.kcal ? t.kcal / tg.kcal * 100 : 0)}
    <div class="grid3" style="margin-top:8px">
      <div><div class="macroline"><span>Protein</span><b>${r0(t.p)}/${tg.p}g</b></div>${bar(tg.p ? t.p / tg.p * 100 : 0, "g")}</div>
      <div><div class="macroline"><span>Carbs</span><b>${r0(t.c)}/${tg.c}g</b></div>${bar(tg.c ? t.c / tg.c * 100 : 0, "b")}</div>
      <div><div class="macroline"><span>Fat</span><b>${r0(t.f)}/${tg.f}g</b></div>${bar(tg.f ? t.f / tg.f * 100 : 0, "gold")}</div>
    </div>
    ${(t.fiber || t.sugar || t.sodium) ? `<p class="small muted" style="margin-top:8px">Fibre ${r1(t.fiber)}g · Sugar ${r1(t.sugar)}g · Sodium ${r0(t.sodium)}mg</p>` : ""}
  </div>`;
}
function renderNutrition() {
  const el = $("#view-nutrition");
  const ents = dayEntries(nutDate);
  const sections = MEALS.map(([key, label]) => {
    const items = ents.filter(e => e.meal === key);
    const sub = items.reduce((a, e) => a + e.per.kcal * e.qty, 0);
    return `<div class="card tight"><div class="row between"><h3>${label}</h3>
      <span class="row" style="gap:8px"><span class="small muted">${items.length ? r0(sub) + " kcal" : ""}</span>
      <button class="iconbtn" onclick="openAddFood('${key}')" aria-label="Add to ${label}">＋</button></span></div>
      ${items.length ? `<div class="list">${items.map(e => `
        <div class="item"><div class="grow" onclick="editEntry('${e.id}')" style="cursor:pointer">
          <div class="t">${esc(e.name)}${e.brand ? ` <span class="dim">· ${esc(e.brand)}</span>` : ""}</div>
          <div class="s">${e.qty} × ${esc(e.unit || "serving")} · P ${r0(e.per.p * e.qty)} · C ${r0(e.per.c * e.qty)} · F ${r0(e.per.f * e.qty)}${e.source === "off" ? " · Open Food Facts" : ""}</div></div>
          <div class="kc">${r0(e.per.kcal * e.qty)}</div>
          <button class="iconbtn" onclick="dupEntry('${e.id}')" aria-label="Duplicate">⧉</button>
          <button class="iconbtn" onclick="delEntry('${e.id}')" aria-label="Delete">✕</button></div>`).join("")}</div>`
      : `<p class="small muted" style="padding:6px 0 2px">Nothing logged yet.</p>`}
    </div>`;
  }).join("");
  const w = waterFor(nutDate), tg = S().targets;
  el.innerHTML = `
  <button class="btn block" style="margin-bottom:10px" onclick="openPhotoLog()">📸 Analyse meal photo</button>
  <div class="datebar">
    <button class="iconbtn" onclick="nutNav(-1)">‹</button>
    <div class="grow" style="text-align:center"><div class="d">${nutDate === todayKey() ? "Today" : fmtDay(nutDate)}</div>
    <div class="small dim">${nutDate}</div></div>
    <button class="iconbtn" onclick="nutNav(1)">›</button>
    <input type="date" id="nutPick" value="${nutDate}" style="width:auto;flex:none" max="${todayKey()}">
  </div>
  ${nutTotalsHTML(nutDate)}
  <div class="row wrap2">
    <button class="chip" onclick="openAddFood('breakfast')">🔍 Add food</button>
    <button class="chip" onclick="openLibrary()">📚 My foods</button>
    <button class="chip" onclick="openMeals()">🍲 Saved meals</button>
    <button class="chip" onclick="openFoodEditor()">✏️ Create food</button>
  </div>
  <div id="offSlot"></div>
  ${sections}
  <div class="card tight"><div class="row between"><h3>💧 Water</h3><span class="small muted">${w} / ${tg.waterMl} ml</span></div>
    ${bar(tg.waterMl ? w / tg.waterMl * 100 : 0, "b")}
    <div class="row" style="margin-top:10px">
      <button class="chip grow" style="justify-content:center" onclick="addWaterDate(250)">+250 ml</button>
      <button class="chip grow" style="justify-content:center" onclick="addWaterDate(500)">+500 ml</button>
      ${DB.water.some(x => x.date === nutDate) ? `<button class="chip grow" style="justify-content:center" onclick="undoWater()">Undo last</button>` : ""}
    </div></div>`;
  $("#nutPick").onchange = e => { if (e.target.value) { nutDate = e.target.value; renderNutrition(); } };
  if (window.renderOffSlot) renderOffSlot();
}
function nutNav(n) { nutDate = addDays(nutDate, n); if (nutDate > todayKey()) nutDate = todayKey(); renderNutrition(); }
function addWaterDate(ml) { DB.water.push({id: uid(), date: nutDate, ml}); saveDB(); renderNutrition(); }
function undoWater() {
  const idx = DB.water.map((w, i) => [w, i]).filter(([w]) => w.date === nutDate).pop();
  if (idx) { DB.water.splice(idx[1], 1); saveDB(); renderNutrition(); }
}
function delEntry(id) {
  const e = DB.entries.find(x => x.id === id); if (!e) return;
  confirmSheet("Delete entry?", `"${e.name}" will be removed from ${fmtDay(e.date)}.`, "Delete", () => {
    DB.entries = DB.entries.filter(x => x.id !== id); saveDB(); renderNutrition(); toast("Entry deleted");
  });
}
function dupEntry(id) {
  const e = DB.entries.find(x => x.id === id); if (!e) return;
  DB.entries.push(Object.assign({}, e, {id: uid(), per: Object.assign({}, e.per)}));
  saveDB(); renderNutrition(); toast("Duplicated");
}
/* ---------- shared entry editor ---------- */
function nutFields(prefix, per = {}) {
  return `<div class="three">
    <div><label>Calories</label><input id="${prefix}K" type="number" inputmode="decimal" min="0" value="${per.kcal ?? ""}"></div>
    <div><label>Protein (g)</label><input id="${prefix}P" type="number" inputmode="decimal" min="0" value="${per.p ?? ""}"></div>
    <div><label>Carbs (g)</label><input id="${prefix}C" type="number" inputmode="decimal" min="0" value="${per.c ?? ""}"></div></div>
  <div class="three">
    <div><label>Fat (g)</label><input id="${prefix}F" type="number" inputmode="decimal" min="0" value="${per.f ?? ""}"></div>
    <div><label>Fibre (g) <span class="dim">opt</span></label><input id="${prefix}Fb" type="number" inputmode="decimal" min="0" value="${per.fiber ?? ""}"></div>
    <div><label>Sugar (g) <span class="dim">opt</span></label><input id="${prefix}Sg" type="number" inputmode="decimal" min="0" value="${per.sugar ?? ""}"></div></div>
  <div class="two">
    <div><label>Sat. fat (g) <span class="dim">opt</span></label><input id="${prefix}Sf" type="number" inputmode="decimal" min="0" value="${per.satfat ?? ""}"></div>
    <div><label>Sodium (mg) <span class="dim">opt</span></label><input id="${prefix}Na" type="number" inputmode="decimal" min="0" value="${per.sodium ?? ""}"></div></div>`;
}
function readNut(prefix) {
  const g = id => { const v = Number(document.getElementById(prefix + id)?.value); return isNaN(v) || v < 0 ? 0 : v; };
  return {kcal: g("K"), p: g("P"), c: g("C"), f: g("F"), fiber: g("Fb"), sugar: g("Sg"), satfat: g("Sf"), sodium: g("Na")};
}
/* Log-entry editor: per-serving values + servings count, live totals. */
function editEntry(id) {
  const e = DB.entries.find(x => x.id === id); if (!e) return;
  openEntryEditor({entry: e});
}
function openEntryEditor({entry = null, preset = null, meal = "breakfast", date = nutDate} = {}) {
  const src = entry || preset || {};
  const per = src.per || {};
  openSheet(`<h3>${entry ? "Edit entry" : "Log food"}</h3>
  <label>Food name</label><input id="eeName" value="${esc(src.name || "")}" placeholder="e.g. Greek yogurt">
  <label>Brand (optional)</label><input id="eeBrand" value="${esc(src.brand || "")}" placeholder="e.g. Oikos">
  <div class="two"><div><label>Servings</label><input id="eeQty" type="number" inputmode="decimal" min="0" step="0.25" value="${src.qty ?? 1}"></div>
  <div><label>Serving size</label><input id="eeUnit" value="${esc(src.unit || "1 serving")}" placeholder="e.g. 175 g, 1 cup, 2 slices"></div></div>
  <fieldset><legend>Nutrition per serving</legend>${nutFields("ee", per)}</fieldset>
  <div class="two"><div><label>Meal</label><select id="eeMeal">${MEALS.map(([k, l]) => `<option value="${k}" ${(entry?.meal || meal) === k ? "selected" : ""}>${l.replace(/^\S+ /, "")}</option>`).join("")}</select></div>
  <div><label>Date</label><input id="eeDate" type="date" value="${entry?.date || date}" max="${todayKey()}"></div></div>
  <label>Note (optional)</label><input id="eeNote" value="${esc(src.note || "")}" placeholder="">
  <div class="okn" id="eeTotals"></div>
  ${!entry ? `<label><span style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="eeSaveLib" style="width:auto" ${preset?.foodId ? "checked" : ""}> Save to my foods for next time</span></label>` : ""}
  <button class="btn block" style="margin-top:12px" id="eeGo">${entry ? "Save changes" : "Add to diary"}</button>
  ${entry ? `<button class="btn danger block" style="margin-top:8px" onclick="closeSheet();delEntry('${entry.id}')">Delete entry</button>` : ""}`);
  const upd = () => {
    const t = scaleNut(readNut("ee"), Number($("#eeQty").value) || 0);
    $("#eeTotals").innerHTML = `Total for this entry: <b>${r0(t.kcal)} kcal</b> · P ${r0(t.p)}g · C ${r0(t.c)}g · F ${r0(t.f)}g`;
  };
  ["eeQty","eeK","eeP","eeC","eeF"].forEach(id => document.getElementById(id)?.addEventListener("input", upd));
  upd();
  $("#eeGo").onclick = () => {
    const name = $("#eeName").value.trim(); if (!name) { toast("Give the food a name"); return; }
    const data = {name, brand: $("#eeBrand").value.trim(), qty: Math.max(0, Number($("#eeQty").value) || 0),
      unit: $("#eeUnit").value.trim() || "1 serving", per: readNut("ee"), meal: $("#eeMeal").value,
      date: $("#eeDate").value || nutDate, note: $("#eeNote").value.trim()};
    if (entry) { Object.assign(entry, data); }
    else {
      const ne = Object.assign({id: uid(), source: src.source || "manual", foodId: src.foodId || null}, data);
      DB.entries.push(ne);
      if ($("#eeSaveLib")?.checked) saveToLibrary(data, src.foodId);
    }
    saveDB(); closeSheet(); nutDate = data.date; renderNutrition(); toast("Saved");
  };
}
function saveToLibrary(data, foodId) {
  if (foodId) { const f = DB.foods.find(x => x.id === foodId); if (f) { f.per = data.per; f.unit = data.unit; f.name = data.name; f.brand = data.brand; return; } }
  if (!DB.foods.some(f => f.name.toLowerCase() === data.name.toLowerCase() && (f.brand || "") === (data.brand || "")))
    DB.foods.push({id: uid(), name: data.name, brand: data.brand, unit: data.unit, per: data.per, fav: false});
}

/* ---------- add-food picker ---------- */
function recentFoods() {
  const seen = new Map();
  for (const e of DB.entries.slice().reverse()) {
    const k = (e.name + "|" + (e.brand || "")).toLowerCase();
    if (!seen.has(k)) seen.set(k, e);
    if (seen.size >= 12) break;
  }
  return Array.from(seen.values());
}
function frequentFoods() {
  const counts = new Map();
  for (const e of DB.entries) {
    const k = (e.name + "|" + (e.brand || "")).toLowerCase();
    const cur = counts.get(k) || {e, n: 0}; cur.n++; cur.e = e; counts.set(k, cur);
  }
  return Array.from(counts.values()).sort((a, b) => b.n - a.n).slice(0, 8).map(x => x.e);
}
function foodRowHTML(f, onclick) {
  return `<div class="item"><div class="grow" onclick="${onclick}" style="cursor:pointer">
    <div class="t">${esc(f.name)}${f.brand ? ` <span class="dim">· ${esc(f.brand)}</span>` : ""}</div>
    <div class="s">${esc(f.unit || "1 serving")} · ${r0(f.per.kcal)} kcal · P ${r0(f.per.p)} C ${r0(f.per.c)} F ${r0(f.per.f)}</div></div>
    <div class="kc">${r0(f.per.kcal)}</div></div>`;
}
function openAddFood(meal = "breakfast") {
  const recents = recentFoods(), favs = DB.foods.filter(f => f.fav), freq = frequentFoods();
  openSheet(`<h3>Add food</h3>
  <div class="row wrap2" style="margin:10px 0">
    <button class="btn sm ghost" onclick="closeSheet();openFoodEditor(null,'${meal}')">✏️ Manual entry</button>
    <button class="btn sm ghost" onclick="closeSheet();openMeals('${meal}')">🍲 Saved meals</button>
    <button class="btn sm ghost" onclick="closeSheet();openLibrary()">📚 My foods</button>
  </div>
  ${favs.length ? `<h3 style="margin-top:8px">⭐ Favourites</h3><div class="list">${favs.map(f => foodRowHTML(f, `pickFood('${f.id}','${meal}')`)).join("")}</div>` : ""}
  ${recents.length ? `<h3 style="margin-top:10px">🕘 Recent</h3><div class="list">${recents.map(e => foodRowHTML(e, `pickRecent('${e.id}','${meal}')`)).join("")}</div>` : ""}
  ${freq.length ? `<h3 style="margin-top:10px">🔁 Frequent</h3><div class="list">${freq.map(e => foodRowHTML(e, `pickRecent('${e.id}','${meal}')`)).join("")}</div>` : ""}
  ${!favs.length && !recents.length ? `<div class="empty">No foods yet. Log your first one manually — it will show up here next time.</div>` : ""}`);
}
function pickFood(foodId, meal) {
  const f = DB.foods.find(x => x.id === foodId); if (!f) return;
  closeSheet();
  openEntryEditor({preset: {name: f.name, brand: f.brand, unit: f.unit, per: Object.assign({}, f.per), qty: 1, source: "custom", foodId: f.id}, meal});
}
function pickRecent(entryId, meal) {
  const e = DB.entries.find(x => x.id === entryId); if (!e) return;
  closeSheet();
  openEntryEditor({preset: {name: e.name, brand: e.brand, unit: e.unit, per: Object.assign({}, e.per), qty: 1, source: e.source, foodId: e.foodId || null}, meal});
}
/* ---------- food library ---------- */
function openLibrary(filter = "") {
  const foods = DB.foods.filter(f => !filter || (f.name + " " + (f.brand || "")).toLowerCase().includes(filter.toLowerCase()));
  openSheet(`<h3>My foods</h3>
  <input id="libQ" placeholder="Search your foods…" value="${esc(filter)}" style="margin:8px 0">
  <div class="list">${foods.length ? foods.map(f => `
    <div class="item"><button class="iconbtn" onclick="toggleFav('${f.id}')" aria-label="Favourite">${f.fav ? "⭐" : "☆"}</button>
    <div class="grow" onclick="pickFood('${f.id}','breakfast')" style="cursor:pointer">
      <div class="t">${esc(f.name)}${f.brand ? ` <span class="dim">· ${esc(f.brand)}</span>` : ""}</div>
      <div class="s">${esc(f.unit || "1 serving")} · ${r0(f.per.kcal)} kcal</div></div>
    <button class="iconbtn" onclick="openFoodEditor('${f.id}')">✏️</button>
    <button class="iconbtn" onclick="delFood('${f.id}')">✕</button></div>`).join("")
    : `<div class="empty">No custom foods yet. Create one, or tick "Save to my foods" when logging.</div>`}</div>
  <button class="btn block" style="margin-top:10px" onclick="openFoodEditor()">＋ Create food</button>`);
  $("#libQ").addEventListener("input", e => { const v = e.target.value; openLibrary(v); const q = $("#libQ"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); });
}
function toggleFav(id) { const f = DB.foods.find(x => x.id === id); if (f) { f.fav = !f.fav; saveDB(); openLibrary($("#libQ")?.value || ""); } }
function delFood(id) {
  const f = DB.foods.find(x => x.id === id); if (!f) return;
  confirmSheet("Delete food?", `"${f.name}" leaves your library. Past diary entries keep their logged values.`, "Delete", () => {
    DB.foods = DB.foods.filter(x => x.id !== id); saveDB(); openLibrary(); toast("Food deleted");
  });
}
function openFoodEditor(id = null, mealAfter = null) {
  const f = id ? DB.foods.find(x => x.id === id) : null;
  openSheet(`<h3>${f ? "Edit food" : "Create food"}</h3>
  <label>Food name</label><input id="feName" value="${esc(f?.name || "")}" placeholder="e.g. Protein bar">
  <label>Brand (optional)</label><input id="feBrand" value="${esc(f?.brand || "")}">
  <label>Serving size</label><input id="feUnit" value="${esc(f?.unit || "")}" placeholder="e.g. 60 g, 1 bar, 250 ml">
  <fieldset><legend>Nutrition per serving</legend>${nutFields("fe", f?.per || {})}</fieldset>
  <label><span style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="feFav" style="width:auto" ${f?.fav ? "checked" : ""}> Favourite</span></label>
  <button class="btn block" style="margin-top:12px" id="feGo">${f ? "Save food" : "Create food"}</button>`);
  $("#feGo").onclick = () => {
    const name = $("#feName").value.trim(); if (!name) { toast("Give the food a name"); return; }
    const data = {name, brand: $("#feBrand").value.trim(), unit: $("#feUnit").value.trim() || "1 serving",
      per: readNut("fe"), fav: $("#feFav").checked};
    if (f) Object.assign(f, data); else DB.foods.push(Object.assign({id: uid()}, data));
    saveDB(); toast("Food saved");
    if (mealAfter) { closeSheet(); openEntryEditor({preset: {name: data.name, brand: data.brand, unit: data.unit, per: data.per, qty: 1, source: "custom"}, meal: mealAfter}); }
    else openLibrary();
  };
}
/* ---------- saved meals & recipes ---------- */
function mealPerServing(m) {
  let t = zeroNut();
  for (const it of m.items) t = addNut(t, scaleNut(it.per, it.qty));
  const y = Math.max(1, Number(m.yield) || 1);
  const o = {}; NUT_KEYS.forEach(k => o[k] = t[k] / y); return o;
}
function openMeals(mealTarget = "breakfast") {
  openSheet(`<h3>Saved meals & recipes</h3>
  <div class="list">${DB.meals.length ? DB.meals.map(m => { const ps = mealPerServing(m); return `
    <div class="item"><div class="grow">
      <div class="t">${esc(m.name)}</div>
      <div class="s">${m.items.length} item${m.items.length === 1 ? "" : "s"} · makes ${m.yield} serving${m.yield === 1 ? "" : "s"} · ${r0(ps.kcal)} kcal/serving</div></div>
    <button class="btn sm grn" onclick="addMealToDiary('${m.id}','${mealTarget}')">Add</button>
    <button class="iconbtn" onclick="openMealEditor('${m.id}','${mealTarget}')">✏️</button>
    <button class="iconbtn" onclick="delMeal('${m.id}','${mealTarget}')">✕</button></div>`; }).join("")
    : `<div class="empty">No saved meals yet. Build one from foods you combine often — a smoothie, a sandwich, your usual breakfast.</div>`}</div>
  <button class="btn block" style="margin-top:10px" onclick="openMealEditor(null,'${mealTarget}')">＋ Create meal / recipe</button>`);
}
function delMeal(id, mt) {
  const m = DB.meals.find(x => x.id === id); if (!m) return;
  confirmSheet("Delete meal?", `"${m.name}" will be removed. Diary entries already logged from it stay as they are.`, "Delete", () => {
    DB.meals = DB.meals.filter(x => x.id !== id); saveDB(); openMeals(mt);
  });
}
function addMealToDiary(id, mealTarget) {
  const m = DB.meals.find(x => x.id === id); if (!m) return;
  const ps = mealPerServing(m);
  closeSheet();
  openEntryEditor({preset: {name: m.name, brand: "", unit: "1 serving", per: ps, qty: 1, source: "meal"}, meal: mealTarget});
}
let mealDraft = null;
function openMealEditor(id = null, mealTarget = "breakfast") {
  const m = id ? DB.meals.find(x => x.id === id) : null;
  mealDraft = m ? JSON.parse(JSON.stringify(m)) : {id: null, name: "", yield: 1, items: []};
  const draw = () => {
    const ps = mealPerServing(mealDraft);
    openSheet(`<h3>${id ? "Edit meal" : "Create meal / recipe"}</h3>
    <label>Name</label><input id="mdName" value="${esc(mealDraft.name)}" placeholder="e.g. Morning smoothie">
    <label>Recipe makes how many servings?</label><input id="mdYield" type="number" inputmode="decimal" min="0.25" step="0.25" value="${mealDraft.yield}">
    <h3 style="margin-top:12px">Ingredients</h3>
    <div class="list">${mealDraft.items.length ? mealDraft.items.map((it, i) => `
      <div class="item"><div class="grow"><div class="t">${esc(it.name)}</div>
      <div class="s">${it.qty} × ${esc(it.unit || "serving")} · ${r0(it.per.kcal * it.qty)} kcal</div></div>
      <button class="iconbtn" onclick="mealItemQty(${i},1)">＋</button>
      <button class="iconbtn" onclick="mealItemQty(${i},-1)">−</button>
      <button class="iconbtn" onclick="mealItemDel(${i})">✕</button></div>`).join("") : `<div class="empty">No ingredients yet.</div>`}</div>
    <button class="btn ghost block" style="margin-top:8px" id="mdAdd">＋ Add ingredient</button>
    <div class="okn">Per serving: <b>${r0(ps.kcal)} kcal</b> · P ${r0(ps.p)}g · C ${r0(ps.c)}g · F ${r0(ps.f)}g</div>
    <button class="btn block" style="margin-top:10px" id="mdSave">${id ? "Save meal" : "Create meal"}</button>`);
    $("#mdName").oninput = e => mealDraft.name = e.target.value;
    $("#mdYield").oninput = e => { mealDraft.yield = Number(e.target.value) || 1; };
    $("#mdYield").onchange = draw;
    $("#mdAdd").onclick = () => openIngredientPicker();
    $("#mdSave").onclick = () => {
      if (!mealDraft.name.trim()) { toast("Name the meal first"); return; }
      if (!mealDraft.items.length) { toast("Add at least one ingredient"); return; }
      if (id) { const orig = DB.meals.find(x => x.id === id); Object.assign(orig, mealDraft); }
      else DB.meals.push(Object.assign({id: uid()}, mealDraft));
      saveDB(); toast("Meal saved"); openMeals(mealTarget);
    };
  };
  window._mealDraw = draw; draw();
}
function mealItemQty(i, d) { mealDraft.items[i].qty = Math.max(0.25, (mealDraft.items[i].qty || 1) + d * 0.25); window._mealDraw(); }
function mealItemDel(i) { mealDraft.items.splice(i, 1); window._mealDraw(); }
function openIngredientPicker() {
  openSheet(`<h3>Add ingredient</h3>
  <div class="list">
  ${DB.foods.map(f => foodRowHTML(f, `mealAddItem('${f.id}')`)).join("")}
  ${recentFoods().map(e => foodRowHTML(e, `mealAddRecent('${e.id}')`)).join("")}
  </div>
  <button class="btn ghost block" style="margin-top:10px" id="ingManual">✏️ Enter manually</button>
  <button class="btn ghost block" style="margin-top:8px" onclick="window._mealDraw()">← Back to meal</button>`);
  $("#ingManual").onclick = () => {
    openSheet(`<h3>Manual ingredient</h3>
    <label>Name</label><input id="miName" placeholder="e.g. Rolled oats">
    <div class="two"><div><label>Quantity</label><input id="miQty" type="number" inputmode="decimal" value="1" min="0" step="0.25"></div>
    <div><label>Serving size</label><input id="miUnit" value="40 g"></div></div>
    <fieldset><legend>Nutrition per serving</legend>${nutFields("mi")}</fieldset>
    <button class="btn block" id="miGo">Add ingredient</button>
    <button class="btn ghost block" style="margin-top:8px" onclick="window._mealDraw()">← Back to meal</button>`);
    $("#miGo").onclick = () => {
      const name = $("#miName").value.trim(); if (!name) { toast("Name it first"); return; }
      mealDraft.items.push({name, brand: "", unit: $("#miUnit").value.trim() || "1 serving", qty: Number($("#miQty").value) || 1, per: readNut("mi")});
      window._mealDraw();
    };
  };
}
function mealAddItem(foodId) {
  const f = DB.foods.find(x => x.id === foodId); if (!f) return;
  mealDraft.items.push({name: f.name, brand: f.brand, unit: f.unit, qty: 1, per: Object.assign({}, f.per)});
  window._mealDraw();
}
function mealAddRecent(entryId) {
  const e = DB.entries.find(x => x.id === entryId); if (!e) return;
  mealDraft.items.push({name: e.name, brand: e.brand, unit: e.unit, qty: 1, per: Object.assign({}, e.per)});
  window._mealDraw();
}

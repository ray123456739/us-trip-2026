"use strict";
/* ---------- 分類與建議清單 ---------- */
const CATS = [
  ["doc", "🛂", "證件錢包"], ["tech", "🔌", "3C 充電"], ["clothes", "🧥", "衣物鞋子"], ["wash", "🧴", "盥洗保養"],
  ["meds", "💊", "藥品"], ["car", "🚗", "自駕路上"], ["fun", "🎢", "迪士尼・賭城"], ["other", "📦", "其他"]
].map(([k, ic, name]) => ({ k, ic, name }));
const CAT = Object.fromEntries(CATS.map(c => [c.k, c]));
const WHO = ["共用", "Ray", "Irene"];

// [名字, 分類, 誰, 數量, 備註]
const SUGGEST = [
  ["護照", "doc", "Ray", 1, "效期要超過回程日"], ["護照", "doc", "Irene", 1, "效期要超過回程日"],
  ["ESTA 核准（截圖存手機）", "doc", "共用", 1, ""],
  ["機票訂位紀錄 BR008 / BR007", "doc", "共用", 1, ""],
  ["台灣駕照＋國際駕照", "doc", "Ray", 1, "租車兩本都要帶"],
  ["信用卡（兩張不同發卡組織）", "doc", "共用", 1, "租車押金要信用卡"],
  ["美金現金（小鈔給小費）", "doc", "共用", 1, ""],
  ["飯店、租車確認信截圖", "doc", "共用", 1, ""],
  ["旅遊保險資料", "doc", "共用", 1, ""],
  ["手機充電線", "tech", "共用", 2, ""], ["多孔 USB 充電頭", "tech", "共用", 1, "美國插座跟台灣一樣，不用轉接頭"],
  ["行動電源", "tech", "共用", 2, "只能隨身，不能托運"], ["美國 eSIM / 網卡", "tech", "共用", 2, "出發前要買", true],
  ["耳機", "tech", "共用", 2, ""],
  ["保暖外套", "clothes", "共用", 2, "11 月舊金山、賭城早晚都冷"], ["薄羽絨或刷毛（洋蔥式）", "clothes", "共用", 2, ""],
  ["好走的鞋", "clothes", "共用", 2, "迪士尼一天走很多"], ["換洗衣物", "clothes", "共用", 1, ""],
  ["感恩節晚餐稍正式的衣服", "clothes", "共用", 1, ""], ["睡衣", "clothes", "共用", 2, ""], ["帽子", "clothes", "共用", 1, ""],
  ["牙刷牙膏", "wash", "共用", 2, "美國飯店多半沒附"], ["保濕乳液", "wash", "共用", 1, "賭城很乾"], ["護唇膏", "wash", "共用", 2, ""],
  ["防曬", "wash", "共用", 1, ""], ["隱形眼鏡／眼鏡", "wash", "共用", 1, ""],
  ["個人常用藥", "meds", "共用", 1, "放隨身行李"], ["感冒藥、止痛藥", "meds", "共用", 1, ""], ["腸胃藥", "meds", "共用", 1, ""],
  ["OK 繃", "meds", "共用", 1, ""],
  ["車用手機架", "car", "共用", 1, ""], ["車充（USB-C）", "car", "共用", 1, ""], ["墨鏡", "car", "共用", 2, "往賭城一路很曬"],
  ["零食、水", "car", "共用", 1, "I-5、I-15 中間休息站少"], ["離線地圖先下載", "car", "共用", 1, ""],
  ["迪士尼 App 先登入、票綁好", "fun", "共用", 1, ""], ["輕便小背包", "fun", "共用", 1, ""], ["雨衣或輕便雨具", "fun", "共用", 1, ""],
  ["摺疊購物袋（Black Friday）", "other", "共用", 2, "回程裝戰利品"], ["行李秤", "other", "共用", 1, "回程怕超重"],
  ["給家人的伴手禮清單", "other", "共用", 1, ""]
];

/* ---------- 小工具（跟旅遊書同一套） ---------- */
const $ = s => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) { if (c == null) continue; e.append(c.nodeType ? c : document.createTextNode(c)); }
  return e;
}
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
let tt; function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2600); }

const CFG = window.TRIP_CONFIG || {};
const BASE = (CFG.url || "").replace(/\/+$/, "");
function headers(extra = {}) {
  const hd = { apikey: CFG.key, ...extra };
  if ((CFG.key || "").startsWith("eyJ")) hd.Authorization = "Bearer " + CFG.key;
  return hd;
}
async function rpc(fn, args) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(args) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  if (!r.ok) { const e = new Error((j && j.message) || t || String(r.status)); e.code = j && j.code; e.status = r.status; throw e; }
  return j;
}

/* ---------- 狀態 ---------- */
let pass = store.get("trip.pass"), me = store.get("trip.name");
let items = [], loaded = false, busy = false, pending = 0, openId = null, confirmDel = null;
let mode = store.get("pack.mode") === "back" ? "back" : "packed";
let filter = store.get("pack.filter") || "all";
let addWho = WHO.includes(me) ? me : "共用";

function onErr(e) {
  if (e && (e.code === "28P01" || /bad_passcode/.test(e.message))) { toast("旅行密碼變了，請重新輸入"); logout(); return; }
  if (e && (e.code === "PGRST202" || e.status === 404)) { showSetup(); return; }
  toast("沒存到，網路可能不穩，請再試一次");
}
async function run(fn) {
  if (busy) return; busy = true;
  try { await fn(); await refresh(); } catch (e) { onErr(e); } finally { busy = false; render(); }
}
async function refresh() { items = await rpc("pack_list", { p: pass }) || []; loaded = true; }
async function poll() {
  if (document.hidden || busy || pending || openId) return;
  try { await refresh(); render(); } catch (e) { if (e.code === "28P01") onErr(e); }
}

/* ---------- 畫面 ---------- */
const whoCls = w => w === "Ray" ? "ray" : w === "Irene" ? "irene" : "";
const norm = s => (s || "").replace(/\s+/g, "").toLowerCase();
function visible() {
  return items.filter(it => {
    if (filter === "mine") return it.who === me || it.who === "共用";
    if (filter === "todo") return !it[mode];
    if (filter === "buy") return it.buy;
    if (WHO.includes(filter)) return it.who === filter;
    return true;
  });
}
function renderTop() {
  const done = items.filter(i => i[mode]).length, n = items.length;
  const pct = n ? Math.round(done / n * 100) : 0;
  const start = new Date("2026-11-20T00:00:00+08:00"), now = new Date();
  const days = Math.ceil((start - now) / 864e5);
  $("#eyebrow").textContent = days > 0 ? `還有 ${days} 天出發 · 11/20` : "旅途中 · 12/05 回台灣";
  const buy = items.filter(i => i.buy && !i.packed).length;
  $("#count").textContent = !n ? "清單還是空的，先加幾樣，或用下面的建議清單。"
    : `${mode === "packed" ? "打包" : "回程收好"} ${done} / ${n} 件（${pct}%）` + (buy && mode === "packed" ? ` · 還有 ${buy} 樣要買` : "");
  $("#meterBar").style.width = pct + "%";
  document.querySelectorAll(".pk-mode button").forEach(b => { b.classList.toggle("on", b.dataset.mode === mode); b.setAttribute("aria-selected", b.dataset.mode === mode); });
  $("#modeHint").textContent = mode === "packed" ? "放進行李就勾一下，兩個人都看得到。" : "退房前一項一項勾，確認沒有東西留在飯店或車上。";
  $("#resetBtn").textContent = mode === "packed" ? "取消全部「已打包」" : "取消全部「回程已收」";
  $("#suggest").hidden = items.length > 25;

  const fs = [["all", "全部"], ["todo", mode === "packed" ? "還沒打包" : "還沒收"], ["buy", "🛒 要買"], ["mine", "我的＋共用"], ["共用", "共用"], ["Ray", "Ray"], ["Irene", "Irene"]];
  $("#filter").replaceChildren(...fs.filter(([k]) => k !== "mine" || me).map(([k, l]) => {
    const c = k === "all" ? items.length : k === "todo" ? items.filter(i => !i[mode]).length : k === "buy" ? items.filter(i => i.buy).length : null;
    return h("button", { type: "button", class: filter === k ? "on" : "", onclick: () => { filter = k; store.set("pack.filter", k); render(); } }, l + (c != null ? ` ${c}` : ""));
  }));
}
function render() {
  if (!loaded) return;
  renderTop();
  const list = visible(), box = $("#groups");
  if (!items.length) { box.replaceChildren(h("p", { class: "empty" }, "還沒有東西。在上面加，或按「加入建議清單」。")); return; }
  if (!list.length) { box.replaceChildren(h("p", { class: "empty" }, "這個篩選下沒有東西 🎉")); return; }
  box.replaceChildren(...CATS.map(c => {
    const all = items.filter(i => (CAT[i.cat] ? i.cat : "other") === c.k);
    const rows = list.filter(i => (CAT[i.cat] ? i.cat : "other") === c.k).sort((a, b) => (a[mode] - b[mode]) || (a.sort - b.sort));
    if (!rows.length) return null;
    const done = all.filter(i => i[mode]).length;
    return h("section", { class: "pk-group", id: "g-" + c.k },
      h("div", { class: "pk-gh" + (done === all.length ? " done" : "") }, h("span", { class: "ic", "aria-hidden": "true" }, c.ic), h("h3", {}, c.name),
        h("span", { class: "n" }, done === all.length ? `✓ ${done}/${all.length}` : `${done}/${all.length}`)),
      h("ul", { class: "pk-list" }, rows.map(itemEl)));
  }).filter(Boolean));
}
function itemEl(it) {
  const ok = !!it[mode];
  const meta = [h("span", { class: "pk-badge " + whoCls(it.who) }, it.who || "共用")];
  if (it.qty > 1) meta.push(h("span", {}, `× ${it.qty}`));
  if (it.buy) meta.push(h("span", { class: "pk-badge buy" }, "要買"));
  if (it.note) meta.push(h("span", {}, it.note));
  if (mode === "back" && !it.packed) meta.push(h("span", {}, "（出發時沒勾）"));
  const li = h("li", { class: "pk-it" + (ok ? " ok" : "") },
    h("div", { class: "pk-row" },
      h("button", { class: "pk-check", type: "button", "aria-pressed": ok, "aria-label": (ok ? "取消勾選 " : "勾選 ") + it.title, onclick: () => toggle(it) }, ok ? "✓" : ""),
      h("div", { class: "pk-txt", onclick: () => toggle(it) }, h("span", { class: "pk-name" }, it.title), h("div", { class: "pk-meta" }, meta)),
      h("button", { class: "pk-more", type: "button", "aria-label": "編輯 " + it.title, "aria-expanded": openId === it.id, onclick: () => { openId = openId === it.id ? null : it.id; confirmDel = null; render(); } }, openId === it.id ? "✕" : "⋯")));
  if (openId === it.id) li.append(editEl(it));
  return li;
}
function toggle(it) {
  const patch = { id: it.id, [mode]: !it[mode] };
  if (mode === "packed" && !it.packed && it.buy) patch.buy = false;   // 打包了就代表買到了
  Object.assign(it, patch); render();                                   // 先在畫面上勾，手感比較快
  pending++;
  rpc("pack_save", { p: pass, it: patch })
    .catch(e => { onErr(e); return refresh().then(render).catch(() => {}); })
    .finally(() => { pending--; });
}
function editEl(it) {
  const t = h("input", { type: "text", maxlength: "200", value: it.title, "aria-label": "名字" });
  const cat = h("select", { "aria-label": "分類" }, CATS.map(c => h("option", { value: c.k, selected: c.k === it.cat }, `${c.ic} ${c.name}`)));
  const qty = h("input", { type: "number", min: "1", max: "99", value: it.qty, inputmode: "numeric", "aria-label": "數量" });
  const note = h("input", { type: "text", maxlength: "1000", value: it.note, placeholder: "備註", "aria-label": "備註" });
  const buy = h("input", { type: "checkbox", checked: it.buy });
  let who = it.who || "共用";
  const whoBox = h("div", { class: "pk-who" });
  const drawWho = () => whoBox.replaceChildren(...WHO.map(w => h("button", { type: "button", class: w === who ? "on" : "", onclick: () => { who = w; drawWho(); } }, w)));
  drawWho();
  const save = () => {
    const title = t.value.trim(); if (!title) { t.focus(); return; }
    run(async () => { await rpc("pack_save", { p: pass, it: { id: it.id, title, cat: cat.value, qty: Math.max(1, Math.min(99, +qty.value || 1)), note: note.value.trim(), buy: buy.checked, who } }); openId = null; toast("已儲存"); });
  };
  return h("div", { class: "pk-edit" },
    h("div", { class: "field" }, t),
    h("div", { class: "row2" }, h("div", { class: "field" }, cat), h("div", { class: "field" }, qty)),
    whoBox, h("div", { class: "field" }, note),
    h("label", { class: "pk-toggle" }, buy, " 出發前還要買"),
    h("div", { class: "actions" },
      h("button", { class: "btn sm", type: "button", onclick: save }, "儲存"),
      confirmDel === it.id
        ? h("span", {}, "確定刪除？ ", h("button", { class: "btn danger sm", type: "button", onclick: () => run(async () => { await rpc("pack_delete", { p: pass, item_id: it.id }); openId = null; confirmDel = null; toast("已刪除"); }) }, "刪除"))
        : h("button", { class: "linkbtn", type: "button", onclick: () => { confirmDel = it.id; render(); } }, "刪除這項")));
}

/* ---------- 新增 ---------- */
function drawAddWho() {
  $("#aWho").replaceChildren(...WHO.map(w => h("button", { type: "button", class: w === addWho ? "on" : "", "aria-pressed": w === addWho, onclick: () => { addWho = w; drawAddWho(); } }, w)));
}
function initForm() {
  $("#aCat").replaceChildren(...CATS.map(c => h("option", { value: c.k }, `${c.ic} ${c.name}`)));
  drawAddWho();
  $("#addForm").addEventListener("submit", e => {
    e.preventDefault();
    const title = $("#aTitle").value.trim(); if (!title) return;
    const dup = items.find(i => norm(i.title) === norm(title) && i.who === addWho);
    run(async () => {
      await rpc("pack_save", { p: pass, it: { title, cat: $("#aCat").value, who: addWho, qty: Math.max(1, Math.min(99, +$("#aQty").value || 1)), note: $("#aNote").value.trim(), buy: $("#aBuy").checked, sort: Date.now(), added_by: me } });
      $("#aTitle").value = ""; $("#aNote").value = ""; $("#aQty").value = "1"; $("#aBuy").checked = false;
      toast(dup ? `加好了（清單裡本來就有「${dup.title}」）` : "加好了"); $("#aTitle").focus();
    });
  });
  $("#sugBtn").addEventListener("click", () => {
    const have = new Set(items.map(i => norm(i.title) + "|" + i.who));
    const todo = SUGGEST.filter(s => !have.has(norm(s[0]) + "|" + s[2]));
    if (!todo.length) { toast("建議清單都已經在裡面了"); return; }
    const btn = $("#sugBtn"); btn.disabled = true; btn.textContent = `加入中… 0/${todo.length}`;
    run(async () => {
      let n = 0, base = Date.now();
      for (const [title, cat, who, qty, note, buy] of todo) {
        await rpc("pack_save", { p: pass, it: { title, cat, who, qty, note, buy: !!buy, sort: base + n, added_by: "建議清單" } });
        btn.textContent = `加入中… ${++n}/${todo.length}`;
      }
      toast(`加了 ${n} 樣，不需要的點 ⋯ 刪掉就好`);
    }).finally(() => { btn.disabled = false; btn.textContent = "✨ 加入建議清單"; });
  });
  document.querySelectorAll(".pk-mode button").forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.mode; store.set("pack.mode", mode); openId = null; render();
  }));
  let resetArmed = false, rt;
  $("#resetBtn").addEventListener("click", () => {
    if (!resetArmed) { resetArmed = true; toast("再按一次就會取消全部勾選"); clearTimeout(rt); rt = setTimeout(() => resetArmed = false, 4000); return; }
    resetArmed = false; run(async () => { await rpc("pack_reset", { p: pass, mode }); toast("已全部取消勾選"); });
  });
  $("#logout").addEventListener("click", logout);
}

/* ---------- 登入 ---------- */
function logout() { store.del("trip.pass"); pass = ""; $("#app").hidden = true; showGate(); }
function showSetup() { $("#app").hidden = true; $("#gate").hidden = true; $("#setup").hidden = false; }
function showGate() {
  $("#gate").hidden = false; $("#gName").value = me;
  $("#gateForm").onsubmit = async e => {
    e.preventDefault(); const p = $("#gPass").value; $("#gBtn").disabled = true; $("#gErr").textContent = "";
    try {
      const ok = await rpc("trip_login", { p });
      if (!ok) { $("#gErr").textContent = "密碼不對，再試一次"; return; }
      pass = p; store.set("trip.pass", p);
      me = $("#gName").value.trim(); if (me) store.set("trip.name", me);
      if (WHO.includes(me)) addWho = me;
      $("#gate").hidden = true; start();
    } catch { $("#gErr").textContent = "連不上，檢查網路再試一次"; }
    finally { $("#gBtn").disabled = false; }
  };
}
let started = false;
async function start() {
  $("#app").hidden = false;
  if (!started) { started = true; initForm(); setInterval(poll, 20000); document.addEventListener("visibilitychange", poll); }
  try { await refresh(); render(); } catch (e) { onErr(e); }
}

if (!BASE || !CFG.key) { $("#setupMsg").textContent = "config.js 裡還沒有填 Supabase 的網址和金鑰。"; showSetup(); }
else if (pass) start(); else showGate();

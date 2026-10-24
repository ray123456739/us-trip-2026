"use strict";
/* ---------- 固定的行程骨架 ---------- */
const DAYS = [
  ["2026-11-20","11/20","五","FRI","sf","舊金山"],["2026-11-21","11/21","六","SAT","la","洛杉磯"],
  ["2026-11-22","11/22","日","SUN","la","洛杉磯"],["2026-11-23","11/23","一","MON","la","洛杉磯"],
  ["2026-11-24","11/24","二","TUE","lv","Las Vegas"],["2026-11-25","11/25","三","WED","lv","Las Vegas"],
  ["2026-11-26","11/26","四","THU","lv","Las Vegas"],["2026-11-27","11/27","五","FRI","lv","Las Vegas"],
  ["2026-11-28","11/28","六","SAT","ana","Anaheim"],["2026-11-29","11/29","日","SUN","ana","Anaheim"],
  ["2026-11-30","11/30","一","MON","ana","Anaheim"],["2026-12-01","12/01","二","TUE","sf","舊金山"],
  ["2026-12-02","12/02","三","WED","sf","舊金山"],["2026-12-03","12/03","四","THU","sf","舊金山"],
  ["2026-12-04","12/04","五","FRI","sf","舊金山"],["2026-12-05","12/05","六","SAT","sf","舊金山"]
].map(([key, md, wd, en, city, stay]) => ({ key, md, wd, en, city, stay }));
const CITY = { sf: "舊金山", la: "洛杉磯", lv: "Las Vegas", ana: "Anaheim" };
const SPECIAL = { "2026-11-20": "抵達日", "2026-11-26": "感恩節", "2026-11-27": "Black Friday", "2026-12-05": "回台灣" };
const DRIVE = {
  "2026-11-21": ["I-5", "舊金山 → 洛杉磯，約 6 小時"],
  "2026-11-24": ["I-15", "洛杉磯 → Las Vegas，約 4.5 小時，感恩節前車多"],
  "2026-11-28": ["I-15", "Las Vegas → Anaheim，約 4.5 小時，節後返程車潮"],
  "2026-12-01": ["I-5", "Anaheim → 舊金山，約 6.5 小時"]
};

/* ---------- 小工具 ---------- */
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

/* ---------- Supabase ---------- */
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
const photoUrl = p => p ? `${BASE}/storage/v1/object/public/photos/${p.split("/").map(encodeURIComponent).join("/")}` : "";
async function uploadPhoto(file) {
  const blob = await compress(file);
  const path = `p/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const r = await fetch(`${BASE}/storage/v1/object/photos/${path}`, { method: "POST", headers: headers({ "Content-Type": "image/jpeg", "x-upsert": "false" }), body: blob });
  if (!r.ok) throw new Error("upload_failed");
  return path;
}
function compress(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      c.toBlob(b => b ? res(b) : rej(new Error("compress_failed")), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("bad_image")); };
    img.src = u;
  });
}

/* ---------- 狀態 ---------- */
let pass = store.get("trip.pass"), me = store.get("trip.name");
let items = [], covers = {}, loaded = false, openId = null, confirmId = null, busy = false;

/* ---------- 連結判斷 ---------- */
function cleanUrl(raw) {
  raw = (raw || "").trim(); if (!raw) return "";
  const m = raw.match(/https?:\/\/[^\s<>"']+/i); if (m) return m[0];
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw)) return "https://" + raw;
  return raw;
}
function isHttp(u) { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } }
function source(url) {
  if (!url) return { k: "", label: "備註" };
  let u; try { u = new URL(url); } catch { return { k: "", label: "連結" }; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (/instagram\.com$/.test(host)) return { k: "ig", label: /\/reels?\//.test(u.pathname) ? "IG Reel" : "IG" };
  if (/tiktok\.com$/.test(host)) return { k: "", label: "TikTok" };
  if (/youtube\.com$|youtu\.be$/.test(host)) return { k: "yt", label: /shorts/.test(u.pathname) ? "Shorts" : "YouTube" };
  if (/^maps\.app\.goo\.gl$|^goo\.gl$/.test(host) || (/google\./.test(host) && /\/maps/.test(u.pathname))) return { k: "map", label: "地圖" };
  if (/xiaohongshu\.com$|xhslink\.com$/.test(host)) return { k: "xhs", label: "小紅書" };
  if (/facebook\.com$|fb\.watch$/.test(host)) return { k: "", label: "FB" };
  if (/threads\.(net|com)$/.test(host)) return { k: "", label: "Threads" };
  const parts = host.split("."); return { k: "", label: parts.length > 1 ? parts[parts.length - 2] : host };
}
function dayLabel(k) { const d = DAYS.find(x => x.key === k); return d ? `${d.md}（${d.wd}）` : "想去清單"; }
function dayOptions(sel, cur) {
  sel.replaceChildren(h("option", { value: "" }, "想去清單（還沒排）"),
    ...DAYS.map(d => h("option", { value: d.key }, `${d.md}（${d.wd}）${CITY[d.city]}${SPECIAL[d.key] ? " · " + SPECIAL[d.key] : ""}`)));
  sel.value = cur || "";
}
function pickFile() {
  return new Promise(res => {
    const i = h("input", { type: "file", accept: "image/*", class: "sr" });
    i.addEventListener("change", () => { res(i.files && i.files[0] || null); i.remove(); });
    document.body.append(i); i.click();
  });
}

/* ---------- 錯誤處理 ---------- */
function onErr(e) {
  if (e && (e.code === "28P01" || /bad_passcode/.test(e.message))) { toast("旅行密碼變了，請重新輸入"); logout(); return; }
  if (e && /upload_failed|compress_failed|bad_image/.test(e.message)) { toast("照片傳不上去，換一張或晚點再試"); return; }
  toast("沒存到，網路可能不穩，請再試一次");
}
async function run(fn) {
  if (busy) return; busy = true;
  try { await fn(); await refresh(); } catch (e) { onErr(e); } finally { busy = false; render(); }
}

/* ---------- 讀取 ---------- */
async function refresh() {
  const data = await rpc("trip_list", { p: pass });
  items = data.items || []; covers = {}; for (const c of data.covers || []) covers[c.day] = c.photo;
  loaded = true;
}
async function poll() {
  if (document.hidden || busy || openId) return;
  try { await refresh(); render(); } catch (e) { if (e.code === "28P01") onErr(e); }
}

/* ---------- 版面 ---------- */
function buildShell() {
  const now = new Date(), start = new Date("2026-11-20T00:00:00-08:00"), end = new Date("2026-12-06T00:00:00-08:00");
  $("#count").textContent = now < start ? `還有 ${Math.ceil((start - now) / 864e5)} 天出發，BR008 早上 6:40 落地 SFO。`
    : now < end ? `旅程第 ${Math.floor((now - start) / 864e5) + 1} 天，玩得開心！` : "旅程結束了，歡迎回家。";
  dayOptions($("#fDay"), "");
  $("#nav").replaceChildren(h("a", { href: "#wish", class: "wish" }, "想去清單"),
    ...DAYS.map(d => h("a", { href: "#d" + d.key.replaceAll("-", "") }, h("span", { class: "dot", style: `background:var(--${d.city})` }), d.md)));
  $("#days").replaceChildren(...DAYS.map(d => {
    const sub = [`住 ${d.stay}`]; if (SPECIAL[d.key]) sub.unshift(SPECIAL[d.key]);
    return h("section", { class: "sec", id: "d" + d.key.replaceAll("-", "") },
      h("div", { class: "cover", id: "cover-" + d.key, style: `--c:var(--${d.city})` },
        h("div", { class: "cover-in" },
          h("div", { class: "sign exit" }, h("span", { class: "md" }, d.md), h("span", { class: "wd" }, `${d.en} · ${d.wd}`)),
          h("div", { class: "cover-txt" }, h("h3", {}, CITY[d.city]), h("span", { class: "sub" }, sub.join(" · ")))),
        h("button", { class: "cover-btn", type: "button", onclick: () => changeCover(d.key) }, "加封面照")),
      DRIVE[d.key] ? h("div", { class: "drive" }, h("span", { class: "lane" }, DRIVE[d.key][0]), h("span", {}, "開車日：" + DRIVE[d.key][1])) : null,
      h("ul", { class: "list", id: "list-" + d.key }),
      h("button", { class: "btn ghost sm add-here", type: "button", onclick: () => focusAdd(d.key) }, "＋ 加到這天"));
  }));
}
function focusAdd(key) { $("#fDay").value = key; $("#addForm").scrollIntoView({ block: "start" }); setTimeout(() => $("#fUrl").focus({ preventScroll: true }), 300); }

function sorted(day) { return items.filter(i => (i.day || "") === day).sort((a, b) => a.sort - b.sort); }
function render() {
  if (!loaded) return;
  let draft = null; const ed = document.querySelector(".edit[data-id]");
  if (ed) draft = { id: ed.dataset.id, title: ed.querySelector(".eTitle").value, url: ed.querySelector(".eUrl").value, time: ed.querySelector(".eTime").value, note: ed.querySelector(".eNote").value, day: ed.querySelector(".eDay").value };
  fill($("#list-wish"), sorted(""), "還沒有東西。在上面貼一個 Reels 連結試試。", draft);
  for (const d of DAYS) {
    fill($("#list-" + d.key), sorted(d.key), "這天還空著。", draft);
    const cv = $("#cover-" + d.key), ph = covers[d.key];
    const old = cv.querySelector("img"); if (old) old.remove();
    cv.classList.toggle("has-photo", !!ph);
    if (ph) cv.prepend(h("img", { src: photoUrl(ph), alt: "", loading: "lazy" }));
    cv.querySelector(".cover-btn").textContent = ph ? "換封面" : "加封面照";
  }
}
function fill(ul, list, emptyText, draft) {
  if (!list.length) { ul.replaceChildren(h("li", { class: "empty" }, emptyText)); return; }
  ul.replaceChildren(...list.map((it, i) => itemEl(it, i, list, draft && draft.id === it.id ? draft : null)));
}
function itemEl(it, i, list, draft) {
  const s = source(it.url), link = it.url && isHttp(it.url);
  const ttl = h("div", { class: "ttl" }, it.time ? h("span", { class: "time" }, it.time) : null,
    link ? h("a", { href: it.url, target: "_blank", rel: "noopener noreferrer" }, it.title || s.label) : (it.title || "（沒有名稱）"));
  const meta = h("div", { class: "meta" }, it.added_by ? h("span", {}, `${it.added_by} 加的`) : null,
    h("a", { href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(it.title || ""), target: "_blank", rel: "noopener noreferrer" }, "在地圖找"));
  const acts = h("div", { class: "acts" },
    h("button", { class: "ic", type: "button", "aria-label": "往上移", disabled: i === 0, onclick: () => swap(list[i], list[i - 1]) }, "↑"),
    h("button", { class: "ic", type: "button", "aria-label": "往下移", disabled: i === list.length - 1, onclick: () => swap(list[i], list[i + 1]) }, "↓"),
    h("button", { class: "ic", type: "button", "aria-label": "編輯", "aria-expanded": openId === it.id ? "true" : "false", onclick: () => { openId = openId === it.id ? null : it.id; confirmId = null; render(); } }, "✎"));
  const li = h("li", { class: "item" + (it.photo ? " has-photo" : "") },
    it.photo ? (link ? h("a", { href: it.url, target: "_blank", rel: "noopener noreferrer", "aria-label": it.title || s.label }, h("img", { class: "ph", src: photoUrl(it.photo), alt: "", loading: "lazy" }))
                     : h("img", { class: "ph", src: photoUrl(it.photo), alt: "", loading: "lazy" })) : null,
    h("div", { class: "body" }, h("span", { class: "tag " + s.k }, s.label), h("div", { class: "main" }, ttl, it.note ? h("div", { class: "note" }, it.note) : null, meta), acts));
  if (openId === it.id) li.append(editEl(it, draft || it));
  return li;
}
function editEl(it, v) {
  const id = it.id;
  const sel = h("select", { class: "eDay", id: "eDay-" + id }); dayOptions(sel, v.day || "");
  const e = h("div", { class: "edit", "data-id": id },
    h("div", { class: "row2" },
      h("div", { class: "field" }, h("label", { for: "eTitle-" + id }, "名稱"), h("input", { type: "text", class: "eTitle", id: "eTitle-" + id, value: v.title || "", maxlength: "200" })),
      h("div", { class: "field" }, h("label", { for: "eTime-" + id }, "時間（選填）"), h("input", { type: "text", class: "eTime", id: "eTime-" + id, value: v.time || "", placeholder: "例如 18:00、傍晚", maxlength: "40" }))),
    h("div", { class: "field" }, h("label", { for: "eUrl-" + id }, "連結"), h("input", { type: "text", class: "eUrl", id: "eUrl-" + id, value: v.url || "", inputmode: "url" })),
    h("div", { class: "field" }, h("label", { for: "eNote-" + id }, "備註"), h("textarea", { class: "eNote", id: "eNote-" + id, rows: "2", maxlength: "2000" }, v.note || "")),
    h("div", { class: "field" }, h("label", { for: "eDay-" + id }, "排到哪天"), sel),
    h("div", { class: "btns" },
      h("button", { class: "btn ghost sm", type: "button", onclick: () => changePhoto(it) }, it.photo ? "換照片" : "加照片"),
      it.photo ? h("button", { class: "btn ghost sm", type: "button", onclick: () => run(() => rpc("trip_save", { p: pass, it: { id, photo: "" } })) }, "移除照片") : null),
    h("div", { class: "btns" },
      h("button", { class: "btn sm", type: "button", onclick: () => saveEdit(it, e) }, "儲存"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => { openId = null; render(); } }, "取消"),
      h("span", { class: "spacer" }),
      confirmId === id
        ? h("span", { class: "confirm" }, "確定刪除？",
            h("button", { class: "btn danger sm", type: "button", onclick: () => run(async () => { await rpc("trip_delete", { p: pass, item_id: id }); openId = null; confirmId = null; toast("已刪除"); }) }, "刪除"),
            h("button", { class: "btn ghost sm", type: "button", onclick: () => { confirmId = null; render(); } }, "保留"))
        : h("button", { class: "btn ghost sm", type: "button", onclick: () => { confirmId = id; render(); } }, "刪除")));
  return e;
}

/* ---------- 寫入 ---------- */
function swap(a, b) {
  if (!a || !b) return;
  run(async () => {
    const na = a.sort === b.sort ? b.sort - 1 : b.sort;
    await rpc("trip_save", { p: pass, it: { id: a.id, sort: na } });
    await rpc("trip_save", { p: pass, it: { id: b.id, sort: a.sort } });
  });
}
function saveEdit(it, e) {
  const url = cleanUrl(e.querySelector(".eUrl").value), day = e.querySelector(".eDay").value;
  const patch = { id: it.id, title: e.querySelector(".eTitle").value.trim() || source(url).label, url,
    time: e.querySelector(".eTime").value.trim(), note: e.querySelector(".eNote").value.trim(), day };
  if (day !== (it.day || "")) patch.sort = Date.now();
  run(async () => { await rpc("trip_save", { p: pass, it: patch }); openId = null; toast(day !== (it.day || "") ? "已移到" + dayLabel(day) : "已儲存"); });
}
async function changePhoto(it) {
  const f = await pickFile(); if (!f) return;
  toast("照片上傳中…");
  run(async () => { const p = await uploadPhoto(f); await rpc("trip_save", { p: pass, it: { id: it.id, photo: p } }); toast("照片換好了"); });
}
async function changeCover(day) {
  const f = await pickFile(); if (!f) return;
  toast("封面上傳中…");
  run(async () => { const p = await uploadPhoto(f); await rpc("trip_set_cover", { p: pass, d: day, ph: p }); toast(dayLabel(day) + " 的封面換好了"); });
}

/* ---------- 新增表單 ---------- */
let pendingPhoto = null;
function initForm() {
  const fUrl = $("#fUrl"), fTag = $("#fTag");
  const updTag = () => { const u = cleanUrl(fUrl.value); if (u && isHttp(u)) { const s = source(u); fTag.textContent = s.label; fTag.className = "tag " + s.k; fTag.hidden = false; } else fTag.hidden = true; };
  fUrl.addEventListener("input", updTag);
  fUrl.addEventListener("paste", () => setTimeout(() => { fUrl.value = cleanUrl(fUrl.value); updTag(); $("#fTitle").focus(); }, 0));
  const clearPhoto = () => { pendingPhoto = null; $("#fPhoto").value = ""; $("#fPreview").hidden = true; const im = $("#fPreviewImg"); if (im.src) URL.revokeObjectURL(im.src); im.removeAttribute("src"); };
  $("#fPhoto").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (!f) return; pendingPhoto = f; $("#fPreviewImg").src = URL.createObjectURL(f); $("#fPreview").hidden = false; });
  $("#fPhotoClear").addEventListener("click", clearPhoto);
  $("#addForm").addEventListener("submit", ev => {
    ev.preventDefault();
    const url = cleanUrl(fUrl.value), title = $("#fTitle").value.trim(), note = $("#fNote").value.trim(), day = $("#fDay").value;
    if (!url && !title) { $("#fMsg").textContent = "貼個連結或寫個名稱再加。"; fUrl.focus(); return; }
    $("#fMsg").textContent = pendingPhoto ? "照片上傳中…" : ""; $("#fBtn").disabled = true;
    run(async () => {
      const photo = pendingPhoto ? await uploadPhoto(pendingPhoto) : "";
      await rpc("trip_save", { p: pass, it: { title: title || source(url).label + " 收藏", url, note, day, time: "", sort: Date.now(), photo, added_by: me } });
      fUrl.value = ""; $("#fTitle").value = ""; $("#fNote").value = ""; updTag(); clearPhoto();
      toast("已加到" + dayLabel(day));
    }).finally(() => { $("#fBtn").disabled = false; $("#fMsg").textContent = ""; });
  });
}

/* ---------- 登入 ---------- */
function logout() { store.del("trip.pass"); pass = ""; $("#app").hidden = true; showGate(); }
function showGate() {
  $("#gate").hidden = false; $("#gName").value = me || "";
  setTimeout(() => $("#gPass").focus(), 50);
}
$("#gateForm").addEventListener("submit", async ev => {
  ev.preventDefault(); $("#gErr").textContent = ""; $("#gBtn").disabled = true;
  const p = $("#gPass").value;
  try {
    const ok = await rpc("trip_login", { p });
    if (!ok) { $("#gErr").textContent = "密碼不對，再試一次。"; return; }
    pass = p; me = $("#gName").value.trim(); store.set("trip.pass", p); store.set("trip.name", me);
    $("#gate").hidden = true; await start();
  } catch { $("#gErr").textContent = "連不上，請確認網路後再試。"; }
  finally { $("#gBtn").disabled = false; }
});
$("#logout").addEventListener("click", logout);

let started = false;
async function start() {
  $("#app").hidden = false;
  $("#nameBar").hidden = !!me;
  if (!started) { started = true; buildShell(); initForm(); setInterval(poll, 20000); document.addEventListener("visibilitychange", poll); }
  try { await refresh(); render(); } catch (e) { onErr(e); }
}

/* 第一次用一鍵連結進來的人，請他留個名字 */
$("#nameForm").addEventListener("submit", ev => {
  ev.preventDefault(); const n = $("#nName").value.trim(); if (!n) return;
  me = n; store.set("trip.name", n); $("#nameBar").hidden = true; toast(`嗨 ${n}，之後你加的行程都會標上名字`);
});

/* 一鍵登入：網址帶 #k=密碼 就自動登入，登入後把密碼從網址拿掉 */
function readLinkKey() {
  const m = location.hash.match(/(?:^#|&)k=([^&]+)/);
  if (!m) return "";
  try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/* ---------- 開始 ---------- */
(async () => {
  if (!BASE || !CFG.key) { $("#setup").hidden = false; return; }
  const k = readLinkKey();
  if (k && k !== pass) {
    try {
      if (await rpc("trip_login", { p: k })) { pass = k; store.set("trip.pass", k); }
      else { showGate(); $("#gErr").textContent = "這個連結的密碼已經換過了，請輸入新的旅行密碼。"; return; }
    } catch { showGate(); $("#gErr").textContent = "連不上，請確認網路後再試。"; return; }
  }
  if (pass) start(); else showGate();
})();

// 算同一天相鄰兩個景點之間的開車時間和距離。
// 位置：OpenStreetMap Nominatim（找到後存在資料庫，不重複查）；路線：OSRM。都不需要金鑰。
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const UA = "us-trip-2026 family travel planner (https://ray123456739.github.io/us-trip-2026/)";
const DAY_CITY: Record<string, string> = {
  "2026-11-20": "sf", "2026-11-21": "la", "2026-11-22": "la", "2026-11-23": "la", "2026-11-24": "lv",
  "2026-11-25": "lv", "2026-11-26": "lv", "2026-11-27": "lv", "2026-11-28": "ana", "2026-11-29": "ana",
  "2026-11-30": "ana", "2026-12-01": "sf", "2026-12-02": "sf", "2026-12-03": "sf", "2026-12-04": "sf", "2026-12-05": "sf",
};
const DRIVE_DAYS = new Set(["2026-11-21", "2026-11-24", "2026-11-28", "2026-12-01"]);
const CITY_EN: Record<string, string> = { sf: "San Francisco", la: "Los Angeles", lv: "Las Vegas", ana: "Anaheim" };
// 經度,緯度 左上,右下：把搜尋範圍限制在那個城市附近，避免找到別州同名的店
const BOX: Record<string, string> = {
  sf: "-123.2,38.6,-121.5,36.4", la: "-119.0,34.5,-117.6,33.6",
  lv: "-115.7,36.5,-114.6,35.8", ana: "-118.2,34.0,-117.4,33.4",
};
const isTransit = (t: string) => /出發|開往|開回|抵達|搭機|入住|回程|休息/.test(t || "");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Item = { id: string; title: string; day: string; sort: number; lat: number | null; lng: number | null; geo_q: string; geo_fail: boolean };

function query(it: Item) {
  const city = CITY_EN[DAY_CITY[it.day]] || "";
  // 去掉括號裡的說明和中文字（地圖資料庫用英文名比較找得到），留下地名
  let t = (it.title || "").replace(/[（(].*?[)）]/g, " ").replace(/[，,、]/g, " ");
  const en = t.replace(/[\u3000-\u9fff\uff00-\uffef]+/g, " ").replace(/\s+/g, " ").trim();
  t = en.length >= 3 ? en : t.trim();
  return t.toLowerCase().includes(city.toLowerCase()) ? t : `${t} ${city}`.trim();
}
const CENTER: Record<string, [number, number]> = { sf: [37.77, -122.42], la: [34.05, -118.30], lv: [36.13, -115.17], ana: [33.81, -117.92] };
const inBox = (city: string, lat: number, lng: number) => {
  const b = BOX[city]; if (!b) return true;
  const [w, n, e, s] = b.split(",").map(Number); return lng >= w && lng <= e && lat <= n && lat >= s;
};
// 1. Photon（OpenStreetMap 資料，對雲端伺服器比較寬鬆）
async function photon(q: string, city: string, wide: boolean) {
  const u = new URL("https://photon.komoot.io/api/");
  u.searchParams.set("q", q); u.searchParams.set("limit", "3");
  if (CENTER[city]) { u.searchParams.set("lat", String(CENTER[city][0])); u.searchParams.set("lon", String(CENTER[city][1])); }
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA } });
    console.log("photon", r.status, q);
    if (!r.ok) return null;
    const j = await r.json();
    for (const f of j.features || []) {
      const [lng, lat] = f.geometry.coordinates;
      if (wide || inBox(city, lat, lng)) return { lat, lng };
    }
    return null;
  } catch (e) { console.log("photon error", String(e)); return null; }
}
// 3. 最後請 AI 給大概的座標（知名景點很準，小店可能有誤差）
async function aiGeo(title: string, city: string) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY"); if (!apiKey) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 80, messages: [{ role: "user", content:
        `"${title}" 這個地點在 ${CITY_EN[city] || "美國"} 附近，它的經緯度是多少？如果這不是一個具體地點（例如「吃晚餐」「逛 Outlet」）或你不確定，回答 none。只回答「緯度,經度」或 none，不要其他文字。` }] }) });
    const j = await r.json();
    const t = (j.content || []).map((c: { text?: string }) => c.text || "").join("").trim();
    console.log("aiGeo", r.status, title, t);
    const m = t.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    return m ? { lat: +m[1], lng: +m[2] } : null;
  } catch (e) { console.log("aiGeo error", String(e)); return null; }
}

let lastGeo = 0;
async function geocode(q: string, city: string, wide: boolean) {
  const wait = 1100 - (Date.now() - lastGeo); if (wait > 0) await sleep(wait);  // Nominatim 規定每秒最多一次
  lastGeo = Date.now();
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q); u.searchParams.set("format", "jsonv2"); u.searchParams.set("limit", "1");
  u.searchParams.set("countrycodes", "us");
  if (!wide && BOX[city]) { u.searchParams.set("viewbox", BOX[city]); u.searchParams.set("bounded", "1"); }
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
    console.log("nominatim", r.status, q);
    if (!r.ok) return null;
    const a = await r.json();
    return a && a[0] ? { lat: +a[0].lat, lng: +a[0].lon } : null;
  } catch (e) { console.log("nominatim error", String(e)); return null; }
}

async function route(a: Item, b: Item) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`,
      { headers: { "User-Agent": UA } });
    console.log("osrm", r.status);
    if (!r.ok) return null;
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    return rt ? { min: Math.max(1, Math.round(rt.duration / 60)), km: Math.round(rt.distance / 100) / 10 } : null;
  } catch { return null; }
}

// OSRM 也連不上時，用直線距離粗估（市區道路約直線的 1.4 倍、平均時速 35 公里）
function estimate(a: Item, b: Item) {
  const R = 6371, toR = (x: number) => x * Math.PI / 180;
  const dLat = toR(b.lat! - a.lat!), dLng = toR(b.lng! - a.lng!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat!)) * Math.cos(toR(b.lat!)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(h)) * 1.4;
  return { min: Math.max(3, Math.round(km / 35 * 60)), km: Math.round(km * 10) / 10, rough: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { p?: string; day?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const day = body.day || "";
  if (!DAY_CITY[day]) return json({ error: "bad_day" }, 400);

  const base = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const hd = { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" };
  const lr = await fetch(`${base}/rest/v1/rpc/trip_list`, { method: "POST", headers: hd, body: JSON.stringify({ p: body.p || "" }) });
  if (!lr.ok) return json({ error: "bad_passcode" }, 401);
  const trip = await lr.json();
  const list: Item[] = (trip.items || []).filter((i: Item) => i.day === day).sort((a: Item, b: Item) => a.sort - b.sort);

  // 只處理「相鄰而且都不是交通行程」的那幾對
  const pairs: [Item, Item][] = [];
  for (let i = 0; i < list.length - 1; i++)
    if (!isTransit(list[i].title) && !isTransit(list[i + 1].title)) pairs.push([list[i], list[i + 1]]);

  const need = new Map<string, Item>();
  for (const [a, b] of pairs) { need.set(a.id, a); need.set(b.id, b); }
  const city = DAY_CITY[day];
  for (const it of need.values()) {
    const q = query(it);
    if (it.geo_q === q && (it.lat != null || it.geo_fail)) continue;  // 已經查過
    const wide = DRIVE_DAYS.has(day);
    let g = await photon(q, city, wide);
    if (!g) g = await geocode(q, city, wide);
    if (!g) g = await aiGeo(it.title, city);
    it.lat = g ? g.lat : null; it.lng = g ? g.lng : null; it.geo_q = q; it.geo_fail = !g;
    await fetch(`${base}/rest/v1/items?id=eq.${it.id}`, { method: "PATCH", headers: hd,
      body: JSON.stringify({ lat: it.lat, lng: it.lng, geo_q: q, geo_fail: !g }) });
  }

  const legs: Record<string, unknown> = {};
  for (const [a, b] of pairs) {
    const k = `${a.id}>${b.id}`;
    if (a.lat == null || b.lat == null) { legs[k] = { missing: [a.lat == null ? a.title : null, b.lat == null ? b.title : null].filter(Boolean) }; continue; }
    legs[k] = (await route(a, b)) || estimate(a, b);
  }
  return json({ ok: true, legs });
});

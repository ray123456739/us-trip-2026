// 讀 Reels／連結的文字說明，請 Claude 判斷地點並建議排在哪一天、什麼時段。
// 需要 Supabase secret：ANTHROPIC_API_KEY
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const DAYS = [
  ["2026-11-20", "五", "sf", "抵達日，早上 6:40 落地 SFO"],
  ["2026-11-21", "六", "la", "開車日：舊金山 → 洛杉磯，I-5 約 6 小時"],
  ["2026-11-22", "日", "la", ""], ["2026-11-23", "一", "la", ""],
  ["2026-11-24", "二", "lv", "開車日：洛杉磯 → Las Vegas，I-15 約 4.5 小時"],
  ["2026-11-25", "三", "lv", ""], ["2026-11-26", "四", "lv", "感恩節，很多店休息或要預約"],
  ["2026-11-27", "五", "lv", "Black Friday"],
  ["2026-11-28", "六", "ana", "開車日：Las Vegas → Anaheim，I-15 約 4.5 小時"],
  ["2026-11-29", "日", "ana", "Disney California Adventure 整天"],
  ["2026-11-30", "一", "ana", "Disneyland Park 整天"],
  ["2026-12-01", "二", "sf", "開車日：Anaheim → 舊金山，I-5 約 6.5 小時"],
  ["2026-12-02", "三", "sf", ""], ["2026-12-03", "四", "sf", ""], ["2026-12-04", "五", "sf", ""],
  ["2026-12-05", "六", "sf", "中午 12:00 的飛機回台灣，早上要還車去機場"],
];
const CITY: Record<string, string> = { sf: "舊金山灣區", la: "洛杉磯", lv: "Las Vegas", ana: "Anaheim / 橘郡" };

function meta(html: string, prop: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  return (html.match(re) || html.match(re2) || [])[1] || "";
}
const decode = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#039;|&apos;/g, "'");

async function readLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    const host = new URL(url).hostname;
    if (!host.includes(".") || /^[\d.]+$|^\[|localhost|\.internal$|supabase\.co$/i.test(host)) return "";
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 7000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow",
      headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Accept-Language": "zh-TW,en;q=0.8" } });
    clearTimeout(t);
    const html = (await r.text()).slice(0, 400000);
    console.log("readLink", host, r.status, html.length);
    const parts = [meta(html, "og:title"), meta(html, "og:description"), meta(html, "description"),
      (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || ""].map(decode).map(s => s.trim()).filter(Boolean);
    return [...new Set(parts)].join("\n").slice(0, 3000);
  } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { p?: string; url?: string; hint?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  // 1. 用旅行密碼取得目前行程（密碼錯就停）
  const base = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
  const lr = await fetch(`${base}/rest/v1/rpc/trip_list`, { method: "POST",
    headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify({ p: body.p || "" }) });
  if (!lr.ok) return json({ error: "bad_passcode" }, 401);
  const trip = await lr.json();

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "no_api_key" }, 500);

  // 2. 讀連結裡的文字
  const url = (body.url || "").slice(0, 1000), hint = (body.hint || "").slice(0, 300);
  let linkText = await readLink(url);
  // IG 擋讀取時只會回「Instagram」這種空殼標題，當作讀不到
  if (linkText.replace(/instagram|tiktok|youtube|log in|登入|\s|[•·|-]/gi, "").length < 12) linkText = "";
  console.log("linkText", linkText.length, linkText.slice(0, 200).replace(/\n/g, " / "));
  if (!linkText && !hint) return json({ error: "nothing_to_read" }, 200);

  // 3. 整理每天已經排的行程
  const byDay: Record<string, string[]> = {};
  for (const it of trip.items || []) if (it.day) (byDay[it.day] ||= []).push(`${it.time ? it.time + " " : ""}${it.title}${it.stay ? "（停留 " + it.stay + "）" : ""}`);
  const schedule = DAYS.map(([d, wd, c, note]) =>
    `${d}（${wd}）住${CITY[c]}${note ? "；" + note : ""}；已排：${(byDay[d] || []).join("、") || "（空）"}`).join("\n");

  const prompt = `你是幫兩個台灣旅客排美西自駕行程的助手。請根據下面的連結內容，找出裡面介紹的地點，並建議每個地點排在哪一天、什麼時段。

<行程>
${schedule}
</行程>

<連結>${url}</連結>
<連結文字>
${linkText || "（讀不到）"}
</連結文字>
<使用者補充>${hint || "（無）"}</使用者補充>

規則：
- 一支影片常常介紹好幾個地點（一日遊路線、清單型影片）。請把每個「具體、叫得出名字的地點」都拆成一筆，最多 8 筆。像「LA 一日遊」這種總稱不算地點。
- 已經在上面行程「已排」裡的同一個地點（名稱相同或明顯是同一處），不要再列進 places，改放進 skipped，reason 寫「行程裡已經有了」。
- 只能排在「住的城市」跟地點相符的日子。Santa Monica、Hollywood、Beverly Hills、Highland Park 等算洛杉磯；Irvine、Huntington Beach、Newport 等橘郡地點算 Anaheim；Red Rock、Hoover Dam 算 Las Vegas；Napa、Muir Woods、Sausalito、Monterey 可排在 12/02–12/04 舊金山的空白日。
- 開車日只在地點剛好在路上時才排（例如 Barstow Outlet、Harris Ranch、Pismo Beach），否則避開。11/29、11/30 整天在迪士尼，除非是迪士尼裡面或 Downtown Disney 的東西，否則避開。
- 同一支影片裡同一區的地點（例如一條散步路線），盡量排在同一天，照影片的順序給時段，讓它們可以一起逛。
- 優先選同城市裡行程比較少的那天；看地點類型決定時段（早午餐→早上、夕陽景點→傍晚、夜景秀和酒吧→晚上），時段要排在當天已排行程的空檔，不要撞時間。
- 地點不在這趟會去的區域（例如亞利桑那州），還是列進 places，但 day 留空字串，note 說明不在路線上。
- 不要編造店名；連結文字沒寫清楚的就不要列。

不管判斷得出來與否，都只輸出一個 JSON，開頭是 { 結尾是 }，不要加任何說明文字或 markdown：
{"places":[{"place":"地點正式名稱（英文為主，可加中文）","area":"所在區域，例如 Santa Monica","day":"YYYY-MM-DD 或空字串","time":"早上／中午／下午／傍晚／晚上，或明確時間如 19:30，不確定就空字串","stay":"建議停留多久，例如 1 小時","note":"一句繁體中文，說明這是什麼和為什麼排這天，30 字內"}],"skipped":[{"place":"地點名稱","reason":"為什麼沒加"}],"confidence":"high、medium 或 low"}`;

  const ar = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 12000, output_config: { effort: "low" }, messages: [{ role: "user", content: prompt }] }) });
  if (!ar.ok) { console.error("anthropic", ar.status, await ar.text()); return json({ error: "ai_failed", status: ar.status }, 502); }
  const out = await ar.json();
  const text = (out.content || []).map((c: { text?: string }) => c.text || "").join("");
  console.log("ai raw", out.stop_reason, text.slice(0, 500).replace(/\n/g, " / "));
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const m = cleaned.match(/\{[\s\S]*\}/);
  // deno-lint-ignore no-explicit-any
  let r: any = null;
  if (m) { try { r = JSON.parse(m[0]); } catch { /* 下面處理 */ } }
  if (!r) return json({ error: linkText || hint ? "not_identified" : "nothing_to_read" }, 200);
  const valid = new Set(DAYS.map(d => d[0]));
  const str = (v: unknown, n: number) => (typeof v === "string" ? v : "").slice(0, n);
  const places = (Array.isArray(r.places) ? r.places : []).slice(0, 8)
    .map((x: Record<string, unknown>) => ({ place: str(x.place, 200), area: str(x.area, 100), day: valid.has(str(x.day, 10)) ? str(x.day, 10) : "",
      time: str(x.time, 40), stay: str(x.stay, 40), note: str(x.note, 300) }))
    .filter((x: { place: string }) => x.place);
  const skipped = (Array.isArray(r.skipped) ? r.skipped : []).slice(0, 10)
    .map((x: Record<string, unknown>) => ({ place: str(x.place, 200), reason: str(x.reason, 100) })).filter((x: { place: string }) => x.place);
  if (!places.length && !skipped.length) return json({ error: linkText || hint ? "not_identified" : "nothing_to_read" }, 200);
  return json({ ok: true, read_link: !!linkText, places, skipped, confidence: str(r.confidence, 10) || "low" });
});

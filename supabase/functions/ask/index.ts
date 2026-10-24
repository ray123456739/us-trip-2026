// 問題討論區：用整趟行程當背景，請 Claude 回答一個問題，答案存進 answers。
// 需要 Supabase secret：ANTHROPIC_API_KEY
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const DAYS: [string, string, string, string][] = [
  ["2026-11-20", "五", "舊金山", "抵達日，早上 6:40 搭 BR008 落地 SFO"],
  ["2026-11-21", "六", "洛杉磯", "開車日：舊金山 → 洛杉磯，I-5 約 6 小時"],
  ["2026-11-22", "日", "洛杉磯", ""], ["2026-11-23", "一", "洛杉磯", ""],
  ["2026-11-24", "二", "Las Vegas", "開車日：洛杉磯 → Las Vegas，I-15 約 4.5 小時"],
  ["2026-11-25", "三", "Las Vegas", ""], ["2026-11-26", "四", "Las Vegas", "感恩節"],
  ["2026-11-27", "五", "Las Vegas", "Black Friday"],
  ["2026-11-28", "六", "Anaheim", "開車日：Las Vegas → Anaheim，I-15 約 4.5 小時"],
  ["2026-11-29", "日", "Anaheim", ""], ["2026-11-30", "一", "Anaheim", ""],
  ["2026-12-01", "二", "舊金山", "開車日：Anaheim → 舊金山，I-5 約 6.5 小時"],
  ["2026-12-02", "三", "舊金山", ""], ["2026-12-03", "四", "舊金山", ""], ["2026-12-04", "五", "舊金山", ""],
  ["2026-12-05", "六", "舊金山", "中午 12:00 搭 BR007 回台灣"],
];
type Item = { title: string; day: string; time: string; stay: string; note: string; sort: number };
type Ans = { body: string; answered_by: string; is_ai: boolean };
type Q = { id: string; body: string; asked_by: string; answers: Ans[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: { p?: string; qid?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  const base = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const hd = { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" };
  const lr = await fetch(`${base}/rest/v1/rpc/trip_list`, { method: "POST", headers: hd, body: JSON.stringify({ p: body.p || "" }) });
  if (!lr.ok) return json({ error: "bad_passcode" }, 401);
  const trip = await lr.json();
  const q: Q | undefined = (trip.questions || []).find((x: Q) => x.id === body.qid);
  if (!q) return json({ error: "not_found" }, 404);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "no_api_key" }, 500);

  const items: Item[] = (trip.items || []).slice().sort((a: Item, b: Item) => a.sort - b.sort);
  const line = (i: Item) => `- ${i.time ? i.time + " " : ""}${i.title}${i.stay ? `（停留 ${i.stay}）` : ""}${i.note ? `：${i.note}` : ""}`;
  const plan = DAYS.map(([d, wd, city, note]) => {
    const rows = items.filter(i => i.day === d).map(line).join("\n");
    return `${d}（${wd}）住${city}${note ? "；" + note : ""}\n${rows || "- （還沒排）"}`;
  }).join("\n\n");
  const wish = items.filter(i => !i.day).map(line).join("\n") || "（無）";
  const thread = (q.answers || []).map(a => `${a.is_ai ? "AI" : a.answered_by || "家人"}：${a.body}`).join("\n") || "（還沒有人回答）";

  const prompt = `你是 Ray 和 Irene 這趟美西自駕旅行（2026/11/20–12/05，兩個從台灣出發的家人）的旅行小幫手。請根據他們目前的行程回答問題。

<目前行程>
${plan}
</目前行程>

<想去清單（還沒排日子）>
${wish}
</想去清單>

<這個問題底下已經有的回答>
${thread}
</這個問題底下已經有的回答>

<問題>（${q.asked_by || "有人"}問）
${q.body}
</問題>

回答方式：
- 用繁體中文，口氣像熟悉美國旅遊的朋友，直接給結論和具體建議，150 字左右，必要時可以用短條列。
- 有用到行程裡的日子或景點就直接點名，例如「11/22 你們排了 Griffith Observatory」。
- 營業時間、票價、訂位規定這類可能變動的資訊，說出你知道的大概情況，並提醒出發前到官網確認。
- 不知道或沒把握的就直說，不要編造。`;

  const ar = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 8000, output_config: { effort: "medium" }, messages: [{ role: "user", content: prompt }] }) });
  if (!ar.ok) { console.error("anthropic", ar.status, await ar.text()); return json({ error: "ai_failed" }, 502); }
  const out = await ar.json();
  const text = (out.content || []).map((c: { text?: string }) => c.text || "").join("").trim();
  if (!text) { console.log("ask empty", out.stop_reason); return json({ error: "ai_unclear" }, 200); }

  const ir = await fetch(`${base}/rest/v1/answers`, { method: "POST", headers: { ...hd, Prefer: "return=representation" },
    body: JSON.stringify({ question_id: q.id, body: text.slice(0, 4000), answered_by: "AI 小幫手", is_ai: true }) });
  if (!ir.ok) { console.error("insert", ir.status, await ir.text()); return json({ error: "save_failed" }, 500); }
  return json({ ok: true, answer: text });
});

-- AI 判斷的固定測試題：每次改完 analyze 都跑一次（在 Supabase SQL Editor 執行）。
-- 1. 把 <旅行密碼> 換成實際的旅行密碼（不要把密碼存回這個檔案，這個 repo 是公開的）
-- 2. 執行 insert，會一次送出 5 個請求；3. 等約 60 秒；4. 執行最下面的檢查
create temporary table if not exists _t(name text, req bigint);
insert into _t select name, net.http_post(
  url := 'https://lgfleupvutgohepaejlc.supabase.co/functions/v1/analyze',
  body := jsonb_build_object('p', '<旅行密碼>', 'url', url, 'hint', hint),
  headers := jsonb_build_object('Content-Type', 'application/json'),
  timeout_milliseconds := 120000)
from (values
  ('單一地點',       'https://www.instagram.com/p/DdOAta2lg71/', ''),
  ('LA 景點合集',    'https://www.instagram.com/reel/DHBL1xRJ8V3/', ''),
  ('Highland Park', 'https://www.instagram.com/reel/DYmMOL8xRS-/', ''),
  ('只寫大概名字',   '', '聖塔莫尼卡那家很紅的潛艇堡'),
  ('不在路線上',     '', '亞利桑那州的馬蹄灣')
) v(name, url, hint);

-- 通過標準：每題 ok = true；同一題沒有重複地點；開車日（11/21、11/24、11/28、12/01）
-- 只出現路上休息點或晚餐；同一天的時間不重疊；不在路線上的 day 是空的
-- select t.name, r.status_code, r.content::jsonb->>'ok' as ok,
--   jsonb_path_query_array(r.content::jsonb, '$.places[*].place') as places,
--   jsonb_path_query_array(r.content::jsonb, '$.places[*].day') as days,
--   jsonb_path_query_array(r.content::jsonb, '$.places[*].time') as times
-- from _t t join net._http_response r on r.id = t.req;

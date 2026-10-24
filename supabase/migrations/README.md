# 之後加的資料庫改動

`setup.sql` 是第一版。之後直接在 Supabase 上套用的改動：

1. `add_stay_duration`：items 加 `stay`（預計停留多久），trip_save 支援它
2. `add_geo_columns`：items 加 `lat`、`lng`、`geo_q`、`geo_fail`（交通時間用的位置快取）
3. `add_questions`：新增 `questions`、`answers` 兩張表，trip_list 會一起回傳問題；新增 trip_ask、trip_reply、trip_qa_delete

Edge Functions（在 `supabase/functions/`）：
- `analyze`：AI 判斷 Reels 地點、建議日期時段和停留時間
- `legs`：用 OpenStreetMap 算景點之間的開車時間
- `ask`：問題討論區的 AI 小幫手

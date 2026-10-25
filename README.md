# 美西公路旅行書

Ray 和 Irene 2026/11/20–12/05 美西自駕的共編行程。手機打開、輸入旅行密碼就能一起排行程、貼 Reels 連結、上傳照片。

**網站：https://ray123456739.github.io/us-trip-2026/**

**行李清單：https://ray123456739.github.io/us-trip-2026/packing.html**（同一個旅行密碼；資料表設定見 `supabase/packing.sql`）

- 網站：GitHub Pages（這個 repo 的 `main` 分支根目錄）
- 資料和照片：Supabase（設定見 `supabase/setup.sql`）
- 連線設定：`config.js`（只放 Project URL 和 publishable key，不能放 secret key）

## 換旅行密碼

在 Supabase 的 SQL Editor 執行：

```sql
update trip_secret set pass_hash = crypt('新密碼', gen_salt('bf')) where id = 1;
```

換完之後，兩支手機都會被要求重新輸入密碼。

-- 美西公路旅行書：Supabase 一次性設定
-- 用法：先把最下面「設定旅行密碼」那行的 '改成你們的密碼' 換掉，再整份貼到 SQL Editor 按 Run。

create extension if not exists pgcrypto with schema extensions;

-- 資料表 ---------------------------------------------------------------
create table if not exists public.trip_secret (
  id int primary key default 1 check (id = 1),
  pass_hash text not null
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  url text not null default '',
  note text not null default '',
  day text not null default '',          -- 'YYYY-MM-DD'，空字串 = 想去清單
  time text not null default '',
  sort double precision not null default 0,
  photo text not null default '',        -- storage 裡的檔名
  added_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.day_covers (
  day text primary key,
  photo text not null default ''
);

-- 開啟 RLS 且不給任何 policy：網頁不能直接讀寫資料表，只能透過下面檢查密碼的函式
alter table public.trip_secret enable row level security;
alter table public.items enable row level security;
alter table public.day_covers enable row level security;

-- 密碼檢查 -------------------------------------------------------------
create or replace function public._trip_check(p text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from trip_secret where id = 1 and pass_hash = crypt(coalesce(p, ''), pass_hash)) then
    raise exception 'bad_passcode' using errcode = '28P01';
  end if;
end $$;
revoke all on function public._trip_check(text) from public, anon, authenticated;

create or replace function public.trip_login(p text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform pg_sleep(0.4);  -- 放慢猜密碼的速度
  return exists (select 1 from trip_secret where id = 1 and pass_hash = crypt(coalesce(p, ''), pass_hash));
end $$;

-- 讀取全部 -------------------------------------------------------------
create or replace function public.trip_list(p text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _trip_check(p);
  return json_build_object(
    'items', coalesce((select json_agg(i order by i.sort) from items i), '[]'::json),
    'covers', coalesce((select json_agg(c) from day_covers c), '[]'::json)
  );
end $$;

-- 新增或修改一項 -------------------------------------------------------
create or replace function public.trip_save(p text, it jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r items;
begin
  perform _trip_check(p);
  if (it ? 'id') and (it->>'id') is not null and (it->>'id') <> '' then
    update items set
      title    = coalesce(it->>'title', title),
      url      = coalesce(it->>'url', url),
      note     = coalesce(it->>'note', note),
      day      = coalesce(it->>'day', day),
      time     = coalesce(it->>'time', time),
      sort     = coalesce((it->>'sort')::double precision, sort),
      photo    = coalesce(it->>'photo', photo),
      updated_at = now()
    where id = (it->>'id')::uuid
    returning * into r;
  else
    insert into items (title, url, note, day, time, sort, photo, added_by)
    values (left(coalesce(it->>'title',''),200), left(coalesce(it->>'url',''),1000), left(coalesce(it->>'note',''),2000),
            coalesce(it->>'day',''), left(coalesce(it->>'time',''),40),
            coalesce((it->>'sort')::double precision, extract(epoch from now())*1000),
            coalesce(it->>'photo',''), left(coalesce(it->>'added_by',''),40))
    returning * into r;
  end if;
  return row_to_json(r);
end $$;

create or replace function public.trip_delete(p text, item_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _trip_check(p);
  delete from items where id = item_id;
end $$;

create or replace function public.trip_set_cover(p text, d text, ph text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _trip_check(p);
  insert into day_covers(day, photo) values (d, coalesce(ph,''))
  on conflict (day) do update set photo = excluded.photo;
end $$;

grant execute on function public.trip_login(text), public.trip_list(text), public.trip_save(text, jsonb),
  public.trip_delete(text, uuid), public.trip_set_cover(text, text, text) to anon, authenticated;

-- 照片空間 -------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "trip photos upload" on storage.objects;
create policy "trip photos upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos');

-- 目前的行程 -----------------------------------------------------------
-- 只在資料表還是空的時候放進去，重跑這份設定不會重複
insert into items (title, note, day, time, sort, added_by)
select * from (values
 ('抵達 SFO（BR008）','紅眼班機落地，這天行程待排','2026-11-20','06:40',1001,'Ray'),
 ('從舊金山出發開往 LA','','2026-11-21','07:00',1002,'Ray'),
 ('途中午餐、休息','','2026-11-21','',1003,'Ray'),
 ('晚上輕鬆吃飯','','2026-11-21','晚上',1004,'Ray'),
 ('Beverly Hills','','2026-11-22','',1005,'Ray'),
 ('Rodeo Drive','','2026-11-22','',1006,'Ray'),
 ('West Hollywood','','2026-11-22','',1007,'Ray'),
 ('Griffith Observatory','','2026-11-22','傍晚',1008,'Ray'),
 ('Santa Monica','','2026-11-23','',1009,'Ray'),
 ('Venice Beach','','2026-11-23','',1010,'Ray'),
 ('購物或休息','','2026-11-23','下午',1011,'Ray'),
 ('從 LA 出發開往 Vegas','','2026-11-24','8–9 AM',1012,'Ray'),
 ('入住後逛 Strip','','2026-11-24','晚上',1013,'Ray'),
 ('Bellagio 溫室花園','','2026-11-25','',1014,'Ray'),
 ('Caesars Palace','','2026-11-25','',1015,'Ray'),
 ('Forum Shops','','2026-11-25','',1016,'Ray'),
 ('Sphere','','2026-11-25','晚上',1017,'Ray'),
 ('Thanksgiving Dinner','不要排太滿，吃一頓好的','2026-11-26','',1018,'Ray'),
 ('Bellagio 水舞','','2026-11-26','晚上',1019,'Ray'),
 ('逛 Outlet','跟 Red Rock Canyon 二選一','2026-11-27','',1020,'Ray'),
 ('Red Rock Canyon','跟 Outlet 二選一','2026-11-27','',1021,'Ray'),
 ('離開 Vegas 開往 Anaheim','','2026-11-28','07:00',1022,'Ray'),
 ('入住','','2026-11-28','下午',1023,'Ray'),
 ('Downtown Disney','','2026-11-28','晚上',1024,'Ray'),
 ('Disney California Adventure (DCA)','','2026-11-29','',1025,'Ray'),
 ('Disneyland Park 主園區','這一天是整趟 Disney 的重點','2026-11-30','',1026,'Ray'),
 ('從 Anaheim 出發開回 SF','這天主要就是回程','2026-12-01','08:00',1027,'Ray'),
 ('搭機回台灣（BR007 SFO → TPE）','','2026-12-05','12:00',1028,'Ray')
) as v(title, note, day, time, sort, added_by)
where not exists (select 1 from items);

-- 設定旅行密碼（把 改成你們的密碼 換掉，至少 6 個字）---------------------
insert into trip_secret (id, pass_hash) values (1, crypt('改成你們的密碼', gen_salt('bf')))
on conflict (id) do update set pass_hash = excluded.pass_hash;

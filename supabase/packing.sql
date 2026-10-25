-- 行李清單：在 Supabase SQL Editor 整份貼上按 Run 一次就好（只新增，不會動到行程資料）
-- 沿用旅遊書的旅行密碼（_trip_check），所以要先跑過 setup.sql

create table if not exists public.packing (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  cat text not null default 'other',
  who text not null default '共用',
  qty int not null default 1,
  note text not null default '',
  buy boolean not null default false,     -- 出發前要買
  packed boolean not null default false,  -- 出發前已打包
  back boolean not null default false,    -- 回程已收回
  photo text not null default '',
  sort double precision not null default 0,
  added_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.packing enable row level security;

create or replace function public.pack_list(p text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _trip_check(p);
  return coalesce((select json_agg(x order by x.sort) from packing x), '[]'::json);
end $$;

create or replace function public.pack_save(p text, it jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r packing;
begin
  perform _trip_check(p);
  if (it ? 'id') and coalesce(it->>'id','') <> '' then
    update packing set
      title  = coalesce(left(it->>'title',200), title),
      cat    = coalesce(left(it->>'cat',20), cat),
      who    = coalesce(left(it->>'who',20), who),
      qty    = coalesce(greatest(1, least(99, (it->>'qty')::int)), qty),
      note   = coalesce(left(it->>'note',1000), note),
      buy    = coalesce((it->>'buy')::boolean, buy),
      packed = coalesce((it->>'packed')::boolean, packed),
      back   = coalesce((it->>'back')::boolean, back),
      photo  = coalesce(it->>'photo', photo),
      sort   = coalesce((it->>'sort')::double precision, sort),
      updated_at = now()
    where id = (it->>'id')::uuid returning * into r;
  else
    insert into packing (title, cat, who, qty, note, buy, photo, sort, added_by)
    values (left(coalesce(it->>'title',''),200), left(coalesce(it->>'cat','other'),20), left(coalesce(it->>'who','共用'),20),
            greatest(1, least(99, coalesce((it->>'qty')::int,1))), left(coalesce(it->>'note',''),1000),
            coalesce((it->>'buy')::boolean,false), coalesce(it->>'photo',''),
            coalesce((it->>'sort')::double precision, extract(epoch from now())*1000), left(coalesce(it->>'added_by',''),40))
    returning * into r;
  end if;
  return row_to_json(r);
end $$;

create or replace function public.pack_delete(p text, item_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _trip_check(p);
  delete from packing where id = item_id;
end $$;

-- 一次取消全部勾選（mode：'packed' 出發前、'back' 回程）
create or replace function public.pack_reset(p text, mode text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _trip_check(p);
  if mode = 'packed' then update packing set packed = false, updated_at = now() where packed;
  elsif mode = 'back' then update packing set back = false, updated_at = now() where back;
  end if;
end $$;

revoke all on function public.pack_list(text), public.pack_save(text, jsonb), public.pack_delete(text, uuid), public.pack_reset(text, text) from public;
grant execute on function public.pack_list(text), public.pack_save(text, jsonb), public.pack_delete(text, uuid), public.pack_reset(text, text) to anon, authenticated;

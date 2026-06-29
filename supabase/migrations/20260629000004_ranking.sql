-- visited_cities 테이블 (Phase 3 시/도 스탬프용, 아직 비어있어도 됨)
create table if not exists public.visited_cities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles on delete cascade not null,
  city_name text not null,
  photo_url text,
  visited_at timestamptz default now(),
  unique(user_id, city_name)
);
alter table public.visited_cities enable row level security;
drop policy if exists "users can manage own visited_cities" on public.visited_cities;
create policy "users can manage own visited_cities"
  on public.visited_cities for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
grant select, insert, update, delete on public.visited_cities to authenticated;

-- friendships 테이블은 초기 스키마에서 user_id/friend_id 로 이미 생성됨
grant select, insert, update, delete on public.friendships to authenticated;

-- 전체 랭킹
create or replace function get_global_ranking(p_category text, p_limit int default 30)
returns table(rank bigint, user_id uuid, username text, avatar_url text, value float8)
language sql security definer as $$
  with base as (
    select
      p.id,
      p.username,
      p.avatar_url,
      case p_category
        when 'total_distance'   then coalesce(sum(d.distance_km), 0)
        when 'monthly_distance' then coalesce(sum(d.distance_km) filter (where d.started_at >= date_trunc('month', now())), 0)
        when 'total_drives'     then count(d.id)::float8
        when 'longest_drive'    then coalesce(max(d.distance_km), 0)
        when 'avg_distance'     then coalesce(avg(d.distance_km), 0)
        when 'visited_cities'   then (select count(*) from visited_cities vc where vc.user_id = p.id)::float8
        else coalesce(sum(d.distance_km), 0)
      end as value
    from profiles p
    left join drives d on d.user_id = p.id and d.ended_at is not null
    group by p.id, p.username, p.avatar_url
  )
  select
    row_number() over (order by value desc) as rank,
    id as user_id, username, avatar_url, value
  from base
  where value > 0
  order by value desc
  limit p_limit;
$$;

-- 친구 랭킹 (본인 포함)
create or replace function get_friend_ranking(p_user_id uuid, p_category text)
returns table(rank bigint, user_id uuid, username text, avatar_url text, value float8, is_me bool)
language sql security definer as $$
  with circle as (
    select friend_id as uid from friendships where user_id = p_user_id
    union
    select user_id as uid from friendships where friend_id = p_user_id
    union select p_user_id
  ),
  base as (
    select
      p.id,
      p.username,
      p.avatar_url,
      case p_category
        when 'total_distance'   then coalesce(sum(d.distance_km), 0)
        when 'monthly_distance' then coalesce(sum(d.distance_km) filter (where d.started_at >= date_trunc('month', now())), 0)
        when 'total_drives'     then count(d.id)::float8
        when 'longest_drive'    then coalesce(max(d.distance_km), 0)
        when 'avg_distance'     then coalesce(avg(d.distance_km), 0)
        when 'visited_cities'   then (select count(*) from visited_cities vc where vc.user_id = p.id)::float8
        else coalesce(sum(d.distance_km), 0)
      end as value
    from profiles p
    join circle c on c.uid = p.id
    left join drives d on d.user_id = p.id and d.ended_at is not null
    group by p.id, p.username, p.avatar_url
  )
  select
    row_number() over (order by value desc) as rank,
    id as user_id, username, avatar_url, value,
    (id = p_user_id) as is_me
  from base
  order by value desc;
$$;

-- 닉네임으로 유저 검색
create or replace function search_users(p_query text)
returns table(user_id uuid, username text, avatar_url text)
language sql security definer as $$
  select id as user_id, username, avatar_url
  from profiles
  where username ilike '%' || p_query || '%'
    and id != auth.uid()
  limit 20;
$$;

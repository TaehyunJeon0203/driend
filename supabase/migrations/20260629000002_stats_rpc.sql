-- drives 테이블에 누락된 컬럼 추가
alter table public.drives
  add column if not exists distance_km float8,
  add column if not exists max_speed_kmh float8;

-- 사용자 전체 통계
create or replace function get_my_stats(p_user_id uuid)
returns table(
  total_distance_km float8,
  total_drives bigint,
  visited_cities_count bigint
)
language sql
security definer
as $$
  select
    coalesce(sum(d.distance_km), 0) as total_distance_km,
    count(d.id)                      as total_drives,
    (select count(*) from visited_cities vc where vc.user_id = p_user_id) as visited_cities_count
  from drives d
  where d.user_id = p_user_id;
$$;

-- 월별 주행 거리 (최근 12개월)
create or replace function get_monthly_distances(p_user_id uuid)
returns table(month text, distance_km float8)
language sql
security definer
as $$
  select
    to_char(date_trunc('month', started_at), 'YYYY-MM') as month,
    coalesce(sum(distance_km), 0) as distance_km
  from drives
  where user_id = p_user_id
    and started_at >= now() - interval '12 months'
  group by date_trunc('month', started_at)
  order by date_trunc('month', started_at);
$$;

-- 최근 주행 목록
create or replace function get_recent_drives(p_user_id uuid, p_limit int default 20)
returns table(
  id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  distance_km float8
)
language sql
security definer
as $$
  select id, started_at, ended_at, distance_km
  from drives
  where user_id = p_user_id
    and ended_at is not null
  order by started_at desc
  limit p_limit;
$$;

-- vehicles 테이블 GRANT
grant select, insert, update, delete on public.vehicles to authenticated;

-- get_my_stats에 최고 속도 추가
create or replace function get_my_stats(p_user_id uuid)
returns table(
  total_distance_km float8,
  total_drives bigint,
  visited_cities_count bigint,
  max_speed_kmh float8
)
language sql security definer as $$
  select
    coalesce(sum(d.distance_km), 0) as total_distance_km,
    count(d.id)                      as total_drives,
    (select count(*) from visited_cities vc where vc.user_id = p_user_id) as visited_cities_count,
    coalesce(max(d.max_speed_kmh), 0) as max_speed_kmh
  from drives d
  where d.user_id = p_user_id;
$$;

-- get_recent_drives에 최고 속도 추가
create or replace function get_recent_drives(p_user_id uuid, p_limit int default 20)
returns table(
  id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  distance_km float8,
  max_speed_kmh float8
)
language sql security definer as $$
  select id, started_at, ended_at, distance_km, max_speed_kmh
  from drives
  where user_id = p_user_id
    and ended_at is not null
  order by started_at desc
  limit p_limit;
$$;

drop function if exists get_recent_drives(uuid, int);

create or replace function get_recent_drives(p_user_id uuid, p_limit int default 20)
returns table(
  id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  distance_km float8,
  max_speed_kmh float8,
  start_address text,
  end_address text,
  zero_to_hundred_s float8
)
language sql security definer as $$
  select id, started_at, ended_at, distance_km, max_speed_kmh,
         start_address, end_address, zero_to_hundred_s
  from drives
  where user_id = p_user_id
    and ended_at is not null
  order by started_at desc
  limit p_limit;
$$;

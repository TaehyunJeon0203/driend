-- Passing NULL for p_limit returns all completed drives while preserving
-- the existing bounded RPC contract for other callers.
create or replace function public.get_recent_drives(p_user_id uuid, p_limit int default null)
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
language sql security definer
set search_path = public
as $$
  select id, started_at, ended_at, distance_km, max_speed_kmh,
         start_address, end_address, zero_to_hundred_s
  from public.drives
  where user_id = p_user_id
    and ended_at is not null
  order by started_at desc
  limit p_limit;
$$;

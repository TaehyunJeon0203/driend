create or replace function public.get_public_user_stats(p_user_id uuid)
returns table(
  total_distance_km float8,
  total_drives bigint,
  visited_cities_count bigint,
  monthly_distance_km float8,
  longest_drive_km float8,
  avg_distance_km float8,
  max_speed_kmh float8
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(d.distance_km), 0)::float8,
    count(d.id),
    (select count(*) from public.visited_cities vc where vc.user_id = p_user_id),
    coalesce(sum(d.distance_km) filter (where d.started_at >= date_trunc('month', now())), 0)::float8,
    coalesce(max(d.distance_km), 0)::float8,
    coalesce(avg(d.distance_km), 0)::float8,
    coalesce(max(d.max_speed_kmh), 0)::float8
  from public.drives d
  where d.user_id = p_user_id
    and d.ended_at is not null;
$$;

grant execute on function public.get_public_user_stats(uuid) to authenticated;

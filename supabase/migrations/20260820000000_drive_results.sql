create or replace function public.get_drive_result(p_drive_id uuid)
returns table(
  id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  distance_km float8,
  max_speed_kmh float8,
  start_address text,
  end_address text,
  route_points jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    d.id,
    d.started_at,
    d.ended_at,
    coalesce(d.distance_km, 0)::float8,
    coalesce(d.max_speed_kmh, 0)::float8,
    d.start_address,
    d.end_address,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lat', st_y(rp.location::geometry),
          'lng', st_x(rp.location::geometry),
          'speed_kmh', rp.speed_kmh,
          'recorded_at', rp.recorded_at
        ) order by rp.recorded_at
      )
      from public.route_points rp
      where rp.drive_id = d.id
    ), '[]'::jsonb)
  from public.drives d
  where d.id = p_drive_id
    and d.user_id = auth.uid();
$$;

grant execute on function public.get_drive_result(uuid) to authenticated;

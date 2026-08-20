-- Preserve raw timestamps for drives whose matched geometry would bridge a recording gap.
-- The RPC shape remains (drive_id, coordinates); raw coordinate tuples add recorded_at as
-- an optional third value, so consumers that only read longitude/latitude remain compatible.
create or replace function get_user_route_lines(p_user_id uuid)
returns table(drive_id uuid, coordinates jsonb)
language sql security definer as $$
  with ordered_points as (
    select
      rp.drive_id,
      rp.location,
      rp.recorded_at,
      lag(rp.location) over point_window as previous_location,
      lag(rp.recorded_at) over point_window as previous_recorded_at
    from route_points rp
    join drives d on d.id = rp.drive_id
    where d.user_id = p_user_id
    window point_window as (partition by rp.drive_id order by rp.recorded_at, rp.id)
  ),
  gap_drives as (
    select distinct op.drive_id
    from ordered_points op
    where op.previous_recorded_at is not null
      and (
        op.recorded_at <= op.previous_recorded_at
        or op.recorded_at - op.previous_recorded_at > interval '30 seconds'
        or st_distance(op.location, op.previous_location)
          / nullif(extract(epoch from op.recorded_at - op.previous_recorded_at), 0) > 220.0 / 3.6
      )
  )
  select d.id as drive_id,
    case
      when d.matched_geometry is not null and gd.drive_id is null then d.matched_geometry
      else raw.coordinates
    end as coordinates
  from drives d
  left join gap_drives gd on gd.drive_id = d.id
  cross join lateral (
    select jsonb_agg(
      jsonb_build_array(
        st_x(rp.location::geometry),
        st_y(rp.location::geometry),
        rp.recorded_at
      )
      order by rp.recorded_at, rp.id
    ) as coordinates
    from route_points rp
    where rp.drive_id = d.id
  ) raw
  where d.user_id = p_user_id
    and d.ended_at is not null
    and (
      (d.matched_geometry is not null and gd.drive_id is null and jsonb_array_length(d.matched_geometry) >= 2)
      or jsonb_array_length(raw.coordinates) >= 2
    );
$$;

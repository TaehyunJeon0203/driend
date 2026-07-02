-- 드라이브별 경로 좌표를 라인으로 묶어서 반환 (지도 도로 색 표시용)
create or replace function get_user_route_lines(p_user_id uuid)
returns table(drive_id uuid, coordinates jsonb)
language sql security definer as $$
  select
    rp.drive_id,
    jsonb_agg(
      jsonb_build_array(
        st_x(rp.location::geometry),
        st_y(rp.location::geometry)
      )
      order by rp.recorded_at
    ) as coordinates
  from route_points rp
  join drives d on d.id = rp.drive_id
  where d.user_id = p_user_id
  group by rp.drive_id
  having count(*) >= 2;
$$;

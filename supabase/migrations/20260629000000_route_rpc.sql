-- 사용자 경로 포인트를 lng/lat으로 반환하는 RPC
create or replace function get_user_route_points(p_user_id uuid)
returns table(lng float8, lat float8)
language sql
security definer
as $$
  select
    st_x(rp.location::geometry) as lng,
    st_y(rp.location::geometry) as lat
  from route_points rp
  join drives d on d.id = rp.drive_id
  where d.user_id = p_user_id
  limit 50000;
$$;

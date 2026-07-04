-- drives 테이블에 맵 매칭 결과 저장 컬럼 추가
alter table drives add column if not exists matched_geometry jsonb;

-- 드라이브 좌표 조회 헬퍼 (맵 매칭용)
create or replace function get_drive_coords(p_drive_id uuid)
returns table(lng float8, lat float8)
language sql security definer as $$
  select
    st_x(location::geometry) as lng,
    st_y(location::geometry) as lat
  from route_points
  where drive_id = p_drive_id
  order by recorded_at;
$$;

-- get_user_route_lines: matched_geometry 있으면 우선 반환, 없으면 raw GPS
create or replace function get_user_route_lines(p_user_id uuid)
returns table(drive_id uuid, coordinates jsonb)
language sql security definer as $$
  select drive_id, coordinates
  from (
    select
      d.id as drive_id,
      case
        when d.matched_geometry is not null then d.matched_geometry
        else (
          select jsonb_agg(
            jsonb_build_array(
              st_x(rp.location::geometry),
              st_y(rp.location::geometry)
            )
            order by rp.recorded_at
          )
          from route_points rp
          where rp.drive_id = d.id
        )
      end as coordinates
    from drives d
    where d.user_id = p_user_id
      and d.ended_at is not null
  ) sub
  where coordinates is not null
    and jsonb_array_length(coordinates) >= 2;
$$;

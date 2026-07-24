-- GPS 신호 유실(지하주차장 등)로 정차/자동종료 감지가 아예 실행되지 못해
-- ended_at이 null로 남는 주행을 정리. 기존 클라이언트 로직(cleanupOrphanedDrives)은
-- distance_km을 무조건 0으로 밀어버려 실제 주행거리를 날렸음 — route_points에 남은
-- 기록으로 실제 거리/최고속도를 복원하고, 종료 시각도 마지막 기록 시점으로 맞춘다.
create or replace function close_orphaned_drives(p_user_id uuid)
returns void
language sql
security definer
as $$
  update drives d
  set
    ended_at = coalesce(
      (select max(rp.recorded_at) from route_points rp where rp.drive_id = d.id),
      d.started_at
    ),
    distance_km = coalesce(
      (
        select ST_Length(ST_MakeLine(array_agg(rp.location::geometry order by rp.recorded_at))::geography) / 1000.0
        from route_points rp
        where rp.drive_id = d.id
        having count(*) >= 2
      ),
      0
    ),
    max_speed_kmh = coalesce(
      (select max(rp.speed_kmh) from route_points rp where rp.drive_id = d.id),
      d.max_speed_kmh
    )
  where d.user_id = p_user_id and d.ended_at is null;
$$;

grant execute on function close_orphaned_drives(uuid) to authenticated;

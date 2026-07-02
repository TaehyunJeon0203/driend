-- vehicles 테이블: Android 블루투스 자동 감지용 기기명 컬럼 추가
alter table public.vehicles
  add column if not exists bt_device_name text;

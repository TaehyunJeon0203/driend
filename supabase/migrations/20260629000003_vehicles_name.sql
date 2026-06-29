-- vehicles 테이블: name 컬럼 추가, 기존 필수 컬럼 옵셔널로 변경
alter table public.vehicles
  add column if not exists name text,
  alter column make drop not null,
  alter column model drop not null,
  alter column year drop not null;

-- 기존 행에 name 백필
update public.vehicles set name = make || ' ' || model where name is null;

-- RLS 정책 추가
create policy "users can manage own vehicles"
  on public.vehicles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

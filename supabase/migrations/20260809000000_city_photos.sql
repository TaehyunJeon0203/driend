-- 방문 도시별 여러 장의 사진 등록 지원 (기존 visited_cities.photo_url은
-- 지도 오버레이용 대표사진 클리핑 이미지로 계속 사용, 이 테이블은 풀스크린 갤러리용)
create table public.city_photos (
  id uuid primary key default gen_random_uuid(),
  visited_city_id uuid not null references public.visited_cities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  url text not null,
  is_cover boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index city_photos_visited_city_id_idx on public.city_photos(visited_city_id);

alter table public.city_photos enable row level security;
create policy "city_photos_own" on public.city_photos using (auth.uid() = user_id);

grant select, insert, update, delete on public.city_photos to authenticated;

-- 도시당 대표사진(is_cover=true)은 하나만 존재해야 함
create unique index city_photos_one_cover_per_city
  on public.city_photos(visited_city_id)
  where is_cover;

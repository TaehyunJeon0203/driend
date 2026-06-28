-- Enable PostGIS for geo queries
create extension if not exists postgis;

-- Users profile (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  created_at timestamptz default now()
);

-- Vehicles
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles on delete cascade not null,
  make text not null,
  model text not null,
  year integer not null,
  color text,
  created_at timestamptz default now()
);

-- Drives (주행 기록 헤더)
create table public.drives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles on delete cascade not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  distance_meters integer not null default 0,
  max_speed_kmh numeric(5,1) not null default 0,
  duration_seconds integer not null default 0,
  created_at timestamptz default now()
);

-- Route points (GPS 좌표 시계열)
create table public.route_points (
  id uuid primary key default gen_random_uuid(),
  drive_id uuid references public.drives on delete cascade not null,
  location geography(Point, 4326) not null,
  speed_kmh numeric(5,1) not null default 0,
  recorded_at timestamptz not null
);

create index route_points_drive_id_idx on public.route_points (drive_id);
create index route_points_location_idx on public.route_points using gist (location);

-- Visited cities (도장깨기)
create table public.visited_cities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles on delete cascade not null,
  city_code text not null,
  city_name text not null,
  first_visited_at timestamptz not null,
  photo_url text,
  unique (user_id, city_code)
);

-- Friendships
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles on delete cascade not null,
  friend_id uuid references public.profiles on delete cascade not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz default now(),
  unique (user_id, friend_id)
);

-- RLS 활성화
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.drives enable row level security;
alter table public.route_points enable row level security;
alter table public.visited_cities enable row level security;
alter table public.friendships enable row level security;

-- Profiles: 본인 및 친구만 조회 가능, 본인만 수정
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);

-- Drives: 본인만 CRUD
create policy "drives_all" on public.drives using (auth.uid() = user_id);

-- Route points: 주행 소유자만
create policy "route_points_all" on public.route_points
  using (exists (select 1 from public.drives where id = drive_id and user_id = auth.uid()));

-- Visited cities: 본인만 write, 친구는 read
create policy "visited_cities_own" on public.visited_cities using (auth.uid() = user_id);

-- Friendships: 관계된 유저만
create policy "friendships_all" on public.friendships
  using (auth.uid() = user_id or auth.uid() = friend_id);

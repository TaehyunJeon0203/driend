create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

alter table trips enable row level security;
create policy "Users can manage own trips" on trips
  for all using (auth.uid() = user_id);

grant select, insert, update, delete on public.trips to authenticated;

alter table drives add column if not exists trip_id uuid references trips(id) on delete set null;

create or replace function get_my_trips(p_user_id uuid)
returns table(
  id uuid, name text, started_at timestamptz, ended_at timestamptz,
  total_distance_km float8, total_drives bigint
)
language sql security definer as $$
  select
    t.id, t.name, t.started_at, t.ended_at,
    coalesce(sum(d.distance_km), 0) as total_distance_km,
    count(d.id) as total_drives
  from trips t
  left join drives d on d.trip_id = t.id and d.ended_at is not null
  where t.user_id = p_user_id
  group by t.id, t.name, t.started_at, t.ended_at
  order by t.started_at desc;
$$;

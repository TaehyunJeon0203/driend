alter table public.drives
  add column if not exists result_image_path text;

insert into storage.buckets (id, name, public)
values ('drive-result-cards', 'drive-result-cards', true)
on conflict (id) do nothing;

drop policy if exists "auth_upload_drive_result_cards" on storage.objects;
create policy "auth_upload_drive_result_cards"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'drive-result-cards'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "public_read_drive_result_cards" on storage.objects;
create policy "public_read_drive_result_cards"
  on storage.objects for select
  using (bucket_id = 'drive-result-cards');

drop policy if exists "auth_update_drive_result_cards" on storage.objects;
create policy "auth_update_drive_result_cards"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'drive-result-cards'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "auth_delete_drive_result_cards" on storage.objects;
create policy "auth_delete_drive_result_cards"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'drive-result-cards'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop function if exists public.get_drive_result(uuid);
create function public.get_drive_result(p_drive_id uuid)
returns table(
  id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  distance_km float8,
  max_speed_kmh float8,
  start_address text,
  end_address text,
  result_image_path text,
  route_points jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    d.id,
    d.started_at,
    d.ended_at,
    coalesce(d.distance_km, 0)::float8,
    coalesce(d.max_speed_kmh, 0)::float8,
    d.start_address,
    d.end_address,
    d.result_image_path,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lat', st_y(rp.location::geometry),
          'lng', st_x(rp.location::geometry),
          'speed_kmh', rp.speed_kmh,
          'recorded_at', rp.recorded_at
        ) order by rp.recorded_at
      )
      from public.route_points rp
      where rp.drive_id = d.id
    ), '[]'::jsonb)
  from public.drives d
  where d.id = p_drive_id
    and d.user_id = auth.uid();
$$;

grant execute on function public.get_drive_result(uuid) to authenticated;

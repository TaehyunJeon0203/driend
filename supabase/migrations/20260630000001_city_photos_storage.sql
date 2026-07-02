-- city-photos Storage bucket
insert into storage.buckets (id, name, public)
values ('city-photos', 'city-photos', true)
on conflict (id) do nothing;

drop policy if exists "auth_upload_city_photos" on storage.objects;
create policy "auth_upload_city_photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'city-photos');

drop policy if exists "public_read_city_photos" on storage.objects;
create policy "public_read_city_photos"
  on storage.objects for select
  using (bucket_id = 'city-photos');

drop policy if exists "auth_update_city_photos" on storage.objects;
create policy "auth_update_city_photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'city-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "auth_delete_city_photos" on storage.objects;
create policy "auth_delete_city_photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'city-photos' and auth.uid()::text = (storage.foldername(name))[1]);

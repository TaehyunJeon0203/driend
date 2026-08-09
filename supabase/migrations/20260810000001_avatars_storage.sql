-- avatars Storage bucket (프로필 사진)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "auth_upload_avatars" on storage.objects;
create policy "auth_upload_avatars"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "public_read_avatars" on storage.objects;
create policy "public_read_avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "auth_update_avatars" on storage.objects;
create policy "auth_update_avatars"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "auth_delete_avatars" on storage.objects;
create policy "auth_delete_avatars"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

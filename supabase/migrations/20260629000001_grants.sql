-- authenticated 롤에 테이블 권한 부여
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.drives to authenticated;
grant select, insert, update, delete on public.route_points to authenticated;
grant select, insert, update, delete on public.visited_cities to authenticated;
grant select, insert, update, delete on public.friendships to authenticated;

-- anon 롤 (읽기 전용)
grant select on public.profiles to anon;

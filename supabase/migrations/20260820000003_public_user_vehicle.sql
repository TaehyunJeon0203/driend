create or replace function public.get_public_user_vehicle(p_user_id uuid)
returns table(make text, name text)
language sql
security definer
set search_path = public
as $$
  select v.make, v.name
  from public.vehicles v
  where v.user_id = p_user_id
  limit 1;
$$;

grant execute on function public.get_public_user_vehicle(uuid) to authenticated;

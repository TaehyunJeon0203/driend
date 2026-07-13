create or replace function save_best_zero_to_hundred(p_user_id uuid, p_seconds float)
returns void language sql security definer as $$
  update profiles
  set best_zero_to_hundred_s = p_seconds
  where id = p_user_id
    and (best_zero_to_hundred_s is null or best_zero_to_hundred_s > p_seconds);
$$;

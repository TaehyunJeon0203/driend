drop function if exists get_global_ranking(text, int);
create function get_global_ranking(p_category text, p_limit int default 30)
returns table(rank bigint, user_id uuid, username text, avatar_url text, value float8)
language sql security definer as $$
  with base as (
    select
      p.id,
      p.username,
      p.avatar_url,
      case p_category
        when 'total_distance'   then coalesce(sum(d.distance_km), 0)
        when 'monthly_distance' then coalesce(sum(d.distance_km) filter (where d.started_at >= date_trunc('month', now())), 0)
        when 'total_drives'     then count(d.id)::float8
        when 'longest_drive'    then coalesce(max(d.distance_km), 0)
        when 'avg_distance'     then coalesce(avg(d.distance_km), 0)
        when 'visited_cities'   then (select count(*) from visited_cities vc where vc.user_id = p.id)::float8
        when 'max_speed'        then coalesce(max(d.max_speed_kmh), 0)
        when 'zero_to_hundred'  then p.best_zero_to_hundred_s
        else coalesce(sum(d.distance_km), 0)
      end as value
    from profiles p
    left join drives d on d.user_id = p.id and d.ended_at is not null
    group by p.id, p.username, p.avatar_url, p.best_zero_to_hundred_s
  )
  select
    row_number() over (
      order by
        case when p_category = 'zero_to_hundred' then value end asc nulls last,
        case when p_category != 'zero_to_hundred' then value end desc nulls last
    ) as rank,
    id as user_id, username, avatar_url, value
  from base
  where value is not null and value > 0
  order by
    case when p_category = 'zero_to_hundred' then value end asc nulls last,
    case when p_category != 'zero_to_hundred' then value end desc nulls last
  limit p_limit;
$$;

drop function if exists get_friend_ranking(uuid, text);
create function get_friend_ranking(p_user_id uuid, p_category text)
returns table(rank bigint, user_id uuid, username text, avatar_url text, value float8, is_me bool)
language sql security definer as $$
  with circle as (
    select friend_id as uid from friendships where user_id = p_user_id
    union
    select user_id as uid from friendships where friend_id = p_user_id
    union select p_user_id
  ),
  base as (
    select
      p.id,
      p.username,
      p.avatar_url,
      case p_category
        when 'total_distance'   then coalesce(sum(d.distance_km), 0)
        when 'monthly_distance' then coalesce(sum(d.distance_km) filter (where d.started_at >= date_trunc('month', now())), 0)
        when 'total_drives'     then count(d.id)::float8
        when 'longest_drive'    then coalesce(max(d.distance_km), 0)
        when 'avg_distance'     then coalesce(avg(d.distance_km), 0)
        when 'visited_cities'   then (select count(*) from visited_cities vc where vc.user_id = p.id)::float8
        when 'max_speed'        then coalesce(max(d.max_speed_kmh), 0)
        when 'zero_to_hundred'  then p.best_zero_to_hundred_s
        else coalesce(sum(d.distance_km), 0)
      end as value
    from profiles p
    join circle c on c.uid = p.id
    left join drives d on d.user_id = p.id and d.ended_at is not null
    group by p.id, p.username, p.avatar_url, p.best_zero_to_hundred_s
  )
  select
    row_number() over (
      order by
        case when p_category = 'zero_to_hundred' then value end asc nulls last,
        case when p_category != 'zero_to_hundred' then value end desc nulls last
    ) as rank,
    id as user_id, username, avatar_url, value,
    (id = p_user_id) as is_me
  from base
  where value is not null and value > 0
  order by
    case when p_category = 'zero_to_hundred' then value end asc nulls last,
    case when p_category != 'zero_to_hundred' then value end desc nulls last;
$$;

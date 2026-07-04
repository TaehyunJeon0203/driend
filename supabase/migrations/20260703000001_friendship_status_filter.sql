-- get_friend_ranking에 accepted 상태 필터 추가
create or replace function get_friend_ranking(p_user_id uuid, p_category text)
returns table(rank bigint, user_id uuid, username text, avatar_url text, value float8, is_me bool)
language sql security definer as $$
  with circle as (
    select friend_id as uid from friendships where user_id = p_user_id and status = 'accepted'
    union
    select user_id as uid from friendships where friend_id = p_user_id and status = 'accepted'
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
        else coalesce(sum(d.distance_km), 0)
      end as value
    from profiles p
    join circle c on c.uid = p.id
    left join drives d on d.user_id = p.id and d.ended_at is not null
    group by p.id, p.username, p.avatar_url
  )
  select
    row_number() over (order by value desc) as rank,
    id as user_id, username, avatar_url, value,
    (id = p_user_id) as is_me
  from base
  order by value desc;
$$;

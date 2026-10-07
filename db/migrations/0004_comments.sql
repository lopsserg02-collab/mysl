-- Comments: reading needs author names across users, and mentions notify other people,
-- so both go through security definer functions that check the caller's access first.

create or replace function board_comments(b uuid)
returns table (thread_id uuid, item_id text, x double precision, y double precision, resolved boolean, thread_created_by uuid,
               thread_created_at timestamptz, comment_id uuid, author_id uuid, author_name text, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if board_role(b, auth.uid()) is null then raise exception 'no access' using errcode = '42501'; end if;
  return query
    select t.id, t.item_id, t.x, t.y, t.resolved_at is not null, t.created_by, t.created_at,
           c.id, c.author_id, coalesce(p.name, ''), c.body, c.created_at
      from comment_threads t
      join comments c on c.thread_id = t.id
      left join profiles p on p.id = c.author_id
     where t.board_id = b
     order by t.created_at, c.created_at;
end;
$$;

-- The author of a comment notifies the people they mentioned; only people on the board are notified.
create or replace function notify_mentions(comment uuid, mentioned uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  b uuid;
  n int;
begin
  select t.board_id into b from comments c join comment_threads t on t.id = c.thread_id
   where c.id = comment and c.author_id = auth.uid();
  if b is null then raise exception 'no access' using errcode = '42501'; end if;
  insert into notifications (user_id, kind, board_id, comment_id, actor_id)
    select distinct u, 'mention', b, comment, auth.uid()
      from unnest(mentioned) as u
     where u <> auth.uid() and board_role(b, u) is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function board_comments(uuid), notify_mentions(uuid, uuid[]) from public, anon;
grant execute on function board_comments(uuid), notify_mentions(uuid, uuid[]) to authenticated;

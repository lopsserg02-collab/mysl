-- Guest links: people who are not signed in may view a board through its link, read-only.
--
-- A link is the board id plus the board's secret (boards.link_token, 128 random bits from 0001).
-- A board id alone is never enough: joining by link and viewing as a guest both check the secret.
-- Owners and co-owners can make a new secret (an ordinary update through boards_update), which
-- stops every link given out before.
--
-- Guests use Supabase's anon role. They reach nothing through tables (row level security needs
-- auth.uid()), only through the two guest_* functions below, which return the board's id and name
-- and the images on that one board. Board content comes from the realtime server, which checks the
-- secret through the web app before it hands out a read-only token.

alter table boards add column if not exists guest_view boolean not null default false;

-- Opening by link needs the secret. The old forms took the board id alone: drop them, so nobody can
-- call them through the API either.
drop function if exists join_board_via_link(uuid);
drop function if exists join_board_via_link(uuid, text);

create or replace function join_board_via_link(b uuid, secret text, cap text) returns text
language plpgsql security definer set search_path = public as $$
declare
  current text := board_role(b, auth.uid());
  via text;
begin
  if auth.uid() is null then return null; end if;
  if current is not null then return current; end if;
  if cap is not null and cap not in ('commenter', 'viewer') then raise exception 'bad role' using errcode = '22023'; end if;
  if secret is null or length(secret) < 32 then return null; end if;
  select link_role(link_access) into via from boards where id = b and deleted_at is null and link_token = secret;
  if via is null then return null; end if;
  if via = 'editor' and cap is not null then via := cap; end if;
  insert into board_members (board_id, user_id, role) values (b, auth.uid(), via) on conflict do nothing;
  return via;
end;
$$;

-- A guest holding the link: the board's id and name, when the link is on, guest viewing is on and
-- the secret matches. Nothing else about the board (no owner, no people, no emails).
create or replace function guest_board(b uuid, secret text)
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select bo.id, bo.name from boards bo
   where bo.id = b and bo.deleted_at is null and bo.guest_view and bo.link_access <> 'private'
     and secret is not null and length(secret) >= 32 and bo.link_token = secret;
$$;

-- An image for a guest: only one on the board whose secret they hold.
create or replace function guest_asset(a uuid, secret text)
returns table (id uuid, board_id uuid, storage_path text, mime text, bytes int, width int, height int)
language sql stable security definer set search_path = public as $$
  select x.id, x.board_id, x.storage_path, x.mime, x.bytes, x.width, x.height
    from assets x join boards bo on bo.id = x.board_id
   where x.id = a and bo.deleted_at is null and bo.guest_view and bo.link_access <> 'private'
     and secret is not null and length(secret) >= 32 and bo.link_token = secret;
$$;

revoke execute on function join_board_via_link(uuid, text, text), guest_board(uuid, text), guest_asset(uuid, text) from public;
grant execute on function join_board_via_link(uuid, text, text) to authenticated;
grant execute on function guest_board(uuid, text), guest_asset(uuid, text) to anon, authenticated;

-- Sharing: invites by email, link access, and the people list.
-- Profiles are private to their owner, so everything that crosses users goes through these
-- security definer functions, each of which checks the caller's own role first.

create or replace function link_role(access text) returns text language sql immutable as $$
  select case access when 'edit' then 'editor' when 'comment' then 'commenter' when 'view' then 'viewer' end;
$$;

-- Everyone on the board plus pending invites, for anyone who can see the board.
create or replace function board_people(b uuid)
returns table (user_id uuid, name text, email text, role text, pending boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if board_role(b, auth.uid()) is null then raise exception 'no access' using errcode = '42501'; end if;
  return query
    select x.uid, x.nm, x.em, x.rl, x.pend from (
      select p.id as uid, p.name as nm, p.email as em, m.role as rl, false as pend
        from board_members m join profiles p on p.id = m.user_id
       where m.board_id = b
      union all
      select null::uuid, ''::text, i.email, i.role, true
        from board_invites i
       where i.board_id = b and i.accepted_at is null
    ) x
    order by x.pend, array_position(array['owner','coowner','editor','commenter','viewer'], x.rl), x.nm, x.em;
end;
$$;

-- Owner or co-owner adds someone by email. An existing account joins at once; anyone else gets
-- a pending invite that turns into membership when they sign up with that address.
create or replace function share_board(b uuid, invitee text, new_role text) returns text
language plpgsql security definer set search_path = public as $$
declare
  key text := lower(trim(invitee));
  uid uuid;
begin
  if coalesce(board_role(b, auth.uid()), '') not in ('owner', 'coowner') then raise exception 'no access' using errcode = '42501'; end if;
  if new_role not in ('editor', 'commenter', 'viewer') then raise exception 'bad role' using errcode = '22023'; end if;
  select id into uid from profiles where email = key;
  if uid is not null then
    insert into board_members (board_id, user_id, role) values (b, uid, new_role)
      on conflict (board_id, user_id) do update set role = excluded.role
      where board_members.role not in ('owner', 'coowner');
    return 'added';
  end if;
  insert into board_invites (board_id, email, role, invited_by) values (b, key, new_role, auth.uid())
    on conflict (board_id, email) do update set role = excluded.role, accepted_at = null;
  return 'invited';
end;
$$;

-- Change a member's role, or remove them with new_role = null. The owner cannot be changed.
create or replace function set_member_role(b uuid, member uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(board_role(b, auth.uid()), '') not in ('owner', 'coowner') then raise exception 'no access' using errcode = '42501'; end if;
  if new_role is not null and new_role not in ('editor', 'commenter', 'viewer') then raise exception 'bad role' using errcode = '22023'; end if;
  if (select role from board_members where board_id = b and user_id = member) = 'owner' then
    raise exception 'owner cannot be changed' using errcode = '42501';
  end if;
  if new_role is null then
    delete from board_members where board_id = b and user_id = member;
  else
    update board_members set role = new_role where board_id = b and user_id = member;
  end if;
end;
$$;

create or replace function cancel_invite(b uuid, invitee text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(board_role(b, auth.uid()), '') not in ('owner', 'coowner') then raise exception 'no access' using errcode = '42501'; end if;
  delete from board_invites where board_id = b and email = lower(trim(invitee)) and accepted_at is null;
end;
$$;

-- Someone signed in opens a board shared by link: they become a member with the link's role,
-- so the board shows up in their list. Returns their role, or null when the link is off.
create or replace function join_board_via_link(b uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  current text := board_role(b, auth.uid());
  via text;
begin
  if auth.uid() is null then return null; end if;
  if current is not null then return current; end if;
  select link_role(link_access) into via from boards where id = b and deleted_at is null;
  if via is null then return null; end if;
  insert into board_members (board_id, user_id, role) values (b, auth.uid(), via) on conflict do nothing;
  return via;
end;
$$;

-- New accounts pick up the invites waiting for their address.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  team uuid;
  display text := coalesce(nullif(new.raw_user_meta_data->>'name', ''), nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1));
begin
  insert into profiles (id, name, email) values (new.id, display, lower(new.email));
  insert into teams (name, created_by) values (display, new.id) returning id into team;
  insert into team_members (team_id, user_id, role) values (team, new.id, 'owner');
  insert into board_members (board_id, user_id, role)
    select board_id, new.id, role from board_invites where email = lower(new.email) and accepted_at is null
    on conflict do nothing;
  update board_invites set accepted_at = now() where email = lower(new.email) and accepted_at is null;
  return new;
end;
$$;

revoke execute on function board_people(uuid), share_board(uuid, text, text), set_member_role(uuid, uuid, text),
  cancel_invite(uuid, text), join_board_via_link(uuid) from public, anon;

grant execute on function board_people(uuid), share_board(uuid, text, text), set_member_role(uuid, uuid, text),
  cancel_invite(uuid, text), join_board_via_link(uuid), link_role(text) to authenticated;

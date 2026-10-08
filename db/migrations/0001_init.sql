-- Mysl: first migration. Postgres 15+ on Supabase.
-- Board content (items) lives in a Yjs CRDT document per board, stored in board_docs.
-- Relational tables hold everything that needs auth, querying or billing.
-- Access rule: row level security on every table; the realtime server uses the service role
-- and checks membership through can_access_board() before accepting a connection.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- profiles mirror auth.users (Supabase Auth owns credentials)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null,
  avatar_url text,
  input_mode text not null default 'auto' check (input_mode in ('auto','mouse','trackpad')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on profiles (lower(email));

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  plan text not null default 'free' check (plan in ('free','starter','business')),
  stripe_customer_id text unique,
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index on team_members (user_id);

create table boards (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete restrict,
  name text not null default 'Untitled' check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  link_access text not null default 'private' check (link_access in ('private','view','comment','edit')),
  team_access text not null default 'edit' check (team_access in ('private','view','comment','edit')),
  link_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  thumbnail_path text,
  deleted_at timestamptz,                 -- trash; purged after 30 days by a job
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on boards (team_id, updated_at desc) where deleted_at is null;
create index on boards (owner_id);
create index boards_name_trgm on boards using gin (name gin_trgm_ops);

create table board_members (
  board_id uuid not null references boards(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('owner','coowner','editor','commenter','viewer')),
  starred boolean not null default false,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index on board_members (user_id, last_opened_at desc);

create table board_invites (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  email text not null,
  role text not null check (role in ('editor','commenter','viewer')),
  invited_by uuid not null references profiles(id) on delete cascade,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (board_id, email)
);

-- Current CRDT state, written by the realtime server (debounced) and on last disconnect
create table board_docs (
  board_id uuid primary key references boards(id) on delete cascade,
  state bytea not null,                   -- Y.encodeStateAsUpdate
  item_count int not null default 0,
  updated_at timestamptz not null default now()
);

-- Version history: hourly snapshot while a board is being edited
create table board_versions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  state bytea not null,
  created_at timestamptz not null default now()
);
create index on board_versions (board_id, created_at desc);

-- Plain-text mirror of item content for search on board and across boards
create table item_search (
  board_id uuid not null references boards(id) on delete cascade,
  item_id text not null,                  -- Yjs item id (nanoid)
  item_type text not null,
  body text not null,
  primary key (board_id, item_id)
);
create index item_search_trgm on item_search using gin (body gin_trgm_ops);

create table assets (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  uploaded_by uuid references profiles(id) on delete set null,
  storage_path text not null unique,
  mime text not null check (mime in ('image/png','image/jpeg','image/gif','image/webp','image/svg+xml','application/pdf')),
  bytes int not null check (bytes between 1 and 31457280),   -- 30 MB
  width int, height int,
  created_at timestamptz not null default now()
);
create index on assets (board_id);

create table comment_threads (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  item_id text,                           -- null = pinned to a canvas point
  x double precision not null,
  y double precision not null,
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null,
  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on comment_threads (board_id, created_at);

create table comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references comment_threads(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index on comments (thread_id, created_at);
create index on comments (author_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('mention','invite','comment_reply','thread_resolved')),
  board_id uuid references boards(id) on delete cascade,
  comment_id uuid references comments(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc) where read_at is null;

create table templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,   -- null = built-in, written by us
  name text not null,
  category text not null,
  state bytea not null,
  preview_path text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on templates (team_id, category);

create table subscriptions (
  team_id uuid primary key references teams(id) on delete cascade,
  stripe_subscription_id text not null unique,
  status text not null check (status in ('trialing','active','past_due','canceled','incomplete','unpaid')),
  plan text not null check (plan in ('starter','business')),
  seats int not null check (seats > 0),
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table stripe_events (
  id text primary key,                    -- Stripe event id, makes webhooks idempotent
  type text not null,
  received_at timestamptz not null default now()
);

-- Authorisation in one place (security definer so policies do not recurse into team_members)
create or replace function is_team_member(t uuid, u uuid, roles text[] default array['owner','admin','member']) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = t and user_id = u and role = any(roles));
$$;

create or replace function board_role(b uuid, u uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from board_members where board_id = b and user_id = u),
    (select case when bo.team_access <> 'private' and exists
              (select 1 from team_members tm where tm.team_id = bo.team_id and tm.user_id = u)
            then case bo.team_access when 'edit' then 'editor' when 'comment' then 'commenter' else 'viewer' end end
       from boards bo where bo.id = b and bo.deleted_at is null)
  );
$$;

create or replace function can_access_board(b uuid, u uuid, need text) returns boolean
language sql stable as $$
  select case need
    when 'view'    then board_role(b,u) is not null
    when 'comment' then board_role(b,u) in ('owner','coowner','editor','commenter')
    when 'edit'    then board_role(b,u) in ('owner','coowner','editor')
    when 'manage'  then board_role(b,u) in ('owner','coowner')
  end;
$$;

alter table profiles enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table boards enable row level security;
alter table board_members enable row level security;
alter table board_invites enable row level security;
alter table board_docs enable row level security;
alter table board_versions enable row level security;
alter table item_search enable row level security;
alter table assets enable row level security;
alter table comment_threads enable row level security;
alter table comments enable row level security;
alter table notifications enable row level security;
alter table templates enable row level security;
alter table subscriptions enable row level security;
alter table stripe_events enable row level security;   -- no policies: service role only

create policy own_profile on profiles for all using (id = auth.uid());
create policy team_read on teams for select using (is_team_member(id, auth.uid()));
create policy team_members_read on team_members for select using (is_team_member(team_id, auth.uid()));
create policy boards_read on boards for select using (can_access_board(id, auth.uid(), 'view'));
create policy boards_update on boards for update using (can_access_board(id, auth.uid(), 'manage'));
create policy boards_insert on boards for insert with check (owner_id = auth.uid() and is_team_member(team_id, auth.uid()));
create policy members_read on board_members for select using (can_access_board(board_id, auth.uid(), 'view'));
create policy members_manage on board_members for all using (can_access_board(board_id, auth.uid(), 'manage'));
create policy members_star_self on board_members for update using (user_id = auth.uid());
create policy invites_manage on board_invites for all using (can_access_board(board_id, auth.uid(), 'manage'));
create policy versions_read on board_versions for select using (can_access_board(board_id, auth.uid(), 'view'));
create policy search_read on item_search for select using (can_access_board(board_id, auth.uid(), 'view'));
create policy assets_read on assets for select using (can_access_board(board_id, auth.uid(), 'view'));
create policy assets_insert on assets for insert with check (can_access_board(board_id, auth.uid(), 'edit'));
create policy threads_read on comment_threads for select using (can_access_board(board_id, auth.uid(), 'view'));
create policy threads_write on comment_threads for insert with check (can_access_board(board_id, auth.uid(), 'comment') and created_by = auth.uid());
create policy threads_resolve on comment_threads for update using (can_access_board(board_id, auth.uid(), 'comment'));
create policy comments_read on comments for select using (exists (select 1 from comment_threads t where t.id = thread_id and can_access_board(t.board_id, auth.uid(), 'view')));
create policy comments_write on comments for insert with check (author_id = auth.uid() and exists (select 1 from comment_threads t where t.id = thread_id and can_access_board(t.board_id, auth.uid(), 'comment')));
create policy comments_edit_own on comments for update using (author_id = auth.uid());
create policy notifications_own on notifications for all using (user_id = auth.uid());
create policy templates_read on templates for select using (team_id is null or is_team_member(team_id, auth.uid()));
create policy subs_read on subscriptions for select using (is_team_member(team_id, auth.uid(), array['owner','admin']));
-- board_docs: no client policies; only the realtime server (service role) reads and writes.

-- ---------- triggers ----------

-- A new account gets a profile and a personal team.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  team uuid;
  display text := coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1));
begin
  insert into profiles (id, name, email) values (new.id, display, lower(new.email));
  insert into teams (name, created_by) values (display, new.id) returning id into team;
  insert into team_members (team_id, user_id, role) values (team, new.id, 'owner');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- Whoever creates a board owns it.
create or replace function handle_new_board() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into board_members (board_id, user_id, role, last_opened_at) values (new.id, new.owner_id, 'owner', now());
  return new;
end;
$$;
create trigger on_board_created after insert on boards for each row execute function handle_new_board();

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger boards_touch before update on boards for each row execute function touch_updated_at();

-- ---------- grants ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

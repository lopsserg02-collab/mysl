-- Our own sign-in by email link, in place of Supabase Auth: the database and sign-in can then run on any
-- Postgres (on the server in Russia, 152-FZ art. 18(5)). A link carries a random secret; only its SHA-256 is
-- kept here, so a copy of the table cannot sign anyone in. A link works once, for 30 minutes.
-- Only the web app's own connection reads this table: row level security with no policies shuts out the
-- anon and authenticated roles.

create table if not exists login_links (
  token_hash text primary key,
  email text not null,
  next text not null default '/',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists login_links_email on login_links (email, created_at desc);

alter table login_links enable row level security;
revoke all on login_links from public;
do $$ begin
  if exists (select from pg_roles where rolname = 'anon') then revoke all on login_links from anon; end if;
  if exists (select from pg_roles where rolname = 'authenticated') then revoke all on login_links from authenticated; end if;
end $$;

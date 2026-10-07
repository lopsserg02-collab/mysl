-- Billing: Free and Pro per person, paid through Stripe (test mode until launch).
-- The plan belongs to a board's owner: their plan sets the editor limit on their boards and
-- the storage for everything uploaded to them.
--
-- Who writes what:
--   * subscriptions rows are written only by the server's service connection, from verified
--     Stripe webhooks (app/api/stripe/webhook) and when a checkout customer is created.
--     There are no insert/update/delete policies, so the authenticated role cannot change them.
--   * a person reads only their own row.
--   * stripe_events (from 0001) records processed event ids so a repeated delivery changes nothing.

-- The team-based draft table from 0001 was never written by any code; billing is per person.
drop table if exists subscriptions;

create table subscriptions (
  user_id uuid primary key references profiles(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'none'
    check (status in ('none', 'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_event_at timestamptz,               -- Stripe event time of the last change; older events are ignored
  updated_at timestamptz not null default now()
);

alter table subscriptions enable row level security;
create policy subscriptions_read_own on subscriptions for select using (user_id = auth.uid());
revoke all on subscriptions from anon, authenticated;
grant select on subscriptions to authenticated;

revoke all on stripe_events from anon, authenticated;

-- Opening a board by an edit link when the owner's plan has no editor seats left: the person
-- joins with a lower role instead. The app decides the cap; the old one-argument form stays.
create or replace function join_board_via_link(b uuid, cap text) returns text
language plpgsql security definer set search_path = public as $$
declare
  current text := board_role(b, auth.uid());
  via text;
begin
  if auth.uid() is null then return null; end if;
  if current is not null then return current; end if;
  if cap is not null and cap not in ('commenter', 'viewer') then raise exception 'bad role' using errcode = '22023'; end if;
  select link_role(link_access) into via from boards where id = b and deleted_at is null;
  if via is null then return null; end if;
  if via = 'editor' and cap is not null then via := cap; end if;
  insert into board_members (board_id, user_id, role) values (b, auth.uid(), via) on conflict do nothing;
  return via;
end;
$$;

revoke execute on function join_board_via_link(uuid, text) from public, anon;
grant execute on function join_board_via_link(uuid, text) to authenticated;

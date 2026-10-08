-- Guests may edit: a guest holding the link gets what the link gives (view or edit). Commenting still
-- needs an account, so a "comment" link gives guests viewing only. guest_board now also returns the
-- link's access, so the web app can hand out an edit token; the secret check is unchanged.

drop function if exists guest_board(uuid, text);

create function guest_board(b uuid, secret text)
returns table (id uuid, name text, link_access text)
language sql stable security definer set search_path = public as $$
  select bo.id, bo.name, bo.link_access::text from boards bo
   where bo.id = b and bo.deleted_at is null and bo.guest_view and bo.link_access <> 'private'
     and secret is not null and length(secret) >= 32 and bo.link_token = secret;
$$;

revoke execute on function guest_board(uuid, text) from public;
grant execute on function guest_board(uuid, text) to anon, authenticated;

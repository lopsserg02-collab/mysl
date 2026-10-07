-- Images live in a private Supabase Storage bucket that only the server reads, with the service key.
-- On plain Postgres (local development) there is no storage schema and this does nothing.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('assets', 'assets', false, 31457280, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end;
$$;

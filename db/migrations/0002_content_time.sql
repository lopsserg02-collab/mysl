-- When the board's content (not its name) last changed; written by the realtime server on save.
alter table boards add column content_updated_at timestamptz;

-- Saving content is not a rename: do not bump updated_at for it.
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  if (new.name, new.description, new.link_access, new.team_access, new.deleted_at) is distinct from
     (old.name, old.description, old.link_access, old.team_access, old.deleted_at) then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

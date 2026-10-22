-- ON DELETE SET NULL is itself an UPDATE. The append-only trigger must allow
-- that nested FK action while keeping operation contents and direct writes
-- immutable. CREATE OR REPLACE preserves the existing trigger and its ACL.
create or replace function public.reject_collaboration_update_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if pg_trigger_depth() > 1
     and old.created_by is not null and new.created_by is null
     and (to_jsonb(new) - 'created_by') is not distinct from (to_jsonb(old) - 'created_by') then
    return new;
  end if;
  raise exception 'Collaboration updates are append-only';
end;
$$;

revoke execute on function public.reject_collaboration_update_mutation() from public, anon, authenticated;

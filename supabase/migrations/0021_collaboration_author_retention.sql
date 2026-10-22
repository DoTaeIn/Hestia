-- A database that received an early, unrecorded 0019 may already have this
-- table with a RESTRICT author FK. CREATE TABLE IF NOT EXISTS cannot repair
-- that constraint. Align it with 0019's final contract without deleting logs.
do $do$
declare author_fk record;
begin
  for author_fk in
    select c.conname from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'created_by'
    where c.conrelid = 'public.page_collaboration_updates'::regclass
      and c.contype = 'f' and c.confrelid = 'auth.users'::regclass
      and c.conkey = array[a.attnum]::smallint[]
  loop
    execute format('alter table public.page_collaboration_updates drop constraint %I', author_fk.conname);
  end loop;

  alter table public.page_collaboration_updates alter column created_by drop not null;
  alter table public.page_collaboration_updates
    add constraint page_collaboration_updates_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;
end;
$do$;

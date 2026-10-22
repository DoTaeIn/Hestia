-- Two-session tests for the collaboration locks in 0019_system_integrity.sql.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/system_integrity_concurrency.sql
--
-- DISPOSABLE DATABASE ONLY. Unlike supabase/tests/system_integrity.sql this file
-- cannot run inside one transaction: the whole point is that a second session
-- observes what a first one has, and has not, committed. It therefore COMMITS
-- its fixtures and deletes them again at the end. Everything it touches lives
-- under the `f0000000-…` id prefix and the `hestia-conc.test` email domain.
--
-- Second connection: dblink. The connection string defaults to the current
-- database over the default socket; override it when the test role cannot
-- connect without a password, e.g.
--
--   psql ... -c "alter database postgres set hestia.conninfo =
--                'dbname=postgres user=postgres password=… host=localhost'"
--
-- If no second connection can be opened, every check is reported as SKIP —
-- never as a pass.
--
-- What is proved here, and nowhere else:
--   C1-C4    two clients seeding the same page cannot both win
--   C5       a concurrent first load creates exactly one collaboration row
--   C6-C8a   an append racing a restore never survives the restore
--   C9-C11   a load racing a restore never returns a torn state/log/generation

\set ON_ERROR_STOP on

-- Not fatal: without dblink the run below records a SKIP instead of a pass.
do $do$
begin
  create extension if not exists dblink;
exception when others then
  raise notice 'concurrency suite: dblink is unavailable (%); the two-session checks will be skipped.', sqlerrm;
end;
$do$;

drop table if exists public._hestia_conc_check;
create table public._hestia_conc_check (
  at timestamptz not null default clock_timestamp(),
  name text not null,
  ok boolean not null,
  detail text
);

create or replace function public._hestia_conc_record(check_name text, ok boolean, detail text) returns void
language sql as $fn$
  insert into public._hestia_conc_check(name, ok, detail) values (check_name, ok, detail);
$fn$;

-- Wait up to `seconds`, then report whether the async query is still running.
-- Still busy after a second means it is blocked on a lock; finished means it
-- was never blocked at all.
create or replace function public._hestia_conc_still_busy(conn text, seconds numeric) returns boolean
language plpgsql as $fn$
declare deadline timestamptz := clock_timestamp() + (seconds || ' seconds')::interval;
begin
  loop
    if dblink_is_busy(conn) = 0 then return false; end if;
    exit when clock_timestamp() >= deadline;
    perform pg_sleep(0.05);
  end loop;
  return dblink_is_busy(conn) = 1;
end;
$fn$;

-- Finish an async query: first result row (as text) and then drain.
create or replace function public._hestia_conc_result(conn text) returns text
language plpgsql as $fn$
declare first_row text; n integer;
begin
  select r.result into first_row from dblink_get_result(conn) as r(result text) limit 1;
  select count(*) into n from dblink_get_result(conn) as r(result text);
  return first_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixture — created OUTSIDE the run block, so it is committed and the other
-- sessions can actually see it. One page per scenario, none of them with a
-- page_collaboration row yet.
-- ---------------------------------------------------------------------------

delete from public.pages where workspace_id = 'f0000000-0000-4000-8000-00000000000a';
delete from public.workspaces where id = 'f0000000-0000-4000-8000-00000000000a';
delete from auth.users where email like '%@hestia-conc.test';

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('f0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'one@hestia-conc.test', now(), now()),
  ('f0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'two@hestia-conc.test', now(), now());

-- the add_workspace_owner trigger makes user one the workspace owner
insert into public.workspaces (id, name, slug, owner_id) values
  ('f0000000-0000-4000-8000-00000000000a', 'Concurrency tenant', 'concurrency-tenant', 'f0000000-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('f0000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-000000000002', 'editor');

insert into public.pages (id, workspace_id, title, content, created_by, updated_by, document_owner_id) values
  ('f0000000-0000-4000-8000-000000000011', 'f0000000-0000-4000-8000-00000000000a', 'Seed race',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"seed"}]}]}'::jsonb,
   'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000012', 'f0000000-0000-4000-8000-00000000000a', 'Load race',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"load"}]}]}'::jsonb,
   'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000013', 'f0000000-0000-4000-8000-00000000000a', 'Restore race',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v1"}]}]}'::jsonb,
   'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001');

insert into public.page_revisions (page_id, workspace_id, version, title, content, created_by) values
  ('f0000000-0000-4000-8000-000000000013',
   'f0000000-0000-4000-8000-00000000000a', 1, 'Restore race',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v1"}]}]}'::jsonb,
   'f0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- The run
-- ---------------------------------------------------------------------------

do $run$
declare
  conninfo text := coalesce(current_setting('hestia.conninfo', true), 'dbname=' || current_database());
  claims_one constant text := '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}';
  claims_two constant text := '{"sub":"f0000000-0000-4000-8000-000000000002","role":"authenticated"}';
  page_seed  constant uuid := 'f0000000-0000-4000-8000-000000000011';
  page_load  constant uuid := 'f0000000-0000-4000-8000-000000000012';
  page_rest  constant uuid := 'f0000000-0000-4000-8000-000000000013';
  revision_id uuid;
  connected boolean := false;
  busy boolean;
  seeded boolean;
  got text;
  got_state text;
  got_gen integer;
  got_status text;
  n integer;
begin
  select id into revision_id from public.page_revisions where page_id = page_rest and version = 1;

  begin
    perform dblink_connect('hestia_a', conninfo);
    perform dblink_connect('hestia_b', conninfo);
    connected := true;
  exception when others then
    perform public._hestia_conc_record('C0 two sessions', true,
      'SKIP: could not open a second connection (' || sqlerrm || '). Set hestia.conninfo and re-run.');
  end;

  if not connected then return; end if;

  perform dblink_exec('hestia_a', 'set lock_timeout = ''15s''');
  perform dblink_exec('hestia_b', 'set lock_timeout = ''15s''');
  perform dblink_exec('hestia_a', 'set role authenticated');
  perform dblink_exec('hestia_b', 'set role authenticated');
  perform dblink_exec('hestia_a', format('set request.jwt.claims = %L', claims_one));
  perform dblink_exec('hestia_b', format('set request.jwt.claims = %L', claims_two));

  begin
    -- =====================================================================
    -- C1-C4  two clients seed the same never-seeded page
    -- =====================================================================
    perform dblink_exec('hestia_a', 'begin');
    select s.seeded into seeded
      from dblink('hestia_a', format(
        'select seeded from public.seed_page_collaboration(%L::uuid, %L, null)', page_seed, 'QUFBQQ=='))
        as s(seeded boolean);
    perform public._hestia_conc_record('C1 the first seeder wins while its transaction is still open',
      coalesce(seeded, false), format('seeded = %s', seeded));

    perform dblink_send_query('hestia_b', format(
      'select seeded::text || ''|'' || coalesce(collaboration_state, ''<null>'')
         from public.seed_page_collaboration(%L::uuid, %L, null)', page_seed, 'QkJCQg=='));
    busy := public._hestia_conc_still_busy('hestia_b', 1.0);
    -- This is the check that fails against an `on conflict do nothing` + read
    -- implementation: that pattern does not wait for the uncommitted inserter,
    -- so the second seeder returns instantly, believing it seeded.
    perform public._hestia_conc_record('C2 the second seeder waits for the first instead of seeding too',
      busy, case when busy then 'still waiting after 1s, as the row lock requires'
                 else 'RETURNED IMMEDIATELY — the second seeder did not see the uncommitted row' end);

    perform dblink_exec('hestia_a', 'commit');
    got := public._hestia_conc_result('hestia_b');
    perform public._hestia_conc_record('C3 the loser is told it did not seed, and is handed the winning state',
      got = 'false|QUFBQQ==', format('got %s, expected false|QUFBQQ==', coalesce(got, '<null>')));

    select state, generation into got_state, got_gen
      from public.page_collaboration where page_id = page_seed;
    perform public._hestia_conc_record('C4 exactly one canonical state survived the race',
      got_state = 'QUFBQQ==' and got_gen = 1,
      format('state=%s generation=%s', coalesce(got_state, '<null>'), got_gen));

    -- =====================================================================
    -- C5  two clients load a page whose collaboration row does not exist yet
    -- =====================================================================
    perform dblink_exec('hestia_a', 'begin');
    select count(*) into n from dblink('hestia_a', format(
      'select 1 from public.load_page_collaboration(%L::uuid)', page_load)) as t(x integer);
    perform dblink_send_query('hestia_b', format(
      'select collaboration_generation::text || ''|'' || should_seed::text
         from public.load_page_collaboration(%L::uuid)', page_load));
    busy := public._hestia_conc_still_busy('hestia_b', 1.0);
    perform dblink_exec('hestia_a', 'commit');
    got := public._hestia_conc_result('hestia_b');

    select count(*) into n from public.page_collaboration where page_id = page_load;
    perform public._hestia_conc_record('C5 a concurrent first load creates exactly one collaboration row',
      n = 1 and got = '1|true',
      format('rows=%s, the second load returned %s (blocked: %s)', n, coalesce(got, '<null>'), busy));

    -- =====================================================================
    -- C6-C8a  an append that races a restore does not survive it
    -- =====================================================================
    select count(*) into n from dblink('hestia_b', format(
      'select 1 from public.seed_page_collaboration(%L::uuid, %L, 1)', page_rest, 'U0VFRA==')) as t(x integer);

    perform dblink_exec('hestia_a', 'begin');
    select t.status into got_status from dblink('hestia_a', format(
      'select status from public.append_page_collaboration_update(%L::uuid, 1, %L::uuid, %L)',
      page_rest, 'f0000000-0000-4000-8000-0000000000e1', 'QUFBQQ==')) as t(status text);
    perform public._hestia_conc_record('C6 the in-flight append is accepted before the restore commits',
      got_status = 'appended', format('status = %s', coalesce(got_status, '<null>')));

    -- session B becomes the document owner and restores
    perform dblink_exec('hestia_b', format('set request.jwt.claims = %L', claims_one));
    perform dblink_send_query('hestia_b', format(
      'select version::text from public.restore_page_revision(%L::uuid, %L::uuid, ''concurrency'')',
      page_rest, revision_id));
    busy := public._hestia_conc_still_busy('hestia_b', 1.0);
    perform public._hestia_conc_record('C7 the restore waits for the in-flight append instead of stepping over it',
      busy, case when busy then 'still waiting after 1s on the collaboration row lock'
                 else 'RETURNED IMMEDIATELY — the restore did not serialize against the append' end);

    perform dblink_exec('hestia_a', 'commit');
    got := public._hestia_conc_result('hestia_b');

    select count(*) into n from public.page_collaboration_updates where page_id = page_rest;
    select generation, state into got_gen, got_state from public.page_collaboration where page_id = page_rest;
    perform public._hestia_conc_record('C8 the committed delta did not survive the restore',
      n = 0 and got_gen = 2 and got_state is null,
      format('log rows=%s generation=%s state=%s (restore returned version %s)',
             n, got_gen, coalesce(got_state, '<null>'), coalesce(got, '<null>')));

    perform dblink_exec('hestia_b', format('set request.jwt.claims = %L', claims_two));
    select t.status into got_status from dblink('hestia_b', format(
      'select status from public.append_page_collaboration_update(%L::uuid, 1, %L::uuid, %L)',
      page_rest, 'f0000000-0000-4000-8000-0000000000e2', 'QUFBQQ==')) as t(status text);
    perform public._hestia_conc_record('C8a the pre-restore generation is fenced out afterwards',
      got_status = 'stale_generation', format('status = %s', coalesce(got_status, '<null>')));

    -- =====================================================================
    -- C9-C11  a load that races a restore is never torn
    -- =====================================================================
    select count(*) into n from dblink('hestia_b', format(
      'select 1 from public.seed_page_collaboration(%L::uuid, %L, 2)', page_rest, 'U0VFRA==')) as t(x integer);
    select count(*) into n from dblink('hestia_b', format(
      'select 1 from public.append_page_collaboration_update(%L::uuid, 2, %L::uuid, %L)',
      page_rest, 'f0000000-0000-4000-8000-0000000000e3', 'QkJCQg==')) as t(x integer);

    perform dblink_exec('hestia_a', format('set request.jwt.claims = %L', claims_one));
    perform dblink_exec('hestia_a', 'begin');
    select count(*) into n from dblink('hestia_a', format(
      'select 1 from public.restore_page_revision(%L::uuid, %L::uuid, null)', page_rest, revision_id)) as t(x integer);

    perform dblink_send_query('hestia_b', format(
      'select collaboration_generation::text || ''|'' || should_seed::text || ''|'' ||
              coalesce(collaboration_state, ''<null>'') || ''|'' || jsonb_array_length(updates)::text
         from public.load_page_collaboration(%L::uuid)', page_rest));
    busy := public._hestia_conc_still_busy('hestia_b', 1.0);
    perform public._hestia_conc_record('C9 a load racing a restore waits rather than reading half of it',
      busy, case when busy then 'still waiting after 1s on the collaboration row lock'
                 else 'RETURNED IMMEDIATELY — load did not take the row lock' end);

    perform dblink_exec('hestia_a', 'commit');
    got := public._hestia_conc_result('hestia_b');
    perform public._hestia_conc_record('C10 the load sees generation, state and log from the same side of the restore',
      got = '3|true|<null>|0',
      format('got %s, expected 3|true|<null>|0 (generation, should_seed, state, log length)',
             coalesce(got, '<null>')));

    select count(*) into n from public.page_collaboration_updates where page_id = page_rest;
    perform public._hestia_conc_record('C11 no delta of the dead generation is left behind',
      n = 0, format('log rows = %s', n));

  exception when others then
    perform public._hestia_conc_record('C! the run aborted', false, 'error: ' || sqlerrm);
  end;

  -- ---- always let go of the connections ----------------------------------
  begin perform dblink_exec('hestia_a', 'rollback'); exception when others then null; end;
  begin perform dblink_exec('hestia_b', 'rollback'); exception when others then null; end;
  begin perform dblink_disconnect('hestia_a'); exception when others then null; end;
  begin perform dblink_disconnect('hestia_b'); exception when others then null; end;
end;
$run$;

-- ---------------------------------------------------------------------------
-- Cleanup, before the verdict, so a failing run still cleans up after itself
-- ---------------------------------------------------------------------------

delete from public.pages where workspace_id = 'f0000000-0000-4000-8000-00000000000a';
delete from public.workspaces where id = 'f0000000-0000-4000-8000-00000000000a';
delete from auth.users where email like '%@hestia-conc.test';

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------

select
  case when detail like 'SKIP%' then 'SKIP' when ok then 'pass' else 'FAIL' end as result,
  name,
  detail
from public._hestia_conc_check
order by at, name;

do $do$
declare
  total integer;
  failed integer;
  skipped integer;
  row record;
begin
  for row in select * from public._hestia_conc_check where not ok order by at, name loop
    raise notice 'FAIL  % — %', row.name, row.detail;
  end loop;
  for row in select * from public._hestia_conc_check where ok and detail like 'SKIP%' order by at, name loop
    raise notice '%', 'SKIP  ' || row.name || ' — ' || row.detail;
  end loop;
  select count(*) into total from public._hestia_conc_check;
  select count(*) into failed from public._hestia_conc_check where not ok;
  select count(*) into skipped from public._hestia_conc_check where ok and detail like 'SKIP%';
  raise notice '0019 collaboration concurrency: % checks, % failed, % skipped', total, failed, skipped;
  if total = 0 then
    raise exception 'no concurrency checks ran at all';
  end if;
  if failed > 0 then
    raise exception '% of % concurrency checks failed', failed, total;
  end if;
end;
$do$;

drop function if exists public._hestia_conc_result(text);
drop function if exists public._hestia_conc_still_busy(text, numeric);
drop function if exists public._hestia_conc_record(text, boolean, text);
drop table if exists public._hestia_conc_check;

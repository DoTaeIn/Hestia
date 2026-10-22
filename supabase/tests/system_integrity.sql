-- Integration tests for 0019_system_integrity.sql.
--
-- These are not string checks against the migration text: every assertion runs a
-- real statement as a real database role with a real `auth.uid()`, against the
-- effective schema after 0001..0019.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/system_integrity.sql
--
-- Disposable local database only. The whole file runs in one transaction and ends
-- with ROLLBACK, so a passing *and* a failing run both leave the database as they
-- found it. Exit status is non-zero if any check failed; every check is printed.
--
-- Role simulation: `set local role authenticated` + `request.jwt.claims` is exactly
-- what PostgREST does per request, so RLS, column grants, function EXECUTE grants
-- and `auth.uid()` all behave as they do for a browser client. `set local role anon`
-- with empty claims is an anonymous caller.

begin;

set local client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------------

create table public._hestia_check (
  at timestamptz not null default clock_timestamp(),
  name text not null,
  ok boolean not null,
  detail text
);
-- the checks run as anon/authenticated and record their own outcome
grant insert, select on table public._hestia_check to public;

create function public._hestia_record(check_name text, ok boolean, detail text) returns void
language sql as $fn$
  insert into public._hestia_check(name, ok, detail) values (check_name, ok, detail);
$fn$;

-- 0019 §8b strips `anon` from public. These harness functions are created after
-- the migration so they keep the built-in PUBLIC execute, but say it out loud
-- rather than depend on it — the checks that run as `anon` need them.
grant execute on function public._hestia_record(text, boolean, text) to public;

-- expects the statement to raise, with `expect` appearing in the message
create function public._hestia_expect_fail(check_name text, stmt text, expect text) returns void
language plpgsql as $fn$
declare err text;
begin
  begin
    execute stmt;
  exception when others then
    err := sqlerrm;
  end;
  if err is null then
    perform public._hestia_record(check_name, false, 'statement unexpectedly SUCCEEDED');
  else
    perform public._hestia_record(check_name, err ilike '%' || expect || '%', 'error: ' || err);
  end if;
end;
$fn$;

create function public._hestia_expect_ok(check_name text, stmt text) returns void
language plpgsql as $fn$
begin
  begin
    execute stmt;
  exception when others then
    perform public._hestia_record(check_name, false, 'error: ' || sqlerrm);
    return;
  end;
  perform public._hestia_record(check_name, true, 'ok');
end;
$fn$;

-- single-row single-column statement compared as text
create function public._hestia_expect_value(check_name text, stmt text, expected text) returns void
language plpgsql as $fn$
declare got text;
begin
  begin
    execute stmt into got;
  exception when others then
    perform public._hestia_record(check_name, false, 'error: ' || sqlerrm);
    return;
  end;
  perform public._hestia_record(check_name, coalesce(got, '<null>') = expected,
    'got ' || coalesce(got, '<null>') || ', expected ' || expected);
end;
$fn$;

create function public._hestia_expect_rows(check_name text, stmt text, expected integer) returns void
language plpgsql as $fn$
declare affected integer;
begin
  begin
    execute stmt;
    get diagnostics affected = row_count;
  exception when others then
    perform public._hestia_record(check_name, false, 'error: ' || sqlerrm);
    return;
  end;
  perform public._hestia_record(check_name, affected = expected,
    format('affected %s rows, expected %s', affected, expected));
end;
$fn$;

-- realtime.messages is partitioned by day and may have no partition for today on
-- a freshly reset database; that is reported as a skip, never as a pass.
create function public._hestia_realtime_insert(check_name text, expect_allowed boolean) returns void
language plpgsql as $fn$
declare err text;
begin
  begin
    insert into realtime.messages (topic, extension, event, payload, private)
    values (realtime.topic(), 'broadcast', 'yjs-update', '{}'::jsonb, true);
  exception when others then
    err := sqlerrm;
  end;
  if err is not null and (err ilike '%no partition of relation%' or err ilike '%does not exist%') then
    perform public._hestia_record(check_name, true, 'SKIP: realtime.messages not insertable here — ' || err);
  elsif expect_allowed then
    perform public._hestia_record(check_name, err is null, coalesce('error: ' || err, 'inserted'));
  else
    perform public._hestia_record(check_name,
      err is not null and (err ilike '%row-level security%' or err ilike '%permission denied%'),
      coalesce('error: ' || err, 'row was UNEXPECTEDLY inserted'));
  end if;
end;
$fn$;

grant execute on function
  public._hestia_expect_fail(text, text, text),
  public._hestia_expect_ok(text, text),
  public._hestia_expect_value(text, text, text),
  public._hestia_expect_rows(text, text, integer),
  public._hestia_realtime_insert(text, boolean)
to public;

-- `anon` exists in every Supabase database; create it if this is a bare Postgres
-- so the anonymous-caller checks still run. Rolled back with everything else.
do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
    grant usage on schema public to anon;
    perform public._hestia_record('harness: anon role', true, 'SKIP-ish: anon did not exist and was created for this run');
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- u_owner   ws A owner,  document owner of page1
-- u_admin   ws A admin
-- u_editor  ws A editor
-- u_viewer  ws A viewer
-- u_other   ws B owner — a different tenant
-- u_none    no membership anywhere
-- u_demoted ws A editor, document owner of page2; demoted then removed mid-file

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@hestia.test',   now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@hestia.test',   now(), now()),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor@hestia.test',  now(), now()),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@hestia.test',  now(), now()),
  ('55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@hestia.test',   now(), now()),
  ('66666666-6666-4666-8666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'none@hestia.test',    now(), now()),
  ('77777777-7777-4777-8777-777777777777', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demoted@hestia.test', now(), now());

-- the add_workspace_owner trigger inserts the owner membership
insert into public.workspaces (id, name, slug, owner_id) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'Tenant A', 'tenant-a', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'Tenant B', 'tenant-b', '55555555-5555-4555-8555-555555555555');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222', 'admin'),
  ('aaaaaaaa-0000-4000-8000-00000000000a', '33333333-3333-4333-8333-333333333333', 'editor'),
  ('aaaaaaaa-0000-4000-8000-00000000000a', '44444444-4444-4444-8444-444444444444', 'viewer'),
  ('aaaaaaaa-0000-4000-8000-00000000000a', '77777777-7777-4777-8777-777777777777', 'editor');

insert into public.pages (id, workspace_id, title, content, created_by, updated_by, document_owner_id) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Page one',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v1 body"}]}]}'::jsonb,
   '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Page two',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"two body"}]}]}'::jsonb,
   '77777777-7777-4777-8777-777777777777', '77777777-7777-4777-8777-777777777777', '77777777-7777-4777-8777-777777777777'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-00000000000b', 'Other tenant page',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"tenant b"}]}]}'::jsonb,
   '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555'),
  ('eeeeeeee-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Scratch page',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"scratch"}]}]}'::jsonb,
   '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111');

-- ===========================================================================
-- A. Function EXECUTE defaults and schema grants
-- ===========================================================================

select public._hestia_expect_value('A1 PUBLIC has no execute on restore_page_revision',
  $s$ select has_function_privilege('public', 'public.restore_page_revision(uuid,uuid,text)', 'execute')::text $s$, 'false');
select public._hestia_expect_value('A2 PUBLIC has no execute on transfer_page_ownership',
  $s$ select has_function_privilege('public', 'public.transfer_page_ownership(uuid,uuid)', 'execute')::text $s$, 'false');
select public._hestia_expect_value('A3 PUBLIC has no execute on invite_workspace_member',
  $s$ select has_function_privilege('public', 'public.invite_workspace_member(uuid,text,text)', 'execute')::text $s$, 'false');
select public._hestia_expect_value('A4 PUBLIC has no execute on append_page_collaboration_update',
  $s$ select has_function_privilege('public', 'public.append_page_collaboration_update(uuid,integer,uuid,text)', 'execute')::text $s$, 'false');
select public._hestia_expect_value('A5 PUBLIC has no execute on handle_new_user trigger function',
  $s$ select has_function_privilege('public', 'public.handle_new_user()', 'execute')::text $s$, 'false');
select public._hestia_expect_value('A6 authenticated keeps execute on is_workspace_member (RLS needs it)',
  $s$ select has_function_privilege('authenticated', 'public.is_workspace_member(uuid)', 'execute')::text $s$, 'true');
select public._hestia_expect_value('A7 authenticated keeps execute on can_edit_workspace (RLS needs it)',
  $s$ select has_function_privilege('authenticated', 'public.can_edit_workspace(uuid)', 'execute')::text $s$, 'true');
select public._hestia_expect_value('A8 authenticated keeps execute on document_plain_text (generated column)',
  $s$ select has_function_privilege('authenticated', 'public.document_plain_text(jsonb)', 'execute')::text $s$, 'true');
select public._hestia_expect_value('A9 authenticated keeps execute on shares_workspace_with (profiles RLS)',
  $s$ select has_function_privilege('authenticated', 'public.shares_workspace_with(uuid)', 'execute')::text $s$, 'true');
select public._hestia_expect_value('A10 anon has usage on schema public',
  $s$ select has_schema_privilege('anon', 'public', 'usage')::text $s$, 'true');
select public._hestia_expect_value('A11 anon cannot create in schema public',
  $s$ select has_schema_privilege('anon', 'public', 'create')::text $s$, 'false');
select public._hestia_expect_value('A12 authenticated cannot create in schema public',
  $s$ select has_schema_privilege('authenticated', 'public', 'create')::text $s$, 'false');

-- the unsafe 2-arg collaboration overload is gone, not merely unused
select public._hestia_expect_fail('A13 save_page_collaboration(uuid,text) overload is retired',
  $s$ select public.save_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'AAAA') $s$,
  'does not exist');
select public._hestia_expect_value('A14 only the 3-arg save_page_collaboration remains',
  $s$ select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'save_page_collaboration' $s$, '1');

-- every function the client calls must be restricted to the authenticated role
select public._hestia_expect_value('A15 no security definer public function is executable by PUBLIC',
  $s$ select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        and has_function_privilege('public', p.oid, 'execute') $s$, 'none');

-- Revoking PUBLIC is not enough: Supabase grants anon by name. This is the
-- check the first cut of 0019 was missing.
select public._hestia_expect_value('A15a no application function in public is executable by anon',
  $s$ select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind in ('f', 'p')
        and p.proname not like '\_hestia%'   -- this harness, created after the migration
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') -- extension-owned utilities
        and has_function_privilege('anon', p.oid, 'execute') $s$, 'none');
select public._hestia_expect_value('A15b anon holds no privilege on any table in public',
  $s$ select coalesce(string_agg(format('%s:%s', c.relname, pr.priv), ', ' order by c.relname, pr.priv), 'none')
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['select','insert','update','delete','truncate','references','trigger']) as pr(priv)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
        and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
        and c.relname not like '\_hestia%'
        and has_table_privilege('anon', c.oid, pr.priv) $s$, 'none');

-- `authenticated` write privileges in public, as an exact allowlist. Supabase's
-- default privileges hand it ALL on every new table, so anything not listed
-- here is a grant nobody asked for.
select public._hestia_expect_value('A15c authenticated write privileges in public match the allowlist',
  $s$ select coalesce(string_agg(format('%s:%s', c.relname, pr.priv), ', ' order by c.relname collate "C", pr.priv collate "C"), 'none')
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['insert','update','delete','truncate']) as pr(priv)
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and c.relname not like '\_hestia%'
        and has_table_privilege('authenticated', c.oid, pr.priv) $s$,
  'comment_threads:insert, comments:insert, pages:insert, workspaces:insert');

do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    perform public._hestia_record('A15d service_role keeps full access', true,
      'SKIP: service_role does not exist in this database');
  else
    perform public._hestia_record('A15d service_role keeps full access',
      has_table_privilege('service_role', 'public.pages', 'select')
        and has_table_privilege('service_role', 'public.pages', 'update'),
      'server-side jobs are not affected by the authenticated allowlist');
  end if;
end;
$do$;

-- the compacting checkpoint is not shipped at all, so no client can reach it
select public._hestia_expect_value('A15e checkpoint_page_collaboration does not exist',
  $s$ select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'checkpoint_page_collaboration' $s$, '0');

-- ---- anonymous callers are stopped by the grant, before any function body ----

-- claims with no `sub`, not an empty string: older auth.uid() definitions cast
-- the claims GUC to jsonb without guarding against ''.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select public._hestia_expect_fail('A16 anon cannot call transfer_page_ownership',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, '66666666-6666-4666-8666-666666666666'::uuid) $s$,
  'permission denied for function');
select public._hestia_expect_fail('A17 anon cannot call invite_workspace_member',
  $s$ select * from public.invite_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, 'none@hestia.test', 'admin') $s$,
  'permission denied for function');
select public._hestia_expect_fail('A18 anon cannot call save_page_version',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'hijacked', '{"type":"doc"}'::jsonb, null) $s$,
  'permission denied for function');
select public._hestia_expect_fail('A19 anon cannot call restore_page_revision',
  $s$ select public.restore_page_revision('eeeeeeee-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000000'::uuid, null) $s$,
  'permission denied for function');
select public._hestia_expect_fail('A20 anon cannot call remove_workspace_member',
  $s$ select public.remove_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '11111111-1111-4111-8111-111111111111'::uuid) $s$,
  'permission denied for function');
select public._hestia_expect_fail('A21 anon cannot call soft_delete_comment',
  $s$ select public.soft_delete_comment('00000000-0000-4000-8000-000000000000'::uuid) $s$,
  'permission denied for function');
select public._hestia_expect_fail('A22 anon cannot call load_page_collaboration',
  $s$ select * from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$,
  'permission denied for function');
select public._hestia_expect_fail('A23 anon cannot call append_page_collaboration_update',
  $s$ select * from public.append_page_collaboration_update('eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, gen_random_uuid(), 'AAAA') $s$,
  'permission denied for function');
select public._hestia_expect_fail('A24 anon cannot call seed_page_collaboration',
  $s$ select * from public.seed_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'AAAA', null) $s$,
  'permission denied for function');
select public._hestia_expect_fail('A25 anon cannot read pages at all',
  $s$ select count(*) from public.pages $s$, 'permission denied');
select public._hestia_expect_fail('A25a anon cannot read the collaboration log',
  $s$ select count(*) from public.page_collaboration_updates $s$, 'permission denied');
select public._hestia_expect_fail('A25b anon cannot read comments',
  $s$ select count(*) from public.comments $s$, 'permission denied');
select public._hestia_expect_fail('A25c anon cannot call the removed legacy save',
  $s$ select public.save_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'AAAA', 1) $s$,
  'permission denied for function');

reset role;

-- The same functions must also reject a NULL auth.uid() on their own, so the
-- guard does not depend on the grant alone (service_role, a future role, psql).
select public._hestia_expect_fail('A26 null auth.uid() is rejected inside transfer_page_ownership',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, '33333333-3333-4333-8333-333333333333'::uuid) $s$,
  'Authentication required');
select public._hestia_expect_fail('A27 null auth.uid() is rejected inside invite_workspace_member',
  $s$ select * from public.invite_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, 'none@hestia.test', 'admin') $s$,
  'Authentication required');
select public._hestia_expect_fail('A28 null auth.uid() is rejected inside save_page_version',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'x', '{"type":"doc"}'::jsonb, null) $s$,
  'Authentication required');
select public._hestia_expect_fail('A29 null auth.uid() is rejected inside append_page_collaboration_update',
  $s$ select * from public.append_page_collaboration_update('eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, gen_random_uuid(), 'AAAA') $s$,
  'Authentication required');
select public._hestia_expect_fail('A30 null auth.uid() is rejected inside soft_delete_comment',
  $s$ select public.soft_delete_comment('00000000-0000-4000-8000-000000000000'::uuid) $s$,
  'Authentication required');

-- ===========================================================================
-- B. Member management with a NULL actor role
-- ===========================================================================

-- non-member of any workspace
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);

select public._hestia_expect_fail('B1 non-member cannot invite into a workspace',
  $s$ select * from public.invite_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, 'none@hestia.test', 'admin') $s$,
  'Not allowed to manage workspace members');
select public._hestia_expect_fail('B2 non-member cannot change a member role',
  $s$ select public.set_workspace_member_role('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '33333333-3333-4333-8333-333333333333'::uuid, 'viewer') $s$,
  'Not allowed to manage workspace members');
select public._hestia_expect_fail('B3 non-member cannot remove a member',
  $s$ select public.remove_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '33333333-3333-4333-8333-333333333333'::uuid) $s$,
  'Not allowed to manage workspace members');

-- a different tenant's owner has a role, just not here
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select public._hestia_expect_fail('B4 cross-workspace owner cannot invite into another workspace',
  $s$ select * from public.invite_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, 'none@hestia.test', 'editor') $s$,
  'Not allowed to manage workspace members');
select public._hestia_expect_fail('B5 cross-workspace owner cannot remove another workspace member',
  $s$ select public.remove_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '33333333-3333-4333-8333-333333333333'::uuid) $s$,
  'Not allowed to manage workspace members');

-- viewer and editor are members but not managers
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select public._hestia_expect_fail('B6 viewer cannot invite',
  $s$ select * from public.invite_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, 'none@hestia.test', 'editor') $s$,
  'Not allowed to manage workspace members');
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_fail('B7 editor cannot change roles',
  $s$ select public.set_workspace_member_role('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, 'editor') $s$,
  'Not allowed to manage workspace members');

-- admin limits
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public._hestia_expect_fail('B8 admin cannot grant admin',
  $s$ select public.set_workspace_member_role('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '33333333-3333-4333-8333-333333333333'::uuid, 'admin') $s$,
  'Only an owner can grant administrator access');
select public._hestia_expect_fail('B8a admin cannot downgrade an existing administrator through invite',
  $s$ select * from public.invite_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, 'admin@hestia.test', 'viewer') $s$,
  'Not allowed to manage this workspace member');
select public._hestia_expect_fail('B9 admin cannot change the workspace owner',
  $s$ select public.set_workspace_member_role('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '11111111-1111-4111-8111-111111111111'::uuid, 'viewer') $s$,
  'The workspace owner role cannot be changed');
select public._hestia_expect_fail('B10 admin cannot remove the workspace owner',
  $s$ select public.remove_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '11111111-1111-4111-8111-111111111111'::uuid) $s$,
  'Not allowed to remove this workspace member');
select public._hestia_expect_fail('B11 unknown target member is reported, not silently changed',
  $s$ select public.set_workspace_member_role('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '66666666-6666-4666-8666-666666666666'::uuid, 'editor') $s$,
  'Workspace member was not found');

-- owner can manage
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('B12 owner can invite an existing user',
  $s$ select * from public.invite_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, 'none@hestia.test', 'viewer') $s$);
select public._hestia_expect_fail('B13 owner cannot invite an unknown email',
  $s$ select * from public.invite_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, 'nobody@hestia.test', 'viewer') $s$,
  'has not signed in to Hestia yet');
select public._hestia_expect_fail('B14 invalid role is rejected',
  $s$ select public.set_workspace_member_role('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '33333333-3333-4333-8333-333333333333'::uuid, 'superuser') $s$,
  'Invalid workspace role');

reset role;

-- state assertions: the failed attempts changed nothing
select public._hestia_expect_value('B15 non-member did not gain membership through the failed invite',
  $s$ select count(*)::text from public.workspace_members
      where workspace_id = 'aaaaaaaa-0000-4000-8000-00000000000a' and user_id = '66666666-6666-4666-8666-666666666666'
        and role <> 'viewer' $s$, '0');
select public._hestia_expect_value('B16 owner role in tenant A is still owner',
  $s$ select role from public.workspace_members
      where workspace_id = 'aaaaaaaa-0000-4000-8000-00000000000a' and user_id = '11111111-1111-4111-8111-111111111111' $s$, 'owner');
select public._hestia_expect_value('B17 editor was not promoted by the admin attempt',
  $s$ select role from public.workspace_members
      where workspace_id = 'aaaaaaaa-0000-4000-8000-00000000000a' and user_id = '33333333-3333-4333-8333-333333333333' $s$, 'editor');
select public._hestia_expect_value('B18 owner invite actually landed',
  $s$ select role from public.workspace_members
      where workspace_id = 'aaaaaaaa-0000-4000-8000-00000000000a' and user_id = '66666666-6666-4666-8666-666666666666' $s$, 'viewer');

-- undo B12 so the later non-member checks still have a non-member
delete from public.workspace_members
 where workspace_id = 'aaaaaaaa-0000-4000-8000-00000000000a' and user_id = '66666666-6666-4666-8666-666666666666';

-- ===========================================================================
-- C. Document ownership transfer
-- ===========================================================================

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_fail('C1 non-member cannot transfer page ownership',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, '66666666-6666-4666-8666-666666666666'::uuid) $s$,
  'Only the document owner can transfer ownership');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select public._hestia_expect_fail('C2 cross-workspace owner cannot transfer another tenant''s page',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, '55555555-5555-4555-8555-555555555555'::uuid) $s$,
  'Only the document owner can transfer ownership');

select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_fail('C3 editor who is not the document owner cannot transfer',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, '33333333-3333-4333-8333-333333333333'::uuid) $s$,
  'Only the document owner can transfer ownership');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public._hestia_expect_fail('C4 workspace admin cannot transfer a document they do not own',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, '22222222-2222-4222-8222-222222222222'::uuid) $s$,
  'Only the document owner can transfer ownership');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_fail('C5 next owner must be a member',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, '66666666-6666-4666-8666-666666666666'::uuid) $s$,
  'The next owner must be an editor in this workspace');
select public._hestia_expect_fail('C6 next owner must have edit capability, not viewer',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, '44444444-4444-4444-8444-444444444444'::uuid) $s$,
  'The next owner must be an editor in this workspace');
select public._hestia_expect_fail('C7 next owner cannot be null',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, null) $s$,
  'The next owner must be an editor in this workspace');
select public._hestia_expect_ok('C8 document owner can transfer to an editor',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, '33333333-3333-4333-8333-333333333333'::uuid) $s$);

reset role;
select public._hestia_expect_value('C9 ownership moved to the editor',
  $s$ select document_owner_id::text from public.pages where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  '33333333-3333-4333-8333-333333333333');

-- hand it back so the version tests below run against the original owner
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_ok('C10 the new owner can transfer it back',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000001'::uuid, '11111111-1111-4111-8111-111111111111'::uuid) $s$);
reset role;

select public._hestia_expect_value('C11 ownership is back with the original owner',
  $s$ select document_owner_id::text from public.pages where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  '11111111-1111-4111-8111-111111111111');

-- ===========================================================================
-- D. Version save / restore is document-owner-only on the server
-- ===========================================================================

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_fail('D1 editor cannot save a version of a document they do not own',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'editor title', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, null) $s$,
  'Only the document owner can save a version');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public._hestia_expect_fail('D2 workspace admin cannot save a version of a document they do not own',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'admin title', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, null) $s$,
  'Only the document owner can save a version');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select public._hestia_expect_fail('D3 viewer cannot save a version',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'viewer title', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, null) $s$,
  'Not allowed to save this page');

select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_fail('D4 non-member cannot save a version',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'nobody title', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, null) $s$,
  'Not allowed to save this page');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select public._hestia_expect_fail('D5 cross-workspace user cannot save a version',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'other title', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, null) $s$,
  'Not allowed to save this page');

-- the document owner, who is also a workspace member with edit capability
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('D6 document owner saves v1',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'Page one',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"first"}]}]}'::jsonb, 'first version') $s$);
select public._hestia_expect_ok('D7 document owner saves v2',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'Page one, edited',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"second"}]}]}'::jsonb, null) $s$);

-- page2's owner saves v1 while still an editor, then loses the capability
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);
select public._hestia_expect_ok('D8 page two owner saves v1 while an editor',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000002'::uuid, 'Page two',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"two first"}]}]}'::jsonb, null) $s$);

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('D9 owner demotes the page two document owner to viewer',
  $s$ select public.set_workspace_member_role('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '77777777-7777-4777-8777-777777777777'::uuid, 'viewer') $s$);

select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);
select public._hestia_expect_fail('D10 document owner demoted to viewer cannot save a version',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000002'::uuid, 'demoted', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, null) $s$,
  'Not allowed to save this page');
select public._hestia_expect_fail('D11 document owner demoted to viewer cannot restore a version',
  $s$ select public.restore_page_revision('eeeeeeee-0000-4000-8000-000000000002'::uuid,
        (select id from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000002' order by version limit 1), null) $s$,
  'Not allowed to restore this page');
select public._hestia_expect_fail('D12 document owner demoted to viewer cannot transfer ownership',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000002'::uuid, '33333333-3333-4333-8333-333333333333'::uuid) $s$,
  'Only the document owner can transfer ownership');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('D13 owner removes the page two document owner from the workspace',
  $s$ select public.remove_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '77777777-7777-4777-8777-777777777777'::uuid) $s$);

select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);
select public._hestia_expect_fail('D14 removed document owner cannot save a version',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000002'::uuid, 'removed', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, null) $s$,
  'Not allowed to save this page');
select public._hestia_expect_fail('D15 removed document owner cannot restore a version',
  $s$ select public.restore_page_revision('eeeeeeee-0000-4000-8000-000000000002'::uuid,
        (select id from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000002' order by version limit 1), null) $s$,
  'Not allowed to restore this page');
select public._hestia_expect_fail('D16 removed document owner cannot transfer ownership',
  $s$ select public.transfer_page_ownership('eeeeeeee-0000-4000-8000-000000000002'::uuid, '33333333-3333-4333-8333-333333333333'::uuid) $s$,
  'Only the document owner can transfer ownership');
select public._hestia_expect_fail('D17 removed member cannot read the page at all',
  $s$ select * from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000002'::uuid) $s$,
  'Not allowed to read this page');

-- restore authorization on page one
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_fail('D18 editor cannot restore a version of a document they do not own',
  $s$ select public.restore_page_revision('eeeeeeee-0000-4000-8000-000000000001'::uuid,
        (select id from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000001' and version = 1), null) $s$,
  'Only the document owner can restore a version');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select public._hestia_expect_fail('D19 viewer cannot restore a version',
  $s$ select public.restore_page_revision('eeeeeeee-0000-4000-8000-000000000001'::uuid,
        (select id from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000001' and version = 1), null) $s$,
  'Not allowed to restore this page');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_fail('D20 a revision from another page is not restorable here',
  $s$ select public.restore_page_revision('eeeeeeee-0000-4000-8000-000000000001'::uuid,
        (select id from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000002' order by version limit 1), null) $s$,
  'Revision not found');

reset role;
select public._hestia_expect_value('D21 no unauthorized save changed the page title',
  $s$ select title from public.pages where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 'Page one, edited');
select public._hestia_expect_value('D22 exactly the two authorized revisions exist',
  $s$ select count(*)::text from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '2');
select public._hestia_expect_value('D23 the reason from 0015 is still recorded',
  $s$ select reason from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000001' and version = 1 $s$, 'first version');

-- ===========================================================================
-- E. Collaboration protocol
-- ===========================================================================

set local role authenticated;

-- membership is enough to follow, edit capability is required to write
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_fail('E1 non-member cannot load collaboration state',
  $s$ select * from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$,
  'Not allowed to read this page');
select public._hestia_expect_fail('E2 non-member cannot append an update',
  $s$ select * from public.append_page_collaboration_update('eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, gen_random_uuid(), 'AAAA') $s$,
  'Not allowed to collaborate on this page');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select public._hestia_expect_fail('E3 cross-workspace editor cannot append an update',
  $s$ select * from public.append_page_collaboration_update('eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, gen_random_uuid(), 'AAAA') $s$,
  'Not allowed to collaborate on this page');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select public._hestia_expect_ok('E4 viewer can load collaboration state',
  $s$ select * from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$);
select public._hestia_expect_value('E5 an unseeded page asks the client to seed',
  $s$ select should_seed::text from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$, 'true');
select public._hestia_expect_fail('E6 viewer cannot seed',
  $s$ select * from public.seed_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'U0VFRA==', null) $s$,
  'Not allowed to collaborate on this page');
select public._hestia_expect_fail('E7 viewer cannot append',
  $s$ select * from public.append_page_collaboration_update('eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, gen_random_uuid(), 'AAAA') $s$,
  'Not allowed to collaborate on this page');
-- there is no whole-document write path left for anyone, viewer or editor
select public._hestia_expect_fail('E8 the compacting checkpoint is not callable at all',
  $s$ select * from public.checkpoint_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, 'U0VFRA==', 0) $s$,
  'does not exist');

-- seeding: first writer wins, second adopts
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_value('E9 the first seed becomes canonical',
  $s$ select seeded::text from public.seed_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'U0VFRA==', 1) $s$, 'true');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_value('E10 a concurrent initializer does not re-seed',
  $s$ select seeded::text from public.seed_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'T1RIRVI=', 1) $s$, 'false');
select public._hestia_expect_value('E11 the loser is handed the winning state',
  $s$ select collaboration_state from public.seed_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'T1RIRVI=', 1) $s$, 'U0VFRA==');
select public._hestia_expect_fail('E12 seeding with a stale generation is rejected',
  $s$ select * from public.seed_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'U0VFRA==', 99) $s$,
  'This document was restored');
select public._hestia_expect_fail('E13 a non-base64 seed is rejected',
  $s$ select * from public.seed_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'not base64!', null) $s$,
  'Invalid collaboration state encoding');

-- appending deltas
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_value('E14 editor append is accepted',
  $s$ select status from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, 'cccccccc-0000-4000-8000-000000000001'::uuid, 'AAAA') $s$, 'appended');
select public._hestia_expect_value('E15 replaying the same operation id is a duplicate, not a second row',
  $s$ select status from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, 'cccccccc-0000-4000-8000-000000000001'::uuid, 'AAAA') $s$, 'duplicate');
select public._hestia_expect_value('E16 a duplicate returns the already stored seq',
  $s$ select (select update_seq from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, 'cccccccc-0000-4000-8000-000000000001'::uuid, 'AAAA'))
      = (select seq from public.page_collaboration_updates
          where operation_id = 'cccccccc-0000-4000-8000-000000000001') $s$, 'true');
select public._hestia_expect_value('E17 a second distinct operation is appended',
  $s$ select status from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, 'cccccccc-0000-4000-8000-000000000002'::uuid, 'BBBB') $s$, 'appended');
select public._hestia_expect_value('E18 an append against an old generation is rejected, not written',
  $s$ select status from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 0, 'cccccccc-0000-4000-8000-000000000003'::uuid, 'CCCC') $s$, 'stale_generation');
select public._hestia_expect_value('E19 a future generation is rejected too',
  $s$ select status from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 99, 'cccccccc-0000-4000-8000-000000000004'::uuid, 'CCCC') $s$, 'stale_generation');
select public._hestia_expect_fail('E20 a non-base64 payload is rejected',
  $s$ select * from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, gen_random_uuid(), 'nope!') $s$,
  'Invalid collaboration update encoding');
select public._hestia_expect_fail('E21 an empty payload is rejected',
  $s$ select * from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, gen_random_uuid(), '') $s$,
  'Invalid collaboration update encoding');
select public._hestia_expect_fail('E22 a null operation id is rejected',
  $s$ select * from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, null, 'AAAA') $s$,
  'An operation id is required');

-- loading returns the seed plus every delta, in order
select public._hestia_expect_value('E23 load returns the canonical seed state',
  $s$ select collaboration_state from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$, 'U0VFRA==');
select public._hestia_expect_value('E24 load returns both deltas ordered by seq',
  $s$ select (select jsonb_agg(entry ->> 'payload' order by (entry ->> 'seq')::bigint)
              from jsonb_array_elements(updates) entry)::text
      from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$, '["AAAA", "BBBB"]');
select public._hestia_expect_value('E25 load reports the delta order as stored',
  $s$ select (updates -> 0 ->> 'payload') || ',' || (updates -> 1 ->> 'payload')
      from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$, 'AAAA,BBBB');
select public._hestia_expect_value('E26 latest_update_seq matches the last delta',
  $s$ select (latest_update_seq = (select max(seq) from public.page_collaboration_updates
        where page_id = 'eeeeeeee-0000-4000-8000-000000000001'))::text
      from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$, 'true');
select public._hestia_expect_value('E27 a seeded page no longer asks the client to seed',
  $s$ select should_seed::text from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$, 'false');

-- The log is append-only from a client's point of view, and that must be a
-- *grant*, not an RLS row filter: UPDATE and DELETE with no matching policy are
-- allowed as commands and simply affect zero rows, which is not the same claim.
select public._hestia_expect_fail('E28 a client cannot insert into the update log directly',
  $s$ insert into public.page_collaboration_updates (operation_id, page_id, workspace_id, generation, payload)
      values (gen_random_uuid(), 'eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 1, 'DDDD') $s$,
  'permission denied');
select public._hestia_expect_fail('E29 a client cannot rewrite a stored update',
  $s$ update public.page_collaboration_updates set payload = 'ZZZZ' where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  'permission denied');
select public._hestia_expect_fail('E30 a client cannot delete stored updates',
  $s$ delete from public.page_collaboration_updates where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  'permission denied');
select public._hestia_expect_value('E30a authenticated holds no write grant on the log',
  $s$ select coalesce(string_agg(pr.priv, ', ' order by pr.priv collate "C"), 'none')
      from unnest(array['insert','update','delete','truncate']) as pr(priv)
      where has_table_privilege('authenticated', 'public.page_collaboration_updates', pr.priv) $s$, 'none');
select public._hestia_expect_value('E30b the append-only trigger is attached',
  $s$ select count(*)::text from pg_trigger
      where tgrelid = 'public.page_collaboration_updates'::regclass
        and tgname = 'reject_collaboration_update_mutation' and not tgisinternal $s$, '1');
select public._hestia_expect_value('E31 a member can read the update log',
  $s$ select count(*)::text from public.page_collaboration_updates where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '2');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select public._hestia_expect_value('E32 another tenant cannot read this update log',
  $s$ select count(*)::text from public.page_collaboration_updates where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '0');

-- ---- no whole-document write path survives, and none of them half-works ----
--
-- This is the audit finding that removed checkpointing: whatever generation it
-- is handed, a full-state write replaces a canonical state the caller may not
-- contain. The tombstones must raise a *different* error from the recoverable
-- stale-generation one, so an old tab is told to reload instead of retrying.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_fail('E33 the legacy whole-document save raises upgrade-required',
  $s$ select public.save_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'T1RIRVI=', 1) $s$,
  'Reload this page to keep editing');
select public._hestia_expect_fail('E34 the legacy initialize raises upgrade-required',
  $s$ select * from public.initialize_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$,
  'Reload this page to keep editing');
select public._hestia_expect_value('E35 the refused legacy save did not touch the canonical state',
  $s$ select collaboration_state from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$, 'U0VFRA==');
select public._hestia_expect_value('E36 the refused legacy save did not drop appended deltas',
  $s$ select count(*)::text from public.page_collaboration_updates where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '2');

-- ---- idempotency is bytes-exact: a reused operation id is never acknowledged
-- unless the stored payload is the payload that was sent ----
select public._hestia_expect_fail('E37 the same operation id with a different payload is refused',
  $s$ select * from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, 'cccccccc-0000-4000-8000-000000000001'::uuid, 'WElYWA==') $s$,
  'already used for a different update');
select public._hestia_expect_value('E38 the refusal stored nothing and rewrote nothing',
  $s$ select payload from public.page_collaboration_updates
      where operation_id = 'cccccccc-0000-4000-8000-000000000001' $s$, 'AAAA');
select public._hestia_expect_value('E39 the refusal did not add a row',
  $s$ select count(*)::text from public.page_collaboration_updates where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '2');
select public._hestia_expect_value('E40 appends still work after the refusal',
  $s$ select status from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, 'cccccccc-0000-4000-8000-000000000005'::uuid, 'RERERA==') $s$, 'appended');
select public._hestia_expect_value('E40a the byte-identical retry is still a duplicate',
  $s$ select status from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, 'cccccccc-0000-4000-8000-000000000005'::uuid, 'RERERA==') $s$, 'duplicate');
select public._hestia_expect_value('E40b the log now holds three deltas, in order',
  $s$ select (select string_agg(entry ->> 'payload', ',' order by (entry ->> 'seq')::bigint)
              from jsonb_array_elements(updates) entry)
      from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$, 'AAAA,BBBB,RERERA==');

-- trashed pages are not collaborative
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('E41 owner trashes the scratch page',
  $s$ select public.trash_page('eeeeeeee-0000-4000-8000-000000000009'::uuid) $s$);
select public._hestia_expect_fail('E42 a trashed page cannot be appended to',
  $s$ select * from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000009'::uuid, 1, gen_random_uuid(), 'AAAA') $s$,
  'Not allowed to collaborate on this page');
select public._hestia_expect_ok('E43 owner restores the scratch page',
  $s$ select public.restore_page('eeeeeeee-0000-4000-8000-000000000009'::uuid) $s$);

reset role;

-- ===========================================================================
-- F. Restore behaviour: revision, collaboration reset, generation, locking
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('F1 document owner restores v1 with a reason',
  $s$ select public.restore_page_revision('eeeeeeee-0000-4000-8000-000000000001'::uuid,
        (select id from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000001' and version = 1),
        'the second version lost the exception note') $s$);
reset role;

select public._hestia_expect_value('F2 the page content is the restored snapshot',
  $s$ select public.document_plain_text(content) from public.pages where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 'first');
select public._hestia_expect_value('F3 the page title is the restored snapshot',
  $s$ select title from public.pages where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 'Page one');
select public._hestia_expect_value('F4 the restore was appended as a new revision',
  $s$ select max(version)::text from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '3');
select public._hestia_expect_value('F5 the earlier revisions were not rewritten',
  $s$ select count(*)::text from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '3');
select public._hestia_expect_value('F6 the restore reason was recorded',
  $s$ select reason from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000001' and version = 3 $s$,
  'the second version lost the exception note');
select public._hestia_expect_value('F7 the restored revision carries the restored content',
  $s$ select public.document_plain_text(content) from public.page_revisions
      where page_id = 'eeeeeeee-0000-4000-8000-000000000001' and version = 3 $s$, 'first');
select public._hestia_expect_value('F8 the live collaboration state was cleared',
  $s$ select coalesce(state, '<null>') from public.page_collaboration where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '<null>');
select public._hestia_expect_value('F9 the collaboration generation advanced',
  $s$ select generation::text from public.page_collaboration where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '2');
select public._hestia_expect_value('F10 the delta log of the dead generation was dropped',
  $s$ select count(*)::text from public.page_collaboration_updates where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '0');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_value('F11 a client still on the old generation is fenced out',
  $s$ select status from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, 'cccccccc-0000-4000-8000-00000000000a'::uuid, 'AAAA') $s$, 'stale_generation');
select public._hestia_expect_value('F12 the rejected append reports the new generation so the client can recover',
  $s$ select collaboration_generation::text from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 1, 'cccccccc-0000-4000-8000-00000000000b'::uuid, 'AAAA') $s$, '2');
select public._hestia_expect_fail('F13 the removed whole-document save cannot resurrect the old state',
  $s$ select public.save_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'T1RIRVI=', 1) $s$,
  'Reload this page to keep editing');
select public._hestia_expect_value('F14 load reports the new generation and asks for a fresh seed',
  $s$ select collaboration_generation::text || ',' || should_seed::text
      from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$, '2,true');
select public._hestia_expect_value('F15 the new generation accepts appends again',
  $s$ select status from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 2, 'cccccccc-0000-4000-8000-00000000000c'::uuid, 'AAAA') $s$, 'appended');

-- restore also works for a page that was never collaborated on
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select public._hestia_expect_ok('F16 tenant B owner saves a version',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000003'::uuid, 'Other tenant page',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"b first"}]}]}'::jsonb, null) $s$);
select public._hestia_expect_ok('F17 restore succeeds with no pre-existing collaboration row',
  $s$ select public.restore_page_revision('eeeeeeee-0000-4000-8000-000000000003'::uuid,
        (select id from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000003' and version = 1), null) $s$);
reset role;
select public._hestia_expect_value('F18 that restore created the collaboration row at generation 2',
  $s$ select generation::text from public.page_collaboration where page_id = 'eeeeeeee-0000-4000-8000-000000000003' $s$, '2');

-- the page lock restore relies on is a real lock, not a comment
select public._hestia_expect_value('F19 restore_page_revision still locks the page row (structural)',
  $s$ select (prosrc like '%for update%')::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'restore_page_revision' $s$, 'true');

-- ===========================================================================
-- G. Direct writes to pages cannot bypass the version/ownership RPCs
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select public._hestia_expect_fail('G1 an editor cannot PATCH page content directly',
  $s$ update public.pages set content = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"injected"}]}]}'::jsonb
      where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  'permission denied');
select public._hestia_expect_fail('G2 an editor cannot PATCH the page title directly',
  $s$ update public.pages set title = 'injected' where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  'permission denied');
select public._hestia_expect_fail('G3 an editor cannot take document ownership directly',
  $s$ update public.pages set document_owner_id = '33333333-3333-4333-8333-333333333333'
      where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  'permission denied');
select public._hestia_expect_fail('G4 an editor cannot trash a page by setting deleted_at',
  $s$ update public.pages set deleted_at = now() where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  'permission denied');
select public._hestia_expect_fail('G5 an editor cannot move a page across workspaces',
  $s$ update public.pages set workspace_id = 'bbbbbbbb-0000-4000-8000-00000000000b'
      where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  'permission denied');

-- the tree moves the UI actually performs must keep working
select public._hestia_expect_rows('G6 an editor can still reparent a page',
  $s$ update public.pages set parent_id = 'eeeeeeee-0000-4000-8000-000000000002', position = 2048
      where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 1);
select public._hestia_expect_rows('G7 an editor can still reorder a page',
  $s$ update public.pages set position = 4096 where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 1);
select public._hestia_expect_rows('G8 an editor can still move a page back to the root',
  $s$ update public.pages set parent_id = null where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 1);

-- insert path still works: validate_page_parent, touch_page and the
-- search_text generated column all run under the hardened grants
select public._hestia_expect_rows('G9 an editor can still create a page (triggers and generated column)',
  $s$ insert into public.pages (id, workspace_id, title, content)
      values ('eeeeeeee-0000-4000-8000-00000000000f', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Fresh page',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"searchable body"}]}]}'::jsonb) $s$, 1);
select public._hestia_expect_value('G10 the generated search column was computed',
  $s$ select (search_text like '%searchable body%')::text from public.pages where id = 'eeeeeeee-0000-4000-8000-00000000000f' $s$, 'true');
select public._hestia_expect_fail('G11 the parent validation trigger still fires',
  $s$ update public.pages set parent_id = 'eeeeeeee-0000-4000-8000-000000000003' where id = 'eeeeeeee-0000-4000-8000-00000000000f' $s$,
  'same workspace');
-- INSERT is where the owner columns were unguarded: the 0002 policy pins
-- created_by and nothing else, so document_owner_id, updated_by, deleted_at and
-- deleted_by were free-form. The trigger pins them for any caller that has an
-- identity, and the inserts the app performs (G9) are unaffected.
select public._hestia_expect_rows('G9a an editor can insert a page while naming other people in the owner columns',
  $s$ insert into public.pages (id, workspace_id, title, content, document_owner_id, created_by, updated_by, deleted_at, deleted_by)
      values ('eeeeeeee-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Forged page',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"forged"}]}]}'::jsonb,
        '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
        '11111111-1111-4111-8111-111111111111', now(), '11111111-1111-4111-8111-111111111111') $s$, 1);
select public._hestia_expect_value('G9b the inserted page is owned by its author, not the named owner',
  $s$ select document_owner_id::text from public.pages where id = 'eeeeeeee-0000-4000-8000-0000000000aa' $s$,
  '33333333-3333-4333-8333-333333333333');
select public._hestia_expect_value('G9c created_by and updated_by are the author',
  $s$ select created_by::text || ',' || updated_by::text from public.pages
      where id = 'eeeeeeee-0000-4000-8000-0000000000aa' $s$,
  '33333333-3333-4333-8333-333333333333,33333333-3333-4333-8333-333333333333');
select public._hestia_expect_value('G9d a page cannot be inserted already trashed',
  $s$ select coalesce(deleted_at::text, '<null>') || ',' || coalesce(deleted_by::text, '<null>')
      from public.pages where id = 'eeeeeeee-0000-4000-8000-0000000000aa' $s$, '<null>,<null>');
-- the user the insert tried to name as owner has gained nothing
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_fail('G9e the named owner did not become the document owner',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-0000000000aa'::uuid, 'x',
        '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, null) $s$,
  'Only the document owner can save a version');
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select public._hestia_expect_value('G12 the touch trigger still stamps the editor',
  $s$ select updated_by::text from public.pages where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  '33333333-3333-4333-8333-333333333333');

-- a viewer passes the column grant but is stopped by RLS: no error, no rows
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select public._hestia_expect_rows('G13 a viewer reparenting a page affects no rows',
  $s$ update public.pages set parent_id = 'eeeeeeee-0000-4000-8000-000000000002' where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 0);
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_rows('G14 a non-member reparenting a page affects no rows',
  $s$ update public.pages set parent_id = 'eeeeeeee-0000-4000-8000-000000000002' where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 0);
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select public._hestia_expect_rows('G15 another tenant reordering a page affects no rows',
  $s$ update public.pages set position = 9999 where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 0);

reset role;
select public._hestia_expect_value('G16 the page is still parented at the root',
  $s$ select coalesce(parent_id::text, '<null>') from public.pages where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, '<null>');
select public._hestia_expect_value('G17 no direct write changed the document owner',
  $s$ select document_owner_id::text from public.pages where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  '11111111-1111-4111-8111-111111111111');
select public._hestia_expect_value('G18 no direct write changed the content',
  $s$ select public.document_plain_text(content) from public.pages where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 'first');
select public._hestia_expect_value('G19 authenticated has no table-wide update on pages',
  $s$ select has_table_privilege('authenticated', 'public.pages', 'update')::text $s$, 'false');
select public._hestia_expect_value('G20 authenticated may update parent_id',
  $s$ select has_column_privilege('authenticated', 'public.pages', 'parent_id', 'update')::text $s$, 'true');
select public._hestia_expect_value('G21 authenticated may update position',
  $s$ select has_column_privilege('authenticated', 'public.pages', 'position', 'update')::text $s$, 'true');
select public._hestia_expect_value('G22 authenticated may not update content',
  $s$ select has_column_privilege('authenticated', 'public.pages', 'content', 'update')::text $s$, 'false');
select public._hestia_expect_value('G23 authenticated may not update title',
  $s$ select has_column_privilege('authenticated', 'public.pages', 'title', 'update')::text $s$, 'false');
select public._hestia_expect_value('G24 authenticated may not update document_owner_id',
  $s$ select has_column_privilege('authenticated', 'public.pages', 'document_owner_id', 'update')::text $s$, 'false');
select public._hestia_expect_value('G25 the revision reason column grant from 0016 survives',
  $s$ select has_column_privilege('authenticated', 'public.page_revisions', 'reason', 'update')::text $s$, 'true');
-- 0016 added `grant update (reason)` on top of the Supabase default table-wide
-- UPDATE grant, and 0016's policy lets any editor through: until 0019 revoked
-- the table grant, an editor could PATCH a revision's content and rewrite
-- document history.
select public._hestia_expect_value('G26 revision content is still not writable',
  $s$ select has_column_privilege('authenticated', 'public.page_revisions', 'content', 'update')::text $s$, 'false');
select public._hestia_expect_value('G26a revision title is not writable either',
  $s$ select has_column_privilege('authenticated', 'public.page_revisions', 'title', 'update')::text $s$, 'false');
select public._hestia_expect_value('G26b authenticated has no table-wide update on page_revisions',
  $s$ select has_table_privilege('authenticated', 'public.page_revisions', 'update')::text $s$, 'false');
select public._hestia_expect_value('G26c authenticated cannot insert or delete revisions',
  $s$ select (has_table_privilege('authenticated', 'public.page_revisions', 'insert')
              or has_table_privilege('authenticated', 'public.page_revisions', 'delete'))::text $s$, 'false');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_fail('G26d an editor cannot rewrite recorded history',
  $s$ update public.page_revisions set content = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"rewritten"}]}]}'::jsonb
      where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  'permission denied');
select public._hestia_expect_rows('G26e an editor can still fill in a revision reason (0016)',
  $s$ update public.page_revisions set reason = 'because' where page_id = 'eeeeeeee-0000-4000-8000-000000000001' and version = 2 $s$, 1);
select public._hestia_expect_fail('G26f an editor cannot delete a revision',
  $s$ delete from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  'permission denied');
select public._hestia_expect_fail('G26g a client cannot write the live collaboration state directly',
  $s$ update public.page_collaboration set state = 'WFhYWA==' where page_id = 'eeeeeeee-0000-4000-8000-000000000001' $s$,
  'permission denied');
reset role;
select public._hestia_expect_value('G26h recorded content is unchanged',
  $s$ select public.document_plain_text(content) from public.page_revisions
      where page_id = 'eeeeeeee-0000-4000-8000-000000000001' and version = 1 $s$, 'first');

-- ===========================================================================
-- H. Comments: NULL-role soft delete
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_rows('H1 an editor can open a comment thread (trigger path)',
  $s$ insert into public.comment_threads (id, page_id, workspace_id, quote, anchor_from, anchor_to)
      values ('dddddddd-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001',
              'aaaaaaaa-0000-4000-8000-00000000000a', 'first', 1, 6) $s$, 1);
select public._hestia_expect_rows('H2 an editor can comment (notification trigger path)',
  $s$ insert into public.comments (id, thread_id, body)
      values ('dddddddd-0000-4000-8000-00000000000c', 'dddddddd-0000-4000-8000-000000000001', 'why was this changed?') $s$, 1);

select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_fail('H3 a non-member cannot soft delete someone else''s comment',
  $s$ select public.soft_delete_comment('dddddddd-0000-4000-8000-00000000000c'::uuid) $s$,
  'Not allowed to delete this comment');
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select public._hestia_expect_fail('H4 another tenant cannot soft delete this comment',
  $s$ select public.soft_delete_comment('dddddddd-0000-4000-8000-00000000000c'::uuid) $s$,
  'Not allowed to delete this comment');
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select public._hestia_expect_fail('H5 a viewer cannot soft delete someone else''s comment',
  $s$ select public.soft_delete_comment('dddddddd-0000-4000-8000-00000000000c'::uuid) $s$,
  'Not allowed to delete this comment');
reset role;
select public._hestia_expect_value('H6 the comment is still there',
  $s$ select coalesce(deleted_at::text, '<null>') from public.comments where id = 'dddddddd-0000-4000-8000-00000000000c' $s$, '<null>');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select public._hestia_expect_ok('H7 a workspace admin can soft delete a comment',
  $s$ select public.soft_delete_comment('dddddddd-0000-4000-8000-00000000000c'::uuid) $s$);
reset role;
select public._hestia_expect_value('H8 the soft delete is recorded, the row is kept',
  $s$ select deleted_by::text from public.comments where id = 'dddddddd-0000-4000-8000-00000000000c' $s$,
  '22222222-2222-4222-8222-222222222222');
select public._hestia_expect_value('H9 the comment notified the document owner',
  $s$ select count(*)::text from public.notifications
      where comment_id = 'dddddddd-0000-4000-8000-00000000000c'
        and recipient_id = '11111111-1111-4111-8111-111111111111' $s$, '1');

-- The author branch is the one that used to be NULL-safe only by accident:
-- `created_by <> auth.uid() and actor_role not in (…)` is NULL for a caller with
-- no membership row, and NULL is not a raise condition. Cover the whole matrix:
-- an author who is still a member, an author demoted to viewer, and an author
-- who left the workspace entirely.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('H10 owner invites the outsider as an editor',
  $s$ select * from public.invite_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, 'none@hestia.test', 'editor') $s$);

select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_rows('H11 the new editor writes two comments',
  $s$ insert into public.comments (id, thread_id, body) values
      ('dddddddd-0000-4000-8000-00000000000d', 'dddddddd-0000-4000-8000-000000000001', 'mine, deleted while a member'),
      ('dddddddd-0000-4000-8000-00000000000e', 'dddddddd-0000-4000-8000-000000000001', 'mine, deleted after leaving') $s$, 2);
select public._hestia_expect_ok('H12 an author can soft delete their own comment',
  $s$ select public.soft_delete_comment('dddddddd-0000-4000-8000-00000000000d'::uuid) $s$);

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('H13 owner demotes that author to viewer',
  $s$ select public.set_workspace_member_role('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '66666666-6666-4666-8666-666666666666'::uuid, 'viewer') $s$);
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_ok('H14 an author demoted to viewer still manages their own comment',
  $s$ select public.soft_delete_comment('dddddddd-0000-4000-8000-00000000000e'::uuid) $s$);

-- and once they are out of the workspace, not even their own comment answers
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_fail('H15 nobody can un-delete a comment from the client',
  $s$ update public.comments set deleted_at = null, deleted_by = null
      where id = 'dddddddd-0000-4000-8000-00000000000e' $s$,
  'permission denied');
reset role;
-- the UI cannot undelete; do it as the table owner so the next check has a live row
update public.comments set deleted_at = null, deleted_by = null
 where id = 'dddddddd-0000-4000-8000-00000000000e';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('H16 owner removes that author from the workspace',
  $s$ select public.remove_workspace_member('aaaaaaaa-0000-4000-8000-00000000000a'::uuid, '66666666-6666-4666-8666-666666666666'::uuid) $s$);
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_fail('H17 an author who left the workspace cannot delete their own comment',
  $s$ select public.soft_delete_comment('dddddddd-0000-4000-8000-00000000000e'::uuid) $s$,
  'Not allowed to delete this comment');
select public._hestia_expect_fail('H18 …and cannot reach an unrelated comment by id either',
  $s$ select public.soft_delete_comment('dddddddd-0000-4000-8000-00000000000c'::uuid) $s$,
  'Not allowed to delete this comment');
select public._hestia_expect_fail('H19 a comment id that does not exist is reported, not silently accepted',
  $s$ select public.soft_delete_comment('dddddddd-0000-4000-8000-0000000000ff'::uuid) $s$,
  'Comment was not found');
reset role;
select public._hestia_expect_value('H20 the removed author''s comment is still live',
  $s$ select coalesce(deleted_at::text, '<null>') from public.comments
      where id = 'dddddddd-0000-4000-8000-00000000000e' $s$, '<null>');
select public._hestia_expect_value('H21 the member-era soft delete is recorded against its author',
  $s$ select deleted_by::text from public.comments where id = 'dddddddd-0000-4000-8000-00000000000d' $s$,
  '66666666-6666-4666-8666-666666666666');

-- ===========================================================================
-- I. pg_temp shadowing of a SECURITY DEFINER body
-- ===========================================================================
-- Without pg_temp pinned in search_path, Postgres searches the temp schema first
-- for relations, so a client could plant pg_temp.pages and hand itself the
-- document-owner check inside save_page_version.

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

-- The planted row claims the editor owns page one. If a definer body resolved
-- `pages` through pg_temp, the owner checks below would pass.
do $do$
begin
  create temp table pages (
    id uuid,
    workspace_id uuid,
    title text,
    content jsonb,
    deleted_at timestamptz,
    document_owner_id uuid
  );
  insert into pages values (
    'eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'shadow',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"shadow"}]}]}'::jsonb,
    null, '33333333-3333-4333-8333-333333333333');
  perform public._hestia_record('I0 a temp table named pages was planted', true, 'planted');
exception when others then
  perform public._hestia_record('I0 a temp table named pages was planted', true,
    'SKIP: could not create a temp table here — ' || sqlerrm);
end;
$do$;

select public._hestia_expect_fail('I1 a planted pg_temp.pages cannot pass the save_page_version owner check',
  $s$ select public.save_page_version('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'shadowed', '{"type":"doc"}'::jsonb, null) $s$,
  'Only the document owner can save a version');
select public._hestia_expect_fail('I2 a planted pg_temp.pages cannot pass the restore owner check',
  $s$ select public.restore_page_revision('eeeeeeee-0000-4000-8000-000000000001'::uuid,
        (select id from public.page_revisions where page_id = 'eeeeeeee-0000-4000-8000-000000000001' and version = 1), null) $s$,
  'Only the document owner can restore a version');

drop table if exists pg_temp.pages;
reset role;

select public._hestia_expect_value('I3 the shadowing attempt changed nothing',
  $s$ select title from public.pages where id = 'eeeeeeee-0000-4000-8000-000000000001' $s$, 'Page one');
select public._hestia_expect_value('I4 every public security definer function pins pg_temp in search_path',
  $s$ select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
          where cfg like 'search_path=%' and cfg like '%pg_temp%') $s$, 'none');

-- ===========================================================================
-- J. Private Realtime policy for page-v2:<uuid>
-- ===========================================================================

-- topic parsing fails closed
select public._hestia_expect_value('J1 a well formed topic resolves to its page',
  $s$ select public.page_topic_page_id('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$,
  'eeeeeeee-0000-4000-8000-000000000001');
select public._hestia_expect_value('J2 a topic without the page prefix resolves to nothing',
  $s$ select coalesce(public.page_topic_page_id('room:eeeeeeee-0000-4000-8000-000000000001')::text, '<null>') $s$, '<null>');
select public._hestia_expect_value('J3 a malformed uuid resolves to nothing instead of raising',
  $s$ select coalesce(public.page_topic_page_id('page-v2:not-a-uuid')::text, '<null>') $s$, '<null>');
select public._hestia_expect_value('J4 trailing junk resolves to nothing',
  $s$ select coalesce(public.page_topic_page_id('page-v2:eeeeeeee-0000-4000-8000-000000000001 or 1=1')::text, '<null>') $s$, '<null>');
select public._hestia_expect_value('J5 an empty topic resolves to nothing',
  $s$ select coalesce(public.page_topic_page_id('')::text, '<null>') $s$, '<null>');
select public._hestia_expect_value('J6 a null topic resolves to nothing',
  $s$ select coalesce(public.page_topic_page_id(null)::text, '<null>') $s$, '<null>');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public._hestia_expect_fail('J7 an anonymous caller may not receive on a page topic',
  $s$ select public.can_read_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'permission denied for function');
select public._hestia_expect_fail('J8 an anonymous caller may not send on a page topic',
  $s$ select public.can_write_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'permission denied for function');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_value('J9 a non-member may not receive',
  $s$ select public.can_read_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'false');
select public._hestia_expect_value('J10 a non-member may not send',
  $s$ select public.can_write_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'false');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select public._hestia_expect_value('J11 another tenant may not receive',
  $s$ select public.can_read_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'false');
select public._hestia_expect_value('J12 another tenant may not send',
  $s$ select public.can_write_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'false');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select public._hestia_expect_value('J13 a viewer may receive',
  $s$ select public.can_read_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'true');
select public._hestia_expect_value('J14 a viewer may not send',
  $s$ select public.can_write_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'false');

select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_value('J15 an editor may receive',
  $s$ select public.can_read_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'true');
select public._hestia_expect_value('J16 an editor may send',
  $s$ select public.can_write_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'true');
select public._hestia_expect_value('J17 an editor may not send on another tenant''s page',
  $s$ select public.can_write_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000003')::text $s$, 'false');
select public._hestia_expect_value('J18 an unknown page id authorizes nothing',
  $s$ select public.can_read_page_topic('page-v2:eeeeeeee-0000-4000-8000-0000000000ff')::text $s$, 'false');
select public._hestia_expect_value('J19 a malformed topic authorizes nothing',
  $s$ select public.can_read_page_topic('page-v2:*')::text $s$, 'false');

reset role;

-- a removed member loses the channel immediately
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);
select public._hestia_expect_value('J20 a removed member may no longer receive',
  $s$ select public.can_read_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000001')::text $s$, 'false');
reset role;

-- trashed page-v2: members still receive, nobody sends. Trashing goes through the
-- RPC, not a direct update — touch_page would write a NULL updated_by otherwise.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('J21 owner trashes the scratch page again',
  $s$ select public.trash_page('eeeeeeee-0000-4000-8000-000000000009'::uuid) $s$);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_value('J22 a trashed page still delivers to members',
  $s$ select public.can_read_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000009')::text $s$, 'true');
select public._hestia_expect_value('J23 a trashed page accepts no sends',
  $s$ select public.can_write_page_topic('page-v2:eeeeeeee-0000-4000-8000-000000000009')::text $s$, 'false');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('J24 owner restores the scratch page again',
  $s$ select public.restore_page('eeeeeeee-0000-4000-8000-000000000009'::uuid) $s$);
reset role;

-- the policies are actually attached to realtime.messages
do $do$
begin
  if to_regclass('realtime.messages') is null then
    perform public._hestia_record('J25 realtime.messages policies', true,
      'SKIP: realtime.messages does not exist in this database');
    return;
  end if;

  perform public._hestia_record('J25 realtime.messages has RLS enabled',
    (select c.relrowsecurity from pg_class c where c.oid = 'realtime.messages'::regclass),
    'relrowsecurity');

  perform public._hestia_record('J26 the receive policy is attached to realtime.messages',
    exists (select 1 from pg_policies
            where schemaname = 'realtime' and tablename = 'messages'
              and cmd = 'SELECT' and qual like '%can_read_page_topic%'),
    'policy present');

  perform public._hestia_record('J27 the send policy is attached to realtime.messages',
    exists (select 1 from pg_policies
            where schemaname = 'realtime' and tablename = 'messages'
              and cmd = 'INSERT' and with_check like '%can_write_page_topic%'),
    'policy present');

  -- `anon` keeps Supabase's default table grants on realtime.messages (that
  -- schema is not 0019's to re-grant), so the private channel depends on no
  -- policy ever naming anon or PUBLIC.
  perform public._hestia_record('J27a no policy on realtime.messages applies to anon or PUBLIC',
    not exists (select 1 from pg_policies
                where schemaname = 'realtime' and tablename = 'messages'
                  and (roles::text like '%anon%' or roles::text like '%public%')),
    (select coalesce(string_agg(policyname || ' -> ' || roles::text, '; '), 'none') from pg_policies
      where schemaname = 'realtime' and tablename = 'messages'));

  -- a blanket permissive policy from anywhere else would defeat the private channel
  perform public._hestia_record('J28 no blanket permissive policy on realtime.messages',
    not exists (select 1 from pg_policies
                where schemaname = 'realtime' and tablename = 'messages' and permissive = 'PERMISSIVE'
                  and policyname not in ('Hestia members receive page topics', 'Hestia editors send page topics')
                  and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')),
    (select coalesce(string_agg(policyname, ', '), 'none') from pg_policies
      where schemaname = 'realtime' and tablename = 'messages'));
end;
$do$;

-- and they are enforced for real, topic by topic
do $do$
begin
  if to_regclass('realtime.messages') is null
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'realtime' and p.proname = 'topic') then
    perform public._hestia_record('J29 realtime.messages RLS enforcement', true,
      'SKIP: realtime.messages or realtime.topic() is absent');
  end if;
end;
$do$;

select set_config('realtime.topic', 'page-v2:eeeeeeee-0000-4000-8000-000000000001', true);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public._hestia_realtime_insert('J29a an anonymous caller cannot broadcast on the page topic', false);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select public._hestia_realtime_insert('J30 a viewer cannot broadcast on the page topic', false);
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_realtime_insert('J31 a non-member cannot broadcast on the page topic', false);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_realtime_insert('J32 an editor can broadcast on the page topic', true);
reset role;

select set_config('realtime.topic', 'page-v2:eeeeeeee-0000-4000-8000-000000000003', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_realtime_insert('J33 an editor cannot broadcast on another tenant''s page topic', false);
reset role;

select set_config('realtime.topic', '', true);

-- ===========================================================================
-- K. Signup path still works under the hardened function grants
-- ===========================================================================

do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    perform public._hestia_record('K1 signup trigger under the auth role', true,
      'SKIP: supabase_auth_admin does not exist in this database');
    return;
  end if;
  -- `set role` needs membership. A plain `postgres` session in the stock
  -- Supabase image does not have it, and a skip is the honest result — run the
  -- suite as supabase_admin (or a superuser) to actually exercise this path.
  if not pg_has_role(current_user, 'supabase_auth_admin', 'member') then
    perform public._hestia_record('K1 signup trigger under the auth role', true,
      format('SKIP: %s is not a member of supabase_auth_admin; re-run as supabase_admin to cover the signup path', current_user));
    return;
  end if;
  begin
    set local role supabase_auth_admin;
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values ('88888888-8888-4888-8888-888888888888', '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'signup@hestia.test', now(), now());
    reset role;
    perform public._hestia_record('K1 signup trigger under the auth role',
      exists (select 1 from public.profiles where id = '88888888-8888-4888-8888-888888888888'),
      'handle_new_user created the profile');
  exception when others then
    reset role;
    perform public._hestia_record('K1 signup trigger under the auth role', false, 'error: ' || sqlerrm);
  end;
end;
$do$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_rows('K2 a signed-in user can still create a workspace (owner trigger)',
  $s$ insert into public.workspaces (id, name, slug, owner_id)
      values ('cccccccc-0000-4000-8000-00000000000c', 'Fresh workspace', 'fresh-workspace',
              '66666666-6666-4666-8666-666666666666') $s$, 1);
reset role;
select public._hestia_expect_value('K3 the add_workspace_owner trigger still runs',
  $s$ select role from public.workspace_members
      where workspace_id = 'cccccccc-0000-4000-8000-00000000000c' and user_id = '66666666-6666-4666-8666-666666666666' $s$, 'owner');

-- search still works for a member and leaks nothing across tenants
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_value('K4 search finds a page in the caller''s workspace',
  $s$ select count(*)::text from public.search_workspace('searchable body') $s$, '1');
select public._hestia_expect_value('K5 search does not reach another tenant''s page',
  $s$ select count(*)::text from public.search_workspace('b first') $s$, '0');
reset role;

-- ===========================================================================
-- L. Locking structure, and what this file does *not* prove
-- ===========================================================================

-- Every collaboration entry point must take the page_collaboration row lock
-- through the one helper. `insert … on conflict do nothing` followed by a read
-- is the pattern that silently skips a concurrent, uncommitted inserter, so its
-- absence from these bodies is the regression guard.
select public._hestia_expect_value('L1 every collaboration RPC locks through lock_page_collaboration',
  $s$ select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('load_page_collaboration', 'seed_page_collaboration',
                          'append_page_collaboration_update', 'restore_page_revision')
        and p.prosrc not like '%lock_page_collaboration%' $s$, 'none');
select public._hestia_expect_value('L2 no collaboration RPC still uses the skip-without-waiting upsert',
  $s$ select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('load_page_collaboration', 'seed_page_collaboration',
                          'append_page_collaboration_update', 'restore_page_revision')
        and p.prosrc like '%on conflict (page_id) do nothing%' $s$, 'none');
select public._hestia_expect_value('L3 the helper itself takes FOR UPDATE',
  $s$ select (prosrc like '%for update%')::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'lock_page_collaboration' $s$, 'true');
select public._hestia_expect_value('L4 the helper is not reachable by any API role',
  $s$ select (has_function_privilege('authenticated', 'public.lock_page_collaboration(uuid,uuid)', 'execute')
              or has_function_privilege('anon', 'public.lock_page_collaboration(uuid,uuid)', 'execute')
              or has_function_privilege('public', 'public.lock_page_collaboration(uuid,uuid)', 'execute'))::text $s$,
  'false');
-- regression: `on conflict (page_id, generation, operation_id)` parsed
-- operation_id as the plpgsql parameter and failed every append at runtime
select public._hestia_expect_value('L5 append uses the named unique constraint as its conflict target',
  $s$ select (prosrc like '%on constraint page_collaboration_updates_operation_key%')::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'append_page_collaboration_update' $s$, 'true');
-- deleting a user must not be blocked by, or cascade through, document deltas
select public._hestia_expect_value('L6 the log author FK is ON DELETE SET NULL',
  $s$ select confdeltype from pg_constraint
      where conrelid = 'public.page_collaboration_updates'::regclass and contype = 'f'
        and confrelid = 'auth.users'::regclass $s$, 'n');

-- role revocation and trashing, on the collaboration path specifically
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select public._hestia_expect_fail('L7 a member removed mid-session cannot append',
  $s$ select * from public.append_page_collaboration_update(
        'eeeeeeee-0000-4000-8000-000000000001'::uuid, 2, gen_random_uuid(), 'AAAA') $s$,
  'Not allowed to collaborate on this page');
select public._hestia_expect_fail('L8 a member removed mid-session cannot load',
  $s$ select * from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000001'::uuid) $s$,
  'Not allowed to read this page');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_ok('L9 owner trashes the scratch page once more',
  $s$ select public.trash_page('eeeeeeee-0000-4000-8000-000000000009'::uuid) $s$);
select public._hestia_expect_fail('L10 a trashed page cannot be loaded for collaboration',
  $s$ select * from public.load_page_collaboration('eeeeeeee-0000-4000-8000-000000000009'::uuid) $s$,
  'Not allowed to read this page');
select public._hestia_expect_fail('L11 a trashed page cannot be seeded',
  $s$ select * from public.seed_page_collaboration('eeeeeeee-0000-4000-8000-000000000009'::uuid, 'U0VFRA==', null) $s$,
  'Not allowed to collaborate on this page');
select public._hestia_expect_ok('L12 owner restores the scratch page once more',
  $s$ select public.restore_page('eeeeeeee-0000-4000-8000-000000000009'::uuid) $s$);
reset role;

-- Honest boundaries of this file. Everything above runs in ONE transaction, so
-- it cannot observe two sessions interleaving: a single-session test can show
-- that an append after a committed restore is fenced (F11), but it cannot show
-- that an append *concurrent* with a restore is. Those properties are proved in
-- supabase/tests/system_integrity_concurrency.sql, which needs two real
-- connections; they are recorded here as skips, not as passes.
select public._hestia_record('L13 concurrent seed race', true,
  'SKIP: needs two sessions — see supabase/tests/system_integrity_concurrency.sql (C1-C3)');
select public._hestia_record('L14 append racing a restore', true,
  'SKIP: needs two sessions — see supabase/tests/system_integrity_concurrency.sql (C6-C8)');
select public._hestia_record('L15 load racing a restore', true,
  'SKIP: needs two sessions — see supabase/tests/system_integrity_concurrency.sql (C9-C11)');
select public._hestia_record('L16 Realtime service behaviour', true,
  'SKIP: J25-J33 assert SQL policy and RLS on realtime.messages only. Whether the Realtime server applies them to a private channel, and whether presence/broadcast reach the right subscribers, is not covered by any SQL test.');
select public._hestia_record('L17 Yjs convergence', true,
  'SKIP: SQL stores opaque base64 and never merges it. That seed+log replays to the right document is a client-side property, proved in the collaboration worker''s tests, not here.');

-- ===========================================================================
-- Report
-- ===========================================================================

select
  case when detail like 'SKIP%' then 'SKIP' when ok then 'pass' else 'FAIL' end as result,
  name,
  detail
from public._hestia_check
order by at, name;

do $do$
declare
  total integer;
  failed integer;
  skipped integer;
  row record;
begin
  for row in select * from public._hestia_check where not ok order by at, name loop
    raise notice 'FAIL  % — %', row.name, row.detail;
  end loop;
  for row in select * from public._hestia_check where ok and detail like 'SKIP%' order by at, name loop
    raise notice '%', 'SKIP  ' || row.name || ' — ' || row.detail;
  end loop;
  select count(*) into total from public._hestia_check;
  select count(*) into failed from public._hestia_check where not ok;
  select count(*) into skipped from public._hestia_check where ok and detail like 'SKIP%';
  raise notice '0019 system integrity: % checks, % failed, % skipped', total, failed, skipped;
  if failed > 0 then
    raise exception '% of % system integrity checks failed', failed, total;
  end if;
end;
$do$;

rollback;

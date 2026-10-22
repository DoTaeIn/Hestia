-- Integration tests for 0025_session_security_audit.sql.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/session_security_audit.sql
--
-- Disposable local database only (needs auth.mfa_factors from a real Supabase
-- auth schema). One transaction, ends with ROLLBACK. Role simulation matches
-- supabase/tests/custom_roles.sql: `set local role authenticated` +
-- `request.jwt.claims`, run here as supabase_admin so SET LOCAL can switch role.

begin;

set local client_min_messages = notice;

create table public._hestia_sa_check (
  at timestamptz not null default clock_timestamp(),
  name text not null,
  ok boolean not null,
  detail text
);
grant insert, select on table public._hestia_sa_check to public;

create function public._hestia_sa_record(check_name text, ok boolean, detail text) returns void
language sql as $fn$
  insert into public._hestia_sa_check(name, ok, detail) values (check_name, ok, detail);
$fn$;

create function public._hestia_sa_fail(check_name text, stmt text, expect text) returns void
language plpgsql as $fn$
declare err text;
begin
  begin
    execute stmt;
  exception when others then
    err := sqlerrm;
  end;
  if err is null then
    perform public._hestia_sa_record(check_name, false, 'statement unexpectedly SUCCEEDED');
  else
    perform public._hestia_sa_record(check_name, err ilike '%' || expect || '%', 'error: ' || err);
  end if;
end;
$fn$;

create function public._hestia_sa_ok(check_name text, stmt text) returns void
language plpgsql as $fn$
begin
  begin
    execute stmt;
  exception when others then
    perform public._hestia_sa_record(check_name, false, 'error: ' || sqlerrm);
    return;
  end;
  perform public._hestia_sa_record(check_name, true, 'ok');
end;
$fn$;

create function public._hestia_sa_value(check_name text, stmt text, expected text) returns void
language plpgsql as $fn$
declare got text;
begin
  begin
    execute stmt into got;
  exception when others then
    perform public._hestia_sa_record(check_name, false, 'error: ' || sqlerrm);
    return;
  end;
  perform public._hestia_sa_record(check_name, coalesce(got, '<null>') = expected,
    'got ' || coalesce(got, '<null>') || ', expected ' || expected);
end;
$fn$;

grant execute on function
  public._hestia_sa_record(text, boolean, text),
  public._hestia_sa_fail(text, text, text),
  public._hestia_sa_ok(text, text),
  public._hestia_sa_value(text, text, text)
to public;

-- ===========================================================================
-- Fixture
-- ===========================================================================
-- u1 owner of ws-a, TOTP-enrolled+verified (requires aal2).
-- u2 admin of ws-a, no MFA factor (aal1 is sufficient).
-- u3 viewer of ws-a, no MFA factor, no members.manage.
-- u4 not a member of ws-a at all.
-- u5 owner of ws-b, an unrelated workspace.

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000025-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-owner@hestia.test', now(), now()),
  ('00000025-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-admin@hestia.test', now(), now()),
  ('00000025-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-viewer@hestia.test', now(), now()),
  ('00000025-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-outsider@hestia.test', now(), now()),
  ('00000025-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-other@hestia.test', now(), now());

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values
  ('00000025-f000-4000-8000-000000000001', '00000025-0000-4000-8000-000000000001', 'Authenticator', 'totp', 'verified', 'JBSWY3DPEHPK3PXP', now(), now());

insert into public.workspaces (id, name, slug, owner_id) values
  ('00000025-a000-4000-8000-00000000000a', 'SA Tenant', 'sa-tenant', '00000025-0000-4000-8000-000000000001'),
  ('00000025-a000-4000-8000-00000000000b', 'SA Other Tenant', 'sa-other-tenant', '00000025-0000-4000-8000-000000000005');

-- the add_workspace_owner trigger inserts the owner membership (and fires
-- the member.added trigger under the migration-runner's own auth.uid(), i.e. null)
insert into public.workspace_members (workspace_id, user_id, role) values
  ('00000025-a000-4000-8000-00000000000a', '00000025-0000-4000-8000-000000000002', 'admin'),
  ('00000025-a000-4000-8000-00000000000a', '00000025-0000-4000-8000-000000000003', 'viewer');

-- ===========================================================================
-- 1. session_is_allowed() — aal2 required only for the enrolled user
-- ===========================================================================

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public._hestia_sa_value('1.1 enrolled owner at aal1 (no aal claim) is not allowed',
  $s$ select public.session_is_allowed()::text $s$, 'false');

select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select public._hestia_sa_value('1.2 enrolled owner explicit aal1 is not allowed',
  $s$ select public.session_is_allowed()::text $s$, 'false');
select public._hestia_sa_value('8.1 aal1 cannot enumerate a real shared-membership relationship',
 $s$ select public.shares_workspace_with('00000025-0000-4000-8000-000000000002')::text $s$, 'false');

select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select public._hestia_sa_value('1.3 enrolled owner at aal2 is allowed',
  $s$ select public.session_is_allowed()::text $s$, 'true');
select public._hestia_sa_value('8.2 aal2 can query the same shared-membership relationship',
 $s$ select public.shares_workspace_with('00000025-0000-4000-8000-000000000002')::text $s$, 'true');

select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public._hestia_sa_value('1.4 non-enrolled admin at aal1 is allowed',
  $s$ select public.session_is_allowed()::text $s$, 'true');

reset role;

-- anon / unauthenticated
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public._hestia_sa_fail('1.5 anon cannot even call session_is_allowed',
  $s$ select public.session_is_allowed() $s$, 'permission denied for function');
reset role;

-- ===========================================================================
-- 2. Raw RLS reads cannot bypass MFA even without any app guard
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public._hestia_sa_value('2.1 downgraded owner reads zero rows from workspace_members directly',
  $s$ select count(*)::text from public.workspace_members where workspace_id = '00000025-a000-4000-8000-00000000000a' $s$, '0');
select public._hestia_sa_value('2.2 downgraded owner reads zero rows from workspaces directly',
  $s$ select count(*)::text from public.workspaces where id = '00000025-a000-4000-8000-00000000000a' $s$, '0');

select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select public._hestia_sa_value('2.3 owner at aal2 reads workspace_members normally',
  $s$ select count(*)::text from public.workspace_members where workspace_id = '00000025-a000-4000-8000-00000000000a' $s$, '3');
reset role;

-- ===========================================================================
-- 3. Owner CRUD (create/update/delete_workspace_role) and mark_notifications_read
--    are blocked under a downgraded session, allowed under aal2 / non-enrolled
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public._hestia_sa_fail('3.1 downgraded owner cannot create a custom role',
  $s$ select public.create_workspace_role('00000025-a000-4000-8000-00000000000a'::uuid, 'Writer', array['pages.write']) $s$,
  'Authentication assurance required');
select public._hestia_sa_fail('3.2 downgraded owner cannot call mark_notifications_read',
  $s$ select public.mark_notifications_read() $s$,
  'Authentication assurance required');

select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select public._hestia_sa_ok('3.3 owner at aal2 creates a custom role',
  $s$ select public.create_workspace_role('00000025-a000-4000-8000-00000000000a'::uuid, 'Writer', array['pages.write']) $s$);
select public._hestia_sa_ok('3.4 owner at aal2 calls mark_notifications_read',
  $s$ select public.mark_notifications_read() $s$);

select public._hestia_sa_ok('3.5 owner at aal2 updates the custom role',
  $s$ select public.update_workspace_role('00000025-a000-4000-8000-00000000000a'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000025-a000-4000-8000-00000000000a' and name = 'Writer'),
        'Writer', array['pages.write']) $s$);
select public._hestia_sa_ok('3.6 owner at aal2 deletes the custom role',
  $s$ select public.delete_workspace_role('00000025-a000-4000-8000-00000000000a'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000025-a000-4000-8000-00000000000a' and name = 'Writer')) $s$);

select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public._hestia_sa_value('3.7 the non-enrolled admin still has members.manage at aal1',
  $s$ select public.has_workspace_permission('00000025-a000-4000-8000-00000000000a'::uuid, 'members.manage')::text $s$, 'true');
reset role;

-- ===========================================================================
-- 4. workspace_security_events — writes happen, forged writes are denied
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000002","role":"authenticated"}', true);

select public._hestia_sa_ok('4.1 admin promotes outsider u4 into the workspace (member.added)',
  $s$ select * from public.invite_workspace_member('00000025-a000-4000-8000-00000000000a'::uuid, 'sa-outsider@hestia.test', 'editor') $s$);
select public._hestia_sa_value('4.2 a member.added event was logged with the right actor/subject',
  $s$ select actor_id::text || ':' || subject_user_id::text
      from public.workspace_security_events
      where workspace_id = '00000025-a000-4000-8000-00000000000a' and action = 'member.added' and subject_user_id = '00000025-0000-4000-8000-000000000004'
      order by created_at desc limit 1 $s$,
  '00000025-0000-4000-8000-000000000002:00000025-0000-4000-8000-000000000004');

select public._hestia_sa_ok('4.3 admin changes u4''s role to viewer (member.role_changed)',
  $s$ select public.set_workspace_member_role('00000025-a000-4000-8000-00000000000a'::uuid,
        '00000025-0000-4000-8000-000000000004'::uuid, 'viewer') $s$);
select public._hestia_sa_value('4.4 the role_changed event recorded old and new roles',
  $s$ select (detail -> 'old' ->> 'role') || '->' || (detail -> 'new' ->> 'role')
      from public.workspace_security_events
      where workspace_id = '00000025-a000-4000-8000-00000000000a' and action = 'member.role_changed'
      order by created_at desc limit 1 $s$,
  'editor->viewer');

select set_config('hestia.test_role_changed_count',
  (select count(*)::text from public.workspace_security_events where action = 'member.role_changed'), true);
select public._hestia_sa_ok('4.5a admin reassigns u3 the role it already has (no-op)',
  $s$ select public.set_workspace_member_role('00000025-a000-4000-8000-00000000000a'::uuid,
        '00000025-0000-4000-8000-000000000003'::uuid, 'viewer') $s$);
select public._hestia_sa_value('4.5b the no-op role update logged no new event',
  $s$ select count(*)::text from public.workspace_security_events where action = 'member.role_changed' $s$,
  current_setting('hestia.test_role_changed_count'));

select public._hestia_sa_ok('4.6 admin removes u4 (member.removed)',
  $s$ select public.remove_workspace_member('00000025-a000-4000-8000-00000000000a'::uuid, '00000025-0000-4000-8000-000000000004'::uuid) $s$);
select public._hestia_sa_value('4.7 a member.removed event was logged',
  $s$ select count(*)::text from public.workspace_security_events
      where workspace_id = '00000025-a000-4000-8000-00000000000a' and action = 'member.removed'
        and subject_user_id = '00000025-0000-4000-8000-000000000004' $s$, '1');

select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select public._hestia_sa_ok('4.8 owner creates a role (role.created)',
  $s$ select public.create_workspace_role('00000025-a000-4000-8000-00000000000a'::uuid, 'Auditor', array['pages.write']) $s$);
select public._hestia_sa_ok('4.9 owner updates the role (role.updated)',
  $s$ select public.update_workspace_role('00000025-a000-4000-8000-00000000000a'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000025-a000-4000-8000-00000000000a' and name = 'Auditor'),
        'Auditor2', array['pages.write']) $s$);
select public._hestia_sa_ok('4.10 owner deletes the role (role.deleted)',
  $s$ select public.delete_workspace_role('00000025-a000-4000-8000-00000000000a'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000025-a000-4000-8000-00000000000a' and name = 'Auditor2')) $s$);
select public._hestia_sa_value('4.11 role.created/updated/deleted were all logged for this workspace',
  $s$ select count(distinct action)::text from public.workspace_security_events
      where workspace_id = '00000025-a000-4000-8000-00000000000a'
        and action in ('role.created', 'role.updated', 'role.deleted') $s$, '3');

-- forged direct writes, even by the owner at aal2
select public._hestia_sa_fail('4.12 even the owner cannot INSERT a forged event directly',
  $s$ insert into public.workspace_security_events (workspace_id, actor_id, subject_user_id, action)
      values ('00000025-a000-4000-8000-00000000000a', auth.uid(), auth.uid(), 'member.added') $s$,
  'permission denied');
select public._hestia_sa_fail('4.13 even the owner cannot UPDATE an event directly',
  $s$ update public.workspace_security_events set action = 'member.removed'
      where workspace_id = '00000025-a000-4000-8000-00000000000a' $s$,
  'permission denied');
select public._hestia_sa_fail('4.14 even the owner cannot DELETE an event directly',
  $s$ delete from public.workspace_security_events where workspace_id = '00000025-a000-4000-8000-00000000000a' $s$,
  'permission denied');

reset role;

-- ===========================================================================
-- 5. Read scope — managers of the workspace only, nobody else
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select public._hestia_sa_value('5.1 the owner (members.manage) sees a non-zero number of events',
  $s$ select (count(*) > 0)::text from public.workspace_security_events where workspace_id = '00000025-a000-4000-8000-00000000000a' $s$, 'true');

select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000003","role":"authenticated"}', true);
select public._hestia_sa_value('5.2 a plain viewer (no members.manage) sees none of this workspace''s events',
  $s$ select count(*)::text from public.workspace_security_events where workspace_id = '00000025-a000-4000-8000-00000000000a' $s$, '0');

select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000005","role":"authenticated"}', true);
select public._hestia_sa_value('5.3 a different workspace''s owner sees none of this workspace''s events',
  $s$ select count(*)::text from public.workspace_security_events where workspace_id = '00000025-a000-4000-8000-00000000000a' $s$, '0');

reset role;

-- ===========================================================================
-- 6. Retention cleanup — service_role / admin only, cutoff validated
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000025-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select public._hestia_sa_fail('6.1 an authenticated owner cannot call prune_workspace_security_events',
  $s$ select public.prune_workspace_security_events(now() - interval '60 days') $s$,
  'permission denied for function');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public._hestia_sa_fail('6.2 anon cannot call prune_workspace_security_events',
  $s$ select public.prune_workspace_security_events(now() - interval '60 days') $s$,
  'permission denied for function');
reset role;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'set local role service_role';
    perform public._hestia_sa_fail('6.3 service_role rejects a cutoff newer than 30 days',
      $s$ select public.prune_workspace_security_events(now() - interval '1 day') $s$,
      'at least 30 days');
    perform public._hestia_sa_ok('6.4 service_role prunes with a valid cutoff',
      $s$ select public.prune_workspace_security_events(now() - interval '60 days') $s$);
    reset role;
  else
    perform public._hestia_sa_record('6.3/6.4 skipped: no service_role on this database', true, 'skipped');
  end if;
end;
$do$;

-- ===========================================================================
-- 7. Deleting a user does not break history; a workspace cascade does clear it
-- ===========================================================================

select public._hestia_sa_value('7.1 u2 still has logged events as actor before deletion',
  $s$ select (count(*) > 0)::text from public.workspace_security_events where actor_id = '00000025-0000-4000-8000-000000000002' $s$, 'true');

select public._hestia_sa_ok('7.2 deleting the actor''s auth.users row succeeds (no FK on actor_id)',
  $s$ delete from auth.users where id = '00000025-0000-4000-8000-000000000002' $s$);

select public._hestia_sa_value('7.3 the actor''s prior events are untouched after the user is gone',
  $s$ select (count(*) > 0)::text from public.workspace_security_events where actor_id = '00000025-0000-4000-8000-000000000002' $s$, 'true');

select public._hestia_sa_ok('7.4 deleting the workspace cascades its events away',
  $s$ delete from public.workspaces where id = '00000025-a000-4000-8000-00000000000a' $s$);
select public._hestia_sa_value('7.5 no events remain for the deleted workspace',
  $s$ select count(*)::text from public.workspace_security_events where workspace_id = '00000025-a000-4000-8000-00000000000a' $s$, '0');

-- ===========================================================================
-- Report
-- ===========================================================================

select
  case when ok then 'pass' else 'FAIL' end as result, name, detail
from public._hestia_sa_check
order by at, name;

do $do$
declare
  total integer;
  failed integer;
  row record;
begin
  for row in select * from public._hestia_sa_check where not ok order by at, name loop
    raise notice 'FAIL  % — %', row.name, row.detail;
  end loop;
  select count(*) into total from public._hestia_sa_check;
  select count(*) into failed from public._hestia_sa_check where not ok;
  raise notice '0025 session security audit: % checks, % failed', total, failed;
  if total = 0 then
    raise exception 'no session security audit checks ran at all';
  end if;
  if failed > 0 then
    raise exception '% of % session security audit checks failed', failed, total;
  end if;
end;
$do$;

rollback;

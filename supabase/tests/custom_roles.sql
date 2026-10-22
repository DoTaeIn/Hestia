-- Integration tests for 0024_custom_roles.sql.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/custom_roles.sql
--
-- Disposable local database only. One transaction, ends with ROLLBACK. Role
-- simulation matches supabase/tests/system_integrity.sql: `set local role
-- authenticated` + `request.jwt.claims` is what PostgREST does per request,
-- run here as supabase_admin so the SET LOCAL can actually change role.

begin;

set local client_min_messages = notice;

create table public._hestia_rc_check (
  at timestamptz not null default clock_timestamp(),
  name text not null,
  ok boolean not null,
  detail text
);
grant insert, select on table public._hestia_rc_check to public;

create function public._hestia_rc_record(check_name text, ok boolean, detail text) returns void
language sql as $fn$
  insert into public._hestia_rc_check(name, ok, detail) values (check_name, ok, detail);
$fn$;

create function public._hestia_rc_fail(check_name text, stmt text, expect text) returns void
language plpgsql as $fn$
declare err text;
begin
  begin
    execute stmt;
  exception when others then
    err := sqlerrm;
  end;
  if err is null then
    perform public._hestia_rc_record(check_name, false, 'statement unexpectedly SUCCEEDED');
  else
    perform public._hestia_rc_record(check_name, err ilike '%' || expect || '%', 'error: ' || err);
  end if;
end;
$fn$;

create function public._hestia_rc_ok(check_name text, stmt text) returns void
language plpgsql as $fn$
begin
  begin
    execute stmt;
  exception when others then
    perform public._hestia_rc_record(check_name, false, 'error: ' || sqlerrm);
    return;
  end;
  perform public._hestia_rc_record(check_name, true, 'ok');
end;
$fn$;

create function public._hestia_rc_value(check_name text, stmt text, expected text) returns void
language plpgsql as $fn$
declare got text;
begin
  begin
    execute stmt into got;
  exception when others then
    perform public._hestia_rc_record(check_name, false, 'error: ' || sqlerrm);
    return;
  end;
  perform public._hestia_rc_record(check_name, coalesce(got, '<null>') = expected,
    'got ' || coalesce(got, '<null>') || ', expected ' || expected);
end;
$fn$;

grant execute on function
  public._hestia_rc_record(text, boolean, text),
  public._hestia_rc_fail(text, text, text),
  public._hestia_rc_ok(text, text),
  public._hestia_rc_value(text, text, text)
to public;

-- ===========================================================================
-- Fixture
-- ===========================================================================
-- u1 owner, u2 admin, u3 editor, u4 viewer, u5 other-tenant owner, u6 none,
-- u7/u8/u9 plain viewers promoted to custom roles during the run.

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('00000024-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-owner@hestia.test', now(), now()),
  ('00000024-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-admin@hestia.test', now(), now()),
  ('00000024-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-editor@hestia.test', now(), now()),
  ('00000024-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-viewer@hestia.test', now(), now()),
  ('00000024-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-other@hestia.test', now(), now()),
  ('00000024-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-none@hestia.test', now(), now()),
  ('00000024-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-u7@hestia.test', now(), now()),
  ('00000024-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-u8@hestia.test', now(), now()),
  ('00000024-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-u9@hestia.test', now(), now());

-- the add_workspace_owner trigger inserts the owner membership
insert into public.workspaces (id, name, slug, owner_id) values
  ('00000024-a000-4000-8000-00000000000a', 'RC Tenant', 'rc-tenant', '00000024-0000-4000-8000-000000000001'),
  ('00000024-a000-4000-8000-00000000000b', 'RC Other Tenant', 'rc-other-tenant', '00000024-0000-4000-8000-000000000005');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('00000024-a000-4000-8000-00000000000a', '00000024-0000-4000-8000-000000000002', 'admin'),
  ('00000024-a000-4000-8000-00000000000a', '00000024-0000-4000-8000-000000000003', 'editor'),
  ('00000024-a000-4000-8000-00000000000a', '00000024-0000-4000-8000-000000000004', 'viewer'),
  ('00000024-a000-4000-8000-00000000000a', '00000024-0000-4000-8000-000000000007', 'viewer'),
  ('00000024-a000-4000-8000-00000000000a', '00000024-0000-4000-8000-000000000008', 'viewer'),
  ('00000024-a000-4000-8000-00000000000a', '00000024-0000-4000-8000-000000000009', 'viewer');

-- ===========================================================================
-- 1. create/update/delete — owner only
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public._hestia_rc_ok('1.1 owner creates a pages.write role',
  $s$ select public.create_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid, 'Writer', array['pages.write']) $s$);
select public._hestia_rc_ok('1.2 owner creates a members.manage role',
  $s$ select public.create_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid, 'Manager', array['members.manage']) $s$);

select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public._hestia_rc_fail('1.3 a baseline admin cannot create a role',
  $s$ select public.create_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid, 'Rogue', array['pages.write']) $s$,
  'Only an owner');

select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public._hestia_rc_fail('1.4 duplicate role name in the same workspace is rejected',
  $s$ select public.create_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid, 'Writer', array['pages.write']) $s$,
  'duplicate key');
select public._hestia_rc_fail('1.5 an unknown permission key is rejected',
  $s$ select public.create_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid, 'Bogus', array['pages.delete']) $s$,
  'Invalid role permissions');

select public._hestia_rc_ok('1.6 owner renames a role',
  $s$ select public.update_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Writer'),
        'Writer', array['pages.write']) $s$);

select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public._hestia_rc_fail('1.7 a baseline admin cannot update a role',
  $s$ select public.update_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Writer'),
        'Hijacked', array['members.manage']) $s$,
  'Only an owner');

reset role;

-- ===========================================================================
-- 2. assign_workspace_role — members.manage holders, protected targets
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public._hestia_rc_ok('2.1 owner assigns the write-only role to u7',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000007'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Writer')) $s$);
select public._hestia_rc_ok('2.2 owner assigns the manage-only role to u8',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000008'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Manager')) $s$);

reset role;

select public._hestia_rc_value('2.3 u7 keeps baseline role viewer under its custom role',
  $s$ select role from public.workspace_members where workspace_id = '00000024-a000-4000-8000-00000000000a' and user_id = '00000024-0000-4000-8000-000000000007' $s$,
  'viewer');
select public._hestia_rc_value('2.3a u7''s custom_role_id points at the Writer role',
  $s$ select (custom_role_id = (select id from public.workspace_roles
        where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Writer'))::text
      from public.workspace_members
      where workspace_id = '00000024-a000-4000-8000-00000000000a' and user_id = '00000024-0000-4000-8000-000000000007' $s$,
  'true');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000007","role":"authenticated"}', true);
select public._hestia_rc_value('2.5 u7 (write-only) has pages.write',
  $s$ select public.has_workspace_permission('00000024-a000-4000-8000-00000000000a'::uuid, 'pages.write')::text $s$, 'true');
select public._hestia_rc_value('2.6 u7 (write-only) does NOT have members.manage',
  $s$ select public.has_workspace_permission('00000024-a000-4000-8000-00000000000a'::uuid, 'members.manage')::text $s$, 'false');

select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000008","role":"authenticated"}', true);
select public._hestia_rc_value('2.7 u8 (manage-only) has members.manage',
  $s$ select public.has_workspace_permission('00000024-a000-4000-8000-00000000000a'::uuid, 'members.manage')::text $s$, 'true');
select public._hestia_rc_value('2.8 manager permission does NOT imply pages.write',
  $s$ select public.has_workspace_permission('00000024-a000-4000-8000-00000000000a'::uuid, 'pages.write')::text $s$, 'false');

-- a plain viewer has neither
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000004","role":"authenticated"}', true);
select public._hestia_rc_fail('2.9 a plain viewer cannot assign roles (no members.manage)',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000009'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Writer')) $s$,
  'Not allowed to manage workspace members');

-- custom manager (u8) can assign roles
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000008","role":"authenticated"}', true);
select public._hestia_rc_ok('2.10 the custom manager (members.manage, no pages.write) can assign a role',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000009'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Writer')) $s$);

-- outsider: not a member at all
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000005","role":"authenticated"}', true);
select public._hestia_rc_fail('2.11 a non-member (even a workspace owner elsewhere) cannot assign roles here',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000009'::uuid,
        gen_random_uuid()) $s$,
  'Not allowed to manage workspace members');

-- Fetch the other tenant's real role id as its owner, then test a forged request.
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000005","role":"authenticated"}', true);
select public._hestia_rc_ok('2.12 owner creates a role in the other tenant (fixture for the cross-tenant check)',
  $s$ select public.create_workspace_role('00000024-a000-4000-8000-00000000000b'::uuid, 'OtherWriter', array['pages.write']) $s$);
select set_config('hestia.test_other_role', (select id::text from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000b' and name = 'OtherWriter'), true);
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public._hestia_rc_fail('2.13 a role from a different workspace cannot be assigned here (forged cross-tenant id)',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000009'::uuid,
        current_setting('hestia.test_other_role')::uuid) $s$,
  'Custom role was not found');

-- owner is immutable
select public._hestia_rc_fail('2.14 the workspace owner''s own role cannot be reassigned',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000001'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Writer')) $s$,
  'cannot be changed');

-- owner promotes u9 to a second baseline admin, as a fixture for 2.15
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public._hestia_rc_ok('2.14a owner promotes u9 to baseline admin (fixture)',
  $s$ select public.set_workspace_member_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000009'::uuid, 'admin') $s$);

-- admin (baseline members.manage, not owner) cannot touch another baseline
-- admin, cannot touch an existing manager, and cannot hand out a manage-granting role
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public._hestia_rc_fail('2.15 a non-owner admin cannot assign a role to another baseline admin',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000009'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Writer')) $s$,
  'Not allowed to manage this workspace member');
select public._hestia_rc_fail('2.16 a non-owner admin cannot reassign the existing manager (u8)',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000008'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Writer')) $s$,
  'Not allowed to manage this workspace member');
select public._hestia_rc_fail('2.17 a non-owner admin cannot assign a role that itself grants members.manage',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000004'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Manager')) $s$,
  'Not allowed to assign a role that manages members');
select public._hestia_rc_fail('2.18 a non-owner admin cannot downgrade the existing manager via invite',
  $s$ select * from public.invite_workspace_member('00000024-a000-4000-8000-00000000000a'::uuid, 'rc-u8@hestia.test', 'viewer') $s$,
  'Not allowed to manage this workspace member');

reset role;

-- ===========================================================================
-- 3. Real document edits under a custom role, and losing them on reassignment
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000007","role":"authenticated"}', true);

select public._hestia_rc_value('3.1 can_edit_workspace follows pages.write for the custom editor',
  $s$ select public.can_edit_workspace('00000024-a000-4000-8000-00000000000a'::uuid)::text $s$, 'true');
select public._hestia_rc_ok('3.2 the custom editor (write-only) can actually insert a page',
  $s$ insert into public.pages (id, workspace_id, title) values
      ('00000024-c000-4000-8000-000000000001', '00000024-a000-4000-8000-00000000000a', 'Written by a custom role') $s$);

select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000008","role":"authenticated"}', true);
select public._hestia_rc_fail('3.3 the custom manager (manage-only) cannot insert a page',
  $s$ insert into public.pages (id, workspace_id, title) values
      ('00000024-c000-4000-8000-000000000002', '00000024-a000-4000-8000-00000000000a', 'Blocked manager write') $s$,
  'row-level security');

reset role;

-- owner clears u7's custom role by reassigning the baseline role directly
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public._hestia_rc_ok('3.4 owner clears u7''s custom role via set_workspace_member_role',
  $s$ select public.set_workspace_member_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000007'::uuid, 'viewer') $s$);

select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000007","role":"authenticated"}', true);
select public._hestia_rc_value('3.5 the role change removed pages.write',
  $s$ select public.can_edit_workspace('00000024-a000-4000-8000-00000000000a'::uuid)::text $s$, 'false');
select public._hestia_rc_fail('3.6 u7 can no longer insert a page after the reassignment',
  $s$ insert into public.pages (id, workspace_id, title) values
      ('00000024-c000-4000-8000-000000000003', '00000024-a000-4000-8000-00000000000a', 'Should fail now') $s$,
  'row-level security');

reset role;

select public._hestia_rc_value('3.7 u7''s custom_role_id was actually cleared, not just its baseline role',
  $s$ select coalesce(custom_role_id::text, '<null>') from public.workspace_members
      where workspace_id = '00000024-a000-4000-8000-00000000000a' and user_id = '00000024-0000-4000-8000-000000000007' $s$,
  '<null>');

-- ===========================================================================
-- 4. delete_workspace_role — assigned roles are protected
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public._hestia_rc_fail('4.1 an assigned role cannot be deleted',
  $s$ select public.delete_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Manager')) $s$,
  'assigned to a member');

select public._hestia_rc_ok('4.2 owner creates a throwaway role',
  $s$ select public.create_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid, 'Throwaway', array['pages.write']) $s$);
select public._hestia_rc_ok('4.3 an unassigned role can be deleted',
  $s$ select public.delete_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        (select id from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' and name = 'Throwaway')) $s$);

reset role;

-- ===========================================================================
-- 5. list_workspace_members — membership-gated, no emails
-- ===========================================================================

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000005","role":"authenticated"}', true);
select public._hestia_rc_fail('5.1 a non-member cannot list this workspace''s members',
  $s$ select * from public.list_workspace_members('00000024-a000-4000-8000-00000000000a'::uuid) $s$,
  'Not allowed to view');

select set_config('request.jwt.claims', '{"sub":"00000024-0000-4000-8000-000000000004","role":"authenticated"}', true);
select public._hestia_rc_value('5.2 any member, including a plain viewer, can list members',
  $s$ select count(*)::text from public.list_workspace_members('00000024-a000-4000-8000-00000000000a'::uuid) $s$, '7');
select public._hestia_rc_fail('5.3 the listing has no email column to select at all',
  $s$ select email from public.list_workspace_members('00000024-a000-4000-8000-00000000000a'::uuid) $s$,
  'column "email" does not exist');

reset role;

-- ===========================================================================
-- 6. Anonymous and null-auth callers are stopped outright
-- ===========================================================================

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public._hestia_rc_fail('6.1 anon cannot call create_workspace_role',
  $s$ select public.create_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid, 'Anon', array['pages.write']) $s$,
  'permission denied for function');
select public._hestia_rc_fail('6.2 anon cannot call assign_workspace_role',
  $s$ select public.assign_workspace_role('00000024-a000-4000-8000-00000000000a'::uuid,
        '00000024-0000-4000-8000-000000000009'::uuid, '00000000-0000-4000-8000-000000000000'::uuid) $s$,
  'permission denied for function');
select public._hestia_rc_fail('6.3 anon cannot read workspace_roles',
  $s$ select count(*) from public.workspace_roles $s$, 'permission denied');

reset role;

-- ===========================================================================
-- 7. The owner's own row is untouched by any of the above
-- ===========================================================================

select public._hestia_rc_value('7.1 the workspace owner is still owner with no custom role',
  $s$ select role || ':' || coalesce(custom_role_id::text, '<null>') from public.workspace_members
      where workspace_id = '00000024-a000-4000-8000-00000000000a' and user_id = '00000024-0000-4000-8000-000000000001' $s$,
  'owner:<null>');

-- ===========================================================================
-- Report
-- A complete workspace deletion must still cascade over assigned custom roles.
reset role;
select set_config('request.jwt.claims', '{}', true);
select public._hestia_rc_ok('7.1 workspace cascade removes assigned roles without stranding members',
  $s$ delete from public.workspaces where id = '00000024-a000-4000-8000-00000000000a' $s$);
select public._hestia_rc_value('7.2 workspace custom roles are gone after cascade',
  $s$ select count(*)::text from public.workspace_roles where workspace_id = '00000024-a000-4000-8000-00000000000a' $s$, '0');
-- ===========================================================================

select
  case when ok then 'pass' else 'FAIL' end as result, name, detail
from public._hestia_rc_check
order by at, name;

do $do$
declare
  total integer;
  failed integer;
  row record;
begin
  for row in select * from public._hestia_rc_check where not ok order by at, name loop
    raise notice 'FAIL  % — %', row.name, row.detail;
  end loop;
  select count(*) into total from public._hestia_rc_check;
  select count(*) into failed from public._hestia_rc_check where not ok;
  raise notice '0024 custom roles: % checks, % failed', total, failed;
  if total = 0 then
    raise exception 'no custom role checks ran at all';
  end if;
  if failed > 0 then
    raise exception '% of % custom role checks failed', failed, total;
  end if;
end;
$do$;

rollback;

-- Integration tests for 0023_profile_editing.sql.
--
-- Not string checks against the migration text: every assertion runs a real
-- statement as a real database role with a real `auth.uid()`, against the
-- effective schema after 0001..0023.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/profile_editing.sql
--
-- Run it against a disposable local database, as the admin role the migrations
-- run as (`postgres` on a Supabase project, which is what `supabase db reset`
-- and `psql "$DATABASE_URL"` give you — the fixture writes auth.users and
-- public.workspaces directly, and the role-simulation blocks need SET ROLE).
-- Nothing outside the standard Supabase/PostgreSQL 17 surface is used: no
-- pgTAP, no extensions, no server-side settings changed outside the transaction.
--
-- The whole file runs in ONE transaction and ends with ROLLBACK, so a passing
-- *and* a failing run both leave the database as they found it. Exit status is
-- non-zero if any check failed; every check is printed.
--
-- Role simulation: `set local role authenticated` + `request.jwt.claims` is
-- exactly what PostgREST does per request, so RLS, column grants, function
-- EXECUTE grants and `auth.uid()` all behave as they do for a browser client.
-- `set local role anon` with claims that have no `sub` is an anonymous caller.
--
-- Out of scope here, stated rather than implied: account email and password are
-- the Auth provider's (GoTrue's) data and API. This file asserts that the
-- profile table has no such columns and that a profile edit cannot reach them;
-- it does not test credential changes, which happen in auth.*, not in public.

begin;
set local search_path = public, pg_temp;

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
-- the migrations so they keep the built-in PUBLIC execute, but say it out loud
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

grant execute on function
  public._hestia_expect_fail(text, text, text),
  public._hestia_expect_ok(text, text),
  public._hestia_expect_value(text, text, text),
  public._hestia_expect_rows(text, text, integer)
to public;

-- `anon` exists in every Supabase database; create it if this is a bare
-- Postgres so the anonymous-caller checks still run. Rolled back with
-- everything else.
do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
    grant usage on schema public to anon;
    perform public._hestia_record('harness: anon role', true,
      'SKIP-ish: anon did not exist and was created for this run');
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
-- p_solo   signed up, belongs to no workspace yet (the onboarding state)
-- p_owner  workspace A owner
-- p_mate   workspace A editor — shares a workspace with p_owner
-- p_out    workspace B owner — a different tenant
--
-- Every insert into auth.users fires the 0023 handle_new_user, so the profile
-- rows below are created by the trigger under test, not by the fixture.

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  ('a1111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'solo@hestia.test',   now(), now()),
  ('a2222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@profile.test', now(), now()),
  ('a3333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mate@profile.test',  now(), now()),
  ('a4444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'out@profile.test',   now(), now());

-- the add_workspace_owner trigger inserts the owner membership
insert into public.workspaces (id, name, slug, owner_id) values
  ('c0000000-0000-4000-8000-00000000000a', 'Profile Tenant A', 'profile-tenant-a', 'a2222222-2222-4222-8222-222222222222'),
  ('c0000000-0000-4000-8000-00000000000b', 'Profile Tenant B', 'profile-tenant-b', 'a4444444-4444-4444-8444-444444444444');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('c0000000-0000-4000-8000-00000000000a', 'a3333333-3333-4333-8333-333333333333', 'editor');

-- ===========================================================================
-- A. Schema and grant shape
-- ===========================================================================

-- The column set *is* the claim that account email and credentials are not
-- stored here. If a later migration adds one, this check fails first.
select public._hestia_expect_value('A1 profiles has exactly id, display_name, avatar_url, created_at',
  $s$ select string_agg(attname, ', ' order by attname collate "C")
      from pg_attribute
      where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped $s$,
  'avatar_url, created_at, display_name, id');

select public._hestia_expect_value('A2 authenticated may update display_name',
  $s$ select has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update')::text $s$, 'true');
select public._hestia_expect_value('A3 authenticated may update avatar_url',
  $s$ select has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'update')::text $s$, 'true');
select public._hestia_expect_value('A4 authenticated may NOT update id',
  $s$ select has_column_privilege('authenticated', 'public.profiles', 'id', 'update')::text $s$, 'false');
select public._hestia_expect_value('A5 authenticated may NOT update created_at',
  $s$ select has_column_privilege('authenticated', 'public.profiles', 'created_at', 'update')::text $s$, 'false');
-- the table-level grant is what made id/created_at writable; it must be gone
select public._hestia_expect_value('A6 authenticated holds no table-level UPDATE on profiles',
  $s$ select has_table_privilege('authenticated', 'public.profiles', 'update')::text $s$, 'false');
select public._hestia_expect_value('A7 authenticated may still read profiles',
  $s$ select has_table_privilege('authenticated', 'public.profiles', 'select')::text $s$, 'true');
select public._hestia_expect_value('A8 authenticated holds no insert/delete/truncate on profiles',
  $s$ select coalesce(string_agg(pr.priv, ', ' order by pr.priv collate "C"), 'none')
      from unnest(array['insert','delete','truncate']) as pr(priv)
      where has_table_privilege('authenticated', 'public.profiles', pr.priv) $s$, 'none');
-- column grants are not a way around the missing INSERT: check every column
select public._hestia_expect_value('A9 authenticated holds no column INSERT grant on profiles',
  $s$ select coalesce(string_agg(a.attname, ', ' order by a.attname collate "C"), 'none')
      from pg_attribute a
      where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('authenticated', 'public.profiles', a.attname, 'insert') $s$, 'none');

select public._hestia_expect_value('A10 anon holds no privilege of any kind on profiles',
  $s$ select coalesce(string_agg(pr.priv, ', ' order by pr.priv collate "C"), 'none')
      from unnest(array['select','insert','update','delete','truncate','references','trigger']) as pr(priv)
      where has_table_privilege('anon', 'public.profiles', pr.priv) $s$, 'none');
select public._hestia_expect_value('A11 anon holds no column privilege on profiles either',
  $s$ select coalesce(string_agg(format('%s:%s', a.attname, pr.priv), ', ' order by a.attname collate "C", pr.priv collate "C"), 'none')
      from pg_attribute a
      cross join unnest(array['select','insert','update','references']) as pr(priv)
      where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('anon', 'public.profiles', a.attname, pr.priv) $s$, 'none');

-- trigger functions are callable by nobody: a trigger function cannot be
-- invoked directly and its EXECUTE privilege is checked at CREATE TRIGGER time
select public._hestia_expect_value('A12 handle_new_user is not executable by PUBLIC, anon or authenticated',
  $s$ select (has_function_privilege('public', 'public.handle_new_user()', 'execute')
              or has_function_privilege('anon', 'public.handle_new_user()', 'execute')
              or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'))::text $s$, 'false');
select public._hestia_expect_value('A13 normalize_profile is not executable by PUBLIC, anon or authenticated',
  $s$ select (has_function_privilege('public', 'public.normalize_profile()', 'execute')
              or has_function_privilege('anon', 'public.normalize_profile()', 'execute')
              or has_function_privilege('authenticated', 'public.normalize_profile()', 'execute'))::text $s$, 'false');
select public._hestia_expect_value('A14 the signup name helper is not executable by PUBLIC, anon or authenticated',
  $s$ select (has_function_privilege('public', 'public.profile_display_name_from_signup(jsonb,text)', 'execute')
              or has_function_privilege('anon', 'public.profile_display_name_from_signup(jsonb,text)', 'execute')
              or has_function_privilege('authenticated', 'public.profile_display_name_from_signup(jsonb,text)', 'execute'))::text $s$,
  'false');
-- the avatar validator is the one exception: `authenticated` evaluates the
-- check constraint on its own UPDATE
select public._hestia_expect_value('A15 authenticated keeps execute on is_safe_avatar_url (check constraint)',
  $s$ select has_function_privilege('authenticated', 'public.is_safe_avatar_url(text)', 'execute')::text $s$, 'true');
select public._hestia_expect_value('A16 anon and PUBLIC do not keep execute on is_safe_avatar_url',
  $s$ select (has_function_privilege('public', 'public.is_safe_avatar_url(text)', 'execute')
              or has_function_privilege('anon', 'public.is_safe_avatar_url(text)', 'execute'))::text $s$, 'false');

select public._hestia_expect_value('A17 handle_new_user is SECURITY DEFINER with search_path pinned to public, pg_temp',
  $s$ select coalesce(array_to_string(p.proconfig, ','), '<none>')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'handle_new_user' and p.prosecdef $s$,
  'search_path=public, pg_temp');
select public._hestia_expect_value('A18 the signup trigger is still attached to auth.users',
  $s$ select count(*)::text from pg_trigger
      where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal $s$, '1');
select public._hestia_expect_value('A19 the normalize trigger is attached to profiles',
  $s$ select count(*)::text from pg_trigger
      where tgrelid = 'public.profiles'::regclass and tgname = 'normalize_profile' and not tgisinternal $s$, '1');

-- both constraints must be present *and* validated: NOT VALID would let a
-- pre-0023 row stay out of compliance
select public._hestia_expect_value('A20 display_name constraint exists and is validated',
  $s$ select convalidated::text from pg_constraint
      where conrelid = 'public.profiles'::regclass and conname = 'profiles_display_name_valid' $s$, 'true');
select public._hestia_expect_value('A21 avatar_url constraint exists and is validated',
  $s$ select convalidated::text from pg_constraint
      where conrelid = 'public.profiles'::regclass and conname = 'profiles_avatar_url_valid' $s$, 'true');
select public._hestia_expect_value('A22 display_name is NOT NULL at the column',
  $s$ select attnotnull::text from pg_attribute
      where attrelid = 'public.profiles'::regclass and attname = 'display_name' $s$, 'true');

-- RLS: SELECT (0018) and UPDATE (0023) only. No INSERT or DELETE policy, to
-- match the absent grants.
select public._hestia_expect_value('A23 RLS is enabled on profiles',
  $s$ select relrowsecurity::text from pg_class where oid = 'public.profiles'::regclass $s$, 'true');
select public._hestia_expect_value('A24 profiles has exactly a SELECT and an UPDATE policy',
  $s$ select coalesce(string_agg(cmd, ', ' order by cmd collate "C"), 'none')
      from (select distinct cmd from pg_policies
             where schemaname = 'public' and tablename = 'profiles' and permissive = 'PERMISSIVE') p $s$, 'SELECT, UPDATE');
select public._hestia_expect_value('A25 the update policy pins id = auth.uid() in USING and WITH CHECK',
  $s$ select (qual like '%auth.uid()%' and with_check like '%auth.uid()%')::text from pg_policies
      where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE' $s$, 'true');
select public._hestia_expect_value('A26 the update policy applies to authenticated only',
  $s$ select array_to_string(roles, ',') from pg_policies
      where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE' $s$, 'authenticated');

-- ===========================================================================
-- B. Own edit, by a user who is not in a workspace yet
-- ===========================================================================
-- This is the onboarding state and it is the reason 0018 put `id = auth.uid()`
-- first in the SELECT policy. Profile editing must work before any workspace
-- exists for the user, or a new account cannot set its name.

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select public._hestia_expect_value('B1 a user with no workspace can read their own profile',
  $s$ select count(*)::text from public.profiles where id = 'a1111111-1111-4111-8111-111111111111' $s$, '1');
select public._hestia_expect_rows('B2 a user with no workspace can rename themselves',
  $s$ update public.profiles set display_name = '김하늘' where id = 'a1111111-1111-4111-8111-111111111111' $s$, 1);
select public._hestia_expect_value('B3 the new name is stored',
  $s$ select display_name from public.profiles where id = 'a1111111-1111-4111-8111-111111111111' $s$, '김하늘');

-- surrounding whitespace is a typo, not an error: it is trimmed
select public._hestia_expect_rows('B4 a name with surrounding whitespace is accepted',
  $s$ update public.profiles set display_name = '  Sol Kim  ' where id = 'a1111111-1111-4111-8111-111111111111' $s$, 1);
select public._hestia_expect_value('B5 …and stored trimmed',
  $s$ select display_name from public.profiles where id = 'a1111111-1111-4111-8111-111111111111' $s$, 'Sol Kim');
select public._hestia_expect_value('B6 a tab/newline-padded name is trimmed too',
  $s$ with w as (
        update public.profiles set display_name = chr(9) || ' Tab Name ' || chr(10)
         where id = 'a1111111-1111-4111-8111-111111111111' returning display_name)
      select display_name from w $s$, 'Tab Name');

-- emptiness and length are told to the client, not silently coerced
select public._hestia_expect_fail('B7 a whitespace-only name is rejected',
  $s$ update public.profiles set display_name = '    ' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_display_name_valid');
select public._hestia_expect_fail('B8 an empty name is rejected',
  $s$ update public.profiles set display_name = '' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_display_name_valid');
select public._hestia_expect_fail('B9 a null name is rejected',
  $s$ update public.profiles set display_name = null where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'display_name');
select public._hestia_expect_fail('B10 an 81-character name is rejected',
  $s$ update public.profiles set display_name = repeat('x', 81) where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_display_name_valid');
select public._hestia_expect_fail('B11 an 81-character multibyte name is rejected (characters, not bytes)',
  $s$ update public.profiles set display_name = repeat('가', 81) where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_display_name_valid');
select public._hestia_expect_rows('B12 exactly 80 characters is accepted',
  $s$ update public.profiles set display_name = repeat('x', 80) where id = 'a1111111-1111-4111-8111-111111111111' $s$, 1);
select public._hestia_expect_value('B13 80 multibyte characters are accepted and stored whole',
  $s$ with w as (
        update public.profiles set display_name = repeat('가', 80)
         where id = 'a1111111-1111-4111-8111-111111111111' returning display_name)
      select char_length(display_name)::text from w $s$, '80');
-- 80 characters plus three trailing spaces is 83 raw characters and 80 after
-- trimming: the trim happens before the bound is applied, so this is accepted
select public._hestia_expect_value('B14 trimming happens before the length check',
  $s$ with w as (
        update public.profiles set display_name = repeat('y', 80) || '   '
         where id = 'a1111111-1111-4111-8111-111111111111' returning display_name)
      select char_length(display_name)::text from w $s$, '80');

-- avatars: an http(s) absolute URL, or nothing
select public._hestia_expect_rows('B15 an https avatar URL is accepted',
  $s$ update public.profiles set display_name = 'Sol', avatar_url = 'https://cdn.hestia.test/a/sol.png?v=2'
       where id = 'a1111111-1111-4111-8111-111111111111' $s$, 1);
select public._hestia_expect_value('B16 the avatar URL is stored verbatim',
  $s$ select avatar_url from public.profiles where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'https://cdn.hestia.test/a/sol.png?v=2');
select public._hestia_expect_rows('B17 a plain http avatar URL is accepted',
  $s$ update public.profiles set avatar_url = 'http://cdn.hestia.test/a/sol.png'
       where id = 'a1111111-1111-4111-8111-111111111111' $s$, 1);
select public._hestia_expect_value('B18 an uppercase scheme is accepted',
  $s$ with w as (
        update public.profiles set avatar_url = 'HTTPS://CDN.HESTIA.TEST/a.png'
         where id = 'a1111111-1111-4111-8111-111111111111' returning avatar_url)
      select avatar_url from w $s$, 'HTTPS://CDN.HESTIA.TEST/a.png');
select public._hestia_expect_value('B19 a 2048-character URL is accepted',
  $s$ with w as (
        update public.profiles set avatar_url = 'https://a.test/' || repeat('x', 2033)
         where id = 'a1111111-1111-4111-8111-111111111111' returning avatar_url)
      select char_length(avatar_url)::text from w $s$, '2048');

select public._hestia_expect_fail('B20 a javascript: avatar is rejected',
  $s$ update public.profiles set avatar_url = 'javascript:alert(1)' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B21 a mixed-case JaVaScRiPt: avatar is rejected',
  $s$ update public.profiles set avatar_url = 'JaVaScRiPt:alert(1)' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B22 a javascript: avatar with leading whitespace is rejected',
  $s$ update public.profiles set avatar_url = '   javascript:alert(1)' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B23 a data: avatar is rejected',
  $s$ update public.profiles set avatar_url = 'data:text/html;base64,PHNjcmlwdD4=' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B24 a data:image avatar is rejected too — no inline payloads',
  $s$ update public.profiles set avatar_url = 'data:image/png;base64,iVBORw0KGgo=' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B25 a vbscript: avatar is rejected',
  $s$ update public.profiles set avatar_url = 'vbscript:msgbox(1)' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B26 an ftp: avatar is rejected (allowlist, not denylist)',
  $s$ update public.profiles set avatar_url = 'ftp://cdn.hestia.test/a.png' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B27 a scheme-relative URL is rejected',
  $s$ update public.profiles set avatar_url = '//cdn.hestia.test/a.png' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B28 a relative path is rejected',
  $s$ update public.profiles set avatar_url = '/a/sol.png' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B29 https:// with no host is rejected',
  $s$ update public.profiles set avatar_url = 'https:///a.png' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
-- chr(10) is whitespace, so a second line cannot ride along behind a valid
-- first one: the regex is anchored to the whole string, newline or not
select public._hestia_expect_fail('B30 a newline cannot smuggle a second scheme past the anchors',
  $s$ update public.profiles
         set avatar_url = 'https://cdn.hestia.test/ok.png' || chr(10) || 'javascript:alert(1)'
       where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
-- chr(1) is neither whitespace nor a markup character, so the control-character
-- clause is the only thing that rejects this one
select public._hestia_expect_fail('B31 a control character inside the URL is rejected',
  $s$ update public.profiles
         set avatar_url = 'https://cdn.hestia.test/ok' || chr(1) || '.png'
       where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B32 markup characters in the URL are rejected',
  $s$ update public.profiles set avatar_url = 'https://cdn.hestia.test/ok.png"><script>alert(1)</script>'
       where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');
select public._hestia_expect_fail('B33 a 2049-character URL is rejected',
  $s$ update public.profiles set avatar_url = 'https://a.test/' || repeat('x', 2034)
       where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'profiles_avatar_url_valid');

-- clearing: both spellings of "no avatar" work and both store NULL
select public._hestia_expect_rows('B34 clearing the avatar with null is accepted',
  $s$ update public.profiles set avatar_url = null where id = 'a1111111-1111-4111-8111-111111111111' $s$, 1);
select public._hestia_expect_value('B35 the avatar is NULL after an explicit null',
  $s$ select coalesce(avatar_url, '<null>') from public.profiles where id = 'a1111111-1111-4111-8111-111111111111' $s$, '<null>');
select public._hestia_expect_rows('B36 setting a valid avatar again works',
  $s$ update public.profiles set avatar_url = 'https://cdn.hestia.test/a/sol.png'
       where id = 'a1111111-1111-4111-8111-111111111111' $s$, 1);
select public._hestia_expect_value('B37 clearing the avatar with an empty string stores NULL, not ""',
  $s$ with w as (
        update public.profiles set avatar_url = '' where id = 'a1111111-1111-4111-8111-111111111111'
        returning avatar_url)
      select coalesce(avatar_url, '<null>') from w $s$, '<null>');
select public._hestia_expect_value('B38 clearing the avatar with whitespace stores NULL too',
  $s$ with w as (
        update public.profiles set avatar_url = '   ' where id = 'a1111111-1111-4111-8111-111111111111'
        returning avatar_url)
      select coalesce(avatar_url, '<null>') from w $s$, '<null>');

-- the two immutable columns, stopped by the grant before any policy or trigger
select public._hestia_expect_fail('B39 updating id is denied by the column grant',
  $s$ update public.profiles set id = 'a2222222-2222-4222-8222-222222222222' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'permission denied');
select public._hestia_expect_fail('B40 updating id to an unused uuid is denied as well',
  $s$ update public.profiles set id = gen_random_uuid() where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'permission denied');
select public._hestia_expect_fail('B41 updating created_at is denied by the column grant',
  $s$ update public.profiles set created_at = now() - interval '10 years' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'permission denied');
select public._hestia_expect_fail('B42 a legal column cannot smuggle an illegal one along',
  $s$ update public.profiles set display_name = 'Sol', created_at = now()
       where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'permission denied');
select public._hestia_expect_fail('B43 inserting a profile row is denied',
  $s$ insert into public.profiles (id, display_name) values (gen_random_uuid(), 'Ghost') $s$,
  'permission denied');
select public._hestia_expect_fail('B44 deleting a profile row is denied',
  $s$ delete from public.profiles where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'permission denied');

reset role;

select public._hestia_expect_value('B45 id and created_at survived every attempt',
  $s$ select (count(*) = 1)::text from public.profiles
      where id = 'a1111111-1111-4111-8111-111111111111' and created_at <= now() $s$, 'true');
select public._hestia_expect_value('B46 the last accepted name is what is stored',
  $s$ select display_name from public.profiles where id = 'a1111111-1111-4111-8111-111111111111' $s$, 'Sol');

-- ===========================================================================
-- C. Other people's profiles
-- ===========================================================================

set local role authenticated;

-- A workspace mate may *read* a name — that is what the member list, the
-- comment author and the document owner label need — and may not write it.
-- RLS makes the write affect zero rows rather than raise, so the row count is
-- the assertion, followed by the stored value.
select set_config('request.jwt.claims', '{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public._hestia_expect_value('C1 a workspace mate can read the owner profile',
  $s$ select display_name from public.profiles where id = 'a2222222-2222-4222-8222-222222222222' $s$, 'owner');
select public._hestia_expect_rows('C2 a workspace mate cannot rename the owner',
  $s$ update public.profiles set display_name = 'Hijacked' where id = 'a2222222-2222-4222-8222-222222222222' $s$, 0);
select public._hestia_expect_rows('C3 a workspace mate cannot set the owner avatar',
  $s$ update public.profiles set avatar_url = 'https://evil.test/track.png' where id = 'a2222222-2222-4222-8222-222222222222' $s$, 0);
select public._hestia_expect_rows('C4 a blanket update touches only the caller''s own row',
  $s$ update public.profiles set display_name = 'Everyone' $s$, 1);
select public._hestia_expect_rows('C5 renaming themselves still works',
  $s$ update public.profiles set display_name = 'Mate' where id = 'a3333333-3333-4333-8333-333333333333' $s$, 1);

-- A different tenant sees nothing: no read, and therefore no write either.
select set_config('request.jwt.claims', '{"sub":"a4444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select public._hestia_expect_value('C6 an outsider cannot read a profile from another tenant',
  $s$ select count(*)::text from public.profiles where id = 'a2222222-2222-4222-8222-222222222222' $s$, '0');
select public._hestia_expect_value('C7 an outsider sees only their own profile row',
  $s$ select coalesce(string_agg(id::text, ', ' order by id::text), 'none') from public.profiles $s$,
  'a4444444-4444-4444-8444-444444444444');
select public._hestia_expect_rows('C8 an outsider cannot rename anyone else',
  $s$ update public.profiles set display_name = 'Hijacked' where id = 'a2222222-2222-4222-8222-222222222222' $s$, 0);

-- …and so does a user who has no workspace at all: being signed in is not a
-- licence to read the user table (0018).
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select public._hestia_expect_value('C9 a workspace-less user cannot read other profiles',
  $s$ select count(*)::text from public.profiles where id <> 'a1111111-1111-4111-8111-111111111111' $s$, '0');

reset role;

select public._hestia_expect_value('C10 the owner name was never mutated by anyone else',
  $s$ select display_name from public.profiles where id = 'a2222222-2222-4222-8222-222222222222' $s$, 'owner');
select public._hestia_expect_value('C11 the owner avatar was never set by anyone else',
  $s$ select coalesce(avatar_url, '<null>') from public.profiles where id = 'a2222222-2222-4222-8222-222222222222' $s$, '<null>');
select public._hestia_expect_value('C12 the mate''s own rename did land',
  $s$ select display_name from public.profiles where id = 'a3333333-3333-4333-8333-333333333333' $s$, 'Mate');

-- ===========================================================================
-- D. Anonymous callers
-- ===========================================================================

-- Claims with no `sub`, not an empty string: older auth.uid() definitions cast
-- the claims GUC to jsonb without guarding against ''.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select public._hestia_expect_fail('D1 anon cannot update a profile',
  $s$ update public.profiles set display_name = 'Anon' where id = 'a1111111-1111-4111-8111-111111111111' $s$,
  'permission denied');
select public._hestia_expect_fail('D2 anon cannot update display_name alone either',
  $s$ update public.profiles set display_name = 'Anon' $s$, 'permission denied');
select public._hestia_expect_fail('D3 anon cannot read profiles at all',
  $s$ select count(*) from public.profiles $s$, 'permission denied');
select public._hestia_expect_fail('D4 anon cannot insert a profile',
  $s$ insert into public.profiles (id, display_name) values (gen_random_uuid(), 'Anon') $s$, 'permission denied');
select public._hestia_expect_fail('D5 anon cannot delete a profile',
  $s$ delete from public.profiles $s$, 'permission denied');

reset role;

select public._hestia_expect_value('D6 nothing anon attempted changed a name',
  $s$ select display_name from public.profiles where id = 'a1111111-1111-4111-8111-111111111111' $s$, 'Sol');

-- ===========================================================================
-- E. Signup — handle_new_user
-- ===========================================================================
-- Every insert below is a signup: the 0023 trigger derives the display name.
-- `raw_user_meta_data` is attacker-supplied, so each case states what the
-- database is willing to read out of it.

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  -- no metadata, and a local part well over the 80-character bound
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   repeat('l', 95) || '@hestia.test', null, now(), now()),
  -- metadata display_name wins
  ('b0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'meta-display@hestia.test', '{"display_name":"  Dan Park  ","full_name":"Ignored","name":"Ignored"}'::jsonb, now(), now()),
  -- then full_name
  ('b0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'meta-full@hestia.test', '{"full_name":"Full Name","name":"Ignored"}'::jsonb, now(), now()),
  -- then name
  ('b0000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'meta-name@hestia.test', '{"name":"Just Name"}'::jsonb, now(), now()),
  -- non-string metadata is not a name: fall through to the email local part
  ('b0000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'meta-object@hestia.test', '{"display_name":{"ko":"객체"},"full_name":["a"],"name":42}'::jsonb, now(), now()),
  -- whitespace-only metadata is not a name either
  ('b0000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'meta-blank@hestia.test', '{"display_name":"   ","full_name":"\t\n"}'::jsonb, now(), now()),
  -- an oversized metadata name is truncated, not rejected: a signup must not fail
  ('b0000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'meta-long@hestia.test', jsonb_build_object('display_name', repeat('가', 500)), now(), now()),
  -- no email and no usable metadata at all (a phone or anonymous identity)
  ('b0000000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   null, '{}'::jsonb, now(), now()),
  -- metadata that tries to name its own row and grant itself a role
  ('b0000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'meta-escalate@hestia.test',
   '{"id":"a2222222-2222-4222-8222-222222222222","role":"service_role","aud":"service_role","workspace_id":"c0000000-0000-4000-8000-00000000000a","display_name":"Climber"}'::jsonb,
   now(), now());

select public._hestia_expect_value('E1 a signup with no metadata gets the email local part, truncated to 80',
  $s$ select char_length(display_name)::text from public.profiles where id = 'b0000000-0000-4000-8000-000000000001' $s$, '80');
select public._hestia_expect_value('E2 …and it is the local part, not the whole address',
  $s$ select (display_name = repeat('l', 80))::text from public.profiles where id = 'b0000000-0000-4000-8000-000000000001' $s$, 'true');
select public._hestia_expect_value('E3 metadata display_name wins, trimmed',
  $s$ select display_name from public.profiles where id = 'b0000000-0000-4000-8000-000000000002' $s$, 'Dan Park');
select public._hestia_expect_value('E4 full_name is used when display_name is absent',
  $s$ select display_name from public.profiles where id = 'b0000000-0000-4000-8000-000000000003' $s$, 'Full Name');
select public._hestia_expect_value('E5 name is used when both others are absent',
  $s$ select display_name from public.profiles where id = 'b0000000-0000-4000-8000-000000000004' $s$, 'Just Name');
select public._hestia_expect_value('E6 non-string metadata is ignored, not serialized into the name',
  $s$ select display_name from public.profiles where id = 'b0000000-0000-4000-8000-000000000005' $s$, 'meta-object');
select public._hestia_expect_value('E7 whitespace-only metadata falls through to the email local part',
  $s$ select display_name from public.profiles where id = 'b0000000-0000-4000-8000-000000000006' $s$, 'meta-blank');
select public._hestia_expect_value('E8 a 500-character metadata name is truncated to 80, and the signup succeeded',
  $s$ select char_length(display_name)::text from public.profiles where id = 'b0000000-0000-4000-8000-000000000007' $s$, '80');
select public._hestia_expect_value('E9 no email and no metadata falls back to the placeholder',
  $s$ select display_name from public.profiles where id = 'b0000000-0000-4000-8000-000000000008' $s$, '사용자');
select public._hestia_expect_value('E10 every signup profile satisfies the display_name rule',
  $s$ select count(*)::text from public.profiles
      where display_name is null or display_name <> btrim(display_name)
         or char_length(display_name) not between 1 and 80 $s$, '0');
select public._hestia_expect_value('E11 a signup never sets an avatar from metadata',
  $s$ select count(*)::text from public.profiles
      where id::text like 'b0000000-%' and avatar_url is not null $s$, '0');

-- The escalation attempt: metadata `id` did not choose the row, metadata `role`
-- did not become a membership, and the name — the one field metadata may
-- influence — is all it influenced.
select public._hestia_expect_value('E12 metadata id did not name the profile row',
  $s$ select (count(*) = 1)::text from public.profiles
      where id = 'b0000000-0000-4000-8000-000000000009' and display_name = 'Climber' $s$, 'true');
select public._hestia_expect_value('E13 metadata id did not overwrite the profile it pointed at',
  $s$ select display_name from public.profiles where id = 'a2222222-2222-4222-8222-222222222222' $s$, 'owner');
select public._hestia_expect_value('E14 metadata role granted no workspace membership',
  $s$ select count(*)::text from public.workspace_members where user_id = 'b0000000-0000-4000-8000-000000000009' $s$, '0');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
select public._hestia_expect_value('E15 the self-declared service_role reads no other profile',
  $s$ select count(*)::text from public.profiles where id <> 'b0000000-0000-4000-8000-000000000009' $s$, '0');
select public._hestia_expect_rows('E16 the self-declared service_role cannot rename the workspace owner',
  $s$ update public.profiles set display_name = 'Climbed' where id = 'a2222222-2222-4222-8222-222222222222' $s$, 0);
select public._hestia_expect_value('E17 the self-declared service_role is not a workspace member',
  $s$ select coalesce(public.workspace_role('c0000000-0000-4000-8000-00000000000a'), '<null>') $s$, '<null>');
select public._hestia_expect_value('E18 the self-declared service_role reads no workspace',
  $s$ select count(*)::text from public.workspaces $s$, '0');
select public._hestia_expect_rows('E19 …and can still edit its own profile',
  $s$ update public.profiles set display_name = 'Climber Two' where id = 'b0000000-0000-4000-8000-000000000009' $s$, 1);
reset role;

-- The role that counts is the database role PostgREST switches to, named by the
-- verified JWT — never a string from user metadata.
select public._hestia_expect_value('E20 auth.uid() comes from the JWT sub, so metadata cannot forge an identity',
  $s$ select (display_name = 'Climber Two')::text from public.profiles
      where id = 'b0000000-0000-4000-8000-000000000009' $s$, 'true');

-- ===========================================================================
-- F. Normalization invariants across the whole table
-- ===========================================================================
-- The backfill itself ran inside the migration, so it cannot be re-executed
-- here. What is asserted instead is the property the backfill exists to
-- establish — no stored row violates the rule — plus the fact that the
-- constraints are live even for the table owner, so a legacy-shaped row cannot
-- come back through a migration, a seed script or a service_role job.

select public._hestia_expect_value('F1 no stored display_name violates the rule',
  $s$ select count(*)::text from public.profiles
      where display_name is null or display_name <> btrim(display_name)
         or char_length(display_name) not between 1 and 80 $s$, '0');
select public._hestia_expect_value('F2 no stored avatar_url violates the rule',
  $s$ select count(*)::text from public.profiles where not public.is_safe_avatar_url(avatar_url) $s$, '0');
select public._hestia_expect_fail('F3 a full-email display_name over 80 characters cannot be stored, even as the owner',
  $s$ update public.profiles set display_name = repeat('a', 80) || '@hestia.test'
       where id = 'a2222222-2222-4222-8222-222222222222' $s$,
  'profiles_display_name_valid');
select public._hestia_expect_fail('F4 an unsafe avatar cannot be stored, even as the owner',
  $s$ update public.profiles set avatar_url = 'javascript:alert(1)'
       where id = 'a2222222-2222-4222-8222-222222222222' $s$,
  'profiles_avatar_url_valid');

-- Insert without a name, for an auth.users row that exists and whose profile is
-- removed first, so the only constraint left to fail is the one under test.
delete from public.profiles where id = 'b0000000-0000-4000-8000-000000000008';
select public._hestia_expect_fail('F5 a profile row cannot be inserted without a display_name',
  $s$ insert into public.profiles (id) values ('b0000000-0000-4000-8000-000000000008') $s$,
  'display_name');

-- An email that fits is still an email, and that is on purpose: the database
-- cannot invent a person's name. 80 characters of a long address is the honest
-- truncation, and the owner can now change it.
select public._hestia_expect_value('F6 a short email-shaped name is left alone (it is valid, if ugly)',
  $s$ with w as (
        update public.profiles set display_name = 'owner@profile.test'
         where id = 'a2222222-2222-4222-8222-222222222222' returning display_name)
      select display_name from w $s$, 'owner@profile.test');

-- ===========================================================================
-- G. Honest boundaries of this file
-- ===========================================================================

select public._hestia_expect_fail('B47 URL credentials are rejected',
  $s$ update public.profiles set avatar_url = 'https://user:password@example.com/avatar.png' where id = 'a1111111-1111-4111-8111-111111111111' $s$, 'profiles_avatar_url_valid');

select public._hestia_record('G1 account email change', true,
  'SKIP: email and password live in auth.users and are changed through GoTrue, not through public.profiles. This file asserts only that profiles has no such column (A1) and that a profile edit cannot reach one.');
select public._hestia_record('G2 avatar fetching', true,
  'SKIP: the database validates the URL shape and scheme. Whether the host is reachable, serves an image, or is a tracking pixel is not knowable in SQL and is not checked.');
select public._hestia_record('G3 client-side rendering', true,
  'SKIP: a safe URL in the column does not prove the UI renders it safely. That the avatar is used in an <img src> and never as an <a href> or in dangerouslySetInnerHTML is a UI property, proved in the UI owner''s tests.');
select public._hestia_record('G4 concurrent self-edits', true,
  'SKIP: everything above runs in ONE transaction and cannot observe two sessions interleaving. Two concurrent updates to the same profile row are serialized by the row lock and last-writer-wins, which is the intended behaviour for a single-owner row.');

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
  raise notice '0023 profile editing: % checks, % failed, % skipped', total, failed, skipped;
  if failed > 0 then
    raise exception '% of % profile editing checks failed', failed, total;
  end if;
end;
$do$;

rollback;

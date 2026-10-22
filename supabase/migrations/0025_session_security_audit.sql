-- 0025: DB-enforced TOTP step-up and manager-readable, trigger-written security events.

create or replace function public.session_is_allowed() returns boolean
language plpgsql security definer set search_path = public, pg_temp stable as $$
declare
  claims jsonb;
  mfa_verified boolean;
begin
  if auth.uid() is null then
    return false;
  end if;

  select exists (
    select 1 from auth.mfa_factors f
    where f.user_id = auth.uid()
      and f.factor_type = 'totp'
      and f.status = 'verified'
  ) into mfa_verified;

  if not mfa_verified then
    return true;
  end if;

  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    claims := null;
  end;

  return coalesce(claims ->> 'aal', '') = 'aal2';
end;
$$;

comment on function public.session_is_allowed() is
  'False for anonymous callers. For a caller with a verified TOTP factor, true only at aal2. Everyone else: true.';

revoke execute on function public.session_is_allowed() from public, authenticated;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.session_is_allowed() from anon';
  end if;
end;
$do$;
grant execute on function public.session_is_allowed() to authenticated;

do $do$
declare t text;
begin
  foreach t in array array[
    'profiles', 'workspaces', 'workspace_members', 'pages', 'page_revisions',
    'page_collaboration', 'page_collaboration_updates', 'comment_threads',
    'comments', 'notifications', 'workspace_roles'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'Session assurance required', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.session_is_allowed()) with check (public.session_is_allowed())',
      'Session assurance required', t
    );
  end loop;
end;
$do$;

do $do$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "Session assurance required" on storage.objects';
    execute $p$
      create policy "Session assurance required" on storage.objects
        as restrictive for all to authenticated
        using (public.session_is_allowed())
        with check (public.session_is_allowed())
    $p$;
  end if;

  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "Session assurance required" on realtime.messages';
    execute $p$
      create policy "Session assurance required" on realtime.messages
        as restrictive for all to authenticated
        using (public.session_is_allowed())
        with check (public.session_is_allowed())
    $p$;
  end if;
end;
$do$;

create or replace function public.workspace_role(target_workspace_id uuid) returns text
language sql security definer set search_path = public, pg_temp stable as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace_id
    and auth.uid() is not null
    and public.session_is_allowed()
    and wm.user_id = auth.uid();
$$;

create or replace function public.has_workspace_permission(target_workspace_id uuid, permission_key text) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select case
    when not public.session_is_allowed() then false
    when auth.uid() is null or permission_key not in ('pages.write', 'members.manage') then false
    else coalesce((
      select case
        when wm.custom_role_id is not null then
          permission_key = any(coalesce((select r.permissions from public.workspace_roles r where r.id = wm.custom_role_id), '{}'))
        when wm.role in ('owner', 'admin') then true
        when wm.role = 'editor' then permission_key = 'pages.write'
        else false
      end
      from public.workspace_members wm
      where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid()
    ), false)
  end;
$$;

create or replace function public.create_workspace_role(target_workspace_id uuid, role_name text, role_permissions text[])
returns public.workspace_roles language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  new_role public.workspace_roles%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.session_is_allowed() then raise exception 'Authentication assurance required'; end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;
  select wm.role into actor_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  if actor_role is distinct from 'owner' then raise exception 'Only an owner can manage custom roles'; end if;
  if role_name is null or btrim(role_name) = '' then raise exception 'A role name is required'; end if;
  if not public.is_valid_role_permissions(coalesce(role_permissions, '{}')) then
    raise exception 'Invalid role permissions';
  end if;
  insert into public.workspace_roles (workspace_id, name, permissions)
  values (target_workspace_id, btrim(role_name), coalesce(role_permissions, '{}'))
  returning * into new_role;
  return new_role;
end;
$$;

create or replace function public.update_workspace_role(target_workspace_id uuid, target_role_id uuid, role_name text, role_permissions text[])
returns public.workspace_roles language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  updated_role public.workspace_roles%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.session_is_allowed() then raise exception 'Authentication assurance required'; end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;
  select wm.role into actor_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  if actor_role is distinct from 'owner' then raise exception 'Only an owner can manage custom roles'; end if;
  if role_name is null or btrim(role_name) = '' then raise exception 'A role name is required'; end if;
  if not public.is_valid_role_permissions(coalesce(role_permissions, '{}')) then
    raise exception 'Invalid role permissions';
  end if;
  update public.workspace_roles
     set name = btrim(role_name), permissions = coalesce(role_permissions, '{}')
   where id = target_role_id and workspace_id = target_workspace_id
  returning * into updated_role;
  if not found then raise exception 'Custom role was not found'; end if;
  return updated_role;
end;
$$;

create or replace function public.delete_workspace_role(target_workspace_id uuid, target_role_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.session_is_allowed() then raise exception 'Authentication assurance required'; end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;
  select wm.role into actor_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  if actor_role is distinct from 'owner' then raise exception 'Only an owner can manage custom roles'; end if;
  begin
    delete from public.workspace_roles where id = target_role_id and workspace_id = target_workspace_id;
  exception when foreign_key_violation then
    raise exception 'This role is assigned to a member and cannot be deleted';
  end;
  if not found then raise exception 'Custom role was not found'; end if;
end;
$$;

create or replace function public.mark_notifications_read(target_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  touched integer;
begin
  if not public.session_is_allowed() then raise exception 'Authentication assurance required'; end if;
  update public.notifications
    set read_at = now()
  where recipient_id = auth.uid()
    and read_at is null
    and (target_ids is null or id = any (target_ids));
  get diagnostics touched = row_count;
  return touched;
end;
$$;

create table public.workspace_security_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid,
  subject_user_id uuid,
  action text not null check (action in (
    'member.added', 'member.role_changed', 'member.removed',
    'role.created', 'role.updated', 'role.deleted'
  )),
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 4096),
  created_at timestamptz not null default now()
);

create index workspace_security_events_workspace_created_idx
  on public.workspace_security_events (workspace_id, created_at desc);

create or replace function public.log_workspace_member_security_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.workspaces w where w.id = new.workspace_id) then return new; end if;
    insert into public.workspace_security_events (workspace_id, actor_id, subject_user_id, action, detail)
    values (new.workspace_id, auth.uid(), new.user_id, 'member.added',
      jsonb_build_object('new', jsonb_build_object('role', new.role, 'custom_role_id', new.custom_role_id)));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role or new.custom_role_id is distinct from old.custom_role_id then
      if not exists (select 1 from public.workspaces w where w.id = new.workspace_id) then return new; end if;
      insert into public.workspace_security_events (workspace_id, actor_id, subject_user_id, action, detail)
      values (new.workspace_id, auth.uid(), new.user_id, 'member.role_changed',
        jsonb_build_object(
          'old', jsonb_build_object('role', old.role, 'custom_role_id', old.custom_role_id),
          'new', jsonb_build_object('role', new.role, 'custom_role_id', new.custom_role_id)));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then return old; end if;
    insert into public.workspace_security_events (workspace_id, actor_id, subject_user_id, action, detail)
    values (old.workspace_id, auth.uid(), old.user_id, 'member.removed',
      jsonb_build_object('old', jsonb_build_object('role', old.role, 'custom_role_id', old.custom_role_id)));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists log_workspace_member_security_event on public.workspace_members;
create trigger log_workspace_member_security_event
  after insert or update or delete on public.workspace_members
  for each row execute procedure public.log_workspace_member_security_event();

create or replace function public.log_workspace_role_security_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.workspaces w where w.id = new.workspace_id) then return new; end if;
    insert into public.workspace_security_events (workspace_id, actor_id, subject_user_id, action, detail)
    values (new.workspace_id, auth.uid(), null, 'role.created',
      jsonb_build_object('new', jsonb_build_object('role_id', new.id, 'permissions', new.permissions)));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name or new.permissions is distinct from old.permissions then
      if not exists (select 1 from public.workspaces w where w.id = new.workspace_id) then return new; end if;
      insert into public.workspace_security_events (workspace_id, actor_id, subject_user_id, action, detail)
      values (new.workspace_id, auth.uid(), null, 'role.updated',
        jsonb_build_object(
          'old', jsonb_build_object('role_id', old.id, 'permissions', old.permissions),
          'new', jsonb_build_object('role_id', new.id, 'permissions', new.permissions)));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then return old; end if;
    insert into public.workspace_security_events (workspace_id, actor_id, subject_user_id, action, detail)
    values (old.workspace_id, auth.uid(), null, 'role.deleted',
      jsonb_build_object('old', jsonb_build_object('role_id', old.id, 'permissions', old.permissions)));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists log_workspace_role_security_event on public.workspace_roles;
create trigger log_workspace_role_security_event
  after insert or update or delete on public.workspace_roles
  for each row execute procedure public.log_workspace_role_security_event();

alter table public.workspace_security_events enable row level security;

create policy "Workspace managers can read security events" on public.workspace_security_events
  for select to authenticated
  using (public.session_is_allowed() and public.has_workspace_permission(workspace_id, 'members.manage'));

revoke all on public.workspace_security_events from public, authenticated;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.workspace_security_events from anon';
  end if;
end;
$do$;
grant select on public.workspace_security_events to authenticated;

create or replace function public.prune_workspace_security_events(before_time timestamptz) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare removed integer;
begin
  if before_time is null or before_time > now() - interval '30 days' then
    raise exception 'The cutoff must be at least 30 days in the past';
  end if;
  delete from public.workspace_security_events where created_at < before_time;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.prune_workspace_security_events(timestamptz) is
  'Operator tool: deletes workspace_security_events older than the cutoff (>= 30 days). No automatic schedule; service_role only.';

revoke execute on function public.prune_workspace_security_events(timestamptz) from public, authenticated;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.prune_workspace_security_events(timestamptz) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.prune_workspace_security_events(timestamptz) to service_role';
  end if;
end;
$do$;

revoke execute on function public.log_workspace_member_security_event(), public.log_workspace_role_security_event() from public, anon, authenticated;

-- Deny joins from the old raw-payload wire protocol. Deploy clients and DB together.
create or replace function public.page_topic_page_id(topic text) returns uuid
language sql immutable parallel safe as $$
  select case when topic ~ '^page-v2:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then substring(topic from 9)::uuid end;
$$;

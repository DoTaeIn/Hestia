-- 0024: workspace-scoped roles; document editing and membership management are independent.
-- Role definitions and grants of management remain owner-only. All member mutations lock the workspace.
-- NO ACTION prevents assigned-role deletion while permitting a full workspace cascade.

create table public.workspace_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint workspace_roles_workspace_id_key unique (workspace_id, id),
  constraint workspace_roles_workspace_name_key unique (workspace_id, name)
);

create or replace function public.is_valid_role_permissions(perms text[]) returns boolean
language sql immutable parallel safe as $$
  select perms is not null
     and coalesce(array_ndims(perms), 1) = 1
     and not exists (select 1 from unnest(perms) p where p not in ('pages.write', 'members.manage'))
     and (select count(*) from unnest(perms) p) = (select count(distinct p) from unnest(perms) p);
$$;

alter table public.workspace_roles
  add constraint workspace_roles_permissions_valid check (public.is_valid_role_permissions(permissions));

alter table public.workspace_members add column custom_role_id uuid;

alter table public.workspace_members
  add constraint workspace_members_custom_role_fk
  foreign key (workspace_id, custom_role_id)
  references public.workspace_roles (workspace_id, id)
  on delete no action;

alter table public.workspace_members
  add constraint workspace_members_custom_role_viewer_only
  check (custom_role_id is null or role = 'viewer');

create or replace function public.has_workspace_permission(target_workspace_id uuid, permission_key text) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select case
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

create or replace function public.can_edit_workspace(target_workspace_id uuid) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select public.has_workspace_permission(target_workspace_id, 'pages.write');
$$;

create or replace function public.transfer_page_ownership(target_page_id uuid, next_owner_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if next_owner_id is null then raise exception 'The next owner must be an editor in this workspace'; end if;
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found then raise exception 'Only the document owner can transfer ownership'; end if;
  if not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Only the document owner can transfer ownership';
  end if;
  if current_page.document_owner_id is distinct from auth.uid() then
    raise exception 'Only the document owner can transfer ownership';
  end if;
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = current_page.workspace_id and wm.user_id = next_owner_id
      and (
        wm.role in ('owner', 'admin', 'editor')
        or (wm.custom_role_id is not null and exists (
              select 1 from public.workspace_roles r
              where r.id = wm.custom_role_id and 'pages.write' = any(r.permissions)))
      )
  ) then
    raise exception 'The next owner must be an editor in this workspace';
  end if;
  update public.pages set document_owner_id = next_owner_id where id = target_page_id;
end;
$$;

create or replace function public.create_workspace_role(target_workspace_id uuid, role_name text, role_permissions text[])
returns public.workspace_roles language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  new_role public.workspace_roles%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
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

create or replace function public.assign_workspace_role(target_workspace_id uuid, target_user_id uuid, target_role_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  target_role text;
  target_custom_role_id uuid;
  target_grants_manage boolean;
  new_role_grants_manage boolean;
  workspace_owner_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_role_id is null then raise exception 'A role is required'; end if;
  select owner_id into workspace_owner_id from public.workspaces where id = target_workspace_id for update;
  if workspace_owner_id is null then raise exception 'Workspace was not found'; end if;

  if not public.has_workspace_permission(target_workspace_id, 'members.manage') then
    raise exception 'Not allowed to manage workspace members';
  end if;
  select wm.role into actor_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();

  if target_user_id = workspace_owner_id then raise exception 'The workspace owner role cannot be changed'; end if;

  select wm.role, wm.custom_role_id into target_role, target_custom_role_id from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id for update;
  if target_role is null then raise exception 'Workspace member was not found'; end if;

  select exists (
    select 1 from public.workspace_roles r where r.id = target_role_id and r.workspace_id = target_workspace_id
  ) into new_role_grants_manage;
  if not new_role_grants_manage then raise exception 'Custom role was not found'; end if;

  select 'members.manage' = any(permissions) into new_role_grants_manage
    from public.workspace_roles where id = target_role_id;

  target_grants_manage := target_custom_role_id is not null and exists (
    select 1 from public.workspace_roles r where r.id = target_custom_role_id and 'members.manage' = any(r.permissions)
  );

  if actor_role <> 'owner' then
    if target_role = 'admin' then raise exception 'Not allowed to manage this workspace member'; end if;
    if target_grants_manage then raise exception 'Not allowed to manage this workspace member'; end if;
    if new_role_grants_manage then raise exception 'Not allowed to assign a role that manages members'; end if;
  end if;

  update public.workspace_members set role = 'viewer', custom_role_id = target_role_id
   where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

create or replace function public.invite_workspace_member(target_workspace_id uuid, member_email text, next_role text)
returns table(user_id uuid, display_name text, role text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  member_id uuid;
  existing_role text;
  existing_custom_role_id uuid;
  existing_grants_manage boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if next_role is null then raise exception 'Invalid workspace role'; end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;

  if not public.has_workspace_permission(target_workspace_id, 'members.manage') then
    raise exception 'Not allowed to manage workspace members';
  end if;
  select wm.role into actor_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();

  if next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;

  select id into member_id from auth.users where lower(email) = lower(btrim(member_email));
  if member_id is null then raise exception 'This email has not signed in to Hestia yet'; end if;

  select wm.role, wm.custom_role_id into existing_role, existing_custom_role_id from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = member_id for update;

  existing_grants_manage := existing_custom_role_id is not null and exists (
    select 1 from public.workspace_roles r where r.id = existing_custom_role_id and 'members.manage' = any(r.permissions)
  );

  if actor_role <> 'owner' and existing_role is not null
     and (existing_role = 'admin' or existing_grants_manage) then
    raise exception 'Not allowed to manage this workspace member';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role) values (target_workspace_id, member_id, next_role)
  on conflict on constraint workspace_members_pkey do update
    set role = excluded.role, custom_role_id = null
    where public.workspace_members.role <> 'owner'
      and (actor_role = 'owner' or (public.workspace_members.role <> 'admin' and not existing_grants_manage));
  if not found then
    if actor_role <> 'owner' and existing_role is distinct from 'owner' then
      raise exception 'Not allowed to manage this workspace member';
    end if;
    raise exception 'The workspace owner role cannot be changed';
  end if;
  return query select member_id, coalesce(p.display_name, member_email), next_role from public.profiles p where p.id = member_id;
end;
$$;

create or replace function public.set_workspace_member_role(target_workspace_id uuid, target_user_id uuid, next_role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  target_role text;
  target_custom_role_id uuid;
  target_grants_manage boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if next_role is null then raise exception 'Invalid workspace role'; end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;

  if not public.has_workspace_permission(target_workspace_id, 'members.manage') then
    raise exception 'Not allowed to manage workspace members';
  end if;
  select wm.role into actor_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();

  select wm.role, wm.custom_role_id into target_role, target_custom_role_id from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id for update;
  if target_role is null then raise exception 'Workspace member was not found'; end if;
  if target_role = 'owner' then raise exception 'The workspace owner role cannot be changed'; end if;
  if next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;

  target_grants_manage := target_custom_role_id is not null and exists (
    select 1 from public.workspace_roles r where r.id = target_custom_role_id and 'members.manage' = any(r.permissions)
  );
  if actor_role <> 'owner' and (target_role = 'admin' or target_grants_manage) then
    raise exception 'Not allowed to manage this workspace member';
  end if;

  update public.workspace_members set role = next_role, custom_role_id = null
   where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

create or replace function public.remove_workspace_member(target_workspace_id uuid, target_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  target_role text;
  target_custom_role_id uuid;
  target_grants_manage boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.workspaces where id = target_workspace_id for update;

  if not public.has_workspace_permission(target_workspace_id, 'members.manage') then
    raise exception 'Not allowed to manage workspace members';
  end if;
  select wm.role into actor_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();

  select wm.role, wm.custom_role_id into target_role, target_custom_role_id from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id for update;
  if target_role is null then return; end if;

  target_grants_manage := target_custom_role_id is not null and exists (
    select 1 from public.workspace_roles r where r.id = target_custom_role_id and 'members.manage' = any(r.permissions)
  );
  if target_role = 'owner' or (actor_role <> 'owner' and (target_role = 'admin' or target_grants_manage)) then
    raise exception 'Not allowed to remove this workspace member';
  end if;
  delete from public.workspace_members where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

create or replace function public.list_workspace_members(target_workspace_id uuid)
returns table(user_id uuid, display_name text, role text, custom_role_id uuid, role_name text, permissions text[], created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp stable as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_workspace_member(target_workspace_id) then
    raise exception 'Not allowed to view this workspace''s members';
  end if;
  return query
    select wm.user_id, p.display_name, wm.role, wm.custom_role_id, coalesce(r.name, wm.role),
      case when wm.custom_role_id is not null then r.permissions
           when wm.role in ('owner', 'admin') then array['pages.write','members.manage']::text[]
           when wm.role = 'editor' then array['pages.write']::text[]
           else array[]::text[] end,
      wm.created_at
    from public.workspace_members wm
    join public.profiles p on p.id = wm.user_id
    left join public.workspace_roles r on r.id = wm.custom_role_id
    where wm.workspace_id = target_workspace_id;
end;
$$;

alter table public.workspace_roles enable row level security;

create policy "Members can read custom roles" on public.workspace_roles
  for select to authenticated using (public.is_workspace_member(workspace_id));

revoke all on public.workspace_roles from public, authenticated;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.workspace_roles from anon';
  end if;
end;
$do$;
grant select on public.workspace_roles to authenticated;

revoke execute on function
  public.is_valid_role_permissions(text[]),
  public.has_workspace_permission(uuid, text),
  public.create_workspace_role(uuid, text, text[]),
  public.update_workspace_role(uuid, uuid, text, text[]),
  public.delete_workspace_role(uuid, uuid),
  public.assign_workspace_role(uuid, uuid, uuid),
  public.list_workspace_members(uuid)
from public, authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function
        public.is_valid_role_permissions(text[]),
        public.has_workspace_permission(uuid, text),
        public.create_workspace_role(uuid, text, text[]),
        public.update_workspace_role(uuid, uuid, text, text[]),
        public.delete_workspace_role(uuid, uuid),
        public.assign_workspace_role(uuid, uuid, uuid),
        public.list_workspace_members(uuid)
      from anon';
  end if;
end;
$do$;

grant execute on function public.has_workspace_permission(uuid, text) to authenticated;
grant execute on function
  public.create_workspace_role(uuid, text, text[]),
  public.update_workspace_role(uuid, uuid, text, text[]),
  public.delete_workspace_role(uuid, uuid),
  public.assign_workspace_role(uuid, uuid, uuid),
  public.list_workspace_members(uuid)
to authenticated;

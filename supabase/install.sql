-- Hestia Preview 0.1 (0.1.0-preview.3) — generated; edit numbered migrations.
-- FRESH SUPABASE DATABASE ONLY. Existing installs use migration up, not this file.
-- Requires Supabase Auth, Storage, Realtime schemas and standard API roles.
begin;
do $fresh$
begin
  if exists (select 1 from pg_tables where schemaname = 'public'
    and tablename in ('profiles','workspaces','workspace_roles','workspace_members','pages','page_revisions','page_collaboration','page_collaboration_updates','comment_threads','comments','notifications')) then
    raise exception 'Hestia tables already exist. Apply pending numbered migrations instead.';
  end if;
end;
$fresh$;

-- ===== 0001_auth_workspaces.sql | SHA256 11c86c5a45032dac315202483424f83229816cef892322da5fa9e7fa7a2a272d =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create function public.add_workspace_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger on_workspace_created after insert on public.workspaces for each row execute procedure public.add_workspace_owner();

create function public.is_workspace_member(target_workspace_id uuid) returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.workspace_members where workspace_id = target_workspace_id and user_id = auth.uid());
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "Profiles are visible to signed-in users" on public.profiles for select to authenticated using (true);
create policy "Users update their own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Members can read workspaces" on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy "Users create their own workspaces" on public.workspaces for insert to authenticated with check (owner_id = auth.uid());
create policy "Members can read membership" on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));

grant select, update on public.profiles to authenticated;
grant select, insert on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;


-- ===== 0002_pages.sql | SHA256 c1806ef01b343983b79ada27846729a23a64a772bd0648b9a14267bb2e061f62 =====
alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner', 'admin', 'editor', 'viewer'));

create function public.can_edit_workspace(target_workspace_id uuid) returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid()
      and role in ('owner', 'admin', 'editor')
  );
$$;

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid references public.pages(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  position bigint not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pages_workspace_parent_position_idx on public.pages (workspace_id, parent_id, position, created_at);

create function public.validate_page_parent() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.pages where id = new.parent_id and workspace_id = new.workspace_id
  ) then
    raise exception 'A page parent must belong to the same workspace';
  end if;
  return new;
end;
$$;

create function public.touch_page() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

create trigger validate_page_parent before insert or update of parent_id, workspace_id on public.pages for each row execute procedure public.validate_page_parent();
create trigger touch_page before update on public.pages for each row execute procedure public.touch_page();

alter table public.pages enable row level security;

create policy "Members can read pages" on public.pages for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "Editors can create pages" on public.pages for insert to authenticated with check (public.can_edit_workspace(workspace_id) and created_by = auth.uid());
create policy "Editors can update pages" on public.pages for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
create policy "Editors can delete pages" on public.pages for delete to authenticated using (public.can_edit_workspace(workspace_id));

grant select, insert, update, delete on public.pages to authenticated;


-- ===== 0003_page_tree_and_trash.sql | SHA256 fb118dde9b9ab6ca3b2bbf58f6b9ca82316b94bd8befb964bacf00324b3adcea =====
alter table public.pages add column deleted_at timestamptz;
alter table public.pages add column deleted_by uuid references auth.users(id) on delete set null;

create index pages_workspace_deleted_idx on public.pages (workspace_id, deleted_at, updated_at desc);

create or replace function public.validate_page_parent() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id = new.id then
    raise exception 'A page cannot be its own parent';
  end if;
  if new.parent_id is not null and not exists (
    select 1 from public.pages where id = new.parent_id and workspace_id = new.workspace_id
  ) then
    raise exception 'A page parent must belong to the same workspace';
  end if;
  if new.parent_id is not null and exists (
    with recursive descendants as (
      select id from public.pages where id = new.id
      union all
      select page.id from public.pages page join descendants on page.parent_id = descendants.id
    ) select 1 from descendants where id = new.parent_id
  ) then
    raise exception 'A page cannot move below one of its descendants';
  end if;
  return new;
end;
$$;

create or replace function public.trash_page(target_page_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare target_workspace_id uuid;
begin
  select workspace_id into target_workspace_id from public.pages where id = target_page_id;
  if target_workspace_id is null or not public.can_edit_workspace(target_workspace_id) then
    raise exception 'Not allowed to trash this page';
  end if;
  with recursive subtree as (
    select id from public.pages where id = target_page_id
    union all
    select page.id from public.pages page join subtree on page.parent_id = subtree.id
  )
  update public.pages set deleted_at = now(), deleted_by = auth.uid() where id in (select id from subtree) and deleted_at is null;
end;
$$;

create or replace function public.restore_page(target_page_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare target_workspace_id uuid;
begin
  select workspace_id into target_workspace_id from public.pages where id = target_page_id;
  if target_workspace_id is null or not public.can_edit_workspace(target_workspace_id) then
    raise exception 'Not allowed to restore this page';
  end if;
  with recursive subtree as (
    select id from public.pages where id = target_page_id
    union all
    select page.id from public.pages page join subtree on page.parent_id = subtree.id
  )
  update public.pages set deleted_at = null, deleted_by = null where id in (select id from subtree);
end;
$$;

drop policy "Editors can delete pages" on public.pages;
revoke delete on public.pages from authenticated;
grant execute on function public.trash_page(uuid), public.restore_page(uuid) to authenticated;


-- ===== 0004_page_revisions.sql | SHA256 074e8f45da0cf2c46602b523ee9ab13b3bba9fe0b6a235975537ab39a31ac083 =====
create table public.page_revisions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version integer not null,
  title text not null,
  content jsonb not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (page_id, version)
);

create index page_revisions_page_created_idx on public.page_revisions (page_id, created_at desc);

alter table public.page_revisions enable row level security;

create policy "Members can read page revisions" on public.page_revisions for select to authenticated using (public.is_workspace_member(workspace_id));

create function public.save_page_version(target_page_id uuid, next_title text, next_content jsonb) returns public.page_revisions language plpgsql security definer set search_path = public as $$
declare
  current_page public.pages%rowtype;
  new_revision public.page_revisions%rowtype;
  next_version integer;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to save this page';
  end if;

  update public.pages set title = next_title, content = next_content, updated_at = now(), updated_by = auth.uid() where id = target_page_id;
  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content)
  values (target_page_id, current_page.workspace_id, next_version, next_title, next_content)
  returning * into new_revision;
  return new_revision;
end;
$$;

grant select on public.page_revisions to authenticated;
grant execute on function public.save_page_version(uuid, text, jsonb) to authenticated;


-- ===== 0005_workspace_sharing.sql | SHA256 e5cfca2908bce6c8f20a0a7cbb3b6b5d2145f599aa6f1406cef319723e7312fc =====
create function public.invite_workspace_member(target_workspace_id uuid, member_email text, next_role text)
returns table(user_id uuid, display_name text, role text)
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  member_id uuid;
begin
  select wm.role into actor_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  if actor_role not in ('owner', 'admin') then raise exception 'Not allowed to manage workspace members'; end if;
  if next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;
  select id into member_id from auth.users where lower(email) = lower(trim(member_email));
  if member_id is null then raise exception 'This email has not signed in to Hestia yet'; end if;

  insert into public.workspace_members (workspace_id, user_id, role) values (target_workspace_id, member_id, next_role)
  on conflict on constraint workspace_members_pkey do update set role = excluded.role where public.workspace_members.role <> 'owner';
  if not found then raise exception 'The workspace owner role cannot be changed'; end if;
  return query select member_id, coalesce(p.display_name, member_email), next_role from public.profiles p where p.id = member_id;
end;
$$;

create function public.set_workspace_member_role(target_workspace_id uuid, target_user_id uuid, next_role text) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  target_role text;
begin
  select wm.role into actor_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  select wm.role into target_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id;
  if actor_role not in ('owner', 'admin') then raise exception 'Not allowed to manage workspace members'; end if;
  if target_role is null then raise exception 'Workspace member was not found'; end if;
  if target_role = 'owner' then raise exception 'The workspace owner role cannot be changed'; end if;
  if next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;
  if actor_role = 'admin' and target_role = 'admin' then raise exception 'Not allowed to manage this workspace member'; end if;
  update public.workspace_members set role = next_role where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

create function public.remove_workspace_member(target_workspace_id uuid, target_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  target_role text;
begin
  select wm.role into actor_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  select wm.role into target_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id;
  if actor_role not in ('owner', 'admin') then raise exception 'Not allowed to manage workspace members'; end if;
  if target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then raise exception 'Not allowed to remove this workspace member'; end if;
  delete from public.workspace_members where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

grant execute on function public.invite_workspace_member(uuid, text, text), public.set_workspace_member_role(uuid, uuid, text), public.remove_workspace_member(uuid, uuid) to authenticated;


-- ===== 0006_workspace_sharing_role_fix.sql | SHA256 4d0a308b9f141f373bc32315e139569e7662d57b057919e472c1b38d6b315f3d =====
-- Existing local projects may already have 0005; redefine the functions with
-- qualified membership columns so the RPC return field `role` is unambiguous.
create or replace function public.invite_workspace_member(target_workspace_id uuid, member_email text, next_role text)
returns table(user_id uuid, display_name text, role text)
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  member_id uuid;
begin
  select wm.role into actor_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  if actor_role not in ('owner', 'admin') then raise exception 'Not allowed to manage workspace members'; end if;
  if next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;
  select id into member_id from auth.users where lower(email) = lower(trim(member_email));
  if member_id is null then raise exception 'This email has not signed in to Hestia yet'; end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (target_workspace_id, member_id, next_role)
  on conflict on constraint workspace_members_pkey do update set role = excluded.role where public.workspace_members.role <> 'owner';
  if not found then raise exception 'The workspace owner role cannot be changed'; end if;
  return query select member_id, coalesce(p.display_name, member_email), next_role from public.profiles p where p.id = member_id;
end;
$$;

create or replace function public.set_workspace_member_role(target_workspace_id uuid, target_user_id uuid, next_role text) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  target_role text;
begin
  select wm.role into actor_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  select wm.role into target_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id;
  if actor_role not in ('owner', 'admin') then raise exception 'Not allowed to manage workspace members'; end if;
  if target_role is null then raise exception 'Workspace member was not found'; end if;
  if target_role = 'owner' then raise exception 'The workspace owner role cannot be changed'; end if;
  if next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;
  if actor_role = 'admin' and target_role = 'admin' then raise exception 'Not allowed to manage this workspace member'; end if;
  update public.workspace_members set role = next_role where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

create or replace function public.remove_workspace_member(target_workspace_id uuid, target_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  target_role text;
begin
  select wm.role into actor_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  select wm.role into target_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id;
  if actor_role not in ('owner', 'admin') then raise exception 'Not allowed to manage workspace members'; end if;
  if target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then raise exception 'Not allowed to remove this workspace member'; end if;
  delete from public.workspace_members where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;


-- ===== 0007_workspace_invite_conflict_fix.sql | SHA256 6cf104b0cf70f9946dc64d1870d1c37df23f1e197dcf60cdffbae10925179706 =====
create or replace function public.invite_workspace_member(target_workspace_id uuid, member_email text, next_role text)
returns table(user_id uuid, display_name text, role text)
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  member_id uuid;
begin
  select wm.role into actor_role from public.workspace_members wm where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid();
  if actor_role not in ('owner', 'admin') then raise exception 'Not allowed to manage workspace members'; end if;
  if next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;
  select id into member_id from auth.users where lower(email) = lower(trim(member_email));
  if member_id is null then raise exception 'This email has not signed in to Hestia yet'; end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (target_workspace_id, member_id, next_role)
  on conflict on constraint workspace_members_pkey do update set role = excluded.role where public.workspace_members.role <> 'owner';
  if not found then raise exception 'The workspace owner role cannot be changed'; end if;
  return query select member_id, coalesce(p.display_name, member_email), next_role from public.profiles p where p.id = member_id;
end;
$$;


-- ===== 0008_comments.sql | SHA256 a68a8ca31df369742429d12fe9900cd377286f46008530a59ea13aa0fba9408b =====
create table public.comment_threads (
  id uuid primary key,
  page_id uuid not null references public.pages(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  quote text not null check (char_length(quote) between 1 and 2000),
  anchor_from integer not null check (anchor_from >= 0),
  anchor_to integer not null check (anchor_to > anchor_from),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.comment_threads(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete restrict,
  check ((deleted_at is null) = (deleted_by is null))
);

create index comment_threads_page_created_idx on public.comment_threads (page_id, created_at);
create index comments_thread_created_idx on public.comments (thread_id, created_at);

create function public.validate_comment_thread() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  page_workspace_id uuid;
begin
  select workspace_id into page_workspace_id from public.pages where id = new.page_id and deleted_at is null;
  if page_workspace_id is null or page_workspace_id <> new.workspace_id then raise exception 'Comment thread page must belong to its workspace'; end if;
  return new;
end;
$$;

create trigger validate_comment_thread before insert on public.comment_threads for each row execute procedure public.validate_comment_thread();

alter table public.comment_threads enable row level security;
alter table public.comments enable row level security;

create policy "Members can read comment threads" on public.comment_threads for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "Editors can create comment threads" on public.comment_threads for insert to authenticated with check (public.can_edit_workspace(workspace_id) and created_by = auth.uid());
create policy "Members can read comments" on public.comments for select to authenticated using (exists (select 1 from public.comment_threads t where t.id = thread_id and public.is_workspace_member(t.workspace_id)));
create policy "Editors can create comments" on public.comments for insert to authenticated with check (created_by = auth.uid() and exists (select 1 from public.comment_threads t where t.id = thread_id and public.can_edit_workspace(t.workspace_id)));

create function public.soft_delete_comment(target_comment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  comment_row public.comments%rowtype;
  actor_role text;
begin
  select c.* into comment_row from public.comments c where c.id = target_comment_id for update;
  if not found then raise exception 'Comment was not found'; end if;
  select wm.role into actor_role from public.workspace_members wm join public.comment_threads t on t.workspace_id = wm.workspace_id where t.id = comment_row.thread_id and wm.user_id = auth.uid();
  if comment_row.created_by <> auth.uid() and actor_role not in ('owner', 'admin') then raise exception 'Not allowed to delete this comment'; end if;
  if comment_row.deleted_at is null then update public.comments set deleted_at = now(), deleted_by = auth.uid() where id = target_comment_id; end if;
end;
$$;

grant select, insert on public.comment_threads, public.comments to authenticated;
grant execute on function public.soft_delete_comment(uuid) to authenticated;


-- ===== 0009_page_images.sql | SHA256 b927292b7fd634e3991778ecee5fe81e61fee0eeedec86805aec4117dc91ca5f =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('page-images', 'page-images', false, 20971520, array['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = excluded.allowed_mime_types;

create policy "Workspace members can read page images" on storage.objects for select to authenticated
using (bucket_id = 'page-images' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

create policy "Editors can upload page images" on storage.objects for insert to authenticated
with check (bucket_id = 'page-images' and public.can_edit_workspace((storage.foldername(name))[1]::uuid));

create policy "Editors can delete page images" on storage.objects for delete to authenticated
using (bucket_id = 'page-images' and public.can_edit_workspace((storage.foldername(name))[1]::uuid));


-- ===== 0010_restore_page_revision.sql | SHA256 fa72d43d0ca5bee5c048e8e0d9ac93b708bc2be083299411beadea8ca656c309 =====
create or replace function public.restore_page_revision(target_page_id uuid, source_revision_id uuid) returns public.page_revisions language plpgsql security definer set search_path = public as $$
declare
  current_page public.pages%rowtype;
  source_revision public.page_revisions%rowtype;
  restored_revision public.page_revisions%rowtype;
  next_version integer;
begin
  -- Lock the page first so saves and restores always allocate versions in order.
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to restore this page';
  end if;

  select * into source_revision from public.page_revisions
  where id = source_revision_id and page_id = target_page_id and workspace_id = current_page.workspace_id;
  if not found then
    raise exception 'Revision not found';
  end if;

  update public.pages set title = source_revision.title, content = source_revision.content where id = target_page_id;
  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content)
  values (target_page_id, current_page.workspace_id, next_version, source_revision.title, source_revision.content)
  returning * into restored_revision;
  return restored_revision;
end;
$$;

grant execute on function public.restore_page_revision(uuid, uuid) to authenticated;


-- ===== 0011_live_collaboration.sql | SHA256 cffcba8ab46e471d817a31bec0cc536bbe9c014a7e6ffedf8217cced51e1a8d7 =====
alter table public.pages add column if not exists document_owner_id uuid references auth.users(id) on delete restrict;
alter table public.pages disable trigger touch_page;
update public.pages set document_owner_id = created_by where document_owner_id is null;
alter table public.pages enable trigger touch_page;
alter table public.pages alter column document_owner_id set not null;
alter table public.pages alter column document_owner_id set default auth.uid();
create index pages_document_owner_idx on public.pages (document_owner_id);

create table public.page_collaboration (
  page_id uuid primary key references public.pages(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  state text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.page_collaboration enable row level security;
create policy "Members can read collaboration state" on public.page_collaboration for select to authenticated using (public.is_workspace_member(workspace_id));

create or replace function public.initialize_page_collaboration(target_page_id uuid)
returns table(collaboration_state text, should_seed boolean)
language plpgsql security definer set search_path = public as $$
declare
  current_page public.pages%rowtype;
  was_created boolean := false;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to collaborate on this page';
  end if;

  insert into public.page_collaboration (page_id, workspace_id)
  values (current_page.id, current_page.workspace_id)
  on conflict (page_id) do nothing;
  get diagnostics was_created = row_count;

  if was_created then return query select null::text, true; return; end if;
  return query select state, false from public.page_collaboration where page_id = target_page_id;
end;
$$;

create or replace function public.save_page_collaboration(target_page_id uuid, next_state text)
returns void language plpgsql security definer set search_path = public as $$
declare current_page public.pages%rowtype;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to collaborate on this page';
  end if;
  update public.page_collaboration set state = next_state, updated_by = auth.uid(), updated_at = now()
  where page_id = target_page_id;
end;
$$;

create or replace function public.transfer_page_ownership(target_page_id uuid, next_owner_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare current_page public.pages%rowtype; next_role text;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or current_page.document_owner_id <> auth.uid() then raise exception 'Only the document owner can transfer ownership'; end if;
  select role into next_role from public.workspace_members where workspace_id = current_page.workspace_id and user_id = next_owner_id;
  if next_role not in ('owner', 'admin', 'editor') then raise exception 'The next owner must be an editor in this workspace'; end if;
  update public.pages set document_owner_id = next_owner_id where id = target_page_id;
end;
$$;

create or replace function public.save_page_version(target_page_id uuid, next_title text, next_content jsonb) returns public.page_revisions language plpgsql security definer set search_path = public as $$
declare current_page public.pages%rowtype; new_revision public.page_revisions%rowtype; next_version integer;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or current_page.document_owner_id <> auth.uid() then raise exception 'Only the document owner can save a version'; end if;
  update public.pages set title = next_title, content = next_content, updated_at = now(), updated_by = auth.uid() where id = target_page_id;
  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content) values (target_page_id, current_page.workspace_id, next_version, next_title, next_content) returning * into new_revision;
  return new_revision;
end;
$$;

create or replace function public.restore_page_revision(target_page_id uuid, source_revision_id uuid) returns public.page_revisions language plpgsql security definer set search_path = public as $$
declare current_page public.pages%rowtype; source_revision public.page_revisions%rowtype; restored_revision public.page_revisions%rowtype; next_version integer;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or current_page.document_owner_id <> auth.uid() then raise exception 'Only the document owner can restore a version'; end if;
  select * into source_revision from public.page_revisions where id = source_revision_id and page_id = target_page_id and workspace_id = current_page.workspace_id;
  if not found then raise exception 'Revision not found'; end if;
  update public.pages set title = source_revision.title, content = source_revision.content where id = target_page_id;
  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content) values (target_page_id, current_page.workspace_id, next_version, source_revision.title, source_revision.content) returning * into restored_revision;
  return restored_revision;
end;
$$;

grant execute on function public.initialize_page_collaboration(uuid), public.save_page_collaboration(uuid, text), public.transfer_page_ownership(uuid, uuid) to authenticated;


-- ===== 0012_restore_collaboration_state.sql | SHA256 fa2d9c06e5866ced0785c0a6b73434a0fd573b244e19d911c01bc96d6ca94488 =====
create or replace function public.initialize_page_collaboration(target_page_id uuid)
returns table(collaboration_state text, should_seed boolean)
language plpgsql security definer set search_path = public as $$
declare current_page public.pages%rowtype;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to collaborate on this page';
  end if;

  insert into public.page_collaboration (page_id, workspace_id)
  values (current_page.id, current_page.workspace_id)
  on conflict (page_id) do nothing;

  return query
  select state, state is null
  from public.page_collaboration
  where page_id = target_page_id;
end;
$$;

create or replace function public.restore_page_revision(target_page_id uuid, source_revision_id uuid) returns public.page_revisions language plpgsql security definer set search_path = public as $$
declare current_page public.pages%rowtype; source_revision public.page_revisions%rowtype; restored_revision public.page_revisions%rowtype; next_version integer;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or current_page.document_owner_id <> auth.uid() then raise exception 'Only the document owner can restore a version'; end if;
  select * into source_revision from public.page_revisions where id = source_revision_id and page_id = target_page_id and workspace_id = current_page.workspace_id;
  if not found then raise exception 'Revision not found'; end if;
  update public.pages set title = source_revision.title, content = source_revision.content where id = target_page_id;
  update public.page_collaboration set state = null, updated_by = auth.uid(), updated_at = now() where page_id = target_page_id;
  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content) values (target_page_id, current_page.workspace_id, next_version, source_revision.title, source_revision.content) returning * into restored_revision;
  return restored_revision;
end;
$$;


-- ===== 0013_collaboration_generation.sql | SHA256 cbb1c1b891da3ddf5180340c47c29f4896ae74641ab7058029cbb62e75d2c1e1 =====
alter table public.page_collaboration add column if not exists generation integer not null default 1;

drop function if exists public.initialize_page_collaboration(uuid);
create or replace function public.initialize_page_collaboration(target_page_id uuid)
returns table(collaboration_state text, should_seed boolean, collaboration_generation integer)
language plpgsql security definer set search_path = public as $$
declare current_page public.pages%rowtype;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to collaborate on this page';
  end if;
  insert into public.page_collaboration (page_id, workspace_id)
  values (current_page.id, current_page.workspace_id)
  on conflict (page_id) do nothing;
  return query select state, state is null, generation from public.page_collaboration where page_id = target_page_id;
end;
$$;

create or replace function public.save_page_collaboration(target_page_id uuid, next_state text, expected_generation integer)
returns void language plpgsql security definer set search_path = public as $$
declare current_page public.pages%rowtype;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to collaborate on this page';
  end if;
  update public.page_collaboration
  set state = next_state, updated_by = auth.uid(), updated_at = now()
  where page_id = target_page_id and generation = expected_generation;
  if not found then raise exception 'This document was restored. Refresh to continue editing.'; end if;
end;
$$;

create or replace function public.restore_page_revision(target_page_id uuid, source_revision_id uuid) returns public.page_revisions language plpgsql security definer set search_path = public as $$
declare current_page public.pages%rowtype; source_revision public.page_revisions%rowtype; restored_revision public.page_revisions%rowtype; next_version integer;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or current_page.document_owner_id <> auth.uid() then raise exception 'Only the document owner can restore a version'; end if;
  select * into source_revision from public.page_revisions where id = source_revision_id and page_id = target_page_id and workspace_id = current_page.workspace_id;
  if not found then raise exception 'Revision not found'; end if;
  update public.pages set title = source_revision.title, content = source_revision.content where id = target_page_id;
  update public.page_collaboration set state = null, generation = generation + 1, updated_by = auth.uid(), updated_at = now() where page_id = target_page_id;
  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content) values (target_page_id, current_page.workspace_id, next_version, source_revision.title, source_revision.content) returning * into restored_revision;
  return restored_revision;
end;
$$;

grant execute on function public.initialize_page_collaboration(uuid), public.save_page_collaboration(uuid, text, integer) to authenticated;


-- ===== 0014_notifications.sql | SHA256 8df19145b58b9d45d1abfcf128f97e292e46df36a1c231785f93f9553cf9c549 =====
-- Notifications. A comment is the one thing that happens *to* you in Hestia:
-- someone asks a question on a sentence you wrote and, until now, nothing told
-- you. Rows are written by a trigger rather than by the app so every path that
-- inserts a comment produces the same notification.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  -- actor points at profiles, not auth.users, so the client can embed the name
  actor_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  page_id uuid references public.pages(id) on delete cascade,
  thread_id uuid references public.comment_threads(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  kind text not null check (kind in ('comment_on_document', 'reply_in_thread')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (recipient_id <> actor_id)
);

create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);

-- the bell only ever counts unread, so keep that lookup off the full history
create index notifications_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;

alter table public.notifications enable row level security;

create policy "Recipients read their own notifications" on public.notifications
  for select to authenticated using (recipient_id = auth.uid());

create function public.notify_on_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  thread public.comment_threads%rowtype;
  owner_id uuid;
begin
  select * into thread from public.comment_threads where id = new.thread_id;
  if not found then return new; end if;

  select document_owner_id into owner_id from public.pages where id = thread.page_id;

  -- Everyone with a stake in this thread: the document's owner, whoever opened
  -- the thread, and everyone who has already spoken in it. Still a member of
  -- the workspace, and never the person who just typed.
  insert into public.notifications
    (recipient_id, actor_id, workspace_id, page_id, thread_id, comment_id, kind)
  select
    stake.user_id,
    new.created_by,
    thread.workspace_id,
    thread.page_id,
    thread.id,
    new.id,
    case when stake.user_id = owner_id then 'comment_on_document' else 'reply_in_thread' end
  from (
    select owner_id as user_id
    union
    select thread.created_by
    union
    select c.created_by from public.comments c where c.thread_id = new.thread_id
  ) stake
  join public.workspace_members wm
    on wm.workspace_id = thread.workspace_id and wm.user_id = stake.user_id
  where stake.user_id is not null
    and stake.user_id <> new.created_by;

  return new;
end;
$$;

create trigger notify_on_comment
  after insert on public.comments
  for each row execute procedure public.notify_on_comment();

-- Marking read is the only write a reader may make, so it goes through a
-- function instead of an update policy that would expose every column.
create function public.mark_notifications_read(target_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  touched integer;
begin
  update public.notifications
    set read_at = now()
  where recipient_id = auth.uid()
    and read_at is null
    and (target_ids is null or id = any (target_ids));
  get diagnostics touched = row_count;
  return touched;
end;
$$;

grant select on public.notifications to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;


-- ===== 0015_revision_reason.sql | SHA256 7c4e278cf0bda713c9573062a99578aabd798c56b13459fc97e0534e3d71f93d =====
-- 왜(Why)를 1급 시민으로 — docs/WHY.md P0.
-- 판이 무엇을 바꿨는지만이 아니라 왜 바꿨는지를 함께 보관한다.
-- nullable 이다: 이유 없이도 저장은 그대로 된다. 강제가 아니라 비대칭 보상이다.
alter table public.page_revisions add column reason text;

-- 파라미터를 하나 늘리면 default 가 있어도 기존 시그니처와 오버로드가 되어
-- 3인자 호출이 모호해진다. 옛 함수를 먼저 지운다.
drop function public.save_page_version(uuid, text, jsonb);
drop function public.restore_page_revision(uuid, uuid);

create function public.save_page_version(target_page_id uuid, next_title text, next_content jsonb, change_reason text default null)
returns public.page_revisions language plpgsql security definer set search_path = public as $$
declare
  current_page public.pages%rowtype;
  new_revision public.page_revisions%rowtype;
  next_version integer;
begin
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to save this page';
  end if;

  update public.pages set title = next_title, content = next_content, updated_at = now(), updated_by = auth.uid() where id = target_page_id;
  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content, reason)
  values (target_page_id, current_page.workspace_id, next_version, next_title, next_content, nullif(btrim(change_reason), ''))
  returning * into new_revision;
  return new_revision;
end;
$$;

create function public.restore_page_revision(target_page_id uuid, source_revision_id uuid, change_reason text default null)
returns public.page_revisions language plpgsql security definer set search_path = public as $$
declare
  current_page public.pages%rowtype;
  source_revision public.page_revisions%rowtype;
  restored_revision public.page_revisions%rowtype;
  next_version integer;
begin
  -- Lock the page first so saves and restores always allocate versions in order.
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to restore this page';
  end if;

  select * into source_revision from public.page_revisions
  where id = source_revision_id and page_id = target_page_id and workspace_id = current_page.workspace_id;
  if not found then
    raise exception 'Revision not found';
  end if;

  update public.pages set title = source_revision.title, content = source_revision.content where id = target_page_id;
  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content, reason)
  values (target_page_id, current_page.workspace_id, next_version, source_revision.title, source_revision.content, nullif(btrim(change_reason), ''))
  returning * into restored_revision;
  return restored_revision;
end;
$$;

grant execute on function public.save_page_version(uuid, text, jsonb, text) to authenticated;
grant execute on function public.restore_page_revision(uuid, uuid, text) to authenticated;


-- ===== 0016_backfill_revision_reason.sql | SHA256 78d6cd732712f495cd7775fcee417fdf0219dac4779b023040ed53c7e45f6e1e =====
-- docs/WHY.md P1 — 지난 판에 이유를 뒤늦게 채운다.
-- 별도 RPC 를 만들지 않는다. 컬럼 단위 grant 로 `reason` 외에는 손댈 수 없고,
-- 행 범위는 기존 RLS 헬퍼가 그대로 판정한다.
create policy "Editors can fill in a revision reason" on public.page_revisions
  for update to authenticated
  using (public.can_edit_workspace(workspace_id))
  with check (public.can_edit_workspace(workspace_id));

grant update (reason) on public.page_revisions to authenticated;

-- ponytail: 이유는 덮어쓰기 가능하고 그 이력은 남지 않는다 (WHY.md §6).
-- 누가 언제 왜 이유를 고쳤는지가 문제가 되면 그때 reason_history 를 판다.


-- ===== 0017_search.sql | SHA256 0e4986a2a8f245f100cb16a7853b6d9a1c5ccca4a5130c41a77f29f0851a7845 =====
-- 검색을 DB 로 내린다. 지금까지는 워크스페이스의 모든 페이지를 브라우저로 보내
-- 클라이언트에서 includes() 로 걸렀다. 그리고 docs/WHY.md P2 — 이유도 검색 대상이 된다.
--
-- tsvector 가 아니라 pg_trgm 을 쓴다. `to_tsvector` 는 낱말 경계로 자르는데
-- 한국어는 조사가 붙어("문서를") 형태소 분석기 없이는 "문서" 로 못 찾는다.
-- 형태소 분석기 도입 여부는 아직 사람이 정하지 않은 항목이라, 그 결정을 강요하지
-- 않는 쪽을 골랐다. trigram 은 부분 문자열 매칭이라 지금 UX(includes) 와 결과가
-- 같고, 조사가 붙어도 찾는다.
-- ponytail: 대신 관련도 순위가 없다. 정렬은 문서 먼저 / 이유 나중일 뿐이다.
-- 순위가 필요해지면 그때 형태소 분석기 + tsvector 를 얹는다.
create extension if not exists pg_trgm;

-- ProseMirror JSON 에서 평문만 뽑는다. lib/pages.ts 의 documentText 와 같은 일.
-- 생성 열에 쓰려면 immutable 이어야 한다.
--
-- jsonpath `$.**.text` 를 쓰면 안 된다. lax 모드에서 `**` 는 배열을 풀어헤치면서
-- 같은 노드에 두 경로로 도달해 본문이 그대로 두 번 나온다 (실제로 겪었다).
-- `content` 배열만 따라 내려가는 재귀가 ProseMirror 구조와도 정확히 맞는다.
-- path 로 정렬해야 문서 순서가 보존된다 — 순서가 틀리면 구절 검색이 깨진다.
create function public.document_plain_text(doc jsonb) returns text
language sql immutable parallel safe as $$
  with recursive walk(node, path) as (
    select doc, array[0]
    union all
    select child.value, walk.path || child.ord::int
    from walk cross join lateral jsonb_array_elements(walk.node -> 'content') with ordinality as child(value, ord)
    where jsonb_typeof(walk.node -> 'content') = 'array'
  )
  select coalesce(string_agg(node ->> 'text', ' ' order by path), '')
  from walk
  where node ? 'text';
$$;

alter table public.pages add column search_text text
  generated always as (coalesce(title, '') || ' ' || public.document_plain_text(content)) stored;

create index pages_search_trgm_idx on public.pages using gin (search_text gin_trgm_ops);
create index page_revisions_reason_trgm_idx on public.page_revisions using gin (reason gin_trgm_ops);

-- security definer 가 아니다. 호출자 권한으로 돌아 pages·page_revisions 의 RLS 가
-- 그대로 적용된다. 검색이 권한 우회 통로가 되면 안 된다.
-- 패턴 조립을 SQL 안에서 하는 이유: 클라이언트가 `%` 를 넣어 전체를 긁어가지 못하게.
create function public.search_workspace(term text)
returns table (kind text, page_id uuid, title text, workspace_name text, snippet text, version integer)
language sql stable as $$
  with needle as (
    select '%' || replace(replace(replace(btrim(term), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select 'page', p.id, p.title, w.name, p.search_text, null::integer
  from public.pages p
  join public.workspaces w on w.id = p.workspace_id
  cross join needle
  where p.deleted_at is null and p.search_text ilike needle.pattern
  union all
  select 'reason', r.page_id, p.title, w.name, r.reason, r.version
  from public.page_revisions r
  join public.pages p on p.id = r.page_id
  join public.workspaces w on w.id = r.workspace_id
  cross join needle
  where p.deleted_at is null and r.reason ilike needle.pattern;
$$;

grant execute on function public.search_workspace(text) to authenticated;


-- ===== 0018_profile_isolation.sql | SHA256 8b6d13b8fc52f253896625fb2ad2bb25d0acde8d33c842e5e8246667ee02c8c3 =====
-- 테넌트 격리 구멍 하나. 사내 위키였을 때는 맞는 정책이었지만 SaaS 로 확정되면서
-- (2026-08-16) 누수가 됐다.
--
-- `profiles` 의 select 정책이 `using (true)` 였다 — 로그인한 사람은 누구나
-- 플랫폼의 **모든** 사용자 행을 읽었다. `handle_new_user` 가 display_name 을
-- 이메일로 채우므로, 사실상 전체 고객 이메일 목록이 열려 있었다.
--
-- 고친 뒤에도 앱은 그대로 돈다: 화면에 이름을 띄우는 대상(구성원 목록, 댓글 작성자,
-- 문서 소유자)은 전부 같은 워크스페이스 사람이다.
-- `invite_workspace_member` 는 security definer 로 `auth.users` 를 직접 보므로 영향 없다.
create function public.shares_workspace_with(target_user_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user_id
  );
$$;

drop policy "Profiles are visible to signed-in users" on public.profiles;

-- `id = auth.uid()` 를 먼저 두는 이유: 가입 직후 아직 어느 워크스페이스에도
-- 속하지 않은 사람이 자기 프로필은 읽어야 온보딩이 돈다.
create policy "Members read profiles of people they share a workspace with"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_workspace_with(id));


-- ===== 0019_system_integrity.sql | SHA256 2ac5797fac5907d8395762a9fa887a4b76eeadb5fceb3c0e917bcdc4d5537b86 =====
-- 0019 — system integrity: authorization repair, version/ownership enforcement,
-- append-only collaboration persistence, private Realtime policy, grant hardening.
--
-- Audited against the *effective* schema after 0001..0018, not against each
-- migration in isolation. Nothing here rewrites history; it only moves forward.
-- Implements the workspace, document and collaboration integrity boundary.
--
-- Four classes of defect are fixed:
--
--   1. `actor_role not in ('owner','admin')` is NULL — not true — when the caller
--      has no membership row. NULL is not a raise condition, so every one of the
--      0005/0006/0007 member-management RPCs let a non-member through and then ran
--      a SECURITY DEFINER write with RLS bypassed. `transfer_page_ownership` had the
--      same hole via `document_owner_id <> auth.uid()` with a NULL `auth.uid()`:
--      an anonymous caller could hand any page to any user. Guards are now explicit
--      `is null` / `coalesce` checks and every function rejects `auth.uid() is null`.
--
--   2. 0015 re-created `save_page_version` / `restore_page_revision` from the 0004
--      bodies, silently reverting the 0011 document-owner rule and the 0012/0013
--      collaboration reset. Any editor could save or restore versions, and a restore
--      left the live Yjs state and generation untouched, so every connected client
--      kept editing — and re-persisting — the pre-restore document.
--
--   3. The `pages` update grant was table-wide, so a client could PATCH
--      `content`, `title` or `document_owner_id` directly and bypass the version and
--      ownership RPCs entirely. Column grants now allow `parent_id`/`position` only.
--
--   4. `save_page_collaboration(uuid, text)` from 0011 was never dropped when 0013
--      added the generation-checked 3-arg version, leaving an overload that wrote the
--      whole document with no generation check at all. Whole-document writes are the
--      deeper problem: two partitioned clients each write a state that lacks the
--      other's edits and the later write wins. Persistence is now an append-only log
--      of opaque Yjs updates plus a conditionally seeded canonical state, and
--      *every* whole-document write path is removed rather than deprecated: a
--      compacting checkpoint has the same loss window as save (a client that merged
--      through seq 8 can replace a checkpoint that already pruned seq 9 and 10), and
--      a non-compacting one can still replace a newer canonical state with an older
--      snapshot. SQL cannot merge Yjs, so SQL must never choose between two states.
--
--   5. Supabase's bootstrap grants `EXECUTE`/`ALL` to `anon` and `authenticated`
--      *explicitly* (not only through PUBLIC), and installs default privileges that
--      repeat that for every new object. Revoking PUBLIC therefore left `anon`
--      holding its own grant on every function and table in `public`. Section 8
--      strips `anon` outright and re-grants `authenticated` column by column.
--
--   6. `pages` INSERT was only constrained by `created_by = auth.uid()` in the RLS
--      policy; `document_owner_id`, `updated_by`, `deleted_at` and `deleted_by` were
--      free-form on insert. A trigger now pins them for authenticated callers.
--
-- Functions also get `search_path = public, pg_temp`. Without pg_temp listed
-- explicitly Postgres still searches it first for *relations*, so a caller could
-- create `pg_temp.pages` and shadow the real table inside a SECURITY DEFINER body.

-- ---------------------------------------------------------------------------
-- 1. Null-safe role helpers
-- ---------------------------------------------------------------------------

-- Returns NULL for anonymous callers and non-members. Everything below compares
-- against it with explicit null handling rather than `not in`.
create or replace function public.workspace_role(target_workspace_id uuid) returns text
language sql security definer set search_path = public, pg_temp stable as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace_id
    and auth.uid() is not null
    and wm.user_id = auth.uid();
$$;

comment on function public.workspace_role(uuid) is
  'The calling user''s role in a workspace, or NULL when anonymous or not a member.';

-- Can this caller write documents in the workspace at all (membership + role)?
create or replace function public.can_edit_workspace(target_workspace_id uuid) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select coalesce(public.workspace_role(target_workspace_id), '') in ('owner', 'admin', 'editor');
$$;

create or replace function public.is_workspace_member(target_workspace_id uuid) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select public.workspace_role(target_workspace_id) is not null;
$$;

alter function public.shares_workspace_with(uuid) set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.add_workspace_owner() set search_path = public, pg_temp;
alter function public.validate_page_parent() set search_path = public, pg_temp;
alter function public.touch_page() set search_path = public, pg_temp;
alter function public.validate_comment_thread() set search_path = public, pg_temp;
alter function public.notify_on_comment() set search_path = public, pg_temp;
alter function public.mark_notifications_read(uuid[]) set search_path = public, pg_temp;
alter function public.trash_page(uuid) set search_path = public, pg_temp;
alter function public.restore_page(uuid) set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 2. Member management — reject NULL roles
-- ---------------------------------------------------------------------------

create or replace function public.invite_workspace_member(target_workspace_id uuid, member_email text, next_role text)
returns table(user_id uuid, display_name text, role text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  member_id uuid;
  existing_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  actor_role := public.workspace_role(target_workspace_id);
  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Not allowed to manage workspace members';
  end if;
  if next_role is null or next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;
  select id into member_id from auth.users where lower(email) = lower(btrim(member_email));
  if member_id is null then raise exception 'This email has not signed in to Hestia yet'; end if;
  select wm.role into existing_role from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = member_id for update;
  if actor_role = 'admin' and existing_role = 'admin' then
    raise exception 'Not allowed to manage this workspace member';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (target_workspace_id, member_id, next_role)
  on conflict on constraint workspace_members_pkey do update set role = excluded.role
    where public.workspace_members.role <> 'owner'
      and (actor_role = 'owner' or public.workspace_members.role <> 'admin');
  if not found then
    if actor_role = 'admin' and existing_role is distinct from 'owner' then
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  actor_role := public.workspace_role(target_workspace_id);
  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Not allowed to manage workspace members';
  end if;
  select wm.role into target_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id;
  if target_role is null then raise exception 'Workspace member was not found'; end if;
  if target_role = 'owner' then raise exception 'The workspace owner role cannot be changed'; end if;
  if next_role is null or next_role not in ('admin', 'editor', 'viewer') then raise exception 'Invalid workspace role'; end if;
  if next_role = 'admin' and actor_role <> 'owner' then raise exception 'Only an owner can grant administrator access'; end if;
  if actor_role = 'admin' and target_role = 'admin' then raise exception 'Not allowed to manage this workspace member'; end if;
  update public.workspace_members set role = next_role where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

create or replace function public.remove_workspace_member(target_workspace_id uuid, target_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor_role text;
  target_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  actor_role := public.workspace_role(target_workspace_id);
  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Not allowed to manage workspace members';
  end if;
  select wm.role into target_role from public.workspace_members wm
   where wm.workspace_id = target_workspace_id and wm.user_id = target_user_id;
  -- An absent target stays a no-op, as before: the UI treats removal as idempotent.
  if target_role is null then return; end if;
  if target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then
    raise exception 'Not allowed to remove this workspace member';
  end if;
  delete from public.workspace_members where workspace_id = target_workspace_id and user_id = target_user_id;
end;
$$;

-- Same NULL-role shape: `created_by <> auth.uid() and actor_role not in (...)`
-- is NULL for an anonymous caller and for a non-member, so neither was rejected
-- and both could soft-delete any comment in the platform. Two separate guards are
-- needed: current membership (an author who left the workspace no longer manages
-- their comments) and a null-safe author comparison (`is distinct from`, so a NULL
-- `created_by` can never make the whole condition NULL and fall through).
create or replace function public.soft_delete_comment(target_comment_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  comment_row public.comments%rowtype;
  thread_workspace_id uuid;
  actor_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select c.* into comment_row from public.comments c where c.id = target_comment_id for update;
  if not found then raise exception 'Comment was not found'; end if;
  select t.workspace_id into thread_workspace_id from public.comment_threads t where t.id = comment_row.thread_id;
  -- Membership is required of everyone, the author included: leaving the
  -- workspace ends the right to edit its history.
  actor_role := public.workspace_role(thread_workspace_id);
  if actor_role is null then raise exception 'Not allowed to delete this comment'; end if;
  if comment_row.created_by is distinct from auth.uid()
     and coalesce(actor_role, '') not in ('owner', 'admin') then
    raise exception 'Not allowed to delete this comment';
  end if;
  if comment_row.deleted_at is null then
    update public.comments set deleted_at = now(), deleted_by = auth.uid() where id = target_comment_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Document ownership transfer
-- ---------------------------------------------------------------------------

create or replace function public.transfer_page_ownership(target_page_id uuid, next_owner_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  next_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if next_owner_id is null then raise exception 'The next owner must be an editor in this workspace'; end if;
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found then raise exception 'Only the document owner can transfer ownership'; end if;
  -- The owner must still be able to edit here: an owner who was demoted to viewer
  -- or removed from the workspace no longer controls the document.
  if not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Only the document owner can transfer ownership';
  end if;
  if current_page.document_owner_id is distinct from auth.uid() then
    raise exception 'Only the document owner can transfer ownership';
  end if;
  select wm.role into next_role from public.workspace_members wm
   where wm.workspace_id = current_page.workspace_id and wm.user_id = next_owner_id;
  if next_role is null or next_role not in ('owner', 'admin', 'editor') then
    raise exception 'The next owner must be an editor in this workspace';
  end if;
  update public.pages set document_owner_id = next_owner_id where id = target_page_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Append-only collaboration log
-- ---------------------------------------------------------------------------

-- base64 as produced by btoa(): no newlines, padded to a multiple of 4.
-- 4 MiB of base64 is ~3 MiB of Yjs binary — far above a sane single update.
create or replace function public.is_base64_payload(value text) returns boolean
language sql immutable parallel safe as $$
  select value is not null
     and length(value) between 1 and 4194304
     and length(value) % 4 = 0
     and value ~ '^[A-Za-z0-9+/]+={0,2}$';
$$;

create table if not exists public.page_collaboration_updates (
  id uuid primary key default gen_random_uuid(),
  -- client-generated; makes the append idempotent so a retry cannot duplicate
  operation_id uuid not null,
  page_id uuid not null references public.pages(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  generation integer not null,
  seq bigint not null generated always as identity,
  payload text not null check (public.is_base64_payload(payload)),
  -- Nullable + `set null`, deliberately: `on delete restrict` would make deleting
  -- a user fail (or, worse, invite a cascade) because of document deltas that the
  -- remaining members still need to reconstruct the page.
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Named, not inferred: `on conflict (…, operation_id)` inside the append
  -- function would parse `operation_id` as an expression and collide with the
  -- plpgsql parameter of the same name.
  constraint page_collaboration_updates_operation_key unique (page_id, generation, operation_id)
);

create index if not exists page_collaboration_updates_page_generation_seq_idx
  on public.page_collaboration_updates (page_id, generation, seq);

-- Append-only: a stored update is never rewritten. Deletes stay legal because the
-- page cascade and generation pruning both need them.
create or replace function public.reject_collaboration_update_mutation() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Collaboration updates are append-only';
end;
$$;

drop trigger if exists reject_collaboration_update_mutation on public.page_collaboration_updates;
create trigger reject_collaboration_update_mutation
  before update on public.page_collaboration_updates
  for each row execute procedure public.reject_collaboration_update_mutation();

alter table public.page_collaboration_updates enable row level security;

drop policy if exists "Members can read collaboration updates" on public.page_collaboration_updates;
create policy "Members can read collaboration updates" on public.page_collaboration_updates
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Read-only to clients. Every write goes through the RPCs below, which is what
-- makes the generation fence and the member check unavoidable. Supabase's
-- default privileges hand `anon`/`authenticated` ALL on every new table, so the
-- revoke is not redundant: without it `authenticated` holds INSERT/UPDATE/DELETE
-- and only RLS stands between a client and the log.
revoke all on public.page_collaboration_updates from public;
grant select on public.page_collaboration_updates to authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.page_collaboration_updates from anon';
  end if;
end;
$do$;
revoke insert, update, delete, truncate, references, trigger on public.page_collaboration_updates from authenticated;

-- Take the per-page collaboration row lock, creating the row if it is missing.
--
-- `insert … on conflict do nothing` is not enough on its own: when another
-- session has inserted the same page_id but not committed, DO NOTHING skips
-- *without waiting*, and the follow-up `select … for update` still sees no row.
-- The caller would then run with a NULL collaboration row — seed would report
-- `seeded = true` while updating nothing, and restore would advance no
-- generation. DO UPDATE does wait for the other session, so the fallback below
-- always returns a locked, committed row.
--
-- Not SECURITY DEFINER: every caller is, so this runs as the owner anyway.
create or replace function public.lock_page_collaboration(target_page_id uuid, target_workspace_id uuid)
returns public.page_collaboration
language plpgsql set search_path = public, pg_temp as $$
declare collab public.page_collaboration%rowtype;
begin
  select * into collab from public.page_collaboration where page_id = target_page_id for update;
  if found then return collab; end if;

  insert into public.page_collaboration (page_id, workspace_id)
  values (target_page_id, target_workspace_id)
  on conflict (page_id) do update set workspace_id = excluded.workspace_id
  returning * into collab;
  return collab;
end;
$$;

comment on function public.lock_page_collaboration(uuid, uuid) is
  'Internal: FOR UPDATE on the page_collaboration row, creating it if absent. Not granted to any API role.';

-- Seed state + the whole delta log for the current generation. Membership is
-- enough: a viewer may follow the live document, it just cannot write to it.
create or replace function public.load_page_collaboration(target_page_id uuid)
returns table(collaboration_state text, collaboration_generation integer, should_seed boolean, latest_update_seq bigint, updates jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  collab public.page_collaboration%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  -- Always lock the page before collaboration rows: foreign-key checks on
  -- delta inserts also touch pages, so reverse ordering can deadlock a restore.
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for no key update;
  if not found or not public.is_workspace_member(current_page.workspace_id) then
    raise exception 'Not allowed to read this page';
  end if;

  -- Locked, not read: without the lock a restore can commit between reading the
  -- generation and reading the log, and the client would get generation N's
  -- seed with generation N+1's (empty) log. With it, load either runs entirely
  -- before the restore or entirely after it.
  collab := public.lock_page_collaboration(current_page.id, current_page.workspace_id);

  return query
  select
    collab.state,
    collab.generation,
    collab.state is null,
    coalesce(max(u.seq), 0),
    coalesce(
      jsonb_agg(jsonb_build_object('seq', u.seq, 'operation_id', u.operation_id, 'payload', u.payload) order by u.seq)
        filter (where u.seq is not null),
      '[]'::jsonb
    )
  from public.page_collaboration_updates u
  where u.page_id = target_page_id and u.generation = collab.generation;
end;
$$;

-- Conditional canonical initialization. The row lock is what stops two
-- concurrent initializers from each believing their own seed won.
create or replace function public.seed_page_collaboration(target_page_id uuid, seed_state text, expected_generation integer default null)
returns table(collaboration_state text, collaboration_generation integer, seeded boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  collab public.page_collaboration%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_base64_payload(seed_state) then raise exception 'Invalid collaboration state encoding'; end if;
  -- Always lock the page before collaboration rows: foreign-key checks on
  -- delta inserts also touch pages, so reverse ordering can deadlock a restore.
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for no key update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to collaborate on this page';
  end if;

  collab := public.lock_page_collaboration(current_page.id, current_page.workspace_id);

  if expected_generation is not null and collab.generation <> expected_generation then
    raise exception 'This document was restored. Refresh to continue editing.';
  end if;

  if collab.state is null then
    update public.page_collaboration
       set state = seed_state, updated_by = auth.uid(), updated_at = now()
     where page_id = target_page_id
    returning * into collab;
    return query select collab.state, collab.generation, true;
  else
    -- Someone else seeded first; the caller must adopt this state instead.
    return query select collab.state, collab.generation, false;
  end if;
end;
$$;

-- One opaque Yjs update. Idempotent on (page, generation, operation_id).
create or replace function public.append_page_collaboration_update(
  target_page_id uuid,
  expected_generation integer,
  operation_id uuid,
  update_payload text
)
returns table(status text, collaboration_generation integer, update_seq bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  collab public.page_collaboration%rowtype;
  stored_seq bigint;
  stored_payload text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if operation_id is null then raise exception 'An operation id is required'; end if;
  if expected_generation is null then raise exception 'An expected generation is required'; end if;
  if not public.is_base64_payload(update_payload) then raise exception 'Invalid collaboration update encoding'; end if;
  -- Always lock the page before collaboration rows: foreign-key checks on
  -- delta inserts also touch pages, so reverse ordering can deadlock a restore.
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for no key update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to collaborate on this page';
  end if;

  -- FOR UPDATE, not a plain read: a restore that commits first is then visible
  -- here, and a restore that commits later cannot miss this row. It also makes
  -- the appends of one page serial, which is what lets the duplicate branch
  -- below read a committed row rather than racing a speculative insert.
  collab := public.lock_page_collaboration(current_page.id, current_page.workspace_id);

  if collab.generation <> expected_generation then
    return query select 'stale_generation'::text, collab.generation, null::bigint;
    return;
  end if;

  insert into public.page_collaboration_updates (operation_id, page_id, workspace_id, generation, payload)
  values (operation_id, target_page_id, current_page.workspace_id, collab.generation, update_payload)
  on conflict on constraint page_collaboration_updates_operation_key do nothing
  returning seq into stored_seq;

  if stored_seq is null then
    select u.seq, u.payload into stored_seq, stored_payload
      from public.page_collaboration_updates u
     where u.page_id = target_page_id
       and u.generation = collab.generation
       and u.operation_id = append_page_collaboration_update.operation_id;
    if stored_seq is null then
      -- The unique constraint fired but the row is not readable. Nothing was
      -- stored under this call, so it must not be reported as success.
      raise exception 'This update could not be stored. Retry with the same operation id.';
    end if;
    -- `duplicate` is the client's licence to drop the outbox entry, so it may
    -- only be returned when the stored bytes are the bytes that were sent.
    -- Reusing an operation id for different content is a client bug, not a
    -- retry, and silently acknowledging it would lose that update.
    if stored_payload is distinct from update_payload then
      raise exception 'This operation id was already used for a different update';
    end if;
    return query select 'duplicate'::text, collab.generation, stored_seq;
    return;
  end if;

  return query select 'appended'::text, collab.generation, stored_seq;
end;
$$;

-- No compaction in this release, and no whole-document write path of any kind.
--
-- A compacting checkpoint is unsafe for the same reason `save` was. Client A
-- merges through seq 10, checkpoints and prunes <= 10. Client B, which loaded
-- through seq 8, checkpoints a moment later: its state does not contain seq 9
-- and 10, those rows are already gone, and the edits are lost for good — both
-- calls passed the generation check, because a restore never happened. Passing
-- `merged_through_seq => 0` only narrows the window: the later caller still
-- replaces a canonical state that may already have absorbed (and pruned) deltas
-- the caller never saw. The database cannot merge two Yjs states, so it must
-- never be asked to pick one; the only safe compaction needs a persisted
-- watermark and a compare-and-set on the base checkpoint, which is deferred
-- rather than shipped half-proven.
--
-- Consequence, stated plainly: the delta log for a generation only shrinks on
-- restore. See §6 of the contract.
drop function if exists public.checkpoint_page_collaboration(uuid, integer, text, bigint);

-- Tombstones for the two shipped-client entry points. They are kept (rather than
-- dropped) so an old tab gets one deterministic, actionable error instead of
-- PostgREST's 404 for a missing function. The message is deliberately *not* the
-- stale-generation message: this is not recoverable by retrying.
--
-- `initialize_page_collaboration` was read-only, but it cannot stay functional:
-- it returns the canonical state without the delta log, so an old tab would
-- render a document missing every appended edit and let the user type into it.
-- Failing at load is the honest outcome.
create or replace function public.initialize_page_collaboration(target_page_id uuid)
returns table(collaboration_state text, should_seed boolean, collaboration_generation integer)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'Hestia was updated. Reload this page to keep editing.'
    using hint = 'initialize_page_collaboration was removed in 0019: it does not return the append-only update log. Use load_page_collaboration.';
end;
$$;

create or replace function public.save_page_collaboration(target_page_id uuid, next_state text, expected_generation integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'Hestia was updated. Reload this page to keep editing.'
    using hint = 'save_page_collaboration was removed in 0019: a whole-document write overwrites concurrent edits. Use seed_page_collaboration and append_page_collaboration_update.';
end;
$$;

-- The 0011 overload never checked the generation at all. 0013 added the 3-arg
-- form with `create or replace`, which left this one in place as a bypass.
drop function if exists public.save_page_collaboration(uuid, text);

comment on function public.initialize_page_collaboration(uuid) is
  'REMOVED in 0019 (raises upgrade-required). Use load_page_collaboration.';
comment on function public.save_page_collaboration(uuid, text, integer) is
  'REMOVED in 0019 (raises upgrade-required). Use seed_page_collaboration / append_page_collaboration_update.';

-- ---------------------------------------------------------------------------
-- 5. Version save / restore — document owner, on the server
-- ---------------------------------------------------------------------------

-- The UI has always gated both on `page.document_owner_id === currentUserId`.
-- That policy is preserved and now enforced here, plus the workspace edit
-- capability the shared contract requires even of document owners.
create or replace function public.save_page_version(target_page_id uuid, next_title text, next_content jsonb, change_reason text default null)
returns public.page_revisions language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  new_revision public.page_revisions%rowtype;
  next_version integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to save this page';
  end if;
  if current_page.document_owner_id is distinct from auth.uid() then
    raise exception 'Only the document owner can save a version';
  end if;

  update public.pages set title = next_title, content = next_content, updated_at = now(), updated_by = auth.uid()
   where id = target_page_id;
  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content, reason)
  values (target_page_id, current_page.workspace_id, next_version, next_title, next_content, nullif(btrim(change_reason), ''))
  returning * into new_revision;
  return new_revision;
end;
$$;

-- Restores the snapshot, appends the restore as a new revision (0015's reason is
-- preserved), clears the live collaboration state and advances the generation so
-- every connected client is fenced out — all under the page row lock, as 0012 and
-- 0013 intended before 0015 reverted it.
create or replace function public.restore_page_revision(target_page_id uuid, source_revision_id uuid, change_reason text default null)
returns public.page_revisions language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_page public.pages%rowtype;
  source_revision public.page_revisions%rowtype;
  restored_revision public.page_revisions%rowtype;
  next_version integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  -- Lock the page first so saves and restores always allocate versions in order.
  -- Lock order across the whole schema is pages -> page_collaboration.
  select * into current_page from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or not public.can_edit_workspace(current_page.workspace_id) then
    raise exception 'Not allowed to restore this page';
  end if;
  if current_page.document_owner_id is distinct from auth.uid() then
    raise exception 'Only the document owner can restore a version';
  end if;

  select * into source_revision from public.page_revisions
   where id = source_revision_id and page_id = target_page_id and workspace_id = current_page.workspace_id;
  if not found then raise exception 'Revision not found'; end if;

  update public.pages set title = source_revision.title, content = source_revision.content
   where id = target_page_id;

  -- Through the helper, so a collaboration row that another session created but
  -- has not committed is waited for instead of skipped. `do nothing` plus a
  -- blind UPDATE could match zero rows here and leave the generation — the only
  -- fence that stops connected clients from re-persisting the pre-restore
  -- document — unchanged.
  perform public.lock_page_collaboration(current_page.id, current_page.workspace_id);
  update public.page_collaboration
     set state = null, generation = generation + 1, updated_by = auth.uid(), updated_at = now()
   where page_id = target_page_id;
  -- Every delta belongs to a generation that no longer exists.
  delete from public.page_collaboration_updates where page_id = target_page_id;

  select coalesce(max(version), 0) + 1 into next_version from public.page_revisions where page_id = target_page_id;
  insert into public.page_revisions (page_id, workspace_id, version, title, content, reason)
  values (target_page_id, current_page.workspace_id, next_version, source_revision.title, source_revision.content, nullif(btrim(change_reason), ''))
  returning * into restored_revision;
  return restored_revision;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Close the direct-write bypass on pages
-- ---------------------------------------------------------------------------

-- 0002 granted table-wide UPDATE, so `PATCH /pages?id=eq.…` with a `content`,
-- `title` or `document_owner_id` body went straight past save_page_version and
-- transfer_page_ownership (the RLS policy only asks for edit capability).
-- Tree moves are the only direct update the client actually performs.
revoke update on public.pages from authenticated;
grant update (parent_id, position) on public.pages to authenticated;

-- INSERT was only half-constrained: the 0002 policy pins `created_by` but says
-- nothing about `document_owner_id`, `updated_by`, `deleted_at` or `deleted_by`,
-- all of which are plain insertable columns. A client could therefore create a
-- page owned by somebody else (that user, not the author, then controls versions
-- and receives its comment notifications), stamp a false `updated_by`, or insert
-- a page that is already in the trash.
--
-- A column grant cannot express this — `insert (…)` would also forbid the
-- *defaults* from being used by name — so it is a trigger. It only overrides
-- what the app never sets: `SpaceHome` inserts (id, workspace_id, title,
-- content) and nothing else, so every allowed insert is unaffected.
--
-- Scoped to callers that have an identity. A migration, a seed script or a
-- service_role request has `auth.uid() is null`, must be able to backfill
-- authorship explicitly, and is not a client.
create or replace function public.enforce_page_insert_ownership() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  new.created_by := auth.uid();
  new.updated_by := auth.uid();
  new.document_owner_id := auth.uid();
  new.deleted_at := null;
  new.deleted_by := null;
  return new;
end;
$$;

drop trigger if exists enforce_page_insert_ownership on public.pages;
create trigger enforce_page_insert_ownership
  before insert on public.pages
  for each row execute procedure public.enforce_page_insert_ownership();

-- ---------------------------------------------------------------------------
-- 7. Private Realtime policy for page:<uuid>
-- ---------------------------------------------------------------------------

-- Parse defensively: anything that is not exactly `page:` + a UUID yields NULL,
-- which matches no page, so the policies fail closed instead of erroring.
create or replace function public.page_topic_page_id(topic text) returns uuid
language sql immutable parallel safe as $$
  select case
    when topic ~ '^page:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then substring(topic from 6)::uuid
  end;
$$;

-- Receive: any workspace member, viewers included.
create or replace function public.can_read_page_topic(topic text) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1
    from public.pages p
    where p.id = public.page_topic_page_id(topic)
      and public.is_workspace_member(p.workspace_id)
  );
$$;

-- Send: current edit capability, and not a trashed page.
create or replace function public.can_write_page_topic(topic text) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1
    from public.pages p
    where p.id = public.page_topic_page_id(topic)
      and p.deleted_at is null
      and public.can_edit_workspace(p.workspace_id)
  );
$$;

-- Not attempted here: filtering a broadcast by the `generation` inside its
-- payload. Realtime authorizes a client's broadcast by rehearsing an INSERT on
-- realtime.messages with the topic set, and the policy therefore cannot depend
-- on content the sender has not sent through this table. A stale tab can still
-- *broadcast* an update tagged with an old generation; what it cannot do is
-- persist it (append_page_collaboration_update returns `stale_generation`).
-- Receivers must drop any payload whose generation differs from theirs — that
-- is a client obligation, stated in the contract, not a server control.
comment on function public.can_read_page_topic(text) is
  'Realtime authorization for private topic page:<uuid> — SELECT on realtime.messages (receive).';
comment on function public.can_write_page_topic(text) is
  'Realtime authorization for private topic page:<uuid> — INSERT on realtime.messages (send).';

do $do$
begin
  if to_regclass('realtime.messages') is null then
    raise notice '0019: realtime.messages is absent; page topic policies were not created. Re-run on a database with Realtime.';
    return;
  end if;

  -- Realtime ships with RLS already on; only touch it if it is not, so the
  -- migration does not need table ownership in the normal case.
  if not (select c.relrowsecurity from pg_class c where c.oid = 'realtime.messages'::regclass) then
    execute 'alter table realtime.messages enable row level security';
  end if;

  execute 'drop policy if exists "Hestia members receive page topics" on realtime.messages';
  execute $p$
    create policy "Hestia members receive page topics" on realtime.messages
      for select to authenticated
      using (public.can_read_page_topic(realtime.topic()))
  $p$;

  execute 'drop policy if exists "Hestia editors send page topics" on realtime.messages';
  execute $p$
    create policy "Hestia editors send page topics" on realtime.messages
      for insert to authenticated
      with check (public.can_write_page_topic(realtime.topic()))
  $p$;

  -- Realtime normally grants these already; only fill a gap, never assume.
  if not has_table_privilege('authenticated', 'realtime.messages', 'select') then
    execute 'grant select on table realtime.messages to authenticated';
  end if;
  if not has_table_privilege('authenticated', 'realtime.messages', 'insert') then
    execute 'grant insert on table realtime.messages to authenticated';
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 8. Grants: functions are EXECUTE-to-PUBLIC by default
-- ---------------------------------------------------------------------------

-- Every SECURITY DEFINER function above was callable by `anon` through the
-- PostgreSQL default `EXECUTE` grant to PUBLIC, which is exactly how an
-- anonymous caller reached the NULL-role holes. Drop PUBLIC, then grant back
-- only what the `authenticated` role must be able to call. Trigger functions get
-- nothing: a trigger function cannot be invoked directly and its EXECUTE
-- privilege is checked at CREATE TRIGGER time, not when the trigger fires.
--
-- Revoking PUBLIC is necessary but *not* sufficient, and the first cut of this
-- migration got that wrong. Supabase's bootstrap grants EXECUTE to `anon` and
-- `authenticated` by name, so `anon` kept its own grant and reached these
-- bodies anyway — it was stopped only by the `auth.uid() is null` checks, one
-- layer instead of two. Section 8b strips `anon` by name.
revoke execute on function
  public.handle_new_user(),
  public.add_workspace_owner(),
  public.validate_page_parent(),
  public.touch_page(),
  public.validate_comment_thread(),
  public.notify_on_comment(),
  public.reject_collaboration_update_mutation(),
  public.enforce_page_insert_ownership(),
  public.lock_page_collaboration(uuid, uuid),
  public.is_workspace_member(uuid),
  public.can_edit_workspace(uuid),
  public.workspace_role(uuid),
  public.shares_workspace_with(uuid),
  public.document_plain_text(jsonb),
  public.is_base64_payload(text),
  public.page_topic_page_id(text),
  public.can_read_page_topic(text),
  public.can_write_page_topic(text),
  public.search_workspace(text),
  public.trash_page(uuid),
  public.restore_page(uuid),
  public.soft_delete_comment(uuid),
  public.mark_notifications_read(uuid[]),
  public.invite_workspace_member(uuid, text, text),
  public.set_workspace_member_role(uuid, uuid, text),
  public.remove_workspace_member(uuid, uuid),
  public.transfer_page_ownership(uuid, uuid),
  public.save_page_version(uuid, text, jsonb, text),
  public.restore_page_revision(uuid, uuid, text),
  public.initialize_page_collaboration(uuid),
  public.load_page_collaboration(uuid),
  public.seed_page_collaboration(uuid, text, integer),
  public.append_page_collaboration_update(uuid, integer, uuid, text),
  public.save_page_collaboration(uuid, text, integer)
from public, authenticated;

-- Helpers the authenticated role evaluates itself: RLS policy predicates, and
-- the immutable text extractor behind the pages.search_text generated column.
grant execute on function
  public.is_workspace_member(uuid),
  public.can_edit_workspace(uuid),
  public.workspace_role(uuid),
  public.shares_workspace_with(uuid),
  public.document_plain_text(jsonb),
  public.is_base64_payload(text),
  public.page_topic_page_id(text),
  public.can_read_page_topic(text),
  public.can_write_page_topic(text),
  public.search_workspace(text)
to authenticated;

grant execute on function
  public.trash_page(uuid),
  public.restore_page(uuid),
  public.soft_delete_comment(uuid),
  public.mark_notifications_read(uuid[]),
  public.invite_workspace_member(uuid, text, text),
  public.set_workspace_member_role(uuid, uuid, text),
  public.remove_workspace_member(uuid, uuid),
  public.transfer_page_ownership(uuid, uuid),
  public.save_page_version(uuid, text, jsonb, text),
  public.restore_page_revision(uuid, uuid, text),
  public.initialize_page_collaboration(uuid),
  public.load_page_collaboration(uuid),
  public.seed_page_collaboration(uuid, text, integer),
  public.append_page_collaboration_update(uuid, integer, uuid, text),
  public.save_page_collaboration(uuid, text, integer)
to authenticated;

-- Schema grants: the API roles need USAGE and nothing else. CREATE in `public`
-- for an API role would let a client plant objects the Data API may expose.
do $do$
declare api_role text;
begin
  revoke create on schema public from public;
  foreach api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('grant usage on schema public to %I', api_role);
      execute format('revoke create on schema public from %I', api_role);
    end if;
  end loop;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 8b. `anon` keeps nothing in public, and `authenticated` keeps an allowlist
-- ---------------------------------------------------------------------------

-- Hestia has no anonymous surface: `middleware.ts` sends every unauthenticated
-- request to /login, and sign-in itself talks to GoTrue, not to PostgREST. The
-- anon key must therefore reach no table and no function here. Today RLS stops
-- it anyway (no policy mentions `anon`), but "the row filter happened to return
-- nothing" is a weaker statement than "the role cannot execute this", and it is
-- the statement the contract makes.
do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise notice '0019: role anon is absent; nothing to revoke.';
    return;
  end if;
  execute 'revoke all on all tables in schema public from anon';
  execute 'revoke all on all sequences in schema public from anon';
  execute 'revoke all on all functions in schema public from anon';
  execute 'grant usage on schema public to anon';
end;
$do$;

-- …and the same for objects created later, where it is allowed. Default
-- privileges belong to the role that creates the object, so this only covers
-- grantors the migration can speak for; it is best effort and announces what it
-- could not do rather than pretending.
do $do$
declare grantor text;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then return; end if;
  foreach grantor in array array['postgres', 'supabase_admin', current_user]
  loop
    if exists (select 1 from pg_roles where rolname = grantor) and pg_has_role(current_user, grantor, 'member') then
      execute format('alter default privileges for role %I in schema public revoke all on tables from anon', grantor);
      execute format('alter default privileges for role %I in schema public revoke all on sequences from anon', grantor);
      execute format('alter default privileges for role %I in schema public revoke all on functions from anon', grantor);
    else
      raise notice '0019: cannot alter default privileges for role % (not a member); new objects may still be granted to anon.', grantor;
    end if;
  end loop;
end;
$do$;

-- `authenticated` is pruned the same way, because the same bootstrap handed it
-- ALL on every table. This is not theoretical: `page_revisions` carries an
-- UPDATE policy from 0016 ("Editors can fill in a revision reason") and the
-- table-wide UPDATE grant from the Supabase defaults, so until now an editor
-- could PATCH a revision's `content` and rewrite document history — the column
-- grant in 0016 added `reason` to a privilege set that already included
-- everything. Every grant below matches a write the client actually performs:
--
--   workspaces       insert   app/onboarding/actions.ts
--   pages            insert   app/space/SpaceHome.tsx (columns pinned by trigger)
--   pages            update   Workbench.moveTo / SpaceHome reorder (2 columns)
--   page_revisions   update   Workbench reason editor (1 column)
--   comment_threads  insert   Doc.tsx
--   comments         insert   Doc.tsx
--   profiles         update   own row, RLS-pinned (0001)
--
-- Everything else is read-only to clients and moves through a SECURITY DEFINER
-- RPC, which runs as the owner and is unaffected by these grants.
do $do$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke all on public.%I from authenticated', t.relname);
  end loop;
end;
$do$;

grant select on public.profiles, public.workspaces, public.workspace_members,
                public.pages, public.page_revisions, public.comment_threads,
                public.comments, public.notifications, public.page_collaboration,
                public.page_collaboration_updates
  to authenticated;

grant insert on public.workspaces, public.pages, public.comment_threads, public.comments to authenticated;
grant update on public.profiles to authenticated;
grant update (parent_id, position) on public.pages to authenticated;
grant update (reason) on public.page_revisions to authenticated;


-- ===== 0020_workspace_operations.sql | SHA256 046b6501bb599901bea719e761c9c9f01d0d8d1ee16ac58734b7af975714daf5 =====
-- Two gaps the workspace-context work surfaced once pages could belong to a
-- caller with more than one membership:
--
--   1. search_workspace(term) has no workspace_id to filter on, so it answers
--      "every workspace I'm a member of" even when the UI is scoped to one
--      selected workspace. A workspace_id argument is added as a second
--      overload (not a default parameter, so there is no ambiguity between
--      the one- and two-argument calls) rather than changing the existing
--      signature other callers still depend on.
--   2. The page-tree drag reorder sent one UPDATE per sibling from the
--      browser (app/space/SpaceHome.tsx), so a failure partway through left
--      a partially reordered list. move_page_before does the whole
--      reorder as one statement-bound transaction instead.

-- ---------------------------------------------------------------------------
-- 1. search_workspace(term, target_workspace_id) — same shape, one workspace
-- ---------------------------------------------------------------------------

-- security invoker, same as the one-argument form: RLS on pages/page_revisions
-- still does the membership check, this just narrows the result to the
-- caller's selected workspace instead of all of their workspaces. Filtering
-- by workspace_id, not workspace_name, because names are not unique.
create or replace function public.search_workspace(term text, target_workspace_id uuid)
returns table (kind text, page_id uuid, title text, workspace_name text, snippet text, version integer)
language sql security invoker set search_path = public, pg_temp stable as $$
  with needle as (
    select '%' || replace(replace(replace(btrim(term), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select 'page', p.id, p.title, w.name, p.search_text, null::integer
  from public.pages p
  join public.workspaces w on w.id = p.workspace_id
  cross join needle
  where p.workspace_id = target_workspace_id and p.deleted_at is null and p.search_text ilike needle.pattern
  union all
  select 'reason', r.page_id, p.title, w.name, r.reason, r.version
  from public.page_revisions r
  join public.pages p on p.id = r.page_id
  join public.workspaces w on w.id = r.workspace_id
  cross join needle
  where r.workspace_id = target_workspace_id and p.deleted_at is null and r.reason ilike needle.pattern;
$$;

revoke execute on function public.search_workspace(text, uuid) from public, anon;
grant execute on function public.search_workspace(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. move_page_before(target_page_id, before_page_id) — atomic sibling reorder
-- ---------------------------------------------------------------------------

-- Lock order for this function: workspaces -> pages. Locking the workspace
-- row first means two concurrent reorders in the same workspace serialize on
-- that single lock before either one locks any page row, so they cannot end
-- up holding overlapping page-row locks in opposite orders and deadlock.
--
-- Cycle and cross-workspace-parent rejection is not duplicated here: the
-- validate_page_parent trigger (0002/0003) already fires on the parent_id
-- update below and raises on both cases, which aborts this function and
-- rolls back every change made so far in the same statement. "Active" is the
-- one thing that trigger does not check (it allows parenting under a
-- trashed page), so both pages are explicitly re-read with deleted_at is
-- null for update here.
create or replace function public.move_page_before(target_page_id uuid, before_page_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ws_id uuid;
  dragged public.pages%rowtype;
  anchor public.pages%rowtype;
  sibling record;
  idx bigint := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_page_id is null or before_page_id is null then
    raise exception 'Both pages are required';
  end if;
  if target_page_id = before_page_id then
    raise exception 'A page cannot be moved before itself';
  end if;

  select workspace_id into ws_id from public.pages where id = before_page_id and deleted_at is null;
  if ws_id is null then raise exception 'The reference page was not found'; end if;

  perform 1 from public.workspaces where id = ws_id for update;

  if not public.can_edit_workspace(ws_id) then
    raise exception 'Not allowed to reorder pages in this workspace';
  end if;

  select * into dragged from public.pages where id = target_page_id and deleted_at is null for update;
  if not found or dragged.workspace_id <> ws_id then
    raise exception 'Pages must belong to the same workspace to be reordered';
  end if;

  select * into anchor from public.pages where id = before_page_id and deleted_at is null for update;
  if not found or anchor.workspace_id <> ws_id then
    raise exception 'The reference page was not found';
  end if;

  update public.pages set parent_id = anchor.parent_id where id = target_page_id;

  for sibling in
    select id from public.pages
    where workspace_id = ws_id and deleted_at is null and id <> target_page_id
      and parent_id is not distinct from anchor.parent_id
    order by position, created_at, id
    for update
  loop
    if sibling.id = before_page_id then
      idx := idx + 1;
      update public.pages set position = idx * 1024 where id = target_page_id;
    end if;
    idx := idx + 1;
    update public.pages set position = idx * 1024 where id = sibling.id;
  end loop;
end;
$$;

revoke execute on function public.move_page_before(uuid, uuid) from public, anon;
grant execute on function public.move_page_before(uuid, uuid) to authenticated;


-- ===== 0021_collaboration_author_retention.sql | SHA256 9830eba73bf83ecabe080cd884bffb46df6d3e8a57eaf113c1e8a4d2db09ffef =====
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


-- ===== 0022_collaboration_author_cascade.sql | SHA256 166398243edb44d29a83058ef0d016f590781ab592d78d0e049f214f9343663b =====
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


-- ===== 0023_profile_editing.sql | SHA256 f27a0059dbaa5ced0d375f07039a670938031d175a3b2daac283ff98b0b6eb0e =====
-- 0023: own profile editing; credentials remain with the Auth provider.
-- Normalize existing data, constrain fields, and grant UPDATE on two columns only.

create or replace function public.is_safe_avatar_url(value text) returns boolean
language sql immutable parallel safe as $fn$
  select value is null
     or (
       char_length(value) <= 2048
       and value = btrim(value)
       and value !~ '[[:cntrl:]]'
       and value !~* '^https?://[^/?#]*@'
       and value ~* '^https?://[^[:space:]/?#<>"''\\]+[^[:space:]<>"''\\]*$'
     );
$fn$;

comment on function public.is_safe_avatar_url(text) is
  'True for NULL or an absolute http(s) URL of at most 2048 characters with no whitespace, control or markup characters. Backs the profiles.avatar_url check.';

update public.profiles
   set display_name = coalesce(nullif(btrim(left(btrim(display_name), 80)), ''), '사용자'),
       avatar_url = case when public.is_safe_avatar_url(avatar_url) then avatar_url else null end
 where display_name is null
    or display_name <> coalesce(nullif(btrim(left(btrim(display_name), 80)), ''), '사용자')
    or not public.is_safe_avatar_url(avatar_url);

alter table public.profiles
  add constraint profiles_display_name_valid
  check (display_name is not null
         and display_name = btrim(display_name)
         and char_length(display_name) between 1 and 80) not valid;

alter table public.profiles
  add constraint profiles_avatar_url_valid
  check (public.is_safe_avatar_url(avatar_url)) not valid;

alter table public.profiles validate constraint profiles_display_name_valid;
alter table public.profiles validate constraint profiles_avatar_url_valid;

alter table public.profiles alter column display_name set not null;

create or replace function public.normalize_profile() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.display_name := btrim(new.display_name, E' \t\n\r\f\v');
  new.avatar_url := nullif(btrim(new.avatar_url), '');

  if tg_op = 'UPDATE' and auth.uid() is not null then
    if new.id is distinct from old.id then
      raise exception 'A profile id cannot be changed';
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'A profile created_at cannot be changed';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_profile on public.profiles;
create trigger normalize_profile
  before insert or update on public.profiles
  for each row execute procedure public.normalize_profile();

create or replace function public.profile_display_name_from_signup(metadata jsonb, email text)
returns text language sql immutable parallel safe as $fn$
  with candidate as (
    select coalesce(
      nullif(btrim(case when jsonb_typeof(metadata -> 'display_name') = 'string' then metadata ->> 'display_name' end, E' \t\n\r\f\v'), ''),
      nullif(btrim(case when jsonb_typeof(metadata -> 'full_name') = 'string' then metadata ->> 'full_name' end, E' \t\n\r\f\v'), ''),
      nullif(btrim(case when jsonb_typeof(metadata -> 'name') = 'string' then metadata ->> 'name' end, E' \t\n\r\f\v'), ''),
      nullif(btrim(split_part(coalesce(email, ''), '@', 1)), ''),
      '사용자'
    ) as value
  )
  select coalesce(nullif(btrim(left(value, 80)), ''), '사용자') from candidate;
$fn$;

comment on function public.profile_display_name_from_signup(jsonb, text) is
  'Display name for a new signup: metadata display_name/full_name/name (strings only), then the email local part, then a placeholder. Always trimmed and at most 80 characters. Never reads metadata id or role.';

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    public.profile_display_name_from_signup(
      case when jsonb_typeof(new.raw_user_meta_data) = 'object' then new.raw_user_meta_data else '{}'::jsonb end,
      new.email
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update on public.profiles from authenticated;
revoke insert, delete, truncate, references, trigger on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise notice '0023: role anon is absent; nothing to revoke.';
    return;
  end if;
  execute 'revoke all on public.profiles from anon';
end;
$do$;

revoke execute on function
  public.handle_new_user(),
  public.normalize_profile(),
  public.profile_display_name_from_signup(jsonb, text),
  public.is_safe_avatar_url(text)
from public;

do $do$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format($g$revoke execute on function
          public.handle_new_user(),
          public.normalize_profile(),
          public.profile_display_name_from_signup(jsonb, text),
          public.is_safe_avatar_url(text)
        from %I$g$, api_role);
    end if;
  end loop;
end;
$do$;

grant execute on function public.is_safe_avatar_url(text) to authenticated;


-- ===== 0024_custom_roles.sql | SHA256 416c9697e824b0d6240331d3442127b9ddf50d45cb1b342ea1516f095f838c1d =====
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


-- ===== 0025_session_security_audit.sql | SHA256 ea7b1070a127dde5e851aaa5ad6665eb6f97a9d31931f01b0c1ccd7d214c1b79 =====
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


-- ===== 0026_session_metadata_guard.sql | SHA256 2e0554c0349cc19be677439029f17e5a2e6f4a9269f61f925b83e95979f44097 =====
-- Relationship helper is also callable directly through RPC. Do not reveal
-- membership relationships to a TOTP-enrolled account at aal1.
create or replace function public.shares_workspace_with(target_user_id uuid) returns boolean
language sql security definer set search_path = public, pg_temp stable as $$
  select public.session_is_allowed() and exists (
    select 1 from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user_id
  );
$$;
revoke execute on function public.shares_workspace_with(uuid) from public, anon;
grant execute on function public.shares_workspace_with(uuid) to authenticated;


-- Register versions so subsequent Supabase CLI upgrades do not replay them.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text
);
insert into supabase_migrations.schema_migrations(version, name, statements) values
('0001', 'auth_workspaces', array[]::text[]),
('0002', 'pages', array[]::text[]),
('0003', 'page_tree_and_trash', array[]::text[]),
('0004', 'page_revisions', array[]::text[]),
('0005', 'workspace_sharing', array[]::text[]),
('0006', 'workspace_sharing_role_fix', array[]::text[]),
('0007', 'workspace_invite_conflict_fix', array[]::text[]),
('0008', 'comments', array[]::text[]),
('0009', 'page_images', array[]::text[]),
('0010', 'restore_page_revision', array[]::text[]),
('0011', 'live_collaboration', array[]::text[]),
('0012', 'restore_collaboration_state', array[]::text[]),
('0013', 'collaboration_generation', array[]::text[]),
('0014', 'notifications', array[]::text[]),
('0015', 'revision_reason', array[]::text[]),
('0016', 'backfill_revision_reason', array[]::text[]),
('0017', 'search', array[]::text[]),
('0018', 'profile_isolation', array[]::text[]),
('0019', 'system_integrity', array[]::text[]),
('0020', 'workspace_operations', array[]::text[]),
('0021', 'collaboration_author_retention', array[]::text[]),
('0022', 'collaboration_author_cascade', array[]::text[]),
('0023', 'profile_editing', array[]::text[]),
('0024', 'custom_roles', array[]::text[]),
('0025', 'session_security_audit', array[]::text[]),
('0026', 'session_metadata_guard', array[]::text[]);
commit;

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

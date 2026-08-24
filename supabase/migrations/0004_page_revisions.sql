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

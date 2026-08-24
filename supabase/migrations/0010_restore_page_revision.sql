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

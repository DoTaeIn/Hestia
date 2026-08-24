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

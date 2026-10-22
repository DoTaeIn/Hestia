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

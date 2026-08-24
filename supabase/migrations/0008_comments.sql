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

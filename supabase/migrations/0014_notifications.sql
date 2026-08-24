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

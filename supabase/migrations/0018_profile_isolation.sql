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

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

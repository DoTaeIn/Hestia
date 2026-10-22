// node --test lib/workspace-context.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectWorkspace, workspaceHref, type WorkspaceMembership } from "./workspace-context.ts";

const membership = (workspaceId: string, createdAt: string, role: WorkspaceMembership["role"] = "editor"): WorkspaceMembership => ({
  workspaceId,
  workspaceName: `workspace-${workspaceId}`,
  role,
  createdAt,
});

test("요청한 워크스페이스가 본인 멤버십에 있으면 그것을 고른다", () => {
  const memberships = [membership("a", "2026-01-01"), membership("b", "2026-02-01")];
  assert.deepEqual(selectWorkspace(memberships, "b"), { status: "ok", membership: memberships[1] });
});

test("요청한 워크스페이스가 본인 멤버십에 없으면 forbidden — 다른 멤버십으로 대체하지 않는다", () => {
  const memberships = [membership("a", "2026-01-01")];
  assert.deepEqual(selectWorkspace(memberships, "not-mine"), { status: "forbidden" });
});

test("멤버십이 전혀 없으면 none", () => {
  assert.deepEqual(selectWorkspace([], undefined), { status: "none" });
});

test("요청이 없으면 가장 오래된 멤버십으로 고정 폴백한다", () => {
  const oldest = membership("old", "2025-01-01");
  const newer = membership("new", "2026-01-01");
  assert.deepEqual(selectWorkspace([newer, oldest], undefined), { status: "ok", membership: oldest });
  // 입력 순서를 바꿔도 같은 결과 — 배열 순서에 의존한 "임의의 행" 선택이 아니다.
  assert.deepEqual(selectWorkspace([oldest, newer], undefined), { status: "ok", membership: oldest });
});

test("생성 시각이 같으면 workspaceId로 동점을 깨 결정론을 유지한다", () => {
  const sameTime = "2026-01-01T00:00:00.000Z";
  const a = membership("aaa", sameTime);
  const b = membership("bbb", sameTime);
  assert.deepEqual(selectWorkspace([b, a], undefined), { status: "ok", membership: a });
});

test("빈 문자열 요청은 폴백으로 취급한다", () => {
  const only = membership("only", "2026-01-01");
  assert.deepEqual(selectWorkspace([only], ""), { status: "ok", membership: only });
});

test("workspaceHref: 쿼리가 없는 경로에 workspace를 붙인다", () => {
  assert.equal(workspaceHref("/space", "ws-1"), "/space?workspace=ws-1");
});

test("workspaceHref: 기존 쿼리 파라미터를 보존한다", () => {
  assert.equal(workspaceHref("/search?q=hello", "ws-1"), "/search?q=hello&workspace=ws-1");
});

test("workspaceHref: 기존 workspace 파라미터를 덮어쓴다", () => {
  assert.equal(workspaceHref("/space?workspace=old", "new-id"), "/space?workspace=new-id");
});

test("workspaceHref: #hash를 끝에 유지한다", () => {
  assert.equal(workspaceHref("/editor/1#section", "ws-1"), "/editor/1?workspace=ws-1#section");
});

test("workspaceHref: workspaceId가 없으면 경로를 그대로 둔다", () => {
  assert.equal(workspaceHref("/space?q=x", null), "/space?q=x");
  assert.equal(workspaceHref("/space", undefined), "/space");
  assert.equal(workspaceHref("/space", ""), "/space");
});

test("workspaceHref: 특수문자가 든 workspaceId를 안전하게 인코딩한다", () => {
  assert.equal(workspaceHref("/space", "a b&c"), "/space?workspace=a+b%26c");
});

// node --test engine/domain.test.ts
//
// These assertions encode the *server* rules of
// supabase/migrations/0019_system_integrity.sql. When a migration changes a
// guard, this file is what should fail first — the UI hints must not drift
// away from what the RPCs will actually permit.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageMember,
  getCapabilities,
  type Capabilities,
  type WorkspaceRole,
} from "./domain.ts";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

/** The six flags in declaration order, for compact matrix assertions. */
const flags = (capabilities: Capabilities) => [
  capabilities.canRead,
  capabilities.canEdit,
  capabilities.canManageMembers,
  capabilities.canGrantAdmin,
  capabilities.canRecordVersion,
  capabilities.canTransferOwnership,
];

test("역할별 능력 매트릭스 — 본인이 문서 소유자인 경우", () => {
  const matrix: [WorkspaceRole, boolean[]][] = [
    //                read   edit   members admin  version transfer
    ["owner", [true, true, true, true, true, true]],
    ["admin", [true, true, true, false, true, true]],
    ["editor", [true, true, false, false, true, true]],
    ["viewer", [true, false, false, false, false, false]],
  ];
  for (const [role, expected] of matrix) {
    assert.deepEqual(
      flags(getCapabilities({ role, userId: ALICE, documentOwnerId: ALICE })),
      expected,
      `role=${role}`,
    );
  }
});

test("역할별 능력 매트릭스 — 남의 문서를 볼 때는 판 기록·소유권 이전이 모두 막힌다", () => {
  const matrix: [WorkspaceRole, boolean[]][] = [
    //                read   edit   members admin  version transfer
    ["owner", [true, true, true, true, false, false]],
    ["admin", [true, true, true, false, false, false]],
    ["editor", [true, true, false, false, false, false]],
    ["viewer", [true, false, false, false, false, false]],
  ];
  for (const [role, expected] of matrix) {
    assert.deepEqual(
      flags(getCapabilities({ role, userId: ALICE, documentOwnerId: BOB })),
      expected,
      `role=${role}`,
    );
  }
});

test("워크스페이스 관리자라도 문서 소유자가 아니면 판을 기록하지 못한다 — save_page_version 과 같은 규칙", () => {
  // 0019 §5: `document_owner_id is distinct from auth.uid()` 는 역할과 무관하게
  // 거부한다. 관리자 권한이 소유자 권한을 대신하지 않는다.
  const admin = getCapabilities({ role: "admin", userId: ALICE, documentOwnerId: BOB });
  assert.equal(admin.canManageMembers, true);
  assert.equal(admin.canRecordVersion, false);
  assert.equal(admin.canTransferOwnership, false);
});

test("역할이 없으면(비멤버·비로그인) 전부 거부한다 — NULL 을 '금지되지 않음' 으로 읽지 않는다", () => {
  for (const role of [null, undefined] as const) {
    assert.deepEqual(
      flags(getCapabilities({ role, userId: ALICE, documentOwnerId: ALICE })),
      [false, false, false, false, false, false],
      `role=${String(role)}`,
    );
  }
});

test("알 수 없는 역할 문자열도 전부 거부한다", () => {
  const unknown = "superuser" as WorkspaceRole;
  assert.deepEqual(
    flags(getCapabilities({ role: unknown, userId: ALICE, documentOwnerId: ALICE })),
    [false, false, false, false, false, false],
  );
});

test("문서 소유자가 viewer 로 강등되면 판 기록·소유권 이전을 잃는다", () => {
  // 소유자 일치만으로는 부족하다 — 0019 §3·§5 는 소유자에게도 현재의
  // can_edit_workspace() 를 요구한다.
  const demoted = getCapabilities({ role: "viewer", userId: ALICE, documentOwnerId: ALICE });
  assert.equal(demoted.canRead, true);
  assert.equal(demoted.canEdit, false);
  assert.equal(demoted.canRecordVersion, false);
  assert.equal(demoted.canTransferOwnership, false);
});

test("소유자 정보나 사용자 id 가 없으면 소유자 권한을 주지 않는다", () => {
  const cases = [
    { role: "editor" as WorkspaceRole, userId: ALICE },
    { role: "editor" as WorkspaceRole, documentOwnerId: ALICE },
    { role: "editor" as WorkspaceRole },
  ];
  for (const input of cases) {
    const capabilities = getCapabilities(input);
    assert.equal(capabilities.canEdit, true, JSON.stringify(input));
    assert.equal(capabilities.canRecordVersion, false, JSON.stringify(input));
    assert.equal(capabilities.canTransferOwnership, false, JSON.stringify(input));
  }
});

test("빈 문자열은 '알 수 없음' 이다 — 주인 없는 문서와 id 없는 사용자가 일치로 맞물리지 않는다", () => {
  const capabilities = getCapabilities({ role: "owner", userId: "", documentOwnerId: "" });
  assert.equal(capabilities.canEdit, true);
  assert.equal(capabilities.canRecordVersion, false);
  assert.equal(capabilities.canTransferOwnership, false);

  assert.equal(getCapabilities({ role: "owner", userId: ALICE, documentOwnerId: "" }).canRecordVersion, false);
  assert.equal(getCapabilities({ role: "owner", userId: "", documentOwnerId: ALICE }).canRecordVersion, false);
});

test("순수 함수다 — 같은 입력에 같은 결과를 주고 입력을 바꾸지 않는다", () => {
  const input = { role: "admin" as WorkspaceRole, userId: ALICE, documentOwnerId: ALICE };
  const snapshot = { ...input };
  assert.deepEqual(getCapabilities(input), getCapabilities(input));
  assert.deepEqual(input, snapshot);
});

test("getCapabilities 는 매번 새 객체를 돌려준다 — 거부 결과도 공유되지 않는다", () => {
  const first = getCapabilities({ role: null });
  const second = getCapabilities({ role: null });
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
});

test("canManageMember 매트릭스 — owner 는 owner 외 전원을, admin 은 editor·viewer 만", () => {
  const roles: WorkspaceRole[] = ["owner", "admin", "editor", "viewer"];
  const expected: Record<WorkspaceRole, Record<WorkspaceRole, boolean>> = {
    owner: { owner: false, admin: true, editor: true, viewer: true },
    admin: { owner: false, admin: false, editor: true, viewer: true },
    editor: { owner: false, admin: false, editor: false, viewer: false },
    viewer: { owner: false, admin: false, editor: false, viewer: false },
  };
  for (const actorRole of roles) {
    for (const targetRole of roles) {
      assert.equal(
        canManageMember(actorRole, targetRole),
        expected[actorRole][targetRole],
        `${actorRole} -> ${targetRole}`,
      );
    }
  }
});

test("canManageMember: owner 행은 누구도 건드리지 못한다 — owner 자신도", () => {
  // 0019 §2: 'The workspace owner role cannot be changed' 는 호출자 역할을
  // 보지 않는다.
  assert.equal(canManageMember("owner", "owner"), false);
});

test("canManageMember: 역할이 비면(비멤버·대상 없음) 거부한다", () => {
  for (const missing of [null, undefined] as const) {
    assert.equal(canManageMember(missing, "editor"), false, `actor=${String(missing)}`);
    assert.equal(canManageMember("owner", missing), false, `target=${String(missing)}`);
    assert.equal(canManageMember(missing, missing), false, `both=${String(missing)}`);
  }
});

test("canManageMember: 알 수 없는 역할 문자열은 양쪽 모두 거부한다", () => {
  const unknown = "superuser" as WorkspaceRole;
  assert.equal(canManageMember(unknown, "editor"), false);
  assert.equal(canManageMember("owner", unknown), false);
});

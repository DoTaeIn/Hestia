# 사용자·커스텀 역할 관리

## 범위와 권한

워크스페이스별 사용자 관리입니다. 플랫폼 전체 사용자 조회·계정 삭제·인증 공급자의 비밀번호 관리는 제공하지 않습니다. 모든 구성원에게 해당 워크스페이스 문서의 열람 권한이 있고, 추가 권한은 다음 두 키로 표현합니다.

| 역할 | 문서 열람 | `pages.write` | `members.manage` | 역할 정의·관리 권한 부여 |
| --- | --- | --- | --- | --- |
| 소유자 | 가능 | 가능 | 가능 | 가능 |
| 관리자 | 가능 | 가능 | 가능 | 불가 |
| 편집자 | 가능 | 가능 | 불가 | 불가 |
| 열람자 | 가능 | 불가 | 불가 | 불가 |
| 커스텀 | 가능 | 선택 | 선택 | 불가 |

`pages.write`는 기존 문서 편집·문서 생성/이동·댓글 작성·이미지 업로드 권한에 연결됩니다. 버전 기록·복원·문서 소유권 이전에는 편집 권한과 문서 소유자 조건이 모두 필요합니다. `members.manage`는 일반 구성원의 추가·제거·역할 배정 권한이며 문서 편집을 포함하지 않습니다. 다른 관리자나 관리 권한이 있는 커스텀 구성원을 변경할 수 없고, 관리 권한을 재부여할 수도 없습니다. 역할을 정의·변경·삭제하거나 관리 권한을 부여하는 작업은 소유자만 할 수 있습니다. 소유자 자신의 역할은 변경·제거할 수 없습니다.

## 화면 흐름

워크스페이스 상단 **구성원·역할** 또는 문서의 공유 창에서 관리 화면으로 이동합니다. 먼저 로그인한 사람을 이메일로 추가한 뒤 기본 역할 또는 커스텀 역할을 배정합니다. 이메일은 추가할 때만 사용하고 구성원 목록에는 공개하지 않습니다. 역할 생성·수정에서 문서 편집과 구성원 관리를 각각 켭니다. 구성원이 배정된 역할은 먼저 재배정한 뒤 삭제합니다. 구성원 제거는 이 워크스페이스의 접근만 해제하며 로그인 계정이나 다른 워크스페이스의 권한을 삭제하지 않습니다.

## 엔진 API

```ts
const engine = createHestiaEngine(sessionScopedSupabaseClient);
const result = await engine.roles.create({
  workspaceId,
  name: "회의록 담당",
  permissions: ["pages.write"],
});
if (result.error) throw result.error;
const assigned = await engine.members.assignRole(workspaceId, userId, result.data.id);
if (assigned.error) throw assigned.error;
```

| API | 동작 |
| --- | --- |
| `members.list(workspaceId)` | 이름·기본/커스텀 역할·유효 권한 목록. 이메일 제외 |
| `members.assignRole(workspaceId, userId, roleId)` | 기존 구성원에게 커스텀 역할 배정 |
| `roles.list(workspaceId)` | 해당 워크스페이스의 역할 목록 |
| `roles.create({ workspaceId, name, permissions })` | 역할 생성 |
| `roles.update(roleId, { workspaceId, name, permissions })` | 역할 이름·권한 수정 |
| `roles.delete(workspaceId, roleId)` | 미배정 역할 삭제 |
| `workspaces.invite`, `setMemberRole`, `removeMember` | 기존 기본 역할·구성원 관리 API 유지 |

`EngineResult`를 반환합니다. `WorkspaceMembership.permissions`는 커스텀 역할이 배정된 경우 추가되므로, UI에서는 `getCapabilities({ role, permissions, userId, documentOwnerId })`를 사용하세요. 모든 구성원의 유효 권한이 필요하면 `members.list`를 사용합니다. `workspace_role()`은 호환을 위해 기본 역할을 반환하며 커스텀 역할을 자동으로 editor/admin 문자열로 승격시키지 않습니다.

## DB 설계와 격리

0024는 `workspace_roles`와 `workspace_members.custom_role_id`를 추가합니다. 커스텀 역할이 있는 행의 기본 역할은 viewer이고 커스텀 권한만 적용됩니다. 복합 외래 키로 다른 워크스페이스 역할의 배정을 막습니다. 직접 테이블 쓰기 권한은 주지 않고 검증 RPC만 노출합니다. `has_workspace_permission`은 알려진 두 키만 허용하고 익명·비회원은 거부합니다. 기존 RLS·Storage·Realtime가 사용하는 `can_edit_workspace`도 같은 함수를 사용합니다.

모든 구성원·역할 변경 RPC는 워크스페이스 행을 먼저 잠근 뒤 권한을 다시 조회합니다. 관리자 강등과 다른 관리 요청의 경합에서 오래된 역할로 변경하지 못하도록 순서를 맞췄습니다. 권한 제거 후 새 DB 요청은 거부되지만 이미 전달된 문서나 서명 이미지 URL을 회수할 수는 없습니다. 기존 Realtime 연결의 권한 캐시 한계는 [운영 문서](operations.md)에 설명했습니다.

## 감사 기록·추가 인증

0025–0026부터 권한 변경은 DB 트리거가 `workspace_security_events`에 기록한다. 관리자는 구성원 화면의 **권한 변경 기록**에서 최근 50개를 보거나 `engine.audit.list(workspaceId, limit = 50)`(최대 100)으로 조회한다. 일반 구성원·다른 workspace·MFA 미완료 세션은 기록을 볼 수 없다. API로 직접 쓰거나 보존 기간 정리 함수를 호출하는 권한은 주지 않는다. 이벤트는 actor/subject UUID와 권한만 저장하며 계정이 삭제돼도 workspace가 남아 있다면 과거 actor ID는 보존한다.

TOTP가 등록된 계정은 미완료 aal1에서 역할 RPC·원본 테이블·구성원 관계 helper까지 차단된다. UI의 역할 힌트와 별개로 DB가 판정한다. 운영자의 MFA/로그 보존 설정은 [체크리스트](../PRODUCTION-SECURITY.md)를 따른다.

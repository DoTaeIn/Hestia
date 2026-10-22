# 통합 방법

## 사용 단위

엔진은 TypeScript 모듈 소스와 Supabase의 SQL 스키마를 함께 사용한다. 현재 저장소 안에서 바로 호출할 수 있고, 독립 npm 패키지나 별도 HTTP 서버로 배포하지는 않았다.

`@/engine` import는 **이 저장소 안에서만** 유효한 Next.js 경로 별칭이다(`tsconfig.json`의 `"paths": { "@/*": ["./*"] }`). `app/` 아래 서버 컴포넌트·라우트 핸들러에서 쓰는 예시:

```ts
import { createHestiaEngine } from "@/engine";
import { createClient } from "@/lib/supabase/server";

async function listWorkspacePages(workspaceId: string) {
  const engine = createHestiaEngine(await createClient());
  const { data, error } = await engine.pages.list(workspaceId, { trashed: false });
  if (error) throw error;
  return data;
}
```

브라우저에서는 `@/lib/supabase/browser`의 `createClient()`를 주입한다. 서버에서는 매 요청마다 쿠키에 연결된 클라이언트를 만들고, 사용자별 엔진을 전역 변수에 보관하지 않는다. 실제로 타입 검사하는 문서 생성·기록·검색 예제는 [examples/headless.ts](../../examples/headless.ts)에 있다. 각 메서드는 독립 트랜잭션이므로 여러 호출을 하나의 원자적 작업으로 가정하지 않는다.

## 독립된 앱에서 쓰려면

별도 저장소/프로젝트에서 Hestia 엔진을 쓰려면 둘 다 가져가야 한다.

1. **모듈 소스** — `engine/` 전체(CRUD API용 `client.ts`·`result.ts`·`domain.ts`·`document.ts`, 공동 편집용 `collaboration-sync.ts`·`collaboration-recovery.ts`·`collaboration.ts`)를 그대로 복사하거나 git subtree/submodule로 가져온다. 퍼블리시된 레지스트리가 없으므로 버전 고정은 커밋 SHA 단위다. `package.json`에서 CRUD 쪽은 `@supabase/supabase-js`만 필요하고, 공동 편집 모듈은 추가로 `yjs`·`y-protocols`·`@tiptap/core`·`@tiptap/y-tiptap`에 의존한다 — CRUD만 가져갈 때는 Yjs/TipTap 의존성을 가져오지 않아도 된다.
2. **Supabase 스키마** — `supabase/migrations/`의 모든 SQL을 번호 순서대로, 빠짐없이 적용한다. 엔진 코드는 이 스키마와 RLS 정책을 전제로 짜여 있어서, 마이그레이션 없이 모듈만 가져가면 RPC 호출이 전부 실패한다.

RLS와 RPC가 PostgreSQL 함수·정책이므로 다른 DB 벤더로는 옮겨가지 않는다. "DB 독립적인 SDK"가 아니라 Supabase/Postgres에 묶인 코드다.

## API

`engine/client.ts`의 `createHestiaEngine(client, { identity? })`가 돌려주는 API 표면:

| 도메인 | 함수 |
| --- | --- |
| `members` / `roles` | [커스텀 역할 API](authorization.md) |
| `profiles` | `getSelf()`, `updateSelf({ displayName, avatarUrl? })` |
| `workspaces` | `create({ name })`, `listMemberships(userId)`, `invite({ workspaceId, email, role })`, `removeMember(workspaceId, userId)`, `setMemberRole(workspaceId, userId, role)` |
| `pages` | `get(id)`, `list(workspaceId, { trashed? })`, `create({ id?, workspaceId, parentId?, title?, content? })`, `move({ pageId, parentId, position? })`, `moveBefore(pageId, beforePageId)`, `trash(id)`, `restore(id)`, `transferOwnership(pageId, userId)` |
| `revisions` | `list(pageId)`, `save({ pageId, title, content, reason? })`, `restore({ pageId, revisionId, reason? })`, `setReason(id, reason)` |
| `search` | `search(workspaceId, term, limit = 60)` |
| `comments` | `createThread({ id?, workspaceId, pageId, quote, from, to })`, `reply(threadId, body)`, `delete(id)` |
| `notifications` | `list(limit = 20)`, `markRead(ids?)` |

반환되는 도메인 레코드는 DB와 같은 `snake_case`를 쓴다(`pages.create`는 `PageRecord`를, `workspaces.create`는 `{ id, name, slug, owner_id }`를 돌려준다). 페이지·버전·검색 조회는 워크스페이스 ID 또는 페이지 ID를 명시한다. 알림은 주입된 세션 사용자의 RLS로 범위가 결정된다. `listMemberships`의 사용자 ID는 해당 요청의 `auth.getUser()`에서 가져온다. 검색·알림의 limit은 1–100 범위이며, 페이지 목록은 전체 트리용이므로 페이지네이션하지 않는다.

`app/`은 이 API를 직접 호출한다 — 예를 들어 `lib/workspace-context.server.ts`의 `loadWorkspaceMemberships`는 `createHestiaEngine(supabase).workspaces.listMemberships(userId)`를 호출하고, `lib/pages.ts`는 `engine/domain.ts`·`engine/document.ts`의 타입과 헬퍼를 재export하면서 `pagesToTree`만 자체 로직으로 둔다. `invite_workspace_member`·`move_page_before`·`search_workspace`·`save_page_version`·`restore_page_revision` 같은 RPC는 전부 이 API 메서드들 안에서 호출되고, 그 정의는 `supabase/migrations/0019_system_integrity.sql`·`0020_workspace_operations.sql`에 있다.

## 공동 편집은 별도 진입점

페이지/버전/검색과 달리 공동 편집은 UI-free 핵심과 브라우저 결합이 물리적으로 다른 모듈에 있다.

- **헤드리스 코어** — `engine/collaboration-sync.ts`(`CollaborationProviderCore`, RPC 호출, 재시도·세대 충돌 분류)와 `engine/collaboration-recovery.ts`(로컬 스냅샷 직렬화), `engine/collaboration.ts`는 이 둘을 재export하는 진입점이다. 셋 다 React/Next를 import하지 않고, `SupabaseRpcClient`/`RealtimeClientLike`/`OperationStore`/`Scheduler`를 주입받는 순수 TypeScript라 Node에서도 테스트로 돌린다(`lib/collaboration-sync.test.ts`, `lib/collaboration-recovery.test.ts`가 이 엔진 모듈을 테스트한다). `engine/collaboration-sync.ts`만 추가로 `yjs`·`y-protocols`·`@tiptap/core`·`@tiptap/y-tiptap`에 의존한다 — 시드 문서를 Yjs 업데이트로 인코딩하는 `buildSeedUpdate` 때문이고, CRUD 쪽 엔진에는 이 의존이 없다.
- **브라우저 어댑터** — `lib/collaboration.ts`(`"use client"`)가 실제 Supabase 브라우저 클라이언트와 `localStorage`를 그 인터페이스에 맞게 묶어서 `SupabaseYjsProvider`를 만든다. `lib/collaboration-sync.ts`·`lib/collaboration-recovery.ts`는 이제 각각 `export * from "../engine/collaboration-sync.ts"` 한 줄짜리 호환 재export다. 다른 프레임워크(예: Vue, 모바일 웹뷰)에 공동 편집을 붙이려면 `lib/collaboration.ts`에 해당하는 어댑터만 새로 쓰고 `engine/` 쪽 헤드리스 코어는 그대로 재사용한다.

## RPC 의미

- `load_page_collaboration` — seed·generation·해당 generation의 누적 변경 로그를 읽는다. 최초 연결과 재연결 모두 이걸로 DB를 다시 따라간다.
- `seed_page_collaboration` — 최초 seed를 조건부로 확정한다. 승자든 패자든 결과로 받은 seed를 그대로 쓴다 — 자기 seed를 미리 병합하지 않는다.
- `append_page_collaboration_update` — 변경분을 저장하고 `operation_id` 중복을 검사한다. 같은 UUID 재시도는 `duplicate`로 성공 취급하고, 같은 UUID에 다른 내용이 오면 거부한다.

load는 현재 generation을 반환하고, 코어가 현재 세션의 generation과 비교해 복원을 감지한다. seed는 기대 generation이 다르면 오류를 반환하고, append는 예외 대신 `{ status: "stale_generation", generation }`을 반환한다. 코어는 세션을 멈추고 복구 정보를 보존한다. 미전송 내용을 내보낸 뒤 새로고침해서 새 generation을 읽는다.

버전을 기록하는 호스트는 공동 편집의 첫 로드·seed가 끝나고 미전송 큐가 저장된 상태인지 확인해야 한다. `revisions.save` 자체는 임의의 Yjs 세션을 추적하지 않는다. 현재 `Workbench`는 연결 상태와 handshake로 이 조건을 확인한다.

본문은 ProseMirror JSON이다. 엔진의 `DocumentNode`는 TipTap 타입을 런타임 의존성 없이 표현하며, 확장 노드의 전체 스키마 검증은 에디터 호스트가 맡는다. 같은 문서를 여는 호스트들은 댓글 앵커·이미지 `storagePath` 등 확장 스키마도 맞춰야 한다.

인증 제공자와 로그인 방식을 바꾸는 방법은 [authentication.md](authentication.md)를 참고하세요. 엔진의 identity 주입은 DB의 실제 JWT·RLS 권한을 우회하지 않습니다.

## 현재 공동 편집 프로토콜

보안 보강판은 `page-v2:<uuid>`에서 저장 완료 generation만 알리고 본문은 세션별 DB 조회로 가져온다. 원격 Yjs/awareness payload나 state-vector 요청·응답은 보내거나 신뢰하지 않는다. 원격 커서 표시를 별도로 기대하지 않는다. 연결·알림 누락 시 5초 DB 확인을 사용하고 큰 로그를 통째로 읽으므로 고부하 환경의 대역폭/지연은 따로 관찰한다. 구버전 클라이언트와 혼용하지 말고 앱과 0026 DB를 함께 적용한다. `audit.list`는 관리자 전용 로그 조회이며 Auth/MFA는 별도 security 어댑터에서 제공한다.

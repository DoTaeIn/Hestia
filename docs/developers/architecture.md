# 아키텍처

## 엔진과 셸

Hestia는 두 겹으로 나뉜다.

- **엔진** — 워크스페이스·페이지·버전·검색·댓글·알림 도메인 로직(`engine/client.ts`의 `createHestiaEngine(client)`)과 공동 편집 동기화 코어(`engine/collaboration-sync.ts`, `engine/collaboration-recovery.ts`). React·Next.js를 import하지 않고, 자기 손으로 Supabase 클라이언트나 환경변수를 만들지도 않는다. `createHestiaEngine`은 `SupabaseClient` 하나를 받아 그 세션으로만 동작하고, Yjs를 로드하지 않는다 — 공동 편집은 `engine/collaboration-sync.ts`가 별도로 `yjs`/`@tiptap/y-tiptap`을 끌어오는 별도 진입점이다. 공동 편집 코어는 React/Next 대신 `SupabaseRpcClient`/`RealtimeClientLike`/`OperationStore`/`Scheduler` 인터페이스를 주입받으므로 Node의 `node --test`에서 가짜 구현으로 돌아간다(`engine/collaboration-sync.ts`는 선택적으로 `@tiptap/core`의 `getSchema`/`JSONContent`에 의존하는 시드 빌더 `buildSeedUpdate`도 함께 내보낸다).
- **셸** — `app/`의 Next.js 라우트·React 컴포넌트, 그리고 브라우저 전용 결합(로컬스토리지, `window`, Realtime 채널, 이미지 서명 URL 미리보기)을 다루는 `lib/collaboration.ts` 같은 어댑터. 엔진을 호출하고 화면에 그린다. 이미지 업로드는 아직 엔진을 거치지 않는다 — `app/editor/Doc.tsx`가 브라우저 Supabase 클라이언트로 Storage 버킷에 직접 `upload`/`createSignedUrl`을 호출하는 셸 전용 코드다.

`lib/pages.ts`·`lib/workspace-context.server.ts` 같은 `lib/` 모듈은 이제 엔진의 얇은 래퍼다. 예를 들어 `lib/pages.ts`는 `../engine/domain.ts`의 타입과 `../engine/document.ts`의 `documentText`/`needsReason`을 재export하면서 `pagesToTree`만 자기 코드로 갖고, `lib/workspace-context.server.ts`의 `loadWorkspaceMemberships`는 `createHestiaEngine(supabase).workspaces.listMemberships(userId)`를 그대로 호출한다. `lib/collaboration.ts`(`"use client"`)·`lib/collaboration-sync.ts`·`lib/collaboration-recovery.ts`도 마찬가지로 `engine/collaboration*.ts`를 재export하거나 브라우저 전용 바인딩(`localStorage`, 브라우저 Supabase 클라이언트)만 더한다 — 로직 자체는 엔진에 있다.

## 최종 권한 판정은 항상 Postgres

엔진이든 셸이든 "이 사용자가 이 워크스페이스에서 이 작업을 할 수 있는가"를 자기 코드로 판정하지 않는다. 모든 테이블의 RLS 정책과 `security definer` RPC(`is_workspace_member`, `can_edit_workspace`, `invite_workspace_member`, `load_page_collaboration` 등, `supabase/migrations/0019_system_integrity.sql`·`0020_workspace_operations.sql`)가 유일한 경계다. 엔진 쪽 TypeScript 코드는 그 결과를 받아서 `EngineResult`로 포장할 뿐, 애플리케이션 레이어에서 별도로 권한을 재구현하지 않는다.

`engine/domain.ts`의 `getCapabilities`와 `canManageMember`는 이 규칙에 대한 예외처럼 보이지만 아니다. 둘 다 입출력만 있는 순수 함수이고, I/O도 Supabase 호출도 하지 않는다 — RLS/RPC가 내릴 결정을 UI가 미리 흉내 내서 "이 버튼을 보여줄까"만 판단하는 힌트다. 서버가 실제로 거부하는 요청을 이 두 함수가 허용해도 셸에서 버튼이 하나 더 보이는 UX 버그일 뿐 보안 구멍은 아니다 — 하지만 반대로 이 함수들의 결과를 서버 측 인가 판단으로 대체해서는 안 된다.

## 워크스페이스 격리

테넌트 경계는 워크스페이스다. 격리는 두 자리에서 이뤄진다.

1. **DB** — 모든 도메인 테이블이 `workspace_id`를 갖고, RLS가 `is_workspace_member`/`can_edit_workspace`로 멤버십을 확인한다. 이게 유일한 보안 경계다.
2. **호출자 선택** — `lib/workspace-context.ts`의 `selectWorkspace`는 호출자 자신의 멤버십 목록에서만 고른다. `?workspace=` 쿼리가 그 목록에 없으면 다른 워크스페이스로 조용히 대체하지 않고 `{ status: "forbidden" }`을 돌려준다. `lib/workspace-context.server.ts`의 `loadWorkspaceMemberships(supabase, userId)`는 내부에서 `engine.workspaces.listMemberships(userId)`를 호출하고, 그 엔진 함수가 `workspace_members` 조회에 `user_id` 필터를 명시적으로 건다 — 이 테이블의 RLS는 "같은 워크스페이스 멤버면 읽기 허용"이라서 필터를 빼면 다른 사람의 멤버십 행까지 섞여 돌아오기 때문이다. 넘기는 `userId`는 반드시 그 요청의 `supabase.auth.getUser()`가 돌려준 값이어야 한다 — 클라이언트가 보낸 값이나 다른 사용자의 id를 넘기면 이 필터는 그 다른 사용자의 멤버십을 호출자에게 노출하는 쪽으로 작동한다.

이 두 번째 자리는 UX와 쿼리 scope 좁히기용이다. 실제 격리는 1번(RLS)이 깨지면 전부 깨진다.

## 세션 클라이언트 주입

엔진은 자기 세션을 만들지 않는다. `engine/client.ts`의 `createHestiaEngine(client: SupabaseClient)`는 호출자가 이미 로그인 상태로 만든 클라이언트를 받아서 그 세션으로만 RPC/쿼리를 날린다. 서버 컴포넌트·라우트 핸들러는 `lib/supabase/server.ts`의 `createClient()`(쿠키 기반, `@supabase/ssr`의 `createServerClient`를 감싼 async 팩토리 — export된 함수 이름은 `createClient`다)를, 브라우저 코드는 `lib/supabase/browser.ts`의 `createClient()`를 넘긴다. 엔진 코드가 service-role 키나 전역 싱글턴 클라이언트를 들고 있지 않으므로, "누구 권한으로 이 요청이 나갔는가"는 항상 주입된 클라이언트의 세션 하나로 고정된다.

```ts
import { createHestiaEngine } from "@/engine";
import { createClient } from "@/lib/supabase/server";

async function listPages(workspaceId: string) {
  const engine = createHestiaEngine(await createClient());
  const { data, error } = await engine.pages.list(workspaceId, { trashed: false });
  if (error) throw error;
  return data;
}
```

## `EngineResult`와 에러

CRUD 엔진(`engine/client.ts`)의 모든 메서드는 예외를 던지지 않고 `engine/result.ts`의 다음 형태를 돌려준다.

```ts
type EngineResult<T> = { data: T; error: null } | { data: null; error: EngineError };

class EngineError extends Error {
  readonly code: "validation" | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "unavailable" | "unknown";
  readonly operation: string;
  readonly databaseCode?: string;
}
```

Supabase 클라이언트가 던지는 전송 예외(네트워크 끊김 등)와 Postgres 에러 코드는 `normalizeError`가 이 형태로 정규화한다. `error.code === "not_found"`는 RPC의 없음 오류 또는 `pages.move`·`revisions.setReason`에서 갱신 가능한 행이 없을 때 반환된다 — `pages.get`처럼 `.maybeSingle()`로 조회하는 메서드는 행이 없거나 RLS로 보이지 않을 때 예외가 아니라 `{ data: null, error: null }`을 돌려주므로, "행이 하나도 안 보인다"는 이 둘 중 어느 것인지 결과만으로는 구분할 수 없다. 같은 이유로 `pages.list`가 빈 배열을 돌려주는 것은 "이 워크스페이스에 멤버십이 있다"는 증거가 아니다 — 빈 배열은 멤버지만 페이지가 없을 때와 비멤버라 RLS가 아무 행도 보여주지 않을 때 둘 다에서 나온다.

공동 편집 코어(`engine/collaboration-sync.ts`)는 이 `EngineResult` 모양을 쓰지 않는다. `appendPageCollaborationUpdate`는 `{ status: "appended" | "duplicate" | "stale_generation", generation }`을 돌려주고, `CollaborationProviderCore`는 콜백(`onStatus`, `onStaleRecovery`)으로 상태를 통지한다. 세대가 어긋난 append가 예외를 던지지는 않는다 — `status: "stale_generation"`으로 알려주고, 코어가 이걸 받아 세션을 멈추는 쪽(`enterStale`)으로 처리한다. 예외가 나는 경우(RPC 호출 자체의 실패)는 `classifyCollaborationError`가 메시지 문자열로 `"stale-generation" | "forbidden" | "transient"`를 분류한다.

세 가지 실패 양상을 구분해 둘 것:

- **세대 불일치**(다른 편집자가 과거 판으로 복원함) — `append`는 예외 없이 `status: "stale_generation"`으로, `seed`는 기대 generation 불일치를 오류로 반환하고, `load`는 최신 generation을 반환해 코어가 세션과 비교한다. 재시도로 해결되지 않는다. 사용자는 새로고침해야 하고, 미전송 편집은 `engine/collaboration-recovery.ts`가 로컬에 보존한다.
- **`forbidden`**(권한 상실, 비멤버) — 재시도 대상이 아니다. 세션은 저장과 실시간 연결을 멈춘다(`enterForbidden`).
- 그 외 전송 실패 — 지수 백오프로 재시도한다(`nextRetryDelayMs`, 최대 5회).

이미지 업로드와 서명 URL, 로그인, 라우팅, 트리 표시 및 날짜·이름을 붙이는 조회 모델은 현재 셸에 남아 있다. 새 화면은 이 결합부를 자체 구현하고 엔진의 문서 포맷·저장 API를 공유한다. UUID 생성과 base64 함수는 지원되는 Node/브라우저 런타임의 전역 API를 사용한다.

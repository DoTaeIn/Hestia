# Hestia · Preview 0.1

워크스페이스–페이지 계층 구조 기반의 문서 협업 SaaS. (Confluence 형태)

문서·권한·버전·검색·공동 편집을 담당하는 `engine/`과 Next.js 화면인 `app/`을 분리합니다. 현재 화면과 동아리용·다른 SaaS용 화면에서 같은 엔진을 사용할 수 있습니다. [개발자 문서](docs/developers/index.md)에서 시작하세요.

**버전이 텍스트가 아니라 변경 이유를 보존합니다.** 본문이 지워져도 왜 지웠는지는 남고, 그 이유는 검색됩니다 — [docs/WHY.md](docs/WHY.md)

## 인증·워크스페이스 실행

1. Supabase 프로젝트를 만든 뒤 `supabase/migrations/`의 SQL을 번호 순서대로 빠짐없이 실행합니다. 로컬은 `npx supabase start` 후 `npx supabase migration up --local`. 앱 코드와 마이그레이션은 같은 버전으로 맞춥니다.
2. `.env.example`을 `.env.local`로 복사하고 Supabase URL과 Publishable Key를 넣습니다.
3. Supabase Auth에서 사용할 provider를 설정합니다. 기본 로그인은 매직 링크이며 비밀번호·OAuth 표시는 `.env.example`에서 선택합니다. [인증·프로필 설정](docs/developers/authentication.md)을 참고하세요.
4. `npm ci` 후 `npm run dev`로 실행합니다. Vercel에 배포할 때는 같은 환경 변수를 Project Settings에 추가합니다.

자세한 배포 순서는 [배포 가이드](docs/DEPLOYMENT.md)를 참고하세요.

## 문서

- [PRODUCT.md](PRODUCT.md) — 제품 정의, 확정된 것과 미정인 것
- [docs/WHY.md](docs/WHY.md) — 차별점의 설계와 폐기 기준
- [docs/PLANNING.md](docs/PLANNING.md) — 현재 구현 상태, 실제 스택, 다음 할 일
- [DESIGN.md](DESIGN.md) — 디자인 시스템
- [docs/SYSTEM-AUDIT.md](docs/SYSTEM-AUDIT.md) — 시스템 정비, DB 적용 순서, 검증 결과와 남은 범위
- [docs/LOCAL-VALIDATION.md](docs/LOCAL-VALIDATION.md) — 실제 로컬 서비스·브라우저 검증과 0026까지의 적용 결과
- [개발자 문서](docs/developers/index.md) — 엔진 API, 통합 예제, 권한·세션 경계, 동아리 운영 절차

## 엔진 사용

이미 인증된 Supabase 클라이언트를 주입합니다. 브라우저와 서버에서 같은 API를 쓰며, 서버에서는 요청별 세션 클라이언트를 만듭니다.

```ts
import { createHestiaEngine } from "./engine/index.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

async function findDocuments(client: SupabaseClient, workspaceId: string) {
  const engine = createHestiaEngine(client);
  const result = await engine.search(workspaceId, "회의록");
  if (result.error) throw result.error;
  return result.data;
}
```

공동 편집은 별도 진입점 `engine/collaboration.ts`로 제공합니다. DB는 Supabase의 RLS·RPC를 사용하며, 엔진 자체는 로그인·라우팅·화면을 만들지 않습니다.

## 범위

1. 리치 텍스트 에디터 (마크다운 · 표 · 이미지)
2. 계층형 문서 구조 (워크스페이스 / 페이지 트리 · 휴지통)
3. 권한 관리 (`workspace_members.role` + Postgres RLS)
4. 버전 관리 (히스토리 · diff · 복원)
5. 검색 (제목 · 본문 · **변경 이유**)
6. 실시간 동시 편집 (Yjs), 댓글, 알림

## 테스트

```
npm test
```

실제 로컬 Auth·Storage·Realtime 통합 검사는 `npm run test:services`로 실행합니다. Hestia의 `http://127.0.0.1:55421` 환경만 허용하며, 테스트 계정·워크스페이스·이미지는 기본적으로 자동 정리합니다. 브라우저 검증용 계정을 유지하려면 `npm run test:services -- --keep-fixtures`, 검증 후에는 `npm run test:services:cleanup`을 실행합니다. [로컬 실행 가이드](docs/DEPLOYMENT.md)를 참고하세요.

## 보안·사용자 관리

현재 공유본은 `0.1.0-preview.3`입니다. 워크스페이스 상단 **구성원·역할**에서 구성원 추가·제거·기본/커스텀 역할을 관리합니다. [권한 API](docs/developers/authorization.md), [보안 검증](docs/SECURITY-REVIEW.md), [운영자가 설정할 것](docs/PRODUCTION-SECURITY.md), [제보 안내](SECURITY.md)를 참고하세요.

## Preview 0.1 공유

Node.js 24 이상에서 `npm ci`, `npm test`, `npm run typecheck`, `npm run build`로 확인합니다. `npm run release:preview`(macOS/Linux의 zip·unzip 필요)는 소스 ZIP·설치 SQL·파일별 매니페스트·SHA256을 `dist/`에 만듭니다. 비밀값과 `.env.local`, 빌드 캐시, 테스트 계정은 포함하지 않습니다.

새 DB 설치와 기존 DB 업그레이드는 [SQL 안내](supabase/README.md), 받는 사람의 실행 순서는 [Preview 가이드](docs/releases/preview-0.1.md)를 참고하세요. 계정 메뉴 → 프로필 설정에서 표시 이름과 아바타 URL을 수정할 수 있습니다.


개발자 문서 사이트는 `npm run docs:build`로 생성한다. [GitHub Actions/Pages 게시 설정](docs/developers/publishing.md)을 참고한다.

개발자 문서 공개 사이트: [Hestia Developer Docs](https://dotaein.github.io/Hestia/).

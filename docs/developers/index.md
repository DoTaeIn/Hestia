# 개발자 문서

이 폴더는 Hestia를 **임베드해서 쓰는 개발자** 대상이다. 제품 정의는 [`PRODUCT.md`](../../PRODUCT.md), 제품 운영 현황은 [`docs/SYSTEM-AUDIT.md`](../SYSTEM-AUDIT.md)를 본다. 이 폴더는 그 둘과 겹치지 않고, 엔진 코드를 가져다 쓰는 입장에서 필요한 사실만 다룬다.

- [authentication.md](authentication.md) — 로그인 방식 설정, 인증 어댑터 교체, 프로필 수정과 DB 권한.
- [Preview 0.1](../releases/preview-0.1.md) — 공유본 설치와 릴리스 범위.
- [운영 보안 체크리스트](../PRODUCTION-SECURITY.md) — 실제 도메인·Auth·CAPTCHA·백업 설정.
- [authorization.md](authorization.md) — 사용자·기본/커스텀 역할, 권한 조합, 엔진 API와 격리 정책.
- [architecture.md](architecture.md) — UI 없는 엔진과 Next.js 셸의 경계, 워크스페이스 격리, 세션 클라이언트 주입, `EngineResult` 에러 모델.
- [integration.md](integration.md) — 다른 앱에서 이 코드를 가져다 쓰는 실제 방법(모듈 소스 + Supabase 스키마), API 목록.
- [operations.md](operations.md) — 초대·가입 흐름, 마이그레이션 적용 상태, 아직 검증하지 못한 범위.

- [publishing.md](publishing.md) — GitHub Actions/Pages 문서 게시와 로컬 미리보기.

## 시작점

`engine/`은 이 저장소 안에 실제로 존재하고, `app/`은 이미 그걸 통해 워크스페이스·페이지·버전·검색·댓글·알림·공동 편집을 호출한다. UI 없는 CRUD API는 `engine/client.ts`의 `createHestiaEngine(client)`가, 공동 편집의 Yjs 동기화 코어는 `engine/collaboration-sync.ts` + `engine/collaboration-recovery.ts`가 맡는다. 둘은 서로 다른 진입점이다 — `createHestiaEngine`은 Yjs를 로드하지 않고, 공동 편집 코어는 `createHestiaEngine`을 거치지 않는다. 옛 `lib/collaboration-sync.ts`·`lib/collaboration-recovery.ts`는 이제 `engine/collaboration-sync.ts`·`engine/collaboration-recovery.ts`를 그대로 재export하는 한 줄짜리 호환 레이어이고, `lib/collaboration.ts`는 그 엔진 코어에 브라우저 Supabase 클라이언트·`localStorage`를 묶는 `"use client"` 어댑터다.

실제로 타입 검사하는 UI 없는 예제는 [examples/headless.ts](../../examples/headless.ts)에 있다. 문서 생성, 버전 기록, 검색을 각각 보여준다.

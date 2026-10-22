# Changelog

## 0.1.0-preview.3 — 세션·공동 편집 보안

- 0025–0026: TOTP 등록 계정의 aal2를 DB·Storage·Realtime·관리 RPC에서 강제하고 권한 변경 감사 로그를 추가했다.
- 계정 보안·OTP 확인·브라우저 복구 자료 내보내기/삭제 화면을 추가했다.
- 공동 편집 채널은 저장 완료 알림만 전달하고 본문은 인가된 DB에서 읽는다. 비공개 이미지는 인증된 다운로드로 표시한다.
- 응답마다 nonce CSP를 적용하고 운영 HTTPS 설정 검사, Turnstile 연결, 보안 CI와 읽기 전용 DB 점검 SQL을 추가했다.
- 로컬 비밀번호 정책·OTP 만료·TOTP 설정을 적용했다. [운영자가 설정할 항목](docs/PRODUCTION-SECURITY.md)은 별도로 정리했다.

## 0.1.0-preview.2 — 보안·사용자 관리

- 취약점 공지에 맞춰 Next.js·TipTap·ProseMirror·이미지/빌드 의존성을 패치하고 PostCSS override를 적용했다.
- 무인증 대기자 등록 파일 쓰기를 제거하고 Preview 로그인으로 연결했다. 보안 응답 헤더와 인증 페이지의 캐시 방지를 추가했다.
- 0024: 워크스페이스별 커스텀 역할·문서 편집/구성원 관리 권한, 소유자 보호·교차 워크스페이스 배정 차단·관리 요청 경합 방어.
- 구성원·역할 관리 화면과 엔진 API를 추가했다. [권한 안내](docs/developers/authorization.md)·[보안 검증](docs/SECURITY-REVIEW.md).

## 0.1.0-preview.1 — Preview 0.1

- 로그인 방식을 설정 가능하게 했다: 기본은 매직 링크, 비밀번호와 OAuth는 `NEXT_PUBLIC_AUTH_*`로 옵트인한다(`auth.config.ts`).
- `AuthAdapter`/`IdentityProvider`를 엔진 공개 타입으로 분리하고(`engine/auth.ts`), `createHestiaEngine`이 `options.identity`로 다른 구현을 주입받을 수 있게 했다(`engine/client.ts`). 기본 구성은 `lib/auth/browser.ts`/`lib/auth/server.ts`가 맡는다.
- 표시 이름·아바타 URL을 편집하는 프로필 화면을 추가했다(`app/account/profile`, `engine/profiles.ts`). 로그인 이메일/비밀번호는 계속 Auth 공급자 책임이다.
- `supabase/migrations/0023_profile_editing.sql`로 프로필 쓰기 경계를 컬럼 단위 GRANT와 체크 제약으로 좁혔다: `display_name`/`avatar_url`만 쓰기 가능하고, `id`/`created_at`은 더 이상 클라이언트가 바꿀 수 없다. 아바타 URL은 HTTP(S) 절대 주소만 허용한다.
- 자세한 내용은 [docs/developers/authentication.md](docs/developers/authentication.md)와 [docs/releases/preview-0.1.md](docs/releases/preview-0.1.md)에 있다.

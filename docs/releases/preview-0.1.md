# Hestia Preview 0.1

버전 `0.1.0-preview.3`, DB 스키마 `0026`. 동아리에서 평가하고 개발자가 다른 화면을 붙여볼 수 있는 소스 공유본입니다. 기존 [라이선스](../../LICENSE.md)를 유지합니다.

## 받는 사람의 실행 순서

1. ZIP을 풀고 Node.js 24 이상에서 `npm ci`를 실행합니다.
2. [SQL 안내](../../supabase/README.md)에 따라 Supabase를 준비합니다. 새 로컬 환경은 Docker 실행 후 `npx supabase start`, `npx supabase migration up --local`을 사용합니다. 새 Supabase DB에 SQL로 설치한다면 `supabase/install.sql` 하나를 사용합니다. 기존 DB는 미적용 번호만 업그레이드합니다.
3. `.env.example`을 `.env.local`로 복사하고 해당 환경의 Supabase URL·publishable key를 넣습니다. 비밀 service role key는 브라우저 환경 변수에 넣지 않습니다.
4. Auth의 Site URL·Redirect URLs에 실행 주소와 `/auth/callback`을 허용합니다. 기본 `npm run dev` 주소는 `http://localhost:3000`입니다. 포트를 바꾸면 허용 주소도 맞춥니다. 로컬 매직 링크는 Mailpit(기본 55424)에서 확인합니다.
5. `npm run dev`로 열고 로그인 → 워크스페이스 생성 → 문서 작성·버전 기록을 확인합니다. 구성원은 각자 한 번 로그인한 뒤 대표자가 가입된 이메일로 초대합니다.
6. 계정 메뉴 → **프로필 설정**에서 표시 이름과 아바타 URL을 수정합니다.

보안 보강판입니다. 워크스페이스 상단 **구성원·역할**에서 사용자와 커스텀 역할을 관리할 수 있습니다. [권한 문서](../developers/authorization.md)와 [보안 검증](../SECURITY-REVIEW.md)을 참고하세요.

## 포함된 기능과 교체 지점

문서 트리·권한·버전/변경 이유·검색·공동 편집·댓글·알림·비공개 이미지와 휴지통을 제공합니다. `engine/`은 UI와 분리되어 있습니다. [개발자 문서](../developers/index.md)와 [헤드리스 예제](../../examples/headless.ts)를 참고하세요.

로그인 방식은 `auth.config.ts`와 `NEXT_PUBLIC_AUTH_*`로 고릅니다. 기본은 매직 링크이며 비밀번호·OAuth는 설정 후 켭니다. 비밀번호 로그인 UI는 이미 준비된 계정으로 로그인하며, 회원가입·비밀번호 재설정 화면은 호스트 앱에서 구현합니다. 인증 제공자 교체는 `lib/auth/browser.ts`·`lib/auth/server.ts`가 맡습니다. 다른 제공자를 연결할 때 필요한 Supabase UUID/JWT·사용자 매핑은 [인증 문서](../developers/authentication.md)에 설명했습니다. 로그인 이메일·비밀번호는 프로필과 분리해 인증 제공자가 관리합니다.

## 공유 파일

`npm run release:preview`로 다음 파일을 생성합니다.

- `dist/hestia-preview-0.1.zip`: 소스, 문서, SQL, 테스트와 파일별 `RELEASE-MANIFEST.json`.
- `dist/hestia-preview-0.1-install.sql`: 새 DB용 전체 설치 SQL. 원본은 번호별 마이그레이션이며 생성 파일은 직접 수정하지 않습니다.
- `dist/hestia-preview-0.1.manifest.json`, `.sha256`: 파일별 해시와 공유 파일 체크섬. `dist/`에서 `shasum -a 256 -c hestia-preview-0.1.sha256`로 확인합니다.

ZIP에는 `.env.local`, 비밀값, 테스트 계정, Git·빌드 캐시·의존성 폴더를 포함하지 않습니다. 설치 SQL은 기존 테이블이 있으면 중단하고, 성공 시 CLI 마이그레이션 이력을 0001–0026으로 기록합니다. 기존 DB에 설치 SQL을 다시 실행하지 마세요.

## 검증과 알려진 한계

실제 검증 결과는 [로컬 검증 기록](../LOCAL-VALIDATION.md)에 있습니다. 로컬 업그레이드·실제 서비스·프로필 화면과 별도 빈 DB의 설치 번들을 검증했습니다. 외부 발행이나 운영 배포는 수행하지 않았습니다.

외부 SMTP·OAuth 제공자 연결, 운영 도메인, 다인·대용량·장시간 부하는 아직 검증하지 않았습니다. 미가입자 초대 메일·과금·공동 편집 로그 압축은 구현 범위에 없습니다. 지속 연결 Realtime 권한 철회와 복구 저장소의 한계는 [운영 문서](../developers/operations.md)를 확인하세요.

## 최종 보안 보강

계정 보안 화면에서 TOTP를 등록하고 브라우저 복구 데이터를 관리합니다. 등록한 계정은 DB·Storage·관리 RPC에서도 OTP 승격을 요구합니다. 권한 변경 감사 로그와 nonce CSP, 인증 후 이미지 로딩, DB 재검증을 거치는 공동 편집을 포함합니다. 운영 전에는 [운영 보안 설정](../PRODUCTION-SECURITY.md)을 완료하세요.

# 인증

로그인 방식과 프로필 편집은 서로 다른 경계에 있다. 로그인은 호스트 앱(`auth.config.ts`, `lib/auth/`)이 결정하고, 엔진(`engine/auth.ts`)은 "로그인된 사용자가 누구인가"만 `Identity`로 받는다.

## 엔진이 보는 타입

`engine/auth.ts`가 공개하는 전부다.

```ts
type Identity = { id: string; email: string | null };
type IdentityProvider = { getUser(): Promise<EngineResult<Identity | null>> };
type AuthAdapter = IdentityProvider & {
  signOut(): Promise<EngineResult<null>>;
  requestEmailLink(input: { email: string; redirectTo: string }): Promise<EngineResult<null>>;
  signInWithPassword(input: { email: string; password: string }): Promise<EngineResult<Identity>>;
  signInWithOAuth(input: { provider: OAuthProvider; redirectTo: string }): Promise<EngineResult<{ url: string | null }>>;
  exchangeCode(code: string): Promise<EngineResult<Identity>>;
};
```

`createSupabaseAuthAdapter(client)`가 Supabase Auth(GoTrue)로 이 인터페이스를 구현한다. `getUser()`는 세션이 없거나 삭제된 사용자·만료/거부된 세션일 때 `{ data: null, error: null }`을 돌려주고, 다른 실패는 그대로 보존한다. 비밀번호는 trim하지 않고 이메일만 trim한다. `engine/auth.ts`는 Next.js나 다른 런타임 프레임워크를 import하지 않는다 — 어느 호스트에서도 같은 코드로 동작한다.

`createHestiaEngine(client, options?)`의 `options.identity`로 다른 `IdentityProvider`를 주입할 수 있다. 생략하면 `createSupabaseAuthAdapter(client)`가 기본값이다(`engine/client.ts`). `engine/profiles.ts`의 `getSelf`/`updateSelf`를 포함해 엔진 전체가 이 주입된 identity로 "나"를 판단한다. 최종 권한 경계는 여전히 DB RLS다 — identity는 세션을 `Identity`로 바꿔줄 뿐, 그 자체로 권한을 발급하지 않는다.

## 호스트 앱의 기본 구성

`lib/auth/browser.ts`와 `lib/auth/server.ts`가 각각 브라우저/서버 세션에 `createSupabaseAuthAdapter`를 묶는 조립 지점이다.

```ts
// lib/auth/browser.ts
export function createBrowserAuth(client = createClient()): AuthAdapter {
  return createSupabaseAuthAdapter(client);
}
```

`lib/engine/browser.ts`·`lib/engine/server.ts`가 이 어댑터를 `createHestiaEngine`에 넘긴다. 다른 로그인 공급자로 바꾸려면 인증 팩토리와 클라이언트의 JWT 전달을 함께 구성한다. 다른 리다이렉트/콜백 흐름은 호스트 라우트에서 연결하며, `engine/`은 수정할 필요가 없다.

## 로그인 방식: 매직 링크 기본, 비밀번호·OAuth는 옵트인

`auth.config.ts`가 호스트 앱의 로그인 정책이다. 엔진은 이 파일을 import하지 않는다.

| 환경 변수 | 기본값 | 효과 |
| --- | --- | --- |
| `NEXT_PUBLIC_AUTH_EMAIL_LINK` | 미설정 시 `true` | 매직 링크 로그인 표시. `"false"`로만 끈다 |
| `NEXT_PUBLIC_AUTH_PASSWORD` | 미설정 시 `false` | `"true"`일 때만 비밀번호 로그인 표시 |
| `NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS` | 미설정 시 빈 목록 | 쉼표로 구분한 OAuth provider id 목록(`google,github,…`) |

`NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true`는 `NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS`가 비어 있을 때 `google`을 켜는 하위 호환 스위치다. 즉 기본 상태는 매직 링크만 켜진 상태이고, 비밀번호와 OAuth는 각 환경 변수로 명시적으로 열어야 노출된다. `oauthProviders`의 `id`는 `engine/auth.ts`의 `OAuthProvider`(Supabase SDK의 `Provider`) 타입이어야 하므로, 설정에 올리는 provider id는 Supabase Auth가 인식하는 값과 같아야 한다.

## 다른 인증 공급자로 바꾸려면

`lib/auth/browser.ts`·`lib/auth/server.ts`의 팩토리가 반환하는 값을 `AuthAdapter`(또는 읽기만 필요하면 `IdentityProvider`) 구현으로 교체한다. 이때 지켜야 하는 것은 구현 방식이 아니라 엔진이 기대하는 신원 모델이다.

- `getUser()`가 반환하는 `Identity.id`는 `public.profiles.id`, `auth.users.id`와 같은 값(UUID)이어야 한다. 엔진의 모든 쿼리와 RPC는 이 id로 행을 찾는다.
- DB 쪽 RLS와 RPC는 Supabase가 발급하는 JWT(`request.jwt.claims`의 `sub`)를 `auth.uid()`로 읽는다. 다른 공급자를 쓴다면, 그 공급자의 신원이 **같은 `auth.users` 행과 같은 `sub` 클레임을 가진 Supabase JWT**로 교환되어야 RLS가 통과한다 — 그렇지 않으면 쿼리는 전부 빈 결과나 권한 거부로 돌아온다.
- `public.profiles`는 `auth.users`에 대한 `id` FK이고(`supabase/migrations/0001_auth_workspaces.sql`, `0023_profile_editing.sql`의 `handle_new_user` 트리거), 신규 사용자가 로그인했을 때 이 행이 이미 존재하거나 트리거로 생성되어 있어야 `profiles.getSelf()`가 성공한다.

즉 "임의의 OAuth/SSO를 붙이면 그대로 동작한다"는 보장은 없다. 공급자를 바꾸는 쪽이 Supabase 호환 UUID/JWT 발급과 `auth.users`/`profiles` 매핑까지 책임져야 하고, 그 매핑이 없으면 로그인 화면은 뜨더라도 엔진 호출은 전부 거부된다.

## 프로필 편집과 로그인 정보는 분리되어 있다

`profiles.getSelf()`/`profiles.updateSelf({ displayName, avatarUrl? })`(`engine/profiles.ts`)가 다루는 것은 `display_name`과 `avatar_url` 두 컬럼뿐이다. 로그인 이메일과 비밀번호는 Auth 공급자(GoTrue)가 `auth.users`에서 관리하고, `public.profiles`에는 이메일·비밀번호 컬럼이 없다(`supabase/migrations/0023_profile_editing.sql`). `app/account/profile/ProfileForm.tsx`가 로그인 이메일을 읽기 전용으로만 보여주는 이유다.

DB 쪽 경계는 컬럼 단위 GRANT다: `authenticated`는 `profiles` 테이블 전체 UPDATE 권한이 없고 `display_name`, `avatar_url` 두 컬럼에만 UPDATE가 허용된다. `id`/`created_at`은 컬럼 GRANT로 먼저 막히고, 식별된 호출자의 UPDATE에 대해서는 트리거가 한 번 더 그 두 값의 변경을 거부한다. 아바타 URL은 `public.is_safe_avatar_url`로 HTTP(S) 절대 URL(자격 증명 없음, 공백·제어 문자·`<>"'\` 없음, 2048자 이하)만 허용하는 체크 제약을 거친다.

## 2단계 인증과 bot 방지

`engine/security.ts`의 `SecurityAdapter`와 `lib/auth/security-browser.ts`·`security-server.ts`가 TOTP 등록·조회·확인·해지를 분리한다. 기본 Auth와 별개 교체 지점이며 custom provider는 동일 UUID/JWT와 추가 인증 흐름을 함께 연결한다. 기본 화면은 `/account/security`, 1차 로그인 뒤 필요한 추가 확인은 `/account/verify`다. 등록된 TOTP가 있는 계정은 DB의 `session_is_allowed()`가 aal2를 요구하므로 미들웨어만 우회해도 접근하지 못한다.

이메일 링크·비밀번호 요청은 선택적 `captchaToken`을 SDK에 전달한다. `NEXT_PUBLIC_TURNSTILE_SITE_KEY`가 있으면 로그인 위젯을 띄우며 nonce CSP에서 해당 호스트만 추가 허용한다. 대응하는 secret과 서버 CAPTCHA 활성화는 Supabase Auth에 설정한다. `.env.production.example`과 [운영 체크리스트](../PRODUCTION-SECURITY.md)를 참고한다.

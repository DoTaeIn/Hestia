# Hestia

워크스페이스–페이지 계층 구조 기반의 문서 협업 SaaS. (Confluence 형태)

**버전이 텍스트가 아니라 변경 이유를 보존합니다.** 본문이 지워져도 왜 지웠는지는 남고, 그 이유는 검색됩니다 — [docs/WHY.md](docs/WHY.md)

## 인증·워크스페이스 실행

1. Supabase 프로젝트를 만든 뒤 `supabase/migrations/` 의 SQL 을 번호 순서대로 전부 실행합니다 (`0001` ~ `0017`). 로컬은 `npx supabase start` 후 `npx supabase migration up --local`.
2. `.env.example`을 `.env.local`로 복사하고 Supabase URL과 Publishable Key를 넣습니다.
3. Supabase Auth에서 Email과 Google provider를 활성화합니다.
4. `npm run dev`로 실행합니다. Vercel에 배포할 때는 같은 환경 변수를 Project Settings에 추가합니다.

자세한 배포 순서는 [배포 가이드](docs/DEPLOYMENT.md)를 참고하세요.

## 문서

- [PRODUCT.md](PRODUCT.md) — 제품 정의, 확정된 것과 미정인 것
- [docs/WHY.md](docs/WHY.md) — 차별점의 설계와 폐기 기준
- [docs/PLANNING.md](docs/PLANNING.md) — 현재 구현 상태, 실제 스택, 다음 할 일
- [DESIGN.md](DESIGN.md) — 디자인 시스템

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

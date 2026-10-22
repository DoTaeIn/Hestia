# 문서 사이트 게시

기존 Markdown을 `npm run docs:build`로 정적 HTML로 만든다. 앱 서버·Supabase·환경 변수·배포 토큰이 필요하지 않다. 결과는 Git에서 제외되는 `docs-site/`에 생성된다. 모바일 메뉴, 시스템 밝기/어둠 모드와 코드·표 표시를 포함한다.

## GitHub Pages 최초 설정

1. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택한다.
2. **Settings → Environments → github-pages**에서 배포 허용 브랜치를 저장소 기본 브랜치로 제한한다. 게시 전 사람 검토가 필요하면 required reviewers도 설정한다(계정/요금제 지원 여부 확인).
3. 변경을 기본 브랜치에 합친다. **Actions → Developer docs**에서 build와 deploy 결과를 확인한다. 수동 실행은 **Run workflow**에서 기본 브랜치를 선택한다.
4. 성공한 배포의 environment URL로 연다. 별도 도메인을 쓰지 않으면 `https://dotaein.github.io/Hestia/` 형태다. 저장소 이름·Pages 설정에 따라 실제 URL은 Actions 결과를 기준으로 한다.

개인 액세스 토큰이나 Supabase secret을 추가하지 않는다. 배포 작업만 `pages: write`·`id-token: write`를 갖고 기본 브랜치에서 실행된다. PR·다른 브랜치는 빌드만 실행하며 사이트를 게시하지 않는다. 문서/빌드 관련 경로의 push·PR 또는 수동 실행으로 동작한다. [GitHub 공식 custom workflow 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

2026-10-22 사용자의 게시 요청에 따라 GitHub Pages를 Actions 방식으로 활성화하고 실제 게시를 확인했다. 공개 주소는 [Hestia 개발자 문서](https://dotaein.github.io/Hestia/)다. 앱 운영 배포와 운영 DB 변경은 수행하지 않았다.

## 로컬 미리보기

```sh
npm ci
npm run docs:build
python3 -m http.server 8080 --directory docs-site
```

`http://localhost:8080`에서 확인한다. 기본 HTML 링크는 상대 경로이므로 `/Hestia/` 같은 프로젝트 하위 경로에서도 동작한다. 빌드 시 문서 사이 링크를 HTML로 변환하고, 코드/SQL·내부 기록 링크는 GitHub 원본으로 연결한다. 존재하지 않는 파일 링크는 빌드 실패로 확인한다.

## 게시 범위와 수정

공개 사이트 대상은 `scripts/build-docs.mjs`의 명시적 목록이다: 개발자 문서, 릴리스 가이드, 배포·운영 보안·보안 검증 문서, DB 안내와 라이선스. 개발자 문서는 `docs/developers/*.md`를 추가하면 메뉴에 포함된다. 파일 내용을 수정한 뒤 로컬 빌드와 PR 빌드로 확인한다.

`.env*`, 애플리케이션 소스, 테스트 계정·스크린샷, 회사 누적 노트는 사이트에 복사하지 않는다. 문서 자체에 비밀값을 쓰지 않는다. GitHub 원본으로 연결한 파일의 열람 권한은 저장소 설정을 따른다. 비공개 저장소라도 Pages 열람 범위는 별도 설정이므로 실제 게시 전에 확인한다.

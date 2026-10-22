import { headers } from "next/headers";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./sections.css";

export const metadata: Metadata = {
  title: "Hestia — 지운 적 없는 문서",
  description:
    "팀이 쓴 모든 문장에 누가, 언제, 무엇을 바꿨는지가 남는 문서 협업 공간. 베타 대기자를 모집합니다.",
  icons: { icon: "/favicon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f7fafc",
};

/*
 * The direction contract. Emitted into the built markup on purpose — grep the
 * production output for seed 09bd09a4 to audit the build against its promise.
 */
const CONTRACT = `<!--
THESIS: 밤바다는 지나간 자리를 몇 초 만에 지운다. Hestia는 지우지 않는다. 카테고리 기본형(그라디언트 히어로 + 앱 스크린샷 목업 + 3열 기능 카드)을 거부한다.
OWN-WORLD: 심연 흑 #05070B 바탕. 플랑크톤 청 #1E90FF 와 항적 시안 #00E5FF 이 "지금 일어나는 일", 항구 램프 호박 #F5A83C 이 "붙잡아 둔 이력". 극세 기하 산세(SUIT 250 / Jost 300), 발광 윤곽선 컨트롤, 입자 항적. 카드 없음, 3열 없음.
STORY: 방문자는 문서 이력이 증발해 본 경험을 알아본다 → Hestia만 그 자리를 붙잡는다고 믿는다 → 베타 대기자로 등록한다.
FIRST VIEWPORT: 전면 밤바다 캔버스. 스크롤이 배가 되어 항적을 긋고, 커서가 건드린 플랑크톤은 몇 초 뒤 꺼지지만 항적은 호박색으로 식어 남는다. 좌측에 2행 헤드라인, 그 아래 이메일 한 줄이 primary action.
FORM: 야광 플랑크톤 바다(reefs-bioluminescent-nocturnal-plankton-wake-stars). 사용자가 챌린저로 직접 선택 — grounded 목록 3번(원장)을 밀어냈다. seed 09bd09a4.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

/*
 * Runs before first paint. Stored choice wins; Hestia otherwise opens on paper.
 */
const THEME_BOOT = `try{document.documentElement.dataset.theme=localStorage.getItem("hestia-theme")||"light"}catch(e){}`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <span hidden dangerouslySetInnerHTML={{ __html: CONTRACT }} />
        {children}
      </body>
    </html>
  );
}

import Link from "next/link";
import Sea from "./Sea";
import History from "./History";
import Structure from "./Structure";
import Finder from "./Finder";
import Waitlist from "./Waitlist";
import BrandMark from "./BrandMark";
import LandingThemeToggle from "./LandingThemeToggle";
import { ArrowRight } from "./icons";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <>
      <Sea />

      <div className="shell">
        <header className="nav">
          <a className="brand" href="#top">
            <BrandMark size={30} />
          </a>
          <nav className="nav-links" aria-label="주요 섹션">
            <a href="#history">이력</a>
            <a href="#structure">구조</a>
            <a href="#search">검색</a>
            <Link href={user ? "/space" : "/login"}>{user ? "내 워크스페이스" : "로그인"}</Link>
            <LandingThemeToggle />
          </nav>
        </header>

        <main id="top">
          <section className="hero">
            <h1 className="display">
              지나간 자리는 곧 지워집니다.
              <br />
              <span className="kept">여기서는 남습니다.</span>
            </h1>

            <p className="lead hero-lead">
              Hestia는 팀이 쓴 모든 문장에 누가, 언제, 무엇을 바꿨는지를 남기는
              문서 협업 공간입니다. 삭제도 되돌리기도 앞선 판을 덮어쓰지 않고
              새 판으로 기록됩니다.
            </p>

            <div className="hero-cta">
              <Waitlist id="hero-wl" />
            </div>

            <p className="hero-scroll">
              <a href="#history">
                문서 하나가 넉 달 동안 지나온 길 보기
                <ArrowRight size={15} />
              </a>
            </p>
          </section>

          <section id="history" className="band">
            <h2 className="section-head">삭제한 문장도 어디로도 가지 않습니다</h2>
            <p className="lead">
              판마다 누가 무엇을 바꿨는지가 남습니다. 아래는 한 문서가 넉 달
              동안 지나온 다섯 개의 판입니다. 아무 판이나 눌러 그 시점의 본문을
              펼쳐 보세요.
            </p>
            <p className="synthetic">이 문서와 이름은 예시로 지어낸 것입니다</p>
            <div className="band-body">
              <History />
            </div>
          </section>

          <section id="structure" className="band">
            <h2 className="section-head">빛이 닿는 곳만 열립니다</h2>
            <p className="lead">
              스페이스 아래로 페이지가 깊이 제한 없이 이어지고, 권한은 그 구조를
              따라 흐릅니다. 읽을 수 없는 스페이스는 목록에 자리만 남습니다.
            </p>
            <div className="band-body">
              <Structure />
            </div>
          </section>

          <section id="search" className="band">
            <h2 className="section-head">어둠 속에서 한 문장을 찾습니다</h2>
            <p className="lead">
              제목만 뒤지는 검색으로는 반년 전에 내린 결정을 찾지 못합니다.
              본문 전체를 색인해 문장 단위로 꺼내 옵니다.
            </p>
            <div className="band-body">
              <Finder />
            </div>
          </section>

          <section id="join" className="band close">
            <h2 className="section-head">
              베타에 자리를
              <br />
              맡아 두세요.
            </h2>
            <p className="lead">
              아직 만들고 있습니다. 열리는 날 한 번 알려 드리고, 그 외에는
              메일을 보내지 않습니다.
            </p>
            <div className="close-cta">
              <Waitlist id="close-wl" />
            </div>
          </section>
        </main>

        <footer className="foot">
          <hr className="rule" />
          <div className="foot-row">
            <span className="brand">
              <BrandMark size={24} />
            </span>
            <p className="foot-note">
              이 페이지의 문서, 이름, 날짜, 검색 결과는 모두 예시로 지어낸
              것입니다. 아직 공개된 제품도, 실제 이용 기업도 없습니다.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}

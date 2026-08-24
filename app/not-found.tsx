import Link from "next/link";
import BrandMark from "./BrandMark";
import "./tool.css";

export default function NotFound() {
  return (
    <div className="surface auth">
      <div className="auth-card">
        <Link className="bar-mark auth-mark" href="/space">
          <BrandMark size={40} />
        </Link>

        <h1 className="auth-title">찾지 못했습니다</h1>
        {/*
          Row-level security makes "deleted" and "not yours" look identical
          from here — we genuinely cannot tell the reader which one it was, so
          we name both instead of guessing.
        */}
        <p className="auth-sub">
          주소가 바뀌었거나 삭제된 문서일 수 있습니다. 아직 초대받지 않은
          워크스페이스의 문서도 이렇게 보입니다.
        </p>

        <Link href="/space" className="ctl ctl-key auth-submit">
          내 워크스페이스로
        </Link>
      </div>
    </div>
  );
}

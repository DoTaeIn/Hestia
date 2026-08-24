"use client";

import { useEffect } from "react";
import Link from "next/link";
import BrandMark from "./BrandMark";
import "./tool.css";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // no error reporting wired up yet; the console is what we have
    console.error(error);
  }, [error]);

  return (
    <div className="surface auth">
      <div className="auth-card">
        <span className="bar-mark auth-mark">
          <BrandMark size={40} />
        </span>

        <h1 className="auth-title">문제가 생겼습니다</h1>
        {/*
          Worth saying plainly in a product whose promise is that nothing is
          lost: this failed on the way to the documents, not inside them.
        */}
        <p className="auth-sub">
          화면을 불러오지 못했습니다. 문서가 사라진 것은 아니며, 다시 시도하면
          대개 해결됩니다.
        </p>

        <button type="button" className="ctl ctl-key auth-submit" onClick={reset}>
          다시 시도
        </button>

        <p className="auth-foot">
          계속 이러면 <Link href="/space">워크스페이스로 돌아가기</Link>
        </p>

        {error.digest && (
          <p className="error-digest">
            오류 코드 <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}

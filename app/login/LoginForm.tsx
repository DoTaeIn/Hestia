"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import BrandMark from "../BrandMark";
import { useTheme } from "../useTheme";
import { Moon, Sun } from "../icons";
import { createClient } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/safeNext";

export default function LoginForm() {
  const { dark, toggle: toggleDark } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // the middleware parks the page you were denied here; carry it through the
  // round trip so a shared document link survives signing in
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const callback = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSending(true);
    const email = new FormData(event.currentTarget).get("email") as string;
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback() },
    });
    setSending(false);
    if (error) setError("로그인 링크를 보내지 못했습니다. 이메일 주소를 확인해주세요.");
  }

  async function signInWithGoogle() {
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback() },
    });
    if (error) setError("Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }

  return (
    <div className="surface auth">
      <button
        type="button"
        className="ctl auth-theme"
        aria-label={dark ? "밝은 화면으로" : "어두운 화면으로"}
        title={dark ? "밝은 화면으로" : "어두운 화면으로"}
        onClick={toggleDark}
      >
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <div className="auth-card">
        <Link className="bar-mark auth-mark" href="/">
          <BrandMark size={40} />
        </Link>
        <h1 className="auth-title">문서가 머무는 곳으로</h1>
        <p className="auth-sub">로그인 링크를 보내드릴게요. 비밀번호는 필요 없습니다.</p>

        <form className="auth-form" onSubmit={onSubmit}>
          <label className="auth-field">
            이메일
            <input type="email" name="email" required autoComplete="email" placeholder="you@team.io" />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="ctl ctl-solid auth-submit" disabled={sending}>
            {sending ? "링크 보내는 중…" : "로그인 링크 받기"}
          </button>
        </form>

        <div className="auth-divider"><span>또는</span></div>
        <button type="button" className="ctl auth-sso" onClick={signInWithGoogle}>
          Google 계정으로 계속하기
        </button>
        <p className="auth-foot">처음이신가요? 로그인 후 워크스페이스를 만들 수 있습니다.</p>
      </div>
    </div>
  );
}

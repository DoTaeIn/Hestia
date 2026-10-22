"use client";

import Link from "next/link";
import LoginCaptcha from "./LoginCaptcha";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandMark from "../BrandMark";
import { useTheme } from "../useTheme";
import { Moon, Sun } from "../icons";
import { createBrowserAuth } from "@/lib/auth/browser";
import { DEFAULT_NEXT, safeNext } from "@/lib/safeNext";
import { authConfig } from "@/auth.config";
import type { OAuthProvider } from "@/engine/auth";

export default function LoginForm({ nonce }: { nonce?: string }) {
  const { dark, toggle: toggleDark } = useTheme();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<"email-link" | "password">(authConfig.emailLink ? "email-link" : "password");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const captchaRequired = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const invalidLinkMessage = params.get("error") === "invalid_link" ? "링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청하고, 요청한 브라우저에서 열어주세요." : null;
  const visibleError = error || (!linkSent && !sending ? invalidLinkMessage : null);
  const callback = () => `${window.location.origin}${authConfig.callbackPath}?next=${encodeURIComponent(next)}`;
  const emailEnabled = authConfig.emailLink || authConfig.password;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (captchaRequired && !captchaToken) { setError("자동 입력 방지를 먼저 확인해주세요."); return; }
    setError(null); setLinkSent(false); setSending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const auth = createBrowserAuth();
    if (mode === "password") {
      const result = await auth.signInWithPassword({ email, password: String(form.get("password") ?? ""), captchaToken });
      setSending(false); setCaptchaToken(""); setCaptchaReset(value => value + 1);
      if (result.error) { setError("로그인하지 못했습니다. 이메일과 비밀번호를 확인해주세요."); return; }
      router.replace(next === DEFAULT_NEXT ? "/space" : next);
      router.refresh();
    } else {
      const result = await auth.requestEmailLink({ email, redirectTo: callback(), captchaToken });
      setSending(false); setCaptchaToken(""); setCaptchaReset(value => value + 1);
      if (result.error) setError("로그인 링크를 보내지 못했습니다. 이메일 주소와 연결 상태를 확인해주세요.");
      else setLinkSent(true);
    }
  }

  async function oauth(provider: OAuthProvider) {
    setError(null); setSending(true);
    const result = await createBrowserAuth().signInWithOAuth({ provider, redirectTo: callback() });
    if (result.error || !result.data?.url) { setError("로그인을 시작하지 못했습니다. 인증 제공자 설정을 확인해주세요."); setSending(false); return; }
    const url = new URL(result.data.url, window.location.origin);
    if (!["https:", "http:"].includes(url.protocol)) { setError("올바른 로그인 주소가 아닙니다."); setSending(false); return; }
    window.location.assign(url.href);
  }

  return (
    <div className="surface auth">
      <button type="button" className="ctl auth-theme" aria-label={dark ? "밝은 화면으로" : "어두운 화면으로"} onClick={toggleDark}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
      <div className="auth-card">
        <Link className="bar-mark auth-mark" href="/"><BrandMark size={40} /></Link>
        <h1 className="auth-title">문서가 머무는 곳으로</h1>
        <p className="auth-sub">{mode === "email-link" && authConfig.emailLink ? "이메일의 로그인 링크로 시작하세요." : "계정으로 로그인하세요."}</p>
        {authConfig.emailLink && authConfig.password && <div className="doc-controls" aria-label="로그인 방식">
          <button type="button" className="ctl" aria-pressed={mode === "email-link"} onClick={() => { setMode("email-link"); setError(null); setLinkSent(false); }}>이메일 링크</button>
          <button type="button" className="ctl" aria-pressed={mode === "password"} onClick={() => { setMode("password"); setError(null); setLinkSent(false); }}>비밀번호</button>
        </div>}
        {emailEnabled && <form className="auth-form" onSubmit={onSubmit}>
          <label className="auth-field">이메일<input type="email" name="email" required autoComplete="email" placeholder="you@team.io" /></label>
          {mode === "password" && <label className="auth-field">비밀번호<input type="password" name="password" required autoComplete="current-password" /></label>}
          {visibleError && <p className="auth-error" role="alert">{visibleError}</p>}
          {linkSent && <p className="auth-hint" role="status">로그인 링크를 보냈습니다. 이메일을 확인해주세요. 이 브라우저에서 링크를 열면 로그인됩니다.</p>}
          <LoginCaptcha nonce={nonce} resetKey={captchaReset} onToken={setCaptchaToken} />
          <button type="submit" className="ctl ctl-solid auth-submit" disabled={sending || (captchaRequired && !captchaToken)}>{sending ? "처리 중…" : mode === "password" ? "로그인" : "로그인 링크 받기"}</button>
        </form>}
        {!emailEnabled && visibleError && <p className="auth-error" role="alert">{visibleError}</p>}
        {emailEnabled && authConfig.oauthProviders.length > 0 && <div className="auth-divider"><span>또는</span></div>}
        {authConfig.oauthProviders.map(provider => <button type="button" key={provider.id} className="ctl auth-sso" disabled={sending} onClick={() => { void oauth(provider.id); }}>{provider.label} 계정으로 계속하기</button>)}
        {!emailEnabled && authConfig.oauthProviders.length === 0 && <p className="auth-error" role="alert">로그인 방식이 설정되지 않았습니다. 서비스 관리자에게 문의해주세요.</p>}
        <p className="auth-foot">처음이신가요? 로그인 후 워크스페이스를 만들 수 있습니다.</p>
      </div>
    </div>
  );
}

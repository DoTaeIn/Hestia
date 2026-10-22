"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { turnstile?: { render(node: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void } }
}
export default function LoginCaptcha({ nonce, resetKey, onToken }: { nonce?: string; resetKey: number; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!ready || !container.current || !window.turnstile || !sitekey) return;
    onToken(""); setFailed(false);
    const id = window.turnstile.render(container.current, { sitekey, callback: (token: string) => onToken(token), "expired-callback": () => onToken(""), "error-callback": () => { onToken(""); setFailed(true); } });
    return () => { window.turnstile?.remove(id); };
  }, [ready, sitekey, resetKey, onToken]);
  if (!sitekey) return null;
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" nonce={nonce} onReady={() => setReady(true)} onError={() => setFailed(true)} /><div ref={container} aria-label="자동 입력 방지" />{failed && <p className="auth-error" role="alert">자동 입력 방지를 불러오지 못했습니다. 연결을 확인하고 새로고침해주세요.</p>}</>;
}

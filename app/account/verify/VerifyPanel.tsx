"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SecurityFactor } from "@/engine/security";
import { createBrowserSecurity } from "@/lib/auth/security-browser";
import { createBrowserAuth } from "@/lib/auth/browser";
import { authConfig } from "@/auth.config";

export default function VerifyPanel({ factors, next }: { factors: SecurityFactor[]; next: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const adapter = createBrowserSecurity();
    if (!adapter || busy) return;
    setBusy(true); setError(null);
    const result = await adapter.verifyTotp(factorId, code);
    setBusy(false);
    if (result.error) {
      setError(result.error.code === "validation" ? "인증 앱에 표시된 6자리 코드를 입력해주세요." : "코드가 올바르지 않습니다. 인증 앱의 코드와 시간을 다시 확인해주세요.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function signOut() {
    if (busy) return;
    setBusy(true); setError(null);
    const result = await createBrowserAuth().signOut();
    setBusy(false);
    if (result.error) { setError("로그아웃하지 못했습니다. 연결을 확인해주세요."); return; }
    router.replace(authConfig.loginPath);
    router.refresh();
  }

  return <form className="security-verify-form" onSubmit={submit}>
    {factors.length > 1 && <label className="security-field">인증 앱<select value={factorId} onChange={event => setFactorId(event.target.value)}>{factors.map(factor => <option key={factor.id} value={factor.id}>{factor.friendlyName}</option>)}</select></label>}
    <label className="security-field">6자리 코드
      <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
    </label>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="security-actions">
      <button type="submit" className="ctl ctl-solid" disabled={busy || code.length !== 6 || !factorId}>{busy ? "확인 중…" : "확인"}</button>
      <button type="button" className="ctl" disabled={busy} onClick={() => { void signOut(); }}>다른 계정으로 로그인</button>
    </div>
  </form>;
}

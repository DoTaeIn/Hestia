"use client";

import { useEffect, useState } from "react";
import type { SecurityFactor, TotpEnrollment } from "@/engine/security";
import { createBrowserSecurity } from "@/lib/auth/security-browser";

export default function SecurityPanel() {
  const [adapter] = useState(() => createBrowserSecurity());
  const [factors, setFactors] = useState<SecurityFactor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    if (!adapter) return;
    const result = await adapter.listFactors();
    if (!result.error) setFactors(result.data);
    else setError("인증 앱 목록을 불러오지 못했습니다. 새로고침해주세요.");
  }

  useEffect(() => {
    let active = true;
    (async () => {
      await reload();
      if (active) setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

  if (!adapter) return <p className="security-unsupported">이 서비스는 사용자 지정 인증 공급자를 사용하고 있어, 2단계 인증 관리를 이 화면에서 제공하지 않습니다. 인증 제공자의 관리 화면을 이용해주세요.</p>;

  async function startEnroll() {
    if (!adapter || busy) return;
    setBusy(true); setError(null); setMessage(null);
    const result = await adapter.enrollTotp();
    setBusy(false);
    if (result.error) { setError("OTP 등록을 시작하지 못했습니다. 잠시 후 다시 시도해주세요."); return; }
    setEnrollment(result.data); setCode("");
    void reload();
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || !enrollment || busy) return;
    setBusy(true); setError(null); setMessage(null);
    const result = await adapter.verifyTotp(enrollment.id, code);
    setBusy(false);
    if (result.error) {
      setError(result.error.code === "validation" ? "인증 앱에 표시된 6자리 코드를 입력해주세요." : "코드가 올바르지 않습니다. 인증 앱의 코드와 시간을 다시 확인해주세요.");
      return;
    }
    setEnrollment(null); setCode(""); setMessage("2단계 인증을 등록했습니다.");
    void reload();
  }

  async function cancelEnroll() {
    if (!adapter || !enrollment || busy) return;
    setBusy(true); setError(null); setMessage(null);
    const cancelled = await adapter.unenroll(enrollment.id);
    setBusy(false);
    if (cancelled.error) { setError("미완료 등록을 정리하지 못했습니다. 다시 시도해주세요."); return; }
    setEnrollment(null); setCode("");
    void reload();
  }

  async function cleanup(factorId: string) {
    if (!adapter || busy) return;
    setBusy(true); setError(null); setMessage(null);
    const result = await adapter.unenroll(factorId);
    setBusy(false);
    if (result.error) { setError("정리하지 못했습니다. 다시 시도해주세요."); return; }
    void reload();
  }

  async function disable(factorId: string) {
    if (!adapter || busy) return;
    setBusy(true); setError(null); setMessage(null);
    const result = await adapter.unenroll(factorId);
    setBusy(false); setConfirmId(null);
    if (result.error) { setError("등록을 해지하지 못했습니다. 다시 인증한 뒤 시도해주세요."); return; }
    setMessage("등록을 해지했습니다."); void reload();
  }

  const strayUnverified = factors.filter(factor => factor.status === "unverified" && factor.id !== enrollment?.id);
  const verified = factors.filter(factor => factor.status === "verified");

  return <section className="security-panel">
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p className="security-message" role="status">{message}</p>}

    <section className="security-block">
      <h2>등록된 인증 앱</h2>
      {!loaded && <p className="security-muted">불러오는 중…</p>}
      {loaded && !verified.length && !enrollment && <p className="security-muted">아직 등록된 인증 앱이 없습니다.</p>}
      {verified.length > 0 && <ul className="security-list">
        {verified.map(factor => <li key={factor.id}>
          <span>{factor.friendlyName}<span className="security-badge security-badge-ok">확인됨</span></span>
          {confirmId === factor.id ? <div className="security-confirm">
            <p>이 인증 앱을 해지합니다. 마지막 인증 앱을 해지하면 2단계 인증이 꺼집니다. 계속할까요?</p>
            <div className="security-actions"><button type="button" className="ctl ctl-danger" disabled={busy} onClick={() => { void disable(factor.id); }}>해지</button><button type="button" className="ctl" disabled={busy} onClick={() => setConfirmId(null)}>취소</button></div>
          </div> : <button type="button" className="ctl" disabled={busy} onClick={() => setConfirmId(factor.id)}>해지</button>}
        </li>)}
      </ul>}
      {strayUnverified.length > 0 && <ul className="security-list">
        {strayUnverified.map(factor => <li key={factor.id}>
          <span>{factor.friendlyName}<span className="security-badge security-badge-pending">미완료</span></span>
          <button type="button" className="ctl" disabled={busy} onClick={() => { void cleanup(factor.id); }}>정리</button>
        </li>)}
      </ul>}
    </section>

    <section className="security-block">
      <h2>인증 앱 등록</h2>
      {!enrollment && <button type="button" className="ctl ctl-solid" disabled={busy} onClick={() => { void startEnroll(); }}>{busy ? "준비 중…" : "OTP 앱 등록"}</button>}
      {enrollment && <div className="security-enroll">
        <p className="security-muted">인증 앱(Google Authenticator, 1Password 등)으로 아래 QR 코드를 스캔하거나 비밀 키를 직접 입력하세요.</p>
        <img className="security-qr" src={enrollment.qrCode} alt="OTP 등록 QR 코드" width={200} height={200} />
        <p className="security-secret"><span>비밀 키</span><code>{enrollment.secret}</code></p>
        <form className="security-verify-form" onSubmit={verify}>
          <label className="security-field">인증 앱의 6자리 코드
            <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
          </label>
          <div className="security-actions"><button type="submit" className="ctl ctl-solid" disabled={busy || code.length !== 6}>{busy ? "확인 중…" : "등록 완료"}</button><button type="button" className="ctl" disabled={busy} onClick={() => { void cancelEnroll(); }}>취소</button></div>
        </form>
      </div>}
    </section>
  </section>;
}

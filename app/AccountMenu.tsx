"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserAuth } from "@/lib/auth/browser";
import { createBrowserEngine } from "@/lib/engine/browser";
import { authConfig } from "@/auth.config";
import { LogOut, User } from "./icons";

export default function AccountMenu() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const load = async () => {
      const session = await createBrowserAuth().getUser();
      if (!active) return;
      setEmail(session.data?.email ?? "");
      if (!session.data) return;
      const profile = await createBrowserEngine().profiles.getSelf();
      if (active && profile.data) setName(profile.data.display_name);
    };
    void load();
    window.addEventListener("hestia:profile-updated", load);
    return () => { active = false; window.removeEventListener("hestia:profile-updated", load); };
  }, []);

  async function signOut() {
    setSigningOut(true); setError(null);
    const result = await createBrowserAuth().signOut();
    setSigningOut(false);
    if (result.error) { setError("로그아웃하지 못했습니다. 연결 상태를 확인해주세요."); return; }
    router.replace(authConfig.loginPath); router.refresh();
  }

  return <details className="account-menu">
    <summary className="ctl" aria-label={name ? `계정: ${name}` : "계정"} title={email || name || "계정"}><User size={16} /><span className="account-email">{name || email || "계정"}</span></summary>
    <div className="account-popover">
      <p className="account-label">로그인 계정</p><p className="account-address">{email || name || "불러오는 중…"}</p>
      <Link className="ctl" href="/account/profile">프로필 설정</Link>
      <Link className="ctl" href="/account/security">계정 보안·2단계 인증</Link>
      <button type="button" className="ctl account-signout" disabled={signingOut} onClick={() => { void signOut(); }}><LogOut size={15} />{signingOut ? "로그아웃 중…" : "로그아웃"}</button>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  </details>;
}

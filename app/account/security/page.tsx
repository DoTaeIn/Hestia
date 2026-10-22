import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServerAuth } from "@/lib/auth/server";
import { authConfig } from "@/auth.config";
import BrandMark from "@/app/BrandMark";
import AccountMenu from "@/app/AccountMenu";
import RecoveryControls from "./RecoveryControls";
import SecurityPanel from "./SecurityPanel";
import "../../tool.css";
import "./security.css";

export const metadata: Metadata = { title: "계정 보안 — Hestia" };

export default async function SecurityPage() {
  const client = await createClient();
  const session = await createServerAuth(client).getUser();
  if (session.error) throw session.error;
  if (!session.data) redirect(`${authConfig.loginPath}?next=%2Faccount%2Fsecurity`);
  return <div className="surface security-page">
    <header className="bar"><Link className="bar-mark" href="/space" aria-label="Hestia"><BrandMark size={28} /></Link><nav className="crumb" aria-label="현재 위치"><Link href="/space">워크스페이스</Link><span>/</span><b>계정 보안</b></nav><div className="bar-right"><AccountMenu /></div></header>
    <main className="security-card"><h1>계정 보안</h1><p className="security-intro">OTP 인증 앱을 등록하면 로그인할 때 6자리 코드를 추가로 확인합니다.</p><SecurityPanel /><RecoveryControls userId={session.data.id} /></main>
  </div>;
}

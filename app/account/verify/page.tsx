import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServerAuth } from "@/lib/auth/server";
import { createServerSecurity } from "@/lib/auth/security-server";
import { authConfig } from "@/auth.config";
import { safeNext } from "@/lib/safeNext";
import VerifyPanel from "./VerifyPanel";
import "../../tool.css";
import "../security/security.css";

export const metadata: Metadata = { title: "2단계 인증 확인 — Hestia" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  let next = safeNext(params.next, "/space");
  if (new URL(next, "https://hestia.invalid").pathname === "/account/verify" || new URL(next, "https://hestia.invalid").pathname === authConfig.loginPath) next = "/space";

  const client = await createClient();
  const session = await createServerAuth(client).getUser();
  if (session.error) throw session.error;
  if (!session.data) {
    const ownPath = `/account/verify${next !== "/space" ? `?next=${encodeURIComponent(next)}` : ""}`;
    redirect(`${authConfig.loginPath}?next=${encodeURIComponent(ownPath)}`);
  }

  const security = createServerSecurity(client);
  if (!security) redirect(next);

  const assurance = await security.getAssurance();
  if (assurance.error) throw assurance.error;
  if (!assurance.data.nextLevel || assurance.data.currentLevel === assurance.data.nextLevel) redirect(next);

  const factors = await security.listFactors();
  if (factors.error) throw factors.error;
  const verifiedFactors = factors.data.filter(factor => factor.status === "verified");
  if (!verifiedFactors.length) redirect(next);

  return <div className="surface security-page">
    <main className="security-card">
      <h1>2단계 인증 확인</h1>
      <p className="security-intro">계속하려면 등록된 인증 앱의 6자리 코드를 입력해주세요.</p>
      <VerifyPanel factors={verifiedFactors} next={next} />
    </main>
  </div>;
}

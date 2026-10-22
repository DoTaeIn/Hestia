import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServerAuth } from "@/lib/auth/server";
import { createServerEngine } from "@/lib/engine/server";
import { authConfig } from "@/auth.config";
import BrandMark from "@/app/BrandMark";
import AccountMenu from "@/app/AccountMenu";
import ProfileForm from "./ProfileForm";
import "../../tool.css";
import "./profile.css";

export const metadata: Metadata = { title: "프로필 설정 — Hestia" };

export default async function ProfilePage() {
  const client = await createClient();
  const session = await createServerAuth(client).getUser();
  if (session.error) throw session.error;
  if (!session.data) redirect(`${authConfig.loginPath}?next=%2Faccount%2Fprofile`);
  const profile = await createServerEngine(client).profiles.getSelf();
  if (profile.error) throw profile.error;
  return <div className="surface profile-page">
    <header className="bar"><Link className="bar-mark" href="/space" aria-label="Hestia"><BrandMark size={28} /></Link><nav className="crumb" aria-label="현재 위치"><Link href="/space">워크스페이스</Link><span>/</span><b>프로필 설정</b></nav><div className="bar-right"><AccountMenu /></div></header>
    <main className="profile-card"><h1>프로필 설정</h1><p className="profile-intro">문서와 댓글에 표시할 이름을 바꿀 수 있습니다.</p><ProfileForm profile={profile.data} email={session.data.email} /></main>
  </div>;
}

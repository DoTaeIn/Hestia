import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "../BrandMark";
import WorkspaceForm from "./WorkspaceForm";
import "../tool.css";

export const metadata: Metadata = { title: "워크스페이스 만들기 — Hestia" };

export default function OnboardingPage() {
  return (
    <main className="surface auth">
      <div className="auth-card">
        <Link className="bar-mark auth-mark" href="/">
          <BrandMark size={40} />
        </Link>
        <h1 className="auth-title">팀의 첫 공간을 만드세요</h1>
        <p className="auth-sub">문서와 사람, 기록이 이곳에서 함께 자랍니다.</p>
        <WorkspaceForm />
      </div>
    </main>
  );
}

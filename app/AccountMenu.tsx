"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { LogOut, User } from "./icons";

export default function AccountMenu() {
  const [email, setEmail] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  useEffect(() => {
    void createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <details className="account-menu">
      <summary className="ctl" aria-label={email ? `계정: ${email}` : "계정"} title={email || "계정"}>
        <User size={16} />
        <span className="account-email">{email || "계정"}</span>
      </summary>
      <div className="account-popover">
        <p className="account-label">로그인 계정</p>
        <p className="account-address">{email || "불러오는 중…"}</p>
        <button type="button" className="ctl account-signout" disabled={signingOut} onClick={() => void signOut()}>
          <LogOut size={15} />{signingOut ? "로그아웃 중…" : "로그아웃"}
        </button>
      </div>
    </details>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProfileRecord } from "@/engine";
import { createBrowserEngine } from "@/lib/engine/browser";

export default function ProfileForm({ profile, email }: { profile: ProfileRecord; email: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(profile.display_name);
  const [avatar, setAvatar] = useState(profile.avatar_url ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    const result = await createBrowserEngine().profiles.updateSelf({ displayName: name, avatarUrl: avatar });
    setSaving(false);
    if (result.error) {
      setError(result.error.code === "validation" ? "이름은 1~80자로, 아바타는 올바른 HTTP(S) 주소로 입력해주세요." : "프로필을 저장하지 못했습니다. 로그인 상태와 연결을 확인해주세요.");
      return;
    }
    setName(result.data.display_name); setAvatar(result.data.avatar_url ?? "");
    setMessage("프로필을 저장했습니다."); router.refresh();
    window.dispatchEvent(new Event("hestia:profile-updated"));
  }

  return <form className="profile-form" onSubmit={save}>
    <div className="profile-preview">{profile.avatar_url ? <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">{profile.display_name.slice(0, 1)}</span>}<span>{profile.display_name}</span></div>
    <label className="profile-field">표시 이름<input name="displayName" autoComplete="nickname" required maxLength={80} value={name} onChange={event => { setName(event.target.value); setMessage(null); }} /></label>
    <label className="profile-field">아바타 URL<input name="avatarUrl" type="url" maxLength={2048} placeholder="https://example.com/avatar.png" value={avatar} onChange={event => { setAvatar(event.target.value); setMessage(null); }} /></label>
    <p className="profile-help">HTTP(S) 이미지 주소를 입력하거나 비워서 아바타를 지울 수 있습니다. 외부 이미지는 브라우저에서 불러옵니다.</p>
    <label className="profile-field">로그인 이메일<input type="text" value={email ?? "이 인증 방식은 이메일을 제공하지 않습니다"} readOnly /></label>
    <p className="profile-help">로그인 이메일과 비밀번호 변경은 서비스의 인증 제공자가 관리합니다.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p className="profile-message" role="status">{message}</p>}
    <div><button className="ctl ctl-solid" type="submit" disabled={saving}>{saving ? "저장 중…" : "프로필 저장"}</button></div>
  </form>;
}

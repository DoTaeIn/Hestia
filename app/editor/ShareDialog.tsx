"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import Modal from "../Modal";

type Role = "admin" | "editor" | "viewer";
type MemberRole = Role | "owner";
type Member = { userId: string; name: string; role: MemberRole };

const ROLE_WORD: Record<MemberRole, string> = { owner: "소유자", admin: "관리자", editor: "편집 가능", viewer: "보기 가능" };

type Props = { workspaceId: string; members: Member[]; currentUserId: string; canManage: boolean; canGrantAdmin: boolean; onClose: () => void };

export default function ShareDialog({ workspaceId, members: initialMembers, currentUserId, canManage, canGrantAdmin, onClose }: Props) {
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  async function invite() {
    if (!email.trim()) return;
    setSaving(true);
    setMessage(null);
    const { data, error } = await createClient().rpc("invite_workspace_member", { target_workspace_id: workspaceId, member_email: email.trim(), next_role: role });
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    const member = data?.[0] as { user_id: string; display_name: string; role: Role } | undefined;
    if (member) setMembers((items) => [...items.filter((item) => item.userId !== member.user_id), { userId: member.user_id, name: member.display_name, role: member.role }]);
    setEmail("");
    setMessage("권한을 저장했습니다.");
    router.refresh();
  }

  async function remove(userId: string) {
    setSaving(true);
    setMessage(null);
    const { error } = await createClient().rpc("remove_workspace_member", { target_workspace_id: workspaceId, target_user_id: userId });
    setSaving(false);
    if (error) setMessage(error.message);
    else {
      setMembers((items) => items.filter((item) => item.userId !== userId));
      router.refresh();
    }
  }

  async function changeRole(userId: string, nextRole: Role) {
    setSaving(true);
    setMessage(null);
    const { error } = await createClient().rpc("set_workspace_member_role", { target_workspace_id: workspaceId, target_user_id: userId, next_role: nextRole });
    setSaving(false);
    if (error) setMessage(error.message);
    else {
      setMembers((items) => items.map((item) => item.userId === userId ? { ...item, role: nextRole } : item));
      setMessage("권한을 저장했습니다.");
      router.refresh();
    }
  }

  const assignableRoles = (canGrantAdmin ? ["admin", "editor", "viewer"] : ["editor", "viewer"]) as Role[];

  return <Modal className="share-modal" labelledBy="share-title" onClose={onClose}><div className="modal-head"><h2 id="share-title">공유</h2><button type="button" className="ctl" onClick={onClose} aria-label="닫기">✕</button></div><div className="modal-body">{canManage ? <><form className="share-invite" onSubmit={(event) => { event.preventDefault(); void invite(); }}><label className="field-label" htmlFor="share-email">사용자 이메일</label><div><input id="share-email" className="modal-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@team.com" /><select className="ctl role-select" value={role} onChange={(event) => setRole(event.target.value as Role)} aria-label="초대 권한">{assignableRoles.map((item) => <option key={item} value={item}>{ROLE_WORD[item]}</option>)}</select><button type="submit" className="ctl ctl-solid" disabled={saving}>추가</button></div></form><p className="share-note">Hestia에 한 번 이상 로그인한 이메일만 추가할 수 있습니다.</p></> : <p className="share-note">이 워크스페이스의 관리자만 구성원 권한을 바꿀 수 있습니다.</p>}<div><p className="modal-label">워크스페이스 구성원</p><ul className="people">{members.map((member) => { const editable = canManage && member.role !== "owner" && (canGrantAdmin || member.role !== "admin"); return <li key={member.userId}><span className="people-name">{member.name}<span className="people-email">{ROLE_WORD[member.role]}</span></span>{editable && <span className="member-actions"><select className="ctl role-select" value={member.role} onChange={(event) => void changeRole(member.userId, event.target.value as Role)} aria-label={`${member.name} 권한`} disabled={saving}>{assignableRoles.map((item) => <option key={item} value={item}>{ROLE_WORD[item]}</option>)}</select><button type="button" className="ctl" onClick={() => void remove(member.userId)} disabled={saving}>제거</button></span>}</li>; })}</ul></div>{message && <p className="share-message" role="status">{message}</p>}</div><div className="modal-foot"><button type="button" className="ctl" onClick={() => { void navigator.clipboard?.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? "복사됨" : "링크 복사"}</button><button type="button" className="ctl ctl-solid" onClick={onClose}>완료</button></div></Modal>;
}

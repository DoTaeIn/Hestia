"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CustomRole, WorkspaceMember, WorkspacePermission, AssignableRole, EngineResult } from "@/engine";
import { createBrowserEngine } from "@/lib/engine/browser";

const words = { owner: "소유자", admin: "관리자", editor: "편집자", viewer: "열람자" };
export default function MembersPanel({ workspaceId, initialMembers, initialRoles, isOwner, canManage }: { workspaceId: string; initialMembers: WorkspaceMember[]; initialRoles: CustomRole[]; isOwner: boolean; canManage: boolean }) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [roles, setRoles] = useState(initialRoles);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("viewer");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const engine = () => createBrowserEngine();
  async function run(action: () => Promise<EngineResult<unknown>>) {
    if (busy) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await action();
      if (result.error) { setError(result.error.code === "forbidden" ? "이 작업에 대한 권한이 없습니다. 역할이 바뀌었다면 새로고침해주세요." : "저장하지 못했습니다. 권한·입력값을 확인하고, 역할 삭제 전에는 배정된 구성원의 역할을 바꿔주세요. 미가입자는 먼저 로그인해야 합니다."); return false; }
      const [nextMembers, nextRoles] = await Promise.all([engine().members.list(workspaceId), engine().roles.list(workspaceId)]);
      if (nextMembers.error || nextRoles.error) { setError("작업 후 목록을 불러오지 못했습니다. 새로고침해서 상태를 확인해주세요."); router.refresh(); return true; }
      setMembers(nextMembers.data); setRoles(nextRoles.data); setMessage("저장했습니다."); router.refresh(); return true;
    } finally { setBusy(false); }
  }
  function choose(role: CustomRole | null) { setEditing(role?.id ?? null); setName(role?.name ?? ""); setPermissions(role?.permissions ?? []); }
  const available = roles.filter(role => isOwner || !role.permissions.includes("members.manage"));
  function options() { return <><option value="viewer">열람자</option><option value="editor">편집자</option>{isOwner && <option value="admin">관리자</option>}{available.map(role => <option value={`custom:${role.id}`} key={role.id}>{role.name} (커스텀)</option>)}</>; }
  return <>
    {error && <p role="alert" className="members-error">{error}</p>}{message && <p role="status" className="members-success">{message}</p>}
    <section className="members-card"><h2>구성원</h2>{canManage ? <form className="members-invite" onSubmit={event => { event.preventDefault(); void run(() => engine().workspaces.invite({ workspaceId, email, role: inviteRole })).then(ok => { if (ok) setEmail(""); }); }}><label>가입된 이메일<input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="member@club.example" /></label><label>초기 역할<select value={inviteRole} onChange={event => setInviteRole(event.target.value as AssignableRole)} disabled={busy}><option value="viewer">열람자</option><option value="editor">편집자</option>{isOwner && <option value="admin">관리자</option>}</select></label><button className="ctl" disabled={busy}>구성원 추가</button></form> : <p className="members-muted">구성원 관리 권한이 있는 사람만 배정을 바꿀 수 있습니다.</p>}<p className="members-muted">미가입자는 먼저 로그인해야 합니다. 커스텀 역할은 구성원 추가 후 배정할 수 있습니다.</p>
    <ul className="members-list">{members.map(member => { const editable = canManage && member.role !== "owner" && (isOwner || (member.role !== "admin" && !member.permissions.includes("members.manage"))); return <li key={member.user_id}><div><strong>{member.display_name}</strong><span>{member.custom_role_id ? member.role_name : words[member.role]}</span></div>{editable ? <div className="members-actions"><label className="members-sr">{member.display_name} 역할</label><select aria-label={`${member.display_name} 역할`} value={member.custom_role_id ? `custom:${member.custom_role_id}` : member.role} disabled={busy} onChange={event => { const value = event.target.value; void run(() => value.startsWith("custom:") ? engine().members.assignRole(workspaceId, member.user_id, value.slice(7)) : engine().workspaces.setMemberRole(workspaceId, member.user_id, value as AssignableRole)); }}>{options()}</select><button className="ctl" type="button" disabled={busy} aria-label={`${member.display_name} 제거`} onClick={() => { void run(() => engine().workspaces.removeMember(workspaceId, member.user_id)); }}>제거</button></div> : <span className="members-muted">{member.role === "owner" ? "소유자 보호" : "권한 변경 제한"}</span>}</li>; })}</ul></section>
    <section className="members-card"><h2>커스텀 역할</h2><p className="members-muted">기본 열람 권한에 필요한 권한을 더합니다. 역할 정의와 관리자 권한 부여는 소유자만 할 수 있습니다.</p><ul className="members-list">{roles.map(role => <li key={role.id}><div><strong>{role.name}</strong><span>{role.permissions.length ? role.permissions.map(p => p === "pages.write" ? "문서 편집" : "구성원 관리").join(" · ") : "문서 열람"}</span></div>{isOwner && <div className="members-actions"><button type="button" className="ctl" disabled={busy} onClick={() => choose(role)} aria-label={`${role.name} 수정`}>수정</button><button type="button" className="ctl" disabled={busy} onClick={() => { void run(() => engine().roles.delete(workspaceId, role.id)).then(ok => { if (ok && editing === role.id) choose(null); }); }} aria-label={`${role.name} 삭제`}>삭제</button></div>}</li>)}</ul>{!roles.length && <p>아직 만든 역할이 없습니다.</p>}
    {isOwner && <form className="members-role-form" onSubmit={event => { event.preventDefault(); const input = { workspaceId, name, permissions }; void run(() => editing ? engine().roles.update(editing, input) : engine().roles.create(input)).then(ok => { if (ok) choose(null); }); }}><h3>{editing ? "역할 수정" : "역할 만들기"}</h3><label>역할 이름<input required maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="예: 회의록 담당" /></label><fieldset disabled={busy}><legend>추가 권한</legend>{(["pages.write", "members.manage"] as const).map(permission => <label key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={event => setPermissions(values => event.target.checked ? [...values, permission] : values.filter(value => value !== permission))} />{permission === "pages.write" ? "문서 편집" : "구성원 관리"}</label>)}</fieldset><p className="members-muted">구성원 관리 권한만으로 문서를 편집하거나 다른 관리자를 변경할 수 없습니다. 버전 기록·복원은 편집 권한이 있는 문서 소유자만 가능합니다.</p><div className="members-actions"><button className="ctl" disabled={busy}>{editing ? "역할 저장" : "역할 만들기"}</button>{editing && <button type="button" className="ctl" disabled={busy} onClick={() => choose(null)}>취소</button>}</div></form>}</section>
  </>;
}

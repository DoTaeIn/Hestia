"use client";
import { useState } from "react";
import Link from "next/link";
import Modal from "../Modal";
import { workspaceHref } from "@/lib/workspace-context";

type Member = { userId: string; name: string; role: "owner" | "admin" | "editor" | "viewer"; roleName?: string };
type Props = { workspaceId: string; members: Member[]; currentUserId: string; canManage: boolean; canGrantAdmin: boolean; onClose: () => void };
const words = { owner: "소유자", admin: "관리자", editor: "편집자", viewer: "열람자" };
export default function ShareDialog({ workspaceId, members, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  return <Modal className="share-modal" labelledBy="share-title" onClose={onClose}><div className="modal-head"><h2 id="share-title">공유</h2><button type="button" className="ctl" onClick={onClose} aria-label="닫기">✕</button></div><div className="modal-body"><p className="share-note">링크를 복사해도 접근 권한이 생기지는 않습니다. 워크스페이스 구성원만 열 수 있습니다.</p><Link className="ctl" href={workspaceHref("/space/members", workspaceId)}>구성원·역할 관리</Link><ul className="people">{members.map(member => <li key={member.userId}><span className="people-name">{member.name}<span className="people-email">{member.roleName || words[member.role]}</span></span></li>)}</ul>{error && <p role="alert">{error}</p>}</div><div className="modal-foot"><button type="button" className="ctl" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setError(""); } catch { setError("링크를 복사하지 못했습니다."); } }}>{copied ? "복사됨" : "링크 복사"}</button><button type="button" className="ctl" onClick={onClose}>완료</button></div></Modal>;
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServerAuth } from "@/lib/auth/server";
import { createServerEngine } from "@/lib/engine/server";
import { unwrap } from "@/lib/supabase/query";
import { selectWorkspace, workspaceHref } from "@/lib/workspace-context";
import { getCapabilities } from "@/engine";
import AccountMenu from "@/app/AccountMenu";
import BrandMark from "@/app/BrandMark";
import RefreshButton from "@/app/RefreshButton";
import "../../tool.css";
import "../members/members.css";

export const metadata: Metadata = { title: "권한 변경 기록 — Hestia" };
const words: Record<string, string> = { "member.added": "구성원 추가", "member.role_changed": "구성원 역할 변경", "member.removed": "구성원 제거", "role.created": "역할 생성", "role.updated": "역할 수정", "role.deleted": "역할 삭제" };
export default async function SecurityEventsPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const requested = (await searchParams).workspace;
  const client = await createClient();
  const user = unwrap(await createServerAuth(client).getUser(), "계정");
  if (!user) redirect(`/login?next=${encodeURIComponent(workspaceHref("/space/security", requested))}`);
  const engine = createServerEngine(client);
  const selection = selectWorkspace(unwrap(await engine.workspaces.listMemberships(user.id), "워크스페이스") ?? [], requested);
  if (selection.status !== "ok") notFound();
  const membership = selection.membership;
  if (!getCapabilities({ role: membership.role, permissions: membership.permissions }).canManageMembers) notFound();
  const events = unwrap(await engine.audit.list(membership.workspaceId), "보안 기록") ?? [];
  return <div className="surface members-page"><header className="bar"><Link className="bar-mark" href={workspaceHref("/space", membership.workspaceId)} aria-label="Hestia"><BrandMark size={28} /></Link><nav className="crumb"><Link href={workspaceHref("/space/members", membership.workspaceId)}>{membership.workspaceName}</Link><span>/</span><b>권한 변경 기록</b></nav><div className="bar-right"><AccountMenu /></div></header><main className="members-main"><h1>권한 변경 기록</h1><p className="members-muted">최근 50개 권한 변경입니다. 사용자 ID와 권한 변화만 기록하며 이메일·문서 본문·인증 비밀값은 저장하지 않습니다.</p><RefreshButton /><section className="members-card"><ul className="members-list">{events.map(event => <li key={event.id}><div><strong>{words[event.action] ?? event.action}</strong><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time><span>실행자: {event.actor_id ?? "시스템"}{event.subject_user_id ? ` · 대상: ${event.subject_user_id}` : ""}</span><details><summary>권한 변화 보기</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(event.detail, null, 2)}</pre></details></div></li>)}</ul>{!events.length && <p>아직 기록된 권한 변경이 없습니다.</p>}</section></main></div>;
}

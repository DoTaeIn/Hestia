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
import MembersPanel from "./MembersPanel";
import "../../tool.css";
import "./members.css";

export const metadata: Metadata = { title: "구성원·역할 관리 — Hestia" };
export default async function MembersPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const requested = (await searchParams).workspace;
  const client = await createClient();
  const user = unwrap(await createServerAuth(client).getUser(), "계정");
  if (!user) redirect(`/login?next=${encodeURIComponent(workspaceHref("/space/members", requested))}`);
  const engine = createServerEngine(client);
  const selection = selectWorkspace(unwrap(await engine.workspaces.listMemberships(user.id), "워크스페이스") ?? [], requested);
  if (selection.status === "none") redirect("/onboarding");
  if (selection.status !== "ok") notFound();
  const membership = selection.membership;
  const [members, roles] = await Promise.all([engine.members.list(membership.workspaceId), engine.roles.list(membership.workspaceId)]);
  const caps = getCapabilities({ role: membership.role, permissions: membership.permissions });
  return <div className="surface members-page"><header className="bar"><Link className="bar-mark" href={workspaceHref("/space", membership.workspaceId)} aria-label="Hestia"><BrandMark size={28} /></Link><nav className="crumb"><Link href={workspaceHref("/space", membership.workspaceId)}>{membership.workspaceName}</Link><span>/</span><b>구성원·역할</b></nav><div className="bar-right"><AccountMenu /></div></header><main className="members-main"><h1>구성원·역할 관리</h1><p className="members-muted">구성원은 이 워크스페이스의 문서를 읽을 수 있습니다. 편집과 구성원 관리 권한은 역할별로 부여합니다.</p>{caps.canManageMembers && <Link className="ctl" href={workspaceHref("/space/security", membership.workspaceId)}>권한 변경 기록</Link>}<MembersPanel workspaceId={membership.workspaceId} initialMembers={unwrap(members, "구성원") ?? []} initialRoles={unwrap(roles, "역할") ?? []} isOwner={membership.role === "owner"} canManage={caps.canManageMembers} /></main></div>;
}

import { createServerAuth } from "@/lib/auth/server";
import { getCapabilities } from "@/engine";
import { createServerEngine } from "@/lib/engine/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SpaceHome from "./SpaceHome";
import "../tool.css";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase/query";
import { pagesToTree, type PageRecord } from "@/lib/pages";
import { selectWorkspace, workspaceHref } from "@/lib/workspace-context";
import { loadWorkspaceMemberships } from "@/lib/workspace-context.server";
import { safeNext } from "@/lib/safeNext";

export const metadata: Metadata = { title: "워크스페이스 — Hestia" };

export default async function SpacePage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const requestedWorkspaceId = (await searchParams).workspace;
  const supabase = await createClient();
  const { data: user, error: authError } = await createServerAuth(supabase).getUser();
  if (authError) throw authError;
  if (!user) {
    const next = safeNext(workspaceHref("/space", requestedWorkspaceId), "/space");
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const memberships = await loadWorkspaceMemberships(supabase, user.id);
  const selection = selectWorkspace(memberships, requestedWorkspaceId);
  if (selection.status === "none") redirect("/onboarding");
  if (selection.status === "forbidden") {
    const fallback = selectWorkspace(memberships, undefined);
    redirect(fallback.status === "ok" ? workspaceHref("/space", fallback.membership.workspaceId) : "/onboarding");
  }
  const { membership } = selection;

  const pageData = unwrap(
    await createServerEngine(supabase).pages.list(membership.workspaceId),
    "문서 목록",
  );
  const pages = (pageData ?? []) as unknown as PageRecord[];
  const tree = pagesToTree(membership.workspaceName, pages);
  return <SpaceHome workspaceId={membership.workspaceId} workspaceName={membership.workspaceName} pages={pages} tree={tree} canEdit={getCapabilities({ role: membership.role, permissions: membership.permissions }).canEdit} />;
}

import { createServerAuth } from "@/lib/auth/server";
import { getCapabilities } from "@/engine";
import { createServerEngine } from "@/lib/engine/server";
import { redirect } from "next/navigation";
import TrashHome from "./TrashHome";
import "../../tool.css";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase/query";
import type { PageRecord } from "@/lib/pages";
import { selectWorkspace, workspaceHref } from "@/lib/workspace-context";
import { loadWorkspaceMemberships } from "@/lib/workspace-context.server";
import { safeNext } from "@/lib/safeNext";

export default async function TrashPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const requestedWorkspaceId = (await searchParams).workspace;
  const supabase = await createClient();
  const { data: user, error: authError } = await createServerAuth(supabase).getUser();
  if (authError) throw authError;
  if (!user) {
    const next = safeNext(workspaceHref("/space/trash", requestedWorkspaceId), "/space/trash");
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const memberships = await loadWorkspaceMemberships(supabase, user.id);
  const selection = selectWorkspace(memberships, requestedWorkspaceId);
  if (selection.status === "none") redirect("/onboarding");
  if (selection.status === "forbidden") {
    const fallback = selectWorkspace(memberships, undefined);
    redirect(fallback.status === "ok" ? workspaceHref("/space/trash", fallback.membership.workspaceId) : "/onboarding");
  }
  const { membership } = selection;

  const data = unwrap(
    await createServerEngine(supabase).pages.list(membership.workspaceId, { trashed: true }),
    "휴지통 문서",
  );
  return <TrashHome workspaceId={membership.workspaceId} workspaceName={membership.workspaceName} pages={(data ?? []) as unknown as PageRecord[]} canEdit={getCapabilities({ role: membership.role }).canEdit} />;
}

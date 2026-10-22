import { createServerAuth } from "@/lib/auth/server";
import { createServerEngine } from "@/lib/engine/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SearchResults, { type SearchHit } from "./SearchResults";
import "../tool.css";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase/query";
import { snippet } from "@/lib/search";
import { selectWorkspace, workspaceHref } from "@/lib/workspace-context";
import { loadWorkspaceMemberships } from "@/lib/workspace-context.server";
import { safeNext } from "@/lib/safeNext";

export const metadata: Metadata = { title: "검색 — Hestia" };
export const dynamic = "force-dynamic";

type Row = { kind: "page" | "reason"; page_id: string; title: string; workspace_name: string; snippet: string | null; version: number | null };
type RecentRow = { id: string; title: string; workspaces: { name: string } | null };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; workspace?: string }> }) {
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const supabase = await createClient();
  const { data: user, error: authError } = await createServerAuth(supabase).getUser();
  if (authError) throw authError;
  if (!user) {
    const next = safeNext(workspaceHref(query ? `/search?q=${encodeURIComponent(query)}` : "/search", params.workspace), "/search");
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const memberships = await loadWorkspaceMemberships(supabase, user.id);
  const selection = selectWorkspace(memberships, params.workspace);
  if (selection.status === "none") redirect("/onboarding");
  if (selection.status === "forbidden") {
    const fallback = selectWorkspace(memberships, undefined);
    redirect(fallback.status === "ok" ? workspaceHref("/search", fallback.membership.workspaceId) : "/onboarding");
  }
  const { membership } = selection;

  if (!query) {
    const data = unwrap(
      await supabase.from("pages").select("id, title, workspaces(name)").eq("workspace_id", membership.workspaceId).is("deleted_at", null).order("updated_at", { ascending: false }).limit(30),
      "최근 문서",
    );
    const recent: SearchHit[] = ((data ?? []) as unknown as RecentRow[]).map((page) => ({
      key: page.id,
      kind: "page",
      pageId: page.id,
      title: page.title,
      space: page.workspaces?.name ?? "워크스페이스",
      text: "",
    }));
    return <SearchResults hits={recent} query="" workspaceId={membership.workspaceId} />;
  }

  const data = unwrap(
    await createServerEngine(supabase).search(membership.workspaceId, query),
    "검색 결과",
  );
  const hits: SearchHit[] = ((data ?? []) as unknown as Row[]).map((row, index) => ({
    key: `${row.kind}-${row.page_id}-${row.version ?? index}`,
    kind: row.kind,
    pageId: row.page_id,
    title: row.title,
    space: row.workspace_name,
    version: row.version,
    text: snippet(row.snippet ?? "", query),
  }));
  return <SearchResults hits={hits} query={query} workspaceId={membership.workspaceId} />;
}

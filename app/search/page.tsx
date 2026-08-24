import type { Metadata } from "next";
import SearchResults, { type SearchHit } from "./SearchResults";
import "../tool.css";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase/query";
import { snippet } from "@/lib/search";

export const metadata: Metadata = { title: "검색 — Hestia" };
export const dynamic = "force-dynamic";

type Row = { kind: "page" | "reason"; page_id: string; title: string; workspace_name: string; snippet: string | null; version: number | null };
type RecentRow = { id: string; title: string; workspaces: { name: string } | null };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = ((await searchParams).q ?? "").trim();
  const supabase = await createClient();

  if (!query) {
    const data = unwrap(
      await supabase.from("pages").select("id, title, workspaces(name)").is("deleted_at", null).order("updated_at", { ascending: false }).limit(30),
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
    return <SearchResults hits={recent} query="" />;
  }

  const data = unwrap(await supabase.rpc("search_workspace", { term: query }).order("kind").limit(60), "검색 결과");
  const hits: SearchHit[] = ((data ?? []) as unknown as Row[]).map((row, index) => ({
    key: `${row.kind}-${row.page_id}-${row.version ?? index}`,
    kind: row.kind,
    pageId: row.page_id,
    title: row.title,
    space: row.workspace_name,
    version: row.version,
    text: snippet(row.snippet ?? "", query),
  }));
  return <SearchResults hits={hits} query={query} />;
}

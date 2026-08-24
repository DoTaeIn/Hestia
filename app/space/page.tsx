import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SpaceHome from "./SpaceHome";
import "../tool.css";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase/query";
import { pagesToTree, type PageRecord } from "@/lib/pages";

export const metadata: Metadata = { title: "워크스페이스 — Hestia" };

type Membership = { workspace_id: string; workspaces: { name: string } | null };

export default async function SpacePage() {
  const supabase = await createClient();
  const memberData = unwrap(
    await supabase.from("workspace_members").select("workspace_id, workspaces(name)").limit(1).maybeSingle(),
    "워크스페이스 멤버십",
  );
  const member = memberData as unknown as Membership | null;
  if (!member?.workspaces) redirect("/onboarding");

  const pageData = unwrap(
    await supabase.from("pages").select("id, workspace_id, parent_id, title, content, position, created_at, updated_at").eq("workspace_id", member.workspace_id).is("deleted_at", null).order("position").order("created_at"),
    "문서 목록",
  );
  const pages = (pageData ?? []) as unknown as PageRecord[];
  const tree = pagesToTree(member.workspaces.name, pages);
  return <SpaceHome workspaceId={member.workspace_id} workspaceName={member.workspaces.name} pages={pages} tree={tree} />;
}

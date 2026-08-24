import { redirect } from "next/navigation";
import TrashHome from "./TrashHome";
import "../../tool.css";
import { createClient } from "@/lib/supabase/server";
import { unwrap } from "@/lib/supabase/query";
import type { PageRecord } from "@/lib/pages";

type Membership = { workspace_id: string; workspaces: { name: string } | null };

export default async function TrashPage() {
  const supabase = await createClient();
  const memberData = unwrap(
    await supabase.from("workspace_members").select("workspace_id, workspaces(name)").limit(1).maybeSingle(),
    "워크스페이스 멤버십",
  );
  const member = memberData as unknown as Membership | null;
  if (!member?.workspaces) redirect("/onboarding");
  const data = unwrap(
    await supabase.from("pages").select("id, workspace_id, parent_id, title, content, position, created_at, updated_at, deleted_at, deleted_by").eq("workspace_id", member.workspace_id).not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
    "휴지통 문서",
  );
  return <TrashHome workspaceName={member.workspaces.name} pages={(data ?? []) as unknown as PageRecord[]} />;
}

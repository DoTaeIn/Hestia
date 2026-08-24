"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type WorkspaceState = { error?: string };

export async function createWorkspace(_: WorkspaceState, formData: FormData): Promise<WorkspaceState> {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) return { error: "워크스페이스 이름은 2~80자로 입력해주세요." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  const slug = `${name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "") || "workspace"}-${crypto.randomUUID().slice(0, 8)}`;
  const workspaceId = crypto.randomUUID();
  const { error } = await supabase
    .from("workspaces")
    .insert({ id: workspaceId, name, slug, owner_id: user.id });

  if (error) return { error: "워크스페이스를 만들지 못했습니다. 잠시 후 다시 시도해주세요." };
  redirect(`/space?workspace=${workspaceId}`);
}

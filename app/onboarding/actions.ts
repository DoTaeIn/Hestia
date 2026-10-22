"use server";

import { createServerAuth } from "@/lib/auth/server";

import { redirect } from "next/navigation";
import { createServerEngine } from "@/lib/engine/server";
import { createClient } from "@/lib/supabase/server";
import { workspaceHref } from "@/lib/workspace-context";

export type WorkspaceState = { error?: string };

export async function createWorkspace(_: WorkspaceState, formData: FormData): Promise<WorkspaceState> {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) return { error: "워크스페이스 이름은 2~80자로 입력해주세요." };

  const supabase = await createClient();
  const { data: user, error: authError } = await createServerAuth(supabase).getUser();
  if (authError) throw authError;
  if (!user) redirect("/login?next=/onboarding");

  const { data, error } = await createServerEngine(supabase).workspaces.create({ name });

  if (error) return { error: "워크스페이스를 만들지 못했습니다. 잠시 후 다시 시도해주세요." };
  redirect(workspaceHref("/space", data.id));
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerEngine } from "@/lib/engine/server";

/** Call with auth.getUser().id: membership RLS also exposes shared members. */
export async function loadWorkspaceMemberships(supabase: SupabaseClient, userId: string) {
  const result = await createServerEngine(supabase).workspaces.listMemberships(userId);
  if (result.error) throw result.error;
  return result.data;
}

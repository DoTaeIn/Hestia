import type { SupabaseClient } from "@supabase/supabase-js";
import { createHestiaEngine, type DocumentNode } from "../engine/index.ts";

/** Runs in a server or browser host with an authenticated, session-scoped client. */
export async function createHandbook(client: SupabaseClient, workspaceId: string, title: string) {
  const result = await createHestiaEngine(client).pages.create({ workspaceId, title });
  if (result.error) throw result.error;
  return result.data;
}

/** Save only when the editor's collaboration queue has been acknowledged. */
export async function recordHandbook(client: SupabaseClient, pageId: string, title: string, content: DocumentNode, reason?: string) {
  const result = await createHestiaEngine(client).revisions.save({ pageId, title, content, reason });
  if (result.error) throw result.error;
  return result.data;
}

export async function findHandbooks(client: SupabaseClient, workspaceId: string, query: string) {
  const result = await createHestiaEngine(client).search(workspaceId, query);
  if (result.error) throw result.error;
  return result.data;
}

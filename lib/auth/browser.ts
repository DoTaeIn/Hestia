import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuthAdapter, type AuthAdapter } from "@/engine/auth";
import { createClient } from "@/lib/supabase/browser";

/** Replace this factory when the host app owns a different login flow. */
export function createBrowserAuth(client: SupabaseClient = createClient()): AuthAdapter {
  return createSupabaseAuthAdapter(client);
}

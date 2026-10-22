import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAuthAdapter, type AuthAdapter } from "@/engine/auth";

/** Request-scoped session is supplied by the route or middleware. */
export function createServerAuth(client: SupabaseClient): AuthAdapter {
  return createSupabaseAuthAdapter(client);
}

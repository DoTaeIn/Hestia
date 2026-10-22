import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseSecurityAdapter, type SecurityAdapter } from "@/engine/security";

/** Replace this factory when the host app owns a different MFA flow; return null only when the custom provider implements its own step-up flow. */
export function createServerSecurity(client: SupabaseClient): SecurityAdapter | null {
  return createSupabaseSecurityAdapter(client);
}

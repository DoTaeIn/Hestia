import { createServerSecurity } from "@/lib/auth/security-server";
import { createServerAuth } from "@/lib/auth/server";
import { authConfig } from "@/auth.config";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_NEXT, safeNext } from "@/lib/safeNext";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const invalidLink = () => to(`${authConfig.loginPath}?error=invalid_link&next=${encodeURIComponent(next)}`);

  if (!code) return invalidLink();

  const supabase = await createClient();
  const { data: user, error } = await createServerAuth(supabase).exchangeCode(code);
  // an expired or replayed link lands here; send them back to ask for a new one
  if (error || !user) return invalidLink();

  const security = createServerSecurity(supabase);
  if (security) {
    const assurance = await security.getAssurance();
    if (assurance.error) return to("/space");
    if (assurance.data.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2") return to(`/account/verify?next=${encodeURIComponent(next === DEFAULT_NEXT ? "/space" : next)}`);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  // A failed lookup must not read as "no workspace yet": that would walk an
  // existing member into onboarding and let them create a second workspace.
  // /space re-runs the query and surfaces a real failure as a real error.
  if (membershipError) return to("/space");

  // Nowhere to land without a workspace — a shared link would only 404 behind
  // row-level security, so first-run comes before the requested destination.
  if (!membership) return to(DEFAULT_NEXT);

  // Returning members should land in their existing workspace, not see the
  // first-workspace form again after every magic-link sign-in.
  return to(next === DEFAULT_NEXT ? "/space" : next);
}

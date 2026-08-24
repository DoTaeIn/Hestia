import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_NEXT, safeNext } from "@/lib/safeNext";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (!code) return to(DEFAULT_NEXT);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  // an expired or replayed link lands here; send them back to ask for a new one
  if (error || !data.user) return to("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", data.user.id)
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

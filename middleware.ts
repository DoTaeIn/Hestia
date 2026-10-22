import { buildContentSecurityPolicy } from "@/lib/security-policy";
import { createServerSecurity } from "@/lib/auth/security-server";
import { createServerAuth } from "@/lib/auth/server";
import { authConfig } from "@/auth.config";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const protectedPrefixes = ["/space", "/editor", "/search", "/onboarding", "/account"];

function privateResponse(response: NextResponse, policy: string) {
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.append("Vary", "Cookie");
  return response;
}

export async function middleware(request: NextRequest) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const policy = buildContentSecurityPolicy({ nonce, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, development: process.env.NODE_ENV !== "production", turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: { sameSite: "lax", secure: process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") ?? false },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value, options }) => request.cookies.set(name, value));
          requestHeaders.set("cookie", request.cookies.toString());
          response = NextResponse.next({ request: { headers: requestHeaders } });
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: user, error: authError } = await createServerAuth(supabase).getUser();
  const isProtected = protectedPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix));

  if (authError) {
    if (isProtected) return privateResponse(new NextResponse("인증 서비스를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.", { status: 503, headers: { "Retry-After": "30", "Content-Type": "text/plain; charset=utf-8" } }), policy);
    return privateResponse(response, policy);
  }

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = authConfig.loginPath;
    url.search = "";
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return privateResponse(redirect, policy);
  }

  if (user && isProtected && request.nextUrl.pathname !== "/account/verify") {
    const security = createServerSecurity(supabase);
    if (security) {
      const assurance = await security.getAssurance();
      if (assurance.error) return privateResponse(new NextResponse("추가 인증 상태를 확인하지 못했습니다.", { status: 503, headers: { "Retry-After": "30" } }), policy);
      if (assurance.data.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2") {
        const url = request.nextUrl.clone(); url.pathname = "/account/verify"; url.search = "";
        url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
        const redirect = NextResponse.redirect(url);
        response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
        return privateResponse(redirect, policy);
      }
    }
  }

  if (user && request.nextUrl.pathname === authConfig.loginPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/space";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return privateResponse(redirect, policy);
  }

  return privateResponse(response, policy);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.png|icon.png|logo.png).*)"],
};

// Fail closed for a remote production backend when Secure cookies cannot be configured.
if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname);
  if (!local) {
    const site = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : null;
    if (backend.protocol !== "https:" || !site || site.protocol !== "https:" || site.username || site.password || site.pathname !== "/" || site.search || site.hash) throw new Error("Configure NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_SUPABASE_URL as HTTPS origins before production build.");
  }
}

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ...(process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
    ] }];
  },
};

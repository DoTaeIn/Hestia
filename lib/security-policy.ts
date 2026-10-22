/** Pure policy builder shared by middleware and security regression tests. */
export function buildContentSecurityPolicy({ nonce, supabaseUrl, development, turnstile = false }: { nonce: string; supabaseUrl: string; development: boolean; turnstile?: boolean }) {
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(nonce)) throw new Error("Invalid CSP nonce");
  const backend = new URL(supabaseUrl);
  if (!["http:", "https:"].includes(backend.protocol) || backend.username || backend.password) throw new Error("Invalid Supabase origin");
  const socket = new URL(backend.origin); socket.protocol = backend.protocol === "https:" ? "wss:" : "ws:";
  const captcha = turnstile ? " https://challenges.cloudflare.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}${captcha}`,
    // Inline styles are used by TipTap, canvas and React; scripts still require a nonce.
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    `connect-src 'self' ${backend.origin} ${socket.origin}${development ? " ws://localhost:* ws://127.0.0.1:*" : ""}${captcha}`,
    `img-src 'self' data: blob: https: ${backend.origin}`,
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'",
    `frame-src${turnstile ? captcha : " 'none'"}`,
    "worker-src 'self' blob:", "media-src 'self' blob:",
  ].join("; ");
}

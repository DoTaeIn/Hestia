/** Offline readiness check. Reports setting names only, never credential values. */
import { existsSync } from "node:fs";
const position = process.argv.indexOf("--env-file");
if (position >= 0) {
  const path = process.argv[position + 1];
  if (!path || !existsSync(path)) throw new Error("The requested environment file is missing");
  process.loadEnvFile(path);
}
const errors = [];
function requireOrigin(name) {
  try {
    const url = new URL(process.env[name] ?? "");
    if (url.protocol !== "https:" || (url.hostname === "localhost" || url.hostname.startsWith("127.") || ["0.0.0.0", "[::1]", "::1"].includes(url.hostname)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /your-project|example\.|\.example$|\.invalid$/.test(url.hostname)) throw new Error();
  } catch { errors.push(name + ": configure a real HTTPS origin without a path or credentials"); }
}
requireOrigin("NEXT_PUBLIC_SITE_URL"); requireOrigin("NEXT_PUBLIC_SUPABASE_URL");
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
let role;
try { role = JSON.parse(Buffer.from(publishable.split(".")[1], "base64url").toString()).role; } catch {}
if (/REPLACE|your-supabase/i.test(publishable) || !(publishable.startsWith("sb_publishable_") || role === "anon")) errors.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: a publishable/anon key is required");
for (const [name, value] of Object.entries(process.env)) {
  if (!name.startsWith("NEXT_PUBLIC_")) continue;
  let jwtRole;
  try { jwtRole = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString()).role; } catch {}
  if (/SERVICE_ROLE|SECRET|PRIVATE_KEY/.test(name) || value.startsWith("sb_secret_") || jwtRole === "service_role") errors.push(name + ": private credentials must never be public");
}
if (process.env.NEXT_PUBLIC_AUTH_EMAIL_LINK === "false" && process.env.NEXT_PUBLIC_AUTH_PASSWORD !== "true" && !process.env.NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS?.trim()) errors.push("Login methods: configure at least one method");
if ((process.env.NEXT_PUBLIC_AUTH_EMAIL_LINK !== "false" || process.env.NEXT_PUBLIC_AUTH_PASSWORD === "true") && (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || /REPLACE/i.test(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY))) errors.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY: configure bot protection for email/password login and enable matching Supabase CAPTCHA settings");
if (errors.length) { for (const error of errors) console.error("CHECK:", error); process.exitCode = 1; }
else console.log("Environment checks passed. Complete the provider, database, backup and domain checks in docs/PRODUCTION-SECURITY.md before launch.");

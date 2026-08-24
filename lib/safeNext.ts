/**
 * Where to send someone after they sign in.
 *
 * Only same-site absolute paths are allowed. `startsWith("/")` alone is not
 * enough: `//evil.com` and `/\evil.com` also pass it, and both resolve to an
 * external origin once handed to `new URL(next, base)` — an open redirect out
 * of our own login form.
 */
export const DEFAULT_NEXT = "/onboarding";

export function safeNext(value: string | null | undefined, fallback = DEFAULT_NEXT): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

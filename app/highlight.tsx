import type { ReactNode } from "react";

/**
 * Wraps every occurrence of `q` in `text` with <mark>. Case-insensitive,
 * and the matched text keeps the source's own casing.
 *
 * Shared by the landing page's search preview and the search results page so
 * a hit looks the same in both.
 */
export function highlight(text: string, q: string): ReactNode {
  const needle = q.trim().toLowerCase();
  if (!needle) return text;

  const hay = text.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;

  for (;;) {
    const i = hay.indexOf(needle, at);
    if (i < 0) break;
    if (i > at) parts.push(text.slice(at, i));
    parts.push(<mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }

  if (!parts.length) return text;
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

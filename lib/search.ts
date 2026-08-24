export const SNIPPET_PAD = 90;

/**
 * 맞은 자리 앞뒤만 잘라낸다. 본문 전체를 브라우저까지 들고 가던 게 옛 검색의 문제였다.
 * 잘린 쪽에만 줄임표를 붙인다 — 안 잘린 쪽에 붙이면 내용이 더 있는 것처럼 보인다.
 */
export function snippet(text: string, query: string) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return text.slice(0, SNIPPET_PAD * 2);
  const from = Math.max(0, at - SNIPPET_PAD);
  const to = Math.min(text.length, at + query.length + SNIPPET_PAD);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

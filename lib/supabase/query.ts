/**
 * Supabase returns `{ data, error }` and never throws. Dropping `error` on the
 * floor makes a failed query indistinguishable from an empty table: the reader
 * whose request actually failed is told, in our own words, that they have no
 * documents. In a product whose whole promise is that nothing is lost, that is
 * the worst lie the UI can tell.
 *
 * Unwrapping rethrows instead, so the failure reaches app/error.tsx — which
 * says plainly that the documents are still there and offers a retry. The
 * message lands in the server log; Next strips it from the client in
 * production and sends only the digest.
 */
/*
 * Supabase results are discriminated unions — on failure `data` is null (or,
 * for auth, an object of nulls), so a single `{ data: T; error }` shape cannot
 * describe both branches. Matching the union keeps the success type intact.
 */
type Ok<T> = { data: T; error: null };
type Failed = { data: unknown; error: { message: string } };

export function unwrap<T>(result: Ok<T> | Failed, what: string): T {
  if (result.error) throw new Error(`${what} 조회 실패: ${result.error.message}`);
  return result.data as T;
}

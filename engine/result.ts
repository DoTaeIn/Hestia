export type EngineErrorCode = "validation" | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "unavailable" | "unknown";

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly operation: string;
  readonly databaseCode?: string;
  constructor(code: EngineErrorCode, message: string, operation: string, databaseCode?: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.operation = operation;
    this.databaseCode = databaseCode;
  }
}

export type EngineResult<T> = { data: T; error: null } | { data: null; error: EngineError };
type BackendError = { message: string; code?: string };

export function normalizeError(error: unknown, operation: string): EngineError {
  if (error instanceof EngineError) return error;
  const source = error as Partial<BackendError> | null;
  const message = typeof source?.message === "string" ? source.message : "Request failed";
  const db = typeof source?.code === "string" ? source.code : undefined;
  const lower = message.toLowerCase();
  let code: EngineErrorCode = "unknown";
  if (db === "42501" || /not allowed|only (an? |the )?(owner|document owner)|administrator access/.test(lower)) code = "forbidden";
  else if (db === "PGRST301" || db === "PGRST303" || (lower.includes("authentication required") || lower.includes("authentication assurance required")) || lower.includes("auth session missing")) code = "unauthenticated";
  else if (db === "23505" || db === "40001" || db === "40P01" || /was restored|different update|reload this page/.test(lower)) code = "conflict";
  else if (db === "PGRST116" || lower.includes("not found")) code = "not_found";
  else if (db === "22P02" || db === "23514" || db === "23503") code = "validation";
  else if (db?.startsWith("08") || /fetch failed|failed to fetch|network|timeout|timed out/.test(lower)) code = "unavailable";
  return new EngineError(code, message, operation, db);
}

/** Includes transport exceptions: callers always receive one result shape. */
export async function execute<T>(operation: string, query: () => PromiseLike<{ data: unknown; error: BackendError | null }>): Promise<EngineResult<T>> {
  try {
    const result = await query();
    if (result.error) return { data: null, error: normalizeError(result.error, operation) };
    return { data: result.data as T, error: null };
  } catch (error) {
    return { data: null, error: normalizeError(error, operation) };
  }
}

export function requireId(value: string, operation: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new EngineError("validation", "A UUID is required", operation);
  }
  return value;
}

export function requireLimit(value: number, operation: string) {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new EngineError("validation", "Limit must be an integer from 1 to 100", operation);
  return value;
}

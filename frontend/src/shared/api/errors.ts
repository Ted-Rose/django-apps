/**
 * Error thrown by the API client for non-2xx responses that are not
 * auth redirects. `body` holds the parsed JSON response (or raw text)
 * so callers can inspect `{"error": ..., "detail": ...}` payloads
 * returned by the Django API.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;

  constructor(
    message: string,
    status: number,
    statusText = '',
    body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/**
 * Best-effort human-readable message for a failed request — the
 * API's uniform error shape is `{error, detail}`. Shared by every
 * app's mutation hooks (moved out of tasks/mutations.ts in finance
 * Stage 1).
 */
export function errorDetail(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body;
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail) return detail;
    }
    return error.message;
  }
  return 'Could not reach the server. Check your connection.';
}

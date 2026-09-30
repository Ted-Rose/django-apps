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

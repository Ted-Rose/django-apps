/**
 * Error thrown by the API client for non-2xx responses that are not
 * auth redirects. `body` holds the parsed JSON response (or raw text)
 * so callers can inspect `{"error": ..., "detail": ...}` payloads
 * returned by the Django API.
 */
import i18n, { serverText } from '../i18n';

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
 * API's uniform error shape is `{error, detail}` plus optional
 * `code`/`params` for localization (translated via the `server`
 * namespace, falling back to the English `detail`). Shared by every
 * app's mutation hooks (moved out of tasks/mutations.ts in finance
 * Stage 1).
 */
export function errorDetail(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body;
    if (body && typeof body === 'object') {
      const b = body as {
        code?: unknown;
        params?: unknown;
        detail?: unknown;
      };
      const detail =
        typeof b.detail === 'string' && b.detail ? b.detail : undefined;
      if (typeof b.code === 'string' && b.code) {
        const localized = serverText(
          {
            code: b.code,
            params:
              b.params && typeof b.params === 'object'
                ? (b.params as Record<string, unknown>)
                : null,
          },
          detail,
        );
        if (localized) return localized;
      }
      if (detail) return detail;
    }
    return error.message;
  }
  return i18n.t('common:errors.network');
}

import { apiGet } from '../shared/api/client';
import { ApiError } from '../shared/api/errors';
import type { components } from './api-types';

/** Type aliases over the generated OpenAPI schemas (api-types.ts). */
export type AudioOut = components['schemas']['AudioOut'];
export type SpokiOut = components['schemas']['SpokiOut'];

/**
 * GET /api/single_pages/tts/?text=&lang=&filename= → AudioOut.
 * `filename` is the hashOf() of the text — the server uses it in the
 * GCS object name, so repeated phrases reuse the same audio.
 */
export function fetchAudio(
  text: string,
  lang: string,
  filename: string,
): Promise<AudioOut> {
  const qs = new URLSearchParams({ text, lang, filename });
  return apiGet<AudioOut>(`/api/single_pages/tts/?${qs}`);
}

/** GET /api/single_pages/spoki/ → SpokiOut (html is nh3-sanitized). */
export function fetchSpoki(): Promise<SpokiOut> {
  return apiGet<SpokiOut>('/api/single_pages/spoki/');
}

/**
 * Human-readable detail from the API's {error, detail} shape. Local
 * to this entry — shared errorDetail() routes through i18n and this
 * app has no catalogs (Latvian-only toy pages).
 */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = (error.body as { detail?: unknown })?.detail;
    if (typeof detail === 'string' && detail) return detail;
    return error.message;
  }
  return 'Network error';
}

import { apiGet } from '../shared/api/client';
import type { components } from './api-types';

/** Type aliases over the generated OpenAPI schemas (api-types.ts). */
export type GmailStatusOut = components['schemas']['GmailStatusOut'];
export type GmailMessagesOut = components['schemas']['GmailMessagesOut'];
export type GmailMessageOut = components['schemas']['GmailMessageOut'];
export type AudioOut = components['schemas']['AudioOut'];

/** Mutation request body (POST /api/gmail/mark-read/). */
export type MarkReadIn = components['schemas']['MarkReadIn'];
/** The delegated view's JsonResponse — {success: true} on OK. */
export interface MarkReadOut {
  success: boolean;
}

/** GET /api/gmail/status/ → GmailStatusOut. */
export function fetchStatus(): Promise<GmailStatusOut> {
  return apiGet<GmailStatusOut>('/api/gmail/status/');
}

/** GET /api/gmail/messages/?query= → GmailMessagesOut. */
export function fetchMessages(query: string): Promise<GmailMessagesOut> {
  const qs = new URLSearchParams();
  if (query) qs.set('query', query);
  const suffix = qs.toString();
  return apiGet<GmailMessagesOut>(
    `/api/gmail/messages/${suffix ? `?${suffix}` : ''}`,
  );
}

/** GET /api/gmail/audio/?text=&filename=&lang= → AudioOut. */
export function fetchAudio(
  text: string,
  filename?: string,
  lang?: string,
): Promise<AudioOut> {
  const qs = new URLSearchParams({ text });
  if (filename) qs.set('filename', filename);
  if (lang) qs.set('lang', lang);
  return apiGet<AudioOut>(`/api/gmail/audio/?${qs}`);
}

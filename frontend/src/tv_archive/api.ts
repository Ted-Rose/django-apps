import { apiGet } from '../shared/api/client';
import type { components } from './api-types';

/** Type aliases over the generated OpenAPI schemas (api-types.ts). */
export type ContentsOut = components['schemas']['ContentsOut'];
export type ContentOut = components['schemas']['ContentOut'];

/**
 * Filter params for GET /api/tv-arhivs/contents/. Names mirror the
 * template's GET form verbatim, so a copied `/tv-arhivs?…` URL
 * works unchanged in the SPA. `rating_value` and `ratio` are
 * minimums (`__gte` — the plan's deliberate semantic change) and
 * `start_date`/`end_date` both filter `start_date`.
 */
export interface ContentsParams {
  content_rating?: string | null;
  not_content_rating?: string | null;
  rating_value?: number | string | null;
  start_date?: string | null;
  end_date?: string | null;
  ratio?: number | string | null;
  channel?: string | null;
  not_channel?: string | null;
  page?: number | string | null;
}

/**
 * GET /api/tv-arhivs/contents/ — one page of contents plus every
 * filter-dropdown option list (channels, content_ratings, types)
 * per the rewrite plan's single-endpoint rule.
 */
export function fetchContents(
  params: ContentsParams = {},
): Promise<ContentsOut> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') qs.set(key, String(value));
  }
  const suffix = qs.toString();
  return apiGet<ContentsOut>(
    `/api/tv-arhivs/contents/${suffix ? `?${suffix}` : ''}`,
  );
}

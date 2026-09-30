import { apiGet } from '../shared/api/client';
import type { components } from './api-types';

/** Type aliases over the generated OpenAPI schemas (api-types.ts). */
export type DashboardOut = components['schemas']['DashboardOut'];
export type TaskOut = components['schemas']['TaskOut'];
export type TaskListOut = components['schemas']['TaskListOut'];
export type LabelOut = components['schemas']['LabelOut'];
export type LabelRef = components['schemas']['LabelRef'];
export type FlagsOut = components['schemas']['FlagsOut'];

export interface DashboardParams {
  list?: string | null;
  label?: string | null;
  order?: string;
}

/**
 * GET /api/tasks/dashboard/?list=&label=&order=
 *
 * `secondary_label` is intentionally NOT a parameter — the backend
 * does not accept it; that filter stays client-side (ported from
 * filters.js).
 */
export function fetchDashboard(
  params: DashboardParams = {},
): Promise<DashboardOut> {
  const qs = new URLSearchParams();
  if (params.list) qs.set('list', params.list);
  if (params.label) qs.set('label', params.label);
  if (params.order) qs.set('order', params.order);
  const suffix = qs.toString();
  return apiGet<DashboardOut>(
    `/api/tasks/dashboard/${suffix ? `?${suffix}` : ''}`,
  );
}

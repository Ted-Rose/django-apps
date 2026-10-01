import { apiGet } from '../shared/api/client';
import type { components } from './api-types';

/** Type aliases over the generated OpenAPI schemas (api-types.ts). */
export type DashboardOut = components['schemas']['DashboardOut'];
export type TaskOut = components['schemas']['TaskOut'];
export type TaskListOut = components['schemas']['TaskListOut'];
export type LabelOut = components['schemas']['LabelOut'];
export type LabelRef = components['schemas']['LabelRef'];
export type FlagsOut = components['schemas']['FlagsOut'];
export type TaskDetailOut = components['schemas']['TaskDetailOut'];
export type SearchOut = components['schemas']['SearchOut'];

/** Mutation request bodies (POST /api/tasks/…). */
export type TaskCreateIn = components['schemas']['TaskCreateIn'];
export type TaskUpdateIn = components['schemas']['TaskUpdateIn'];
export type DividerCreateIn = components['schemas']['DividerCreateIn'];
export type DividerUpdateIn = components['schemas']['DividerUpdateIn'];

/** Shape returned by the mutation views the API delegates to. */
export interface MutationResult {
  success: boolean;
  task_id?: string;
  is_starred?: boolean;
  stats?: {
    processed: number;
    moved: number;
    starred: number;
    errors?: number;
    unmatched?: { hashtag: string; task_title: string }[];
  };
}

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

export interface ViewParams {
  label?: string | null;
  order?: string;
}

/**
 * GET /api/tasks/starred/|overdue/|archived/|trash/ — the special
 * views share the dashboard-shaped DashboardOut (flags.is_*_view
 * tells them apart). None accept a `list` filter; trash orders by
 * deleted_at (deleted_desc default, deleted_asc the only override).
 */
function fetchView(
  path: 'starred' | 'overdue' | 'archived' | 'trash',
  params: ViewParams = {},
): Promise<DashboardOut> {
  const qs = new URLSearchParams();
  if (params.label) qs.set('label', params.label);
  if (params.order) qs.set('order', params.order);
  const suffix = qs.toString();
  return apiGet<DashboardOut>(
    `/api/tasks/${path}/${suffix ? `?${suffix}` : ''}`,
  );
}

export function fetchStarred(params: ViewParams = {}): Promise<DashboardOut> {
  return fetchView('starred', params);
}

export function fetchOverdue(params: ViewParams = {}): Promise<DashboardOut> {
  return fetchView('overdue', params);
}

export function fetchArchived(params: ViewParams = {}): Promise<DashboardOut> {
  return fetchView('archived', params);
}

export function fetchTrash(params: ViewParams = {}): Promise<DashboardOut> {
  return fetchView('trash', params);
}

/** GET /api/tasks/task/{task_id}/ → TaskDetailOut. */
export function fetchTaskDetail(taskId: string): Promise<TaskDetailOut> {
  return apiGet<TaskDetailOut>(
    `/api/tasks/task/${encodeURIComponent(taskId)}/`,
  );
}

/**
 * GET /api/tasks/search/?q= — flat list across title+notes (the
 * documented redesign: the template search AND-ed separate
 * title/notes inputs and grouped per task list; the API is one
 * `q` OR-matched flat list).
 */
export function fetchSearchTasks(q: string): Promise<SearchOut> {
  return apiGet<SearchOut>(`/api/tasks/search/?q=${encodeURIComponent(q)}`);
}

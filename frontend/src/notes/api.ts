import { apiDelete, apiGet, apiPatch, apiPost } from '../shared/api/client';
import type { components } from './api-types';

/** Type aliases over the generated OpenAPI schemas (api-types.ts). */
export type NotesDashboardOut = components['schemas']['NotesDashboardOut'];
export type NoteCategoryOut = components['schemas']['NoteCategoryOut'];
export type NoteCategoryRef = components['schemas']['NoteCategoryRef'];
export type RetagOut = components['schemas']['RetagOut'];
export type FlagsOut = components['schemas']['FlagsOut'];
export type TaskOut = components['schemas']['TaskOut'];
export type TaskDetailOut = components['schemas']['TaskDetailOut'];

/** Mutation request bodies (POST/PATCH /api/notes/…). */
export type NoteCreateIn = components['schemas']['NoteCreateIn'];
export type NoteUpdateIn = components['schemas']['NoteUpdateIn'];
export type CategoryCreateIn = components['schemas']['CategoryCreateIn'];
export type CategoryRenameIn = components['schemas']['CategoryRenameIn'];
export type CategoryMergeIn = components['schemas']['CategoryMergeIn'];

/**
 * Response of POST/PATCH /api/notes/categories/… — the generated
 * `{category, retagged}` schema (named NoteCategoryMutationOut
 * server-side so it cannot collide with finance's CategoryOut).
 */
export type NoteCategoryResult =
  components['schemas']['NoteCategoryMutationOut'];

/** Shape returned by the task views the API delegates to. */
export interface MutationResult {
  success: boolean;
  task_id?: string;
}

export interface NotesParams {
  /** Category id — the API filters subtree-wide (group + leaves). */
  category?: number | null;
  /** Free-text search across title + body (matches title/notes). */
  q?: string | null;
  order?: string;
}

/**
 * GET /api/notes/?category=&q=&order= → NotesDashboardOut —
 * active notes, completed notes and the category tree with
 * per-category counts.
 */
export function fetchNotes(
  params: NotesParams = {},
): Promise<NotesDashboardOut> {
  const qs = new URLSearchParams();
  if (params.category != null) qs.set('category', String(params.category));
  if (params.q) qs.set('q', params.q);
  if (params.order) qs.set('order', params.order);
  const suffix = qs.toString();
  return apiGet<NotesDashboardOut>(`/api/notes/${suffix ? `?${suffix}` : ''}`);
}

/**
 * GET /api/tasks/task/{task_id}/ → TaskDetailOut — the notes editor
 * reuses the task detail endpoint (notes are GoogleTask rows; the
 * endpoint does not exclude is_note).
 */
export function fetchNoteDetail(taskId: string): Promise<TaskDetailOut> {
  return apiGet<TaskDetailOut>(
    `/api/tasks/task/${encodeURIComponent(taskId)}/`,
  );
}

/** POST /api/notes/ — server appends the #notes marker itself. */
export function createNote(payload: NoteCreateIn): Promise<MutationResult> {
  return apiPost<MutationResult>('/api/notes/', payload);
}

/**
 * PATCH /api/notes/{task_id}/ — title/body/category updates.
 * `category_id` is tri-state server-side: absent = keep, null =
 * uncategorized, id = retag. `is_note: false` converts the note
 * back into a plain task.
 */
export function updateNote(
  taskId: string,
  payload: NoteUpdateIn,
): Promise<MutationResult> {
  return apiPatch<MutationResult>(
    `/api/notes/${encodeURIComponent(taskId)}/`,
    payload,
  );
}

/** POST /api/notes/categories/ → {category, retagged}. */
export function createCategory(
  payload: CategoryCreateIn,
): Promise<NoteCategoryResult> {
  return apiPost<NoteCategoryResult>('/api/notes/categories/', payload);
}

/** PATCH /api/notes/categories/{id}/ — rename; retags members. */
export function renameCategory(
  categoryId: number,
  payload: CategoryRenameIn,
): Promise<NoteCategoryResult> {
  return apiPatch<NoteCategoryResult>(
    `/api/notes/categories/${categoryId}/`,
    payload,
  );
}

/** POST /api/notes/categories/merge/ → RetagOut. */
export function mergeCategories(payload: CategoryMergeIn): Promise<RetagOut> {
  return apiPost<RetagOut>('/api/notes/categories/merge/', payload);
}

/**
 * DELETE /api/notes/categories/{id}/?to=<id|uncategorized> —
 * members are retagged to the target before the category drops.
 */
export function deleteCategory(
  categoryId: number,
  to: number | 'uncategorized',
): Promise<RetagOut> {
  return apiDelete<RetagOut>(`/api/notes/categories/${categoryId}/?to=${to}`);
}

/**
 * Task-level ops notes reuse directly — notes are GoogleTask rows,
 * so delete/uncomplete/sync hit the existing /api/tasks/ endpoints
 * (same NinjaAPI, same auth). Star/complete are deliberately not
 * offered in the notes UI.
 */
function taskUrl(taskId: string, action: string): string {
  return `/api/tasks/task/${encodeURIComponent(taskId)}/${action}/`;
}

export function deleteTask(taskId: string): Promise<MutationResult> {
  return apiPost<MutationResult>(taskUrl(taskId, 'delete'));
}

export function uncompleteTask(taskId: string): Promise<MutationResult> {
  return apiPost<MutationResult>(taskUrl(taskId, 'uncomplete'));
}

export function syncTasks(): Promise<MutationResult> {
  return apiPost<MutationResult>('/api/tasks/sync/');
}

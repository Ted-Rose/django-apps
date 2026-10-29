/**
 * TanStack Query mutation hooks for the notes SPA — /api/notes/
 * note + category mutations plus the /api/tasks/task/{id}/ ops the
 * notes UI reuses (delete, uncomplete, sync).
 *
 * Cache strategy: every mutation invalidates the ['notes'] query
 * root on settle — the refetched NotesDashboardOut carries the
 * authoritative state (retagged categories, needs_push, moved
 * notes). ['notes'] is notes-only: it never touches the tasks
 * SPA's ['dashboard'] keys, and nothing here patches them.
 */
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, errorDetail } from '../shared/api/errors';
import { pushToast } from '../shared/toasts';
import {
  createCategory,
  createNote,
  deleteCategory,
  deleteTask,
  mergeCategories,
  renameCategory,
  syncTasks,
  uncompleteTask,
  updateNote,
  type CategoryCreateIn,
  type CategoryMergeIn,
  type NoteCreateIn,
  type NoteUpdateIn,
} from './api';

const NOTES_KEY = ['notes'] as const;

function invalidateNotes(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: NOTES_KEY });
}

/** Number of notes a category op retagged — drives the toast. */
function retaggedOf(data: unknown): number {
  if (data && typeof data === 'object' && 'retagged' in data) {
    const n = (data as { retagged: unknown }).retagged;
    return typeof n === 'number' ? n : 0;
  }
  return 0;
}

/** createNote — POST /api/notes/ (server composes the marker). */
export function useCreateNote() {
  const { t } = useTranslation('notes');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: NoteCreateIn) => createNote(payload),
    onError: (error) =>
      pushToast(
        t('toasts.createFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateNotes(queryClient),
  });
}

/**
 * updateNote — PATCH /api/notes/{task_id}/. The editor sends
 * title/body plus a category_id only when the selection changed;
 * 'not a note' sends {is_note: false}.
 */
export function useUpdateNote() {
  const { t } = useTranslation('notes');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { taskId: string; payload: NoteUpdateIn }) =>
      updateNote(variables.taskId, variables.payload),
    onError: (error) =>
      pushToast(
        t('toasts.updateFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateNotes(queryClient),
  });
}

/** deleteTask — soft delete to the shared trash; refetch removes. */
export function useDeleteNote() {
  const { t } = useTranslation('notes');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onError: (error) =>
      pushToast(
        t('toasts.deleteFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateNotes(queryClient),
  });
}

/** uncompleteTask — a completed note re-enters the active list. */
export function useUncompleteNote() {
  const { t } = useTranslation('notes');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => uncompleteTask(taskId),
    onError: (error) =>
      pushToast(
        t('toasts.uncompleteFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateNotes(queryClient),
  });
}

/** sync — POST /api/tasks/sync/ pulls new/edited notes too. */
export function useSync() {
  const { t } = useTranslation('notes');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => syncTasks(),
    onError: (error) =>
      pushToast(
        t('toasts.syncFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateNotes(queryClient),
  });
}

/**
 * Category ops — create/rename/merge/delete all respond with
 * CategoryOut or RetagOut carrying `retagged`; a success toast
 * reports the retag count like the spec's rename/merge scenarios.
 */
export function useCreateCategory() {
  const { t } = useTranslation('notes');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CategoryCreateIn) => createCategory(payload),
    onError: (error) =>
      pushToast(
        t('toasts.categoryFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateNotes(queryClient),
  });
}

export function useRenameCategory() {
  const { t } = useTranslation('notes');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { categoryId: number; name: string }) =>
      renameCategory(variables.categoryId, { name: variables.name }),
    onSuccess: (data) =>
      pushToast(
        t('toasts.categorySaved', { count: retaggedOf(data) }),
        'success',
      ),
    onError: (error) =>
      pushToast(
        t('toasts.categoryFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateNotes(queryClient),
  });
}

export function useMergeCategories() {
  const { t } = useTranslation('notes');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CategoryMergeIn) => mergeCategories(payload),
    onSuccess: (data) =>
      pushToast(
        t('toasts.categoriesMerged', { count: retaggedOf(data) }),
        'success',
      ),
    onError: (error) =>
      pushToast(
        t('toasts.categoryFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateNotes(queryClient),
  });
}

export function useDeleteCategory() {
  const { t } = useTranslation('notes');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      categoryId: number;
      to: number | 'uncategorized';
    }) => deleteCategory(variables.categoryId, variables.to),
    onSuccess: (data) =>
      pushToast(
        t('toasts.categoryDeleted', { count: retaggedOf(data) }),
        'success',
      ),
    onError: (error) => {
      // 404 on a stale id deserves a quiet refetch, not a warning —
      // the tree just changed underneath the page.
      if (!(error instanceof ApiError && error.status === 404)) {
        pushToast(
          t('toasts.categoryFailed', { detail: errorDetail(error) }),
          'warning',
        );
      }
    },
    onSettled: () => invalidateNotes(queryClient),
  });
}

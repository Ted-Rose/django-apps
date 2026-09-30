/**
 * TanStack Query mutation hooks for the dashboard's POST
 * /api/tasks/… operations. Ported from js/dashboard/task_actions.js,
 * dividers.js, autosync.js and create_task.js — the ninja operations
 * delegate to the same views, so payloads and semantics match.
 *
 * Cache strategy: star and complete/uncomplete patch every cached
 * `['dashboard', …]` query optimistically and roll back on error
 * (they are pure toggles with a known local result). Create, update,
 * archive, delete and the divider/label-processing ops invalidate the
 * dashboard queries on settle instead — the refetched DashboardOut
 * carries the authoritative state (incl. needs_push).
 *
 * The unarchive/restore/permanent-delete hooks are scaffolded ahead
 * of their UI: Stage 5's archived/trash pages call them, no component
 * imports them yet.
 */
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { apiPost } from '../shared/api/client';
import { ApiError } from '../shared/api/errors';
import type {
  DashboardOut,
  DividerCreateIn,
  DividerUpdateIn,
  MutationResult,
  TaskCreateIn,
  TaskOut,
  TaskUpdateIn,
} from './api';
import { pushToast } from './toasts';

const DASHBOARD_KEY = ['dashboard'] as const;

type Snapshots = [readonly unknown[], DashboardOut | undefined][];

function patchDashboards(
  queryClient: QueryClient,
  updater: (data: DashboardOut) => DashboardOut,
): Snapshots {
  const snapshots = queryClient.getQueriesData<DashboardOut>({
    queryKey: DASHBOARD_KEY,
  });
  queryClient.setQueriesData<DashboardOut>(
    { queryKey: DASHBOARD_KEY },
    (old) => (old ? updater(old) : old),
  );
  return snapshots;
}

function restoreDashboards(queryClient: QueryClient, snapshots?: Snapshots) {
  if (!snapshots) return;
  for (const [key, data] of snapshots) {
    queryClient.setQueryData(key, data);
  }
}

function invalidateDashboards(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
}

/**
 * Best-effort human-readable message for a failed mutation — the
 * API's uniform error shape is `{error, detail}`.
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

function mapTask(
  data: DashboardOut,
  taskId: string,
  fn: (task: TaskOut) => TaskOut,
): DashboardOut {
  const apply = (task: TaskOut) => (task.task_id === taskId ? fn(task) : task);
  return {
    ...data,
    tasks: data.tasks.map(apply),
    completed: data.completed.map(apply),
  };
}

function taskUrl(taskId: string, action: string): string {
  return `/api/tasks/task/${encodeURIComponent(taskId)}/${action}/`;
}

/** Postgres-style ordering on a nullable key (nulls last/first). */
function compareNullable(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  dir: 1 | -1,
  nullsLast: boolean,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return nullsLast ? 1 : -1;
  if (b == null) return nullsLast ? -1 : 1;
  if (a === b) return 0;
  return (a < b ? -1 : 1) * dir;
}

/**
 * Comparator reproducing the dashboard's server-side ordering of the
 * active list (views.py applies the same keys). `created` is not part
 * of TaskOut, so created_* sorts return null — callers fall back to
 * appending and the refetch on settle places the row correctly.
 */
function activeTaskComparator(
  orderBy: string,
): ((a: TaskOut, b: TaskOut) => number) | null {
  switch (orderBy) {
    case 'order_asc':
      // task_order ASC NULLS LAST, updated ASC NULLS LAST.
      return (a, b) =>
        compareNullable(a.task_order, b.task_order, 1, true) ||
        compareNullable(a.updated, b.updated, 1, true);
    case 'order_desc':
      // task_order DESC NULLS LAST, updated DESC NULLS FIRST.
      return (a, b) =>
        compareNullable(a.task_order, b.task_order, -1, true) ||
        compareNullable(a.updated, b.updated, -1, false);
    case 'completed_first':
    case 'completed_last':
      // Active tasks all have completed=null, so the effective key
      // is the `-updated` tie-break — newest first.
      return (a, b) => compareNullable(a.updated, b.updated, -1, false);
    default:
      return null;
  }
}

/**
 * Insert `task` into the active `tasks` array where `orderBy` (the
 * DashboardOut.order_by echo of ?order=) puts it. Unknown or
 * unreproducible orderings append — settle-time refetch corrects.
 */
function insertActiveTask(
  tasks: TaskOut[],
  task: TaskOut,
  orderBy: string,
): TaskOut[] {
  const cmp = activeTaskComparator(orderBy);
  if (!cmp) return [...tasks, task];
  const index = tasks.findIndex((t) => cmp(task, t) < 0);
  if (index === -1) return [...tasks, task];
  return [...tasks.slice(0, index), task, ...tasks.slice(index)];
}

/** toggleStar — flips is_starred optimistically (task_actions.js). */
export function useToggleStar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiPost<MutationResult>(taskUrl(taskId, 'toggle-star')),
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: DASHBOARD_KEY });
      const snapshots = patchDashboards(queryClient, (data) =>
        mapTask(data, taskId, (task) => ({
          ...task,
          is_starred: !task.is_starred,
        })),
      );
      return { snapshots };
    },
    onError: (error, _taskId, context) => {
      restoreDashboards(queryClient, context?.snapshots);
      pushToast(`Failed to update star: ${errorDetail(error)}`, 'warning');
    },
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/**
 * completeTask — optimistically moves the row into the completed
 * section (task_actions.js faded the card out before reloading).
 */
export function useCompleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiPost<MutationResult>(taskUrl(taskId, 'complete')),
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: DASHBOARD_KEY });
      const snapshots = patchDashboards(queryClient, (data) => {
        const task = data.tasks.find((t) => t.task_id === taskId);
        if (!task) return data;
        return {
          ...data,
          tasks: data.tasks.filter((t) => t.task_id !== taskId),
          completed: [
            {
              ...task,
              status: 'completed',
              completed: new Date().toISOString(),
            },
            ...data.completed,
          ],
        };
      });
      return { snapshots };
    },
    onError: (error, _taskId, context) => {
      restoreDashboards(queryClient, context?.snapshots);
      pushToast(`Failed to complete task: ${errorDetail(error)}`, 'warning');
    },
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/**
 * uncompleteTask — optimistic move back into the active list. The
 * server keeps the task's task_order, so the row re-enters where the
 * current ordering places it (created_* sorts append — `created` is
 * not cached — and settle-time refetch corrects).
 */
export function useUncompleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiPost<MutationResult>(taskUrl(taskId, 'uncomplete')),
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: DASHBOARD_KEY });
      const snapshots = patchDashboards(queryClient, (data) => {
        const task = data.completed.find((t) => t.task_id === taskId);
        if (!task) return data;
        const restored: TaskOut = {
          ...task,
          status: 'needsAction',
          completed: null,
          // Mirrors services.py stamping `updated` from Google's
          // response — keeps -updated tie-breaks placing it first.
          updated: new Date().toISOString(),
        };
        return {
          ...data,
          tasks: insertActiveTask(data.tasks, restored, data.order_by),
          completed: data.completed.filter((t) => t.task_id !== taskId),
        };
      });
      return { snapshots };
    },
    onError: (error, _taskId, context) => {
      restoreDashboards(queryClient, context?.snapshots);
      pushToast(`Failed to uncomplete task: ${errorDetail(error)}`, 'warning');
    },
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/** archiveTask — local-only flag; refetch removes the row. */
export function useArchiveTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiPost<MutationResult>(taskUrl(taskId, 'archive')),
    onError: (error) =>
      pushToast(`Failed to archive task: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/** deleteTask — soft delete to trash; refetch removes the row. */
export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiPost<MutationResult>(taskUrl(taskId, 'delete')),
    onError: (error) =>
      pushToast(`Failed to delete task: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/**
 * unarchiveTask — returns an archived task to the main view.
 * Wired by Stage 5's archived page; refetch moves the row.
 */
export function useUnarchiveTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiPost<MutationResult>(taskUrl(taskId, 'unarchive')),
    onError: (error) =>
      pushToast(`Failed to unarchive task: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/**
 * restoreTask — restores a trashed task (clears is_deleted, flags
 * needs_push so sync recreates it on Google). Wired by Stage 5's
 * trash page; refetch removes the row from the trash list.
 */
export function useRestoreTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiPost<MutationResult>(taskUrl(taskId, 'restore')),
    onError: (error) =>
      pushToast(`Failed to restore task: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/**
 * permanentDeleteTask — irreversible DB delete (trash page only).
 * Wired by Stage 5; refetch removes the row.
 */
export function usePermanentDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiPost<MutationResult>(taskUrl(taskId, 'permanent-delete')),
    onError: (error) =>
      pushToast(
        `Failed to permanently delete task: ${errorDetail(error)}`,
        'warning',
      ),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/** createTask (create_task.js) — title/notes/labels/starred. */
export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TaskCreateIn) =>
      apiPost<MutationResult>('/api/tasks/task/create/', payload),
    onError: (error) =>
      pushToast(`Failed to create task: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/**
 * updateTask (task_detail.html form) — title/notes/label_ids.
 * Note: the underlying view strips `notes`, so callers must send a
 * string ('' clears), never null.
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { taskId: string; payload: TaskUpdateIn }) =>
      apiPost<MutationResult>(
        taskUrl(variables.taskId, 'update'),
        variables.payload,
      ),
    onError: (error) =>
      pushToast(`Failed to update task: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/**
 * createDivider (dividers.js) — two payload branches: list pages pass
 * `{task_list_id, is_starred: false}`; the starred view passes
 * `{is_starred: true}` with NO task_list_id (the view leaves
 * task_list null and assigns starred_order = max+1). The starred
 * caller lands with Stage 5's starred page — the payload shape is
 * already valid DividerCreateIn.
 */
export function useCreateDivider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: DividerCreateIn) =>
      apiPost<MutationResult>('/api/tasks/divider/create/', payload),
    onError: (error) =>
      pushToast(`Failed to create divider: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/** updateDivider — inline rename; optimistic title patch. */
export function useUpdateDivider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { taskId: string; title: string }) =>
      apiPost<MutationResult>(
        `/api/tasks/divider/${encodeURIComponent(variables.taskId)}/update/`,
        { title: variables.title } satisfies DividerUpdateIn,
      ),
    onMutate: async ({ taskId, title }) => {
      await queryClient.cancelQueries({ queryKey: DASHBOARD_KEY });
      const snapshots = patchDashboards(queryClient, (data) =>
        mapTask(data, taskId, (task) => ({ ...task, title })),
      );
      return { snapshots };
    },
    onError: (error, _vars, context) => {
      restoreDashboards(queryClient, context?.snapshots);
      pushToast(`Failed to update divider: ${errorDetail(error)}`, 'warning');
    },
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/** deleteDivider — refetch removes the row. */
export function useDeleteDivider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiPost<MutationResult>(
        `/api/tasks/divider/${encodeURIComponent(taskId)}/delete/`,
      ),
    onError: (error) =>
      pushToast(`Failed to delete divider: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/**
 * sync (autosync.js "Sync Now") — failure reports via the shared
 * toast store like every other mutation; the caller keeps rendering
 * `isPending` for the in-progress state.
 */
export function useSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<MutationResult>('/api/tasks/sync/'),
    onError: (error) =>
      pushToast(`Sync failed: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

/**
 * processLabels (autosync.js) — bulk hashtag scan; the template
 * alerted the stats, here they become a success toast.
 */
export function useProcessLabels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<MutationResult>('/api/tasks/process-labels/'),
    onSuccess: (data) => {
      if (data?.stats) {
        const stats = data.stats;
        pushToast(
          `Label processing complete — processed: ${stats.processed}, ` +
            `moved: ${stats.moved}, starred: ${stats.starred}, ` +
            `errors: ${stats.errors ?? 0}`,
          'success',
        );
      }
    },
    onError: (error) =>
      pushToast(`Error processing labels: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateDashboards(queryClient),
  });
}

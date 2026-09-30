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

/** uncompleteTask — optimistic move back into the active list. */
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
        return {
          ...data,
          tasks: [
            { ...task, status: 'needsAction', completed: null },
            ...data.tasks,
          ],
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

/** createDivider (dividers.js) — needs a task_list_id (or starred). */
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

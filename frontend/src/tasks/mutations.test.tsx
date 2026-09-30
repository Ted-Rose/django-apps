import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useCreateDivider,
  usePermanentDeleteTask,
  useReorderTasks,
  useRestoreTask,
  useSync,
  useUnarchiveTask,
  useUncompleteTask,
} from './mutations';
import { apiPost } from '../shared/api/client';
import { ApiError } from '../shared/api/errors';
import { clearToasts, useToasts } from './toasts';
import type { DashboardOut, TaskOut } from './api';

vi.mock('../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiPost = vi.mocked(apiPost);

function makeTask(overrides: Partial<TaskOut> = {}): TaskOut {
  return {
    task_id: 'task-1',
    title: 'Buy milk',
    notes: null,
    status: 'needsAction',
    due: null,
    completed: null,
    updated: '2026-09-01T10:00:00Z',
    position: null,
    task_list: null,
    is_starred: false,
    is_divider: false,
    task_order: 5,
    starred_order: null,
    labels: [],
    is_archived: false,
    is_deleted: false,
    needs_push: false,
    ...overrides,
  };
}

function makeDashboard(overrides: Partial<DashboardOut> = {}): DashboardOut {
  return {
    tasks: [],
    completed: [],
    task_lists: [],
    labels: [],
    order_by: 'order_asc',
    flags: {
      has_credentials: true,
      is_starred_view: false,
      is_overdue_view: false,
      is_archived_view: false,
      is_trash_view: false,
    },
    ...overrides,
  };
}

const DASHBOARD_PARAMS = { list: null, label: null, order: 'order_asc' };

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function makeQueryClient(dashboard?: DashboardOut) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  if (dashboard) {
    queryClient.setQueryData(['dashboard', DASHBOARD_PARAMS], dashboard);
  }
  return queryClient;
}

function getDashboard(queryClient: QueryClient): DashboardOut {
  return queryClient.getQueryData(['dashboard', DASHBOARD_PARAMS])!;
}

function taskIds(queryClient: QueryClient): string[] {
  return getDashboard(queryClient).tasks.map((t) => t.task_id);
}

beforeEach(() => {
  mockedApiPost.mockReset();
  clearToasts();
});

describe('restore-family hooks (Stage 5 scaffolding)', () => {
  it('useUnarchiveTask posts to the unarchive endpoint', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 't1' });
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useUnarchiveTask(), {
      wrapper: makeWrapper(queryClient),
    });
    await act(() => result.current.mutateAsync('t1'));
    expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/task/t1/unarchive/');
  });

  it('useRestoreTask posts to the restore endpoint', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 't1' });
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useRestoreTask(), {
      wrapper: makeWrapper(queryClient),
    });
    await act(() => result.current.mutateAsync('t1'));
    expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/task/t1/restore/');
  });

  it('usePermanentDeleteTask posts to the permanent-delete endpoint', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 't1' });
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => usePermanentDeleteTask(), {
      wrapper: makeWrapper(queryClient),
    });
    await act(() => result.current.mutateAsync('t1'));
    expect(mockedApiPost).toHaveBeenCalledWith(
      '/api/tasks/task/t1/permanent-delete/',
    );
  });

  it('toasts a warning when the mutation fails', async () => {
    mockedApiPost.mockRejectedValue(
      new ApiError('Server error', 500, '', { detail: 'boom' }),
    );
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useRestoreTask(), {
      wrapper: makeWrapper(queryClient),
    });
    const toasts = renderHook(() => useToasts());
    await act(() => result.current.mutateAsync('t1').catch(() => undefined));
    await waitFor(() =>
      expect(
        toasts.result.current.some(
          (t) => t.kind === 'warning' && t.text.includes('restore'),
        ),
      ).toBe(true),
    );
  });
});

describe('useCreateDivider', () => {
  it('posts a list divider payload', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 'div-1' });
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useCreateDivider(), {
      wrapper: makeWrapper(queryClient),
    });
    await act(() =>
      result.current.mutateAsync({ task_list_id: 'list-1', is_starred: false }),
    );
    expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/divider/create/', {
      task_list_id: 'list-1',
      is_starred: false,
    });
  });

  it('posts the starred-view branch: is_starred only, no task_list_id', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 'div-2' });
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useCreateDivider(), {
      wrapper: makeWrapper(queryClient),
    });
    await act(() => result.current.mutateAsync({ is_starred: true }));
    expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/divider/create/', {
      is_starred: true,
    });
  });
});

describe('useSync', () => {
  it('posts to the sync endpoint', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useSync(), {
      wrapper: makeWrapper(queryClient),
    });
    await act(() => result.current.mutateAsync());
    expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/sync/');
  });

  it('reports failures through the toast store', async () => {
    mockedApiPost.mockRejectedValue(
      new ApiError('Server error', 500, '', { detail: 'backend down' }),
    );
    const queryClient = makeQueryClient();
    const { result } = renderHook(() => useSync(), {
      wrapper: makeWrapper(queryClient),
    });
    const toasts = renderHook(() => useToasts());
    await act(() => result.current.mutateAsync().catch(() => undefined));
    await waitFor(() =>
      expect(toasts.result.current.length).toBeGreaterThan(0),
    );
    const toast = toasts.result.current[0];
    expect(toast.kind).toBe('warning');
    expect(toast.text).toContain('Sync failed');
    expect(toast.text).toContain('backend down');
  });
});

describe('useUncompleteTask optimistic insert', () => {
  function mountUncomplete(dashboard: DashboardOut) {
    // Keep the POST in flight so the optimistic state stays visible.
    mockedApiPost.mockReturnValue(new Promise(() => {}));
    const queryClient = makeQueryClient(dashboard);
    const hook = renderHook(() => useUncompleteTask(), {
      wrapper: makeWrapper(queryClient),
    });
    return { queryClient, result: hook.result };
  }

  function completedTask(taskOrder: number | null): TaskOut {
    return makeTask({
      task_id: 'done',
      title: 'Done task',
      status: 'completed',
      completed: '2026-09-02T10:00:00Z',
      task_order: taskOrder,
    });
  }

  it('inserts by task_order for order_asc instead of unshifting', async () => {
    const { queryClient, result } = mountUncomplete(
      makeDashboard({
        tasks: [
          makeTask({ task_id: 'a', task_order: 1 }),
          makeTask({ task_id: 'b', task_order: 7 }),
        ],
        completed: [completedTask(3)],
      }),
    );
    await act(async () => {
      result.current.mutate('done');
    });
    await waitFor(() =>
      expect(taskIds(queryClient)).toEqual(['a', 'done', 'b']),
    );
    const restored = getDashboard(queryClient).tasks[1];
    expect(restored.status).toBe('needsAction');
    expect(restored.completed).toBeNull();
    expect(getDashboard(queryClient).completed).toEqual([]);
  });

  it('inserts by task_order for order_desc', async () => {
    const { queryClient, result } = mountUncomplete(
      makeDashboard({
        order_by: 'order_desc',
        tasks: [
          makeTask({ task_id: 'b', task_order: 7 }),
          makeTask({ task_id: 'a', task_order: 1 }),
        ],
        completed: [completedTask(4)],
      }),
    );
    await act(async () => {
      result.current.mutate('done');
    });
    await waitFor(() =>
      expect(taskIds(queryClient)).toEqual(['b', 'done', 'a']),
    );
  });

  it('tops the list for completed_last (updated=now wins -updated)', async () => {
    const { queryClient, result } = mountUncomplete(
      makeDashboard({
        order_by: 'completed_last',
        tasks: [
          makeTask({ task_id: 'a', updated: '2026-09-01T10:00:00Z' }),
          makeTask({ task_id: 'b', updated: '2026-08-01T10:00:00Z' }),
        ],
        completed: [completedTask(null)],
      }),
    );
    await act(async () => {
      result.current.mutate('done');
    });
    await waitFor(() =>
      expect(getDashboard(queryClient).tasks[0].task_id).toBe('done'),
    );
  });

  it('appends when the ordering needs fields not in the cache (created_*)', async () => {
    const { queryClient, result } = mountUncomplete(
      makeDashboard({
        order_by: 'created_desc',
        tasks: [makeTask({ task_id: 'a' }), makeTask({ task_id: 'b' })],
        completed: [completedTask(null)],
      }),
    );
    await act(async () => {
      result.current.mutate('done');
    });
    await waitFor(() =>
      expect(taskIds(queryClient)).toEqual(['a', 'b', 'done']),
    );
  });
});

describe('useReorderTasks', () => {
  const dashParams = { list: 'list-1', label: null, order: 'order_asc' };

  function mountReorder(dashboard: DashboardOut) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(['dashboard', dashParams], dashboard);
    const hook = renderHook(() => useReorderTasks(), {
      wrapper: makeWrapper(queryClient),
    });
    return { queryClient, result: hook.result };
  }

  it('posts the single midpoint update to the dashboard endpoint', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    const { result } = mountReorder(makeDashboard());
    await act(() =>
      result.current.mutateAsync({
        updates: [{ task_id: 'a', position: 2.5 }],
        starredView: false,
        taskListId: 'list-1',
      }),
    );
    expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/tasks/reorder/', {
      updates: [{ task_id: 'a', position: 2.5 }],
      task_list_id: 'list-1',
    });
  });

  it('uses the starred endpoint and drops task_list_id in the starred view', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    const { result } = mountReorder(makeDashboard());
    await act(() =>
      result.current.mutateAsync({
        updates: [{ task_id: 'a', position: 1 }],
        starredView: true,
        taskListId: 'list-1',
      }),
    );
    expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/starred/reorder/', {
      updates: [{ task_id: 'a', position: 1 }],
    });
  });

  it('optimistically reorders the cached task list', async () => {
    // Keep the POST in flight so the optimistic order stays visible.
    mockedApiPost.mockReturnValue(new Promise(() => {}));
    const { queryClient, result } = mountReorder(
      makeDashboard({
        tasks: [
          makeTask({ task_id: 'a', task_order: 1 }),
          makeTask({ task_id: 'b', task_order: 2 }),
          makeTask({ task_id: 'c', task_order: 3 }),
        ],
      }),
    );
    await act(async () => {
      result.current.mutate({
        updates: [{ task_id: 'c', position: 0.5 }],
        order: ['c', 'a', 'b'],
        positions: { c: 0.5 },
        starredView: false,
      });
    });
    const cached = queryClient.getQueryData<DashboardOut>([
      'dashboard',
      dashParams,
    ])!;
    expect(cached.tasks.map((t) => t.task_id)).toEqual(['c', 'a', 'b']);
    expect(cached.tasks[0].task_order).toBe(0.5);
  });

  it('rolls back and toasts on failure', async () => {
    mockedApiPost.mockRejectedValue(
      new ApiError('Server error', 500, '', { detail: 'nope' }),
    );
    const { queryClient, result } = mountReorder(
      makeDashboard({
        tasks: [makeTask({ task_id: 'a' }), makeTask({ task_id: 'b' })],
      }),
    );
    const toasts = renderHook(() => useToasts());
    await act(() =>
      result.current
        .mutateAsync({
          updates: [{ task_id: 'b', position: 0 }],
          order: ['b', 'a'],
          starredView: false,
        })
        .catch(() => undefined),
    );
    const cached = queryClient.getQueryData<DashboardOut>([
      'dashboard',
      dashParams,
    ])!;
    expect(cached.tasks.map((t) => t.task_id)).toEqual(['a', 'b']);
    await waitFor(() =>
      expect(
        toasts.result.current.some(
          (t) => t.kind === 'warning' && t.text.includes('task order'),
        ),
      ).toBe(true),
    );
  });

  it('treats a 409 position_conflict as a refresh, not a failure toast', async () => {
    mockedApiPost.mockRejectedValue(
      new ApiError('Conflict', 409, '', { error: 'position_conflict' }),
    );
    const { result } = mountReorder(makeDashboard());
    const toasts = renderHook(() => useToasts());
    await act(() =>
      result.current
        .mutateAsync({
          updates: [{ task_id: 'b', position: 0 }],
          starredView: false,
        })
        .catch(() => undefined),
    );
    await waitFor(() =>
      expect(
        toasts.result.current.some((t) => t.text.includes('conflicted')),
      ).toBe(true),
    );
  });
});

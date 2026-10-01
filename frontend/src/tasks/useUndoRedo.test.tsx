import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionHistory, resetActionHistory } from './actionHistory';
import useUndoRedo from './useUndoRedo';
import { apiPost } from '../shared/api/client';
import { clearToasts } from '../shared/toasts';
import type { DashboardOut, TaskOut } from './api';

vi.mock('../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiPost = vi.mocked(apiPost);

function makeTask(id: string, taskOrder: number | null = null): TaskOut {
  return {
    task_id: id,
    title: `Task ${id}`,
    status: 'needsAction',
    is_starred: false,
    is_divider: false,
    labels: [],
    is_archived: false,
    is_deleted: false,
    needs_push: false,
    task_order: taskOrder,
  } as TaskOut;
}

const DASHBOARD_PARAMS = { list: 'list-1', label: null, order: 'order_asc' };

function makeDashboard(tasks: TaskOut[]): DashboardOut {
  return {
    tasks,
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
  } as DashboardOut;
}

function setup(tasks: TaskOut[], taskListId: string | null = 'list-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(['dashboard', DASHBOARD_PARAMS], {
    ...makeDashboard(tasks),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useUndoRedo({ tasks, starredView: false, taskListId }),
    { wrapper },
  );
  return { queryClient, hook };
}

beforeEach(() => {
  mockedApiPost.mockReset();
  mockedApiPost.mockResolvedValue({ success: true });
  clearToasts();
  resetActionHistory();
});

describe('useUndoRedo REORDER dispatch', () => {
  it('undo of a reorder posts the previous order as sequential positions', async () => {
    const tasks = [makeTask('a', 1), makeTask('b', 2), makeTask('c', 3)];
    const { hook } = setup(tasks);

    actionHistory.recordAction({
      type: 'REORDER_TASKS',
      previousOrder: ['a', 'b', 'c'],
      newOrder: ['c', 'a', 'b'],
    });

    await act(async () => {
      hook.result.current.undo();
    });

    expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/tasks/reorder/', {
      updates: [
        { task_id: 'a', position: 1 },
        { task_id: 'b', position: 2 },
        { task_id: 'c', position: 3 },
      ],
      task_list_id: 'list-1',
    });
  });

  it('redo of a reorder posts the new order', async () => {
    const tasks = [makeTask('a', 1), makeTask('b', 2)];
    const { hook } = setup(tasks);

    actionHistory.recordAction({
      type: 'REORDER_TASKS',
      previousOrder: ['a', 'b'],
      newOrder: ['b', 'a'],
    });
    await act(async () => {
      hook.result.current.undo();
    });
    mockedApiPost.mockClear();
    await act(async () => {
      hook.result.current.redo();
    });

    expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/tasks/reorder/', {
      updates: [
        { task_id: 'b', position: 1 },
        { task_id: 'a', position: 2 },
      ],
      task_list_id: 'list-1',
    });
  });

  it('skips snapshot ids that no longer exist in the cache', async () => {
    const tasks = [makeTask('a', 1), makeTask('b', 2)];
    const { hook } = setup(tasks, null);

    actionHistory.recordAction({
      type: 'REORDER_TASKS',
      previousOrder: ['a', 'deleted-task', 'b'],
      newOrder: ['b', 'a', 'deleted-task'],
    });
    await act(async () => {
      hook.result.current.undo();
    });

    expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/tasks/reorder/', {
      updates: [
        { task_id: 'a', position: 1 },
        { task_id: 'b', position: 2 },
      ],
    });
  });

  it('undo of a star re-posts toggle-star', async () => {
    const { hook } = setup([makeTask('a')]);
    actionHistory.recordAction({
      type: 'TOGGLE_STAR',
      taskId: 'a',
      previousState: false,
    });
    await act(async () => {
      hook.result.current.undo();
    });
    expect(mockedApiPost).toHaveBeenCalledWith(
      '/api/tasks/task/a/toggle-star/',
    );
  });

  it('undo of an archive re-records it instead of calling the API', async () => {
    const { hook } = setup([makeTask('a')]);
    actionHistory.recordAction({
      type: 'ARCHIVE_TASK',
      taskId: 'a',
      taskTitle: 'Task a',
    });
    await act(async () => {
      hook.result.current.undo();
    });
    expect(mockedApiPost).not.toHaveBeenCalled();
    // The action is re-recorded (old performUndo pushed it back).
    expect(actionHistory.canUndo()).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Trash from './Trash';
import { apiGet, apiPost } from '../../shared/api/client';
import { resetActionHistory } from '../actionHistory';
import { clearToasts } from '../../shared/toasts';
import type { DashboardOut, TaskOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

function makeTask(overrides: Partial<TaskOut> = {}): TaskOut {
  return {
    task_id: 'task-1',
    title: 'Trashed task',
    status: 'needsAction',
    is_starred: false,
    is_divider: false,
    labels: [],
    is_archived: false,
    is_deleted: true,
    needs_push: false,
    deleted_at: '2026-09-20T10:00:00Z',
    ...overrides,
  };
}

function makeDashboard(overrides: Partial<DashboardOut> = {}): DashboardOut {
  return {
    tasks: [],
    completed: [],
    task_lists: [],
    labels: [],
    order_by: 'deleted_desc',
    flags: {
      has_credentials: true,
      is_starred_view: false,
      is_overdue_view: false,
      is_archived_view: false,
      is_trash_view: true,
    },
    ...overrides,
  };
}

function renderTrash(initialEntry = '/trash') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Trash />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
  resetActionHistory();
  localStorage.setItem('lastPageLoad', String(Date.now()));
});

describe('Trash', () => {
  it('fetches /api/tasks/trash/ ordered by deleted_at', async () => {
    mockedApiGet.mockResolvedValue(makeDashboard());
    renderTrash();
    await screen.findByText('Trash is empty.');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/trash/?order=deleted_desc',
    );
  });

  it('shows the 30-day purge warning and the deleted date', async () => {
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [makeTask({ task_id: 'a', title: 'Do not need' })],
      }),
    );
    renderTrash();
    expect(
      await screen.findByText(/automatically\s+deleted after 30 days/),
    ).toBeInTheDocument();
    expect(await screen.findByText('Do not need')).toBeInTheDocument();
    expect(screen.getByText(/Deleted: Sep 20, 2026/)).toBeInTheDocument();
  });

  it('posts restore when Restore is clicked', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [makeTask({ task_id: 'a', title: 'Bring back' })],
      }),
    );
    renderTrash();
    await screen.findByText('Bring back');
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/task/a/restore/'),
    );
  });

  it('gates permanent deletion behind the confirm modal', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [makeTask({ task_id: 'a', title: 'Gone for good' })],
      }),
    );
    renderTrash();
    await screen.findByText('Gone for good');
    // Card button only opens the modal — nothing posts yet.
    fireEvent.click(
      screen.getAllByRole('button', { name: /Delete Forever/ })[0],
    );
    expect(
      await screen.findByText('Permanently Delete Task'),
    ).toBeInTheDocument();
    expect(mockedApiPost).not.toHaveBeenCalled();
    const confirm = document.querySelector(
      '.modal-footer .btn-danger',
    ) as HTMLButtonElement;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/a/permanent-delete/',
      ),
    );
  });
});

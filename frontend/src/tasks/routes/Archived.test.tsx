import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Archived from './Archived';
import { apiGet, apiPost } from '../../shared/api/client';
import { resetActionHistory } from '../actionHistory';
import { clearToasts } from '../toasts';
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
    title: 'Archived task',
    status: 'needsAction',
    is_starred: false,
    is_divider: false,
    labels: [],
    is_archived: true,
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
      is_archived_view: true,
      is_trash_view: false,
    },
    ...overrides,
  };
}

function renderArchived(initialEntry = '/archived') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Archived />
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

describe('Archived', () => {
  it('fetches /api/tasks/archived/', async () => {
    mockedApiGet.mockResolvedValue(makeDashboard());
    renderArchived();
    await screen.findByText('No archived tasks.');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/archived/?order=order_asc',
    );
  });

  it('renders archived tasks with an Unarchive action', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [makeTask({ task_id: 'a', title: 'Old project' })],
      }),
    );
    renderArchived();
    expect(await screen.findByText('Old project')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Unarchive/ }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/a/unarchive/',
      ),
    );
  });

  it('lists completed archived tasks behind the collapse', async () => {
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        completed: [
          makeTask({
            task_id: 'c',
            title: 'Finished old thing',
            status: 'completed',
          }),
        ],
      }),
    );
    renderArchived();
    const toggle = await screen.findByRole('button', {
      name: /Completed archived tasks \(1\)/,
    });
    fireEvent.click(toggle);
    expect(await screen.findByText('Finished old thing')).toBeInTheDocument();
  });

  it('filters tasks client-side by secondary_label', async () => {
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [
          makeTask({
            task_id: 'a',
            title: 'Tagged archived',
            labels: [{ id: 1, name: 'home' }],
          }),
          makeTask({ task_id: 'b', title: 'Untagged archived' }),
        ],
        labels: [{ id: 1, name: 'home', color: '#f00' }],
      }),
    );
    renderArchived('/archived?secondary_label=home');
    expect(await screen.findByText('Tagged archived')).toBeInTheDocument();
    expect(screen.queryByText('Untagged archived')).not.toBeInTheDocument();
    // secondary_label stays client-side — never sent to the API.
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/archived/?order=order_asc',
    );
  });
});

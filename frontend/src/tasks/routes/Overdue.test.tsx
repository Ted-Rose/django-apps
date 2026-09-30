import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Overdue from './Overdue';
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
    title: 'Late task',
    status: 'needsAction',
    is_starred: false,
    is_divider: false,
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
      is_overdue_view: true,
      is_archived_view: false,
      is_trash_view: false,
    },
    ...overrides,
  };
}

function renderOverdue(initialEntry = '/overdue') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Overdue />
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

describe('Overdue', () => {
  it('fetches /api/tasks/overdue/', async () => {
    mockedApiGet.mockResolvedValue(makeDashboard());
    renderOverdue();
    await screen.findByText('No tasks found');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/overdue/?order=order_asc',
    );
  });

  it('renders overdue tasks', async () => {
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [makeTask({ task_id: 'a', title: 'Overdue chore' })],
      }),
    );
    renderOverdue();
    expect(await screen.findByText('Overdue chore')).toBeInTheDocument();
  });

  it('does not send ?list= to the overdue endpoint', async () => {
    // filters.js bounces list picks back to the dashboard — the
    // overdue URL can't carry a list filter.
    mockedApiGet.mockResolvedValue(makeDashboard());
    renderOverdue('/overdue?list=list-1');
    await screen.findByText('No tasks found');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/overdue/?order=order_asc',
    );
  });

  it('posts reorders to the shared tasks endpoint (task_order)', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [
          makeTask({ task_id: 'a', title: 'First', task_order: 1 }),
          makeTask({ task_id: 'b', title: 'Second', task_order: 2 }),
        ],
      }),
    );
    renderOverdue();
    await screen.findByText('First');
    fireEvent.click(document.querySelectorAll('.order-btn')[0]);
    const menu = document.querySelector('.dropdown-menu.show')!;
    const preset = [...menu.querySelectorAll('.dropdown-item')].find(
      (item) => item.textContent === '5',
    )!;
    fireEvent.click(preset);
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/tasks/reorder/', {
        updates: [{ task_id: 'a', position: 3 }],
      }),
    );
  });
});

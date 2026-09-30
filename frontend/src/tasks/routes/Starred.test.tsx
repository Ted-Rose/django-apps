import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Starred from './Starred';
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
    title: 'Starred task',
    status: 'needsAction',
    is_starred: true,
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
      is_starred_view: true,
      is_overdue_view: false,
      is_archived_view: false,
      is_trash_view: false,
    },
    ...overrides,
  };
}

function renderStarred(initialEntry = '/starred') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Starred />
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

describe('Starred', () => {
  it('fetches /api/tasks/starred/', async () => {
    mockedApiGet.mockResolvedValue(makeDashboard());
    renderStarred();
    await screen.findByText('No starred tasks yet');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/starred/?order=order_asc',
    );
  });

  it('renders the starred task list', async () => {
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [
          makeTask({ task_id: 'a', title: 'Pinned chore', starred_order: 1 }),
        ],
      }),
    );
    renderStarred();
    expect(await screen.findByText('Pinned chore')).toBeInTheDocument();
  });

  it('posts starred_order updates to /api/tasks/starred/reorder/', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [
          makeTask({ task_id: 'a', title: 'First', starred_order: 1 }),
          makeTask({ task_id: 'b', title: 'Second', starred_order: 2 }),
        ],
      }),
    );
    renderStarred();
    await screen.findByText('First');
    // Order-badge dropdown on the first card → preset rank 5 clamps to
    // the bottom (task_actions.js setTaskOrder).
    const orderButtons = document.querySelectorAll('.order-btn');
    fireEvent.click(orderButtons[0]);
    const menu = document.querySelector('.dropdown-menu.show')!;
    const preset = [...menu.querySelectorAll('.dropdown-item')].find(
      (item) => item.textContent === '5',
    )!;
    fireEvent.click(preset);
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/starred/reorder/',
        { updates: [{ task_id: 'a', position: 3 }] },
      ),
    );
  });

  it('posts divider/create with {is_starred: true} and no list', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 'div-1' });
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        task_lists: [{ list_id: 'list-1', title: 'Groceries' }],
      }),
    );
    renderStarred();
    await screen.findByText('No starred tasks yet');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    fireEvent.click(screen.getByRole('button', { name: /Add Divider/ }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/divider/create/', {
        is_starred: true,
      }),
    );
  });
});

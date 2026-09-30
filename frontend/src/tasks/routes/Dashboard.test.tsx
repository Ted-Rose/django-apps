import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './Dashboard';
import { apiGet } from '../../shared/api/client';
import type { DashboardOut, TaskOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);

function makeTask(overrides: Partial<TaskOut> = {}): TaskOut {
  return {
    task_id: 'task-1',
    title: 'Buy milk',
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
      is_overdue_view: false,
      is_archived_view: false,
      is_trash_view: false,
    },
    ...overrides,
  };
}

function renderDashboard(initialEntry = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
});

describe('Dashboard', () => {
  it('fetches /api/tasks/dashboard/ with the filter params', async () => {
    mockedApiGet.mockResolvedValue(makeDashboard());
    renderDashboard('/?list=list-1&order=due_desc');
    await screen.findByText('No tasks found');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/dashboard/?list=list-1&order=due_desc',
    );
  });

  it('renders tasks, dividers and the completed section', async () => {
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [
          makeTask({ task_id: 'a', title: 'Active task' }),
          makeTask({ task_id: 'd', title: 'Later', is_divider: true }),
        ],
        completed: [makeTask({ task_id: 'c', title: 'Old done' })],
      }),
    );
    renderDashboard();
    expect(await screen.findByText('Active task')).toBeInTheDocument();
    expect(document.querySelector('.divider-card')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /Completed tasks \(1\)/ }),
    ).toBeInTheDocument();
  });

  it('filters tasks client-side by secondary_label', async () => {
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [
          makeTask({
            task_id: 'a',
            title: 'Tagged',
            labels: [{ id: 1, name: 'home' }],
          }),
          makeTask({ task_id: 'b', title: 'Untagged' }),
        ],
        labels: [{ id: 1, name: 'home', color: '#f00' }],
      }),
    );
    renderDashboard('/?secondary_label=home');
    expect(await screen.findByText('Tagged')).toBeInTheDocument();
    expect(screen.queryByText('Untagged')).not.toBeInTheDocument();
    // secondary_label is never sent to the API.
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/dashboard/?order=order_asc',
    );
  });

  it('shows the connect-Google prompt without credentials', async () => {
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        flags: { ...makeDashboard().flags, has_credentials: false },
      }),
    );
    renderDashboard();
    expect(
      await screen.findByText('Google Authentication Required'),
    ).toBeInTheDocument();
    // One in the empty-state alert, one in the burger menu.
    const loginLinks = screen.getAllByRole('link', {
      name: /Login with Google/,
    });
    expect(
      loginLinks.some((l) => l.getAttribute('href')?.includes('/login/?next=')),
    ).toBe(true);
  });
});

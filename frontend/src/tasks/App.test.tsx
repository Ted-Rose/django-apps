import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { apiGet, apiPost } from '../shared/api/client';
import { resetActionHistory } from './actionHistory';
import { clearToasts } from '../shared/toasts';
import type { DashboardOut } from './api';

vi.mock('../shared/components/RichTextEditor', async () => ({
  default: (await import('../test/RichTextEditorStub')).default,
}));

vi.mock('../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

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

function renderApp(initialEntry = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
  resetActionHistory();
  localStorage.clear();
  localStorage.setItem('lastPageLoad', String(Date.now()));
  mockedApiGet.mockResolvedValue(makeDashboard());
});

describe('App relaunch restore', () => {
  it('restores a stored section on a bare-/ landing', async () => {
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        flags: { ...makeDashboard().flags, is_starred_view: true },
      }),
    );
    localStorage.setItem('lastTasksView', '/tasks/starred');
    renderApp('/');
    const empty = await screen.findByText('No starred tasks yet');
    expect(empty).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/starred/?order=order_asc',
    );
    expect(mockedApiGet).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/dashboard/'),
    );
  });

  it('restores stored dashboard filters (/tasks/?list=…)', async () => {
    localStorage.setItem('lastTasksView', '/tasks/?list=list-1');
    renderApp('/');
    await screen.findByText('No tasks found');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/dashboard/?list=list-1&order=order_asc',
    );
  });

  it('renders the dashboard when nothing is stored', async () => {
    renderApp('/');
    await screen.findByText('No tasks found');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/dashboard/?order=order_asc',
    );
  });

  it('renders the dashboard for a stored path outside the SPA', async () => {
    localStorage.setItem('lastTasksView', '/finance/accounts');
    renderApp('/');
    await screen.findByText('No tasks found');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/dashboard/?order=order_asc',
    );
  });

  it('does not hijack a direct section link', async () => {
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        flags: { ...makeDashboard().flags, is_trash_view: true },
      }),
    );
    localStorage.setItem('lastTasksView', '/tasks/starred');
    renderApp('/trash');
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/tasks/trash/?order=deleted_desc',
      ),
    );
    expect(mockedApiGet).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/starred/'),
    );
  });

  it('does not hijack a filtered dashboard link', async () => {
    localStorage.setItem('lastTasksView', '/tasks/starred');
    renderApp('/?list=list-2');
    await screen.findByText('No tasks found');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/dashboard/?list=list-2&order=order_asc',
    );
    expect(mockedApiGet).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/starred/'),
    );
  });
});

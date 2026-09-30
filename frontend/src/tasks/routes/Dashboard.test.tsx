import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './Dashboard';
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
  mockedApiPost.mockReset();
  clearToasts();
  resetActionHistory();
  // Keep autosync quiet: a fresh lastPageLoad makes the mount-time
  // stale check skip the initial sync (autosync.js port).
  localStorage.setItem('lastPageLoad', String(Date.now()));
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

  it('keeps original order badges and dividers under secondary_label', async () => {
    // The template renders forloop.counter and selectSecondaryLabel
    // only hides rows without renumbering; divider cards are not
    // .task-container and stay visible.
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        tasks: [
          makeTask({
            task_id: 'a',
            title: 'First',
            labels: [{ id: 1, name: 'home' }],
          }),
          makeTask({ task_id: 'd', title: 'Section', is_divider: true }),
          makeTask({ task_id: 'b', title: 'Hidden' }),
          makeTask({
            task_id: 'c',
            title: 'Third',
            labels: [{ id: 1, name: 'home' }],
          }),
        ],
        labels: [{ id: 1, name: 'home', color: '#f00' }],
      }),
    );
    renderDashboard('/?secondary_label=home');
    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(document.querySelector('.divider-card')).not.toBeNull();
    const badges = [...document.querySelectorAll('.order-btn')].map(
      (btn) => btn.textContent,
    );
    expect(badges).toEqual(['1', '4']);
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

  it('flips the star optimistically and posts toggle-star', async () => {
    // Keep the mutation in flight so the optimistic state stays.
    mockedApiPost.mockReturnValue(new Promise(() => {}));
    mockedApiGet.mockResolvedValue(
      makeDashboard({ tasks: [makeTask({ task_id: 'a', title: 'Star me' })] }),
    );
    const { container } = renderDashboard();
    const starBtn = (await screen.findByText('Star me'))
      .closest('.task-container')!
      .querySelector('.star-btn')!;
    expect(starBtn).not.toHaveClass('starred');
    fireEvent.click(starBtn);
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/a/toggle-star/',
      ),
    );
    // Optimistic cache patch flips the icon before the server replies.
    expect(container.querySelector('.star-btn')).toHaveClass('starred');
    expect(container.querySelector('.bi-star-fill')).not.toBeNull();
  });

  it('creates a task from the floating + button modal', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 'new-1' });
    mockedApiGet.mockResolvedValue(makeDashboard());
    renderDashboard('/?list=list-1');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create new task' }),
    );
    expect(await screen.findByText('Create New Task')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'New chore' },
    });
    fireEvent.change(screen.getByLabelText(/Notes/), {
      target: { value: 'soon' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/task/create/', {
        title: 'New chore',
        notes: 'soon',
        is_starred: false,
        task_list_id: 'list-1',
        label_ids: [],
      }),
    );
  });

  it('warns instead of submitting a blank task title', async () => {
    mockedApiGet.mockResolvedValue(makeDashboard());
    renderDashboard();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create new task' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(
      await screen.findByText('Please enter a task title'),
    ).toBeInTheDocument();
    expect(mockedApiPost).not.toHaveBeenCalled();
  });

  it('posts divider/create for the Add Divider burger item', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 'div-1' });
    mockedApiGet.mockResolvedValue(
      makeDashboard({
        task_lists: [{ list_id: 'list-1', title: 'Groceries' }],
      }),
    );
    renderDashboard();
    await screen.findByText('No tasks found');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    fireEvent.click(screen.getByRole('button', { name: /Add Divider/ }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/divider/create/', {
        task_list_id: 'list-1',
        is_starred: false,
      }),
    );
  });

  it('posts process-labels and shows the stats toast', async () => {
    mockedApiPost.mockResolvedValue({
      success: true,
      stats: { processed: 3, moved: 1, starred: 1, errors: 0 },
    });
    mockedApiGet.mockResolvedValue(makeDashboard());
    renderDashboard();
    await screen.findByText('No tasks found');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    fireEvent.click(screen.getByRole('button', { name: /Process Labels/ }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/tasks/process-labels/'),
    );
    expect(
      await screen.findByText(/processed: 3, moved: 1/),
    ).toBeInTheDocument();
  });
});

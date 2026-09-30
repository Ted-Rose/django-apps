import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskCard } from './TaskCard';
import DividerCard from './DividerCard';
import { apiPost } from '../../shared/api/client';
import { resetActionHistory } from '../actionHistory';
import { clearToasts } from '../toasts';
import type { TaskOut } from '../api';

vi.mock('../../shared/api/client', () => ({
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

const labelColors = new Map([['home', '#ff0000']]);

function withQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderCard(task: TaskOut) {
  return render(
    <MemoryRouter>
      {withQueryClient(
        <TaskCard task={task} position={3} labelColors={labelColors} />,
      )}
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiPost.mockReset();
  clearToasts();
  resetActionHistory();
});

describe('TaskCard', () => {
  it('renders title, order badge and a link to the task detail', () => {
    renderCard(makeTask());
    expect(screen.getByRole('link', { name: 'Buy milk' })).toHaveAttribute(
      'href',
      '/task/task-1',
    );
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
    expect(document.querySelector('.task-container')).toHaveAttribute(
      'data-task-id',
      'task-1',
    );
  });

  it('renders notes truncated to 20 words, due date and label chips', () => {
    const notes = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ');
    renderCard(
      makeTask({
        notes,
        due: '2026-10-05',
        labels: [{ id: 7, name: 'home' }],
        task_list: { list_id: 'l1', title: 'Groceries' },
      }),
    );
    const notesEl = screen.getByText(/w0/);
    expect(notesEl.textContent).toContain('…');
    expect(notesEl.textContent!.split(' ').length).toBeLessThanOrEqual(21);
    expect(screen.getByText(/Due: Oct 5, 2026/)).toBeInTheDocument();
    expect(screen.getByText('home')).toHaveStyle({
      backgroundColor: 'rgb(255, 0, 0)',
    });
    expect(screen.getByText('Groceries')).toBeInTheDocument();
  });

  it('shows the starred icon and the pending-sync marker', () => {
    const { container } = renderCard(
      makeTask({ is_starred: true, needs_push: true }),
    );
    expect(container.querySelector('.star-btn')).toHaveClass('starred');
    expect(container.querySelector('.bi-star-fill')).not.toBeNull();
    expect(container.querySelector('.bi-cloud-arrow-up')).not.toBeNull();
  });

  it('posts toggle-star when the star icon is clicked', async () => {
    mockedApiPost.mockResolvedValue({ success: true, is_starred: true });
    const { container } = renderCard(makeTask());
    fireEvent.click(container.querySelector('.star-btn')!);
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/task-1/toggle-star/',
      ),
    );
  });

  it('asks for confirmation, then posts complete', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 'task-1' });
    const { container } = renderCard(makeTask());
    fireEvent.click(container.querySelector('.complete-btn')!);
    // The confirm modal mirrors modals.html completeTaskModal.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Complete Task')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Are you sure you want to mark this task as completed?',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/task-1/complete/',
      ),
    );
  });

  it('posts archive from the three-dots menu without a confirm', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 'task-1' });
    renderCard(makeTask());
    fireEvent.click(screen.getByRole('button', { name: 'Task actions' }));
    fireEvent.click(screen.getByRole('link', { name: /Archive/ }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/task-1/archive/',
      ),
    );
  });

  it('confirms before posting delete (trash flow)', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 'task-1' });
    renderCard(makeTask());
    fireEvent.click(screen.getByRole('button', { name: 'Task actions' }));
    fireEvent.click(screen.getByRole('link', { name: /Delete/ }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Move this task to trash?'),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/task-1/delete/',
      ),
    );
  });

  it('opens the edit modal and posts the update payload', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 'task-1' });
    const task = makeTask({
      notes: '2% fat',
      labels: [{ id: 7, name: 'home' }],
    });
    render(
      <MemoryRouter>
        {withQueryClient(
          <TaskCard
            task={task}
            position={3}
            labelColors={labelColors}
            labels={[{ id: 7, name: 'home', color: '#ff0000' }]}
          />,
        )}
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Task actions' }));
    fireEvent.click(screen.getByRole('link', { name: /Edit/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit Task')).toBeInTheDocument();

    const titleInput = within(dialog).getByLabelText(/Title/);
    expect(titleInput).toHaveValue('Buy milk');
    fireEvent.change(titleInput, { target: { value: 'Buy oat milk' } });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save Changes' }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/task-1/update/',
        { title: 'Buy oat milk', notes: '2% fat', label_ids: [7] },
      ),
    );
  });
});

describe('DividerCard', () => {
  function renderDivider(task: TaskOut) {
    return render(
      <MemoryRouter>
        {withQueryClient(<DividerCard task={task} />)}
      </MemoryRouter>,
    );
  }

  it('renders the divider layout with an editable label input', () => {
    const { container } = renderDivider(
      makeTask({ is_divider: true, title: 'Later' }),
    );
    expect(container.querySelector('.divider-card')).not.toBeNull();
    const input = container.querySelector('.divider-text')!;
    expect(input).toHaveValue('Later');
    expect(input).not.toHaveAttribute('readonly');
  });

  it('posts divider/update on blur when the label changed', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    const { container } = renderDivider(
      makeTask({ task_id: 'divider_abc', is_divider: true, title: '' }),
    );
    const input = container.querySelector('.divider-text')!;
    fireEvent.change(input, { target: { value: 'This week' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/divider/divider_abc/update/',
        { title: 'This week' },
      ),
    );
  });

  it('does not post when the label is unchanged', () => {
    const { container } = renderDivider(
      makeTask({ task_id: 'divider_abc', is_divider: true, title: 'Same' }),
    );
    const input = container.querySelector('.divider-text')!;
    fireEvent.blur(input);
    expect(mockedApiPost).not.toHaveBeenCalled();
  });

  it('confirms, then posts divider/delete', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    const { container } = renderDivider(
      makeTask({ task_id: 'divider_abc', is_divider: true, title: 'X' }),
    );
    fireEvent.click(container.querySelector('.delete-divider-btn')!);
    expect(await screen.findByText('Delete this divider?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/divider/divider_abc/delete/',
      ),
    );
  });
});

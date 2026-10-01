import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaskDetail from './TaskDetail';
import { apiGet, apiPost } from '../../shared/api/client';
import { resetActionHistory } from '../actionHistory';
import { clearToasts } from '../../shared/toasts';
import type { TaskDetailOut, TaskOut } from '../api';

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
    title: 'Detail task',
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

function makeDetail(overrides: Partial<TaskDetailOut> = {}): TaskDetailOut {
  return {
    task: makeTask(),
    labels: [],
    has_credentials: true,
    ...overrides,
  };
}

function renderDetail(initialEntry = '/task/task-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/task/:taskId" element={<TaskDetail />} />
        </Routes>
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

describe('TaskDetail', () => {
  it('fetches /api/tasks/task/{id}/', async () => {
    mockedApiGet.mockResolvedValue(makeDetail());
    renderDetail();
    expect(await screen.findByDisplayValue('Detail task')).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith('/api/tasks/task/task-1/');
  });

  it('renders title, notes, labels and metadata', async () => {
    mockedApiGet.mockResolvedValue(
      makeDetail({
        task: makeTask({
          title: 'Buy cake',
          notes: 'Chocolate',
          due: '2026-10-01',
          is_starred: true,
          labels: [{ id: 2, name: 'errands' }],
          updated: '2026-09-30T15:04:00Z',
        }),
        labels: [{ id: 2, name: 'errands', color: '#0a0' }],
      }),
    );
    renderDetail();
    expect(await screen.findByDisplayValue('Buy cake')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Chocolate')).toBeInTheDocument();
    expect(screen.getByText('Starred')).toBeInTheDocument();
    expect(screen.getByText(/Due: Oct 1, 2026/)).toBeInTheDocument();
    expect(screen.getAllByText('errands').length).toBeGreaterThan(0);
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  it('posts the edit form to /update/ with title, notes and labels', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    mockedApiGet.mockResolvedValue(
      makeDetail({
        task: makeTask({ title: 'Old title', notes: 'old notes' }),
        labels: [{ id: 3, name: 'work', color: '#00f' }],
      }),
    );
    renderDetail();
    await screen.findByDisplayValue('Old title');
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'New title' },
    });
    fireEvent.change(screen.getByLabelText(/Notes/), {
      target: { value: 'new notes' },
    });
    fireEvent.click(screen.getByLabelText('work'));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/task-1/update/',
        { title: 'New title', notes: 'new notes', label_ids: [3] },
      ),
    );
  });

  it('warns instead of saving a blank title', async () => {
    mockedApiGet.mockResolvedValue(makeDetail());
    renderDetail();
    await screen.findByDisplayValue('Detail task');
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    expect(
      await screen.findByText('Title cannot be empty'),
    ).toBeInTheDocument();
    expect(mockedApiPost).not.toHaveBeenCalled();
  });

  it('posts toggle-star from the header star button', async () => {
    mockedApiPost.mockResolvedValue({ success: true, is_starred: true });
    mockedApiGet.mockResolvedValue(makeDetail());
    renderDetail();
    await screen.findByDisplayValue('Detail task');
    fireEvent.click(document.querySelector('#star-btn') as HTMLElement);
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/task-1/toggle-star/',
      ),
    );
  });
});

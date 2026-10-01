import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Search from './Search';
import { apiGet, apiPost } from '../../shared/api/client';
import { resetActionHistory } from '../actionHistory';
import { clearToasts } from '../../shared/toasts';
import type { SearchOut, TaskOut } from '../api';

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
    title: 'Found task',
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

function makeSearch(overrides: Partial<SearchOut> = {}): SearchOut {
  return { tasks: [], total_results: 0, ...overrides };
}

function renderSearch(initialEntry = '/search') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Search />
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

describe('Search', () => {
  it('prompts for input without firing a request', async () => {
    renderSearch();
    expect(
      await screen.findByText('Enter search criteria'),
    ).toBeInTheDocument();
    expect(mockedApiGet).not.toHaveBeenCalled();
  });

  it('fetches /api/tasks/search/?q= from the URL param', async () => {
    mockedApiGet.mockResolvedValue(
      makeSearch({
        tasks: [makeTask({ task_id: 'a', title: 'Milk run' })],
        total_results: 1,
      }),
    );
    renderSearch('/search?q=milk');
    expect(await screen.findByText('Milk run')).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith('/api/tasks/search/?q=milk');
    expect(screen.getByText(/Found\s+1 task/)).toBeInTheDocument();
  });

  it('encodes multi-word queries', async () => {
    mockedApiGet.mockResolvedValue(makeSearch());
    renderSearch('/search?q=buy%20milk');
    await screen.findByText('No tasks found');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/search/?q=buy%20milk',
    );
  });

  it('submits the form into the ?q= param', async () => {
    mockedApiGet.mockResolvedValue(
      makeSearch({
        tasks: [makeTask({ task_id: 'a', title: 'Hit' })],
        total_results: 1,
      }),
    );
    renderSearch();
    await screen.findByText('Enter search criteria');
    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: 'hit' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith('/api/tasks/search/?q=hit'),
    );
    expect(await screen.findByText('Hit')).toBeInTheDocument();
  });

  it('shows the empty-result state', async () => {
    mockedApiGet.mockResolvedValue(makeSearch());
    renderSearch('/search?q=nothing');
    expect(await screen.findByText('No tasks found')).toBeInTheDocument();
  });
});

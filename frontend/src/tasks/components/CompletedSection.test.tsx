import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompletedSection } from './CompletedSection';
import { apiPost } from '../../shared/api/client';
import { resetActionHistory } from '../actionHistory';
import { clearToasts } from '../../shared/toasts';
import type { TaskOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiPost = vi.mocked(apiPost);

function makeCompleted(
  id: string,
  title: string,
  completed = '2026-09-20T12:00:00Z',
): TaskOut {
  return {
    task_id: id,
    title,
    status: 'completed',
    completed,
    is_starred: false,
    is_divider: false,
    labels: [],
    is_archived: false,
    is_deleted: false,
    needs_push: false,
  };
}

const tasks = [
  makeCompleted('c1', 'Done one', '2026-09-20T12:00:00Z'),
  makeCompleted('c2', 'Done two', '2026-09-21T12:00:00Z'),
];

function renderSection(autoOpen = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CompletedSection
          tasks={tasks}
          labelColors={new Map()}
          autoOpen={autoOpen}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiPost.mockReset();
  clearToasts();
  resetActionHistory();
});

describe('CompletedSection', () => {
  it('renders collapsed with the completed count and toggles open', () => {
    renderSection();
    const collapse = document.getElementById('completedTasksCollapse')!;
    expect(
      screen.getByRole('button', { name: /Completed tasks \(2\)/ }),
    ).toBeInTheDocument();
    expect(collapse).toHaveClass('collapse');
    expect(collapse).not.toHaveClass('show');

    fireEvent.click(
      screen.getByRole('button', { name: /Completed tasks \(2\)/ }),
    );
    expect(collapse).toHaveClass('show');
    expect(document.getElementById('completedChevron')).toHaveClass(
      'bi-chevron-down',
    );
  });

  it('renders struck-through titles with completed dates', () => {
    renderSection(true);
    const link = screen.getByRole('link', { name: 'Done one' });
    expect(link).toHaveClass('text-decoration-line-through');
    expect(screen.getByText('Sep 20')).toBeInTheDocument();
  });

  it('auto-opens when autoOpen is set (secondary_label parity)', () => {
    renderSection(true);
    expect(document.getElementById('completedTasksCollapse')).toHaveClass(
      'show',
    );
  });

  it('renders nothing when there are no completed tasks', () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <CompletedSection tasks={[]} labelColors={new Map()} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('posts uncomplete after the confirm modal', async () => {
    mockedApiPost.mockResolvedValue({ success: true, task_id: 'c1' });
    const { container } = renderSection(true);
    fireEvent.click(container.querySelector('.uncomplete-btn')!);
    expect(
      await screen.findByText('Mark as Not Completed', {
        selector: '.modal-title',
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark as Not Completed' }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/c1/uncomplete/',
      ),
    );
  });

  it('posts toggle-star for a completed task', async () => {
    mockedApiPost.mockResolvedValue({ success: true, is_starred: true });
    const { container } = renderSection(true);
    fireEvent.click(container.querySelector('.star-btn')!);
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/c1/toggle-star/',
      ),
    );
  });
});

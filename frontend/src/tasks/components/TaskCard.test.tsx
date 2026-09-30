import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskCard } from './TaskCard';
import DividerCard from './DividerCard';
import type { TaskOut } from '../api';

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

function renderCard(task: TaskOut) {
  return render(
    <MemoryRouter>
      <TaskCard task={task} position={3} labelColors={labelColors} />
    </MemoryRouter>,
  );
}

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
});

describe('DividerCard', () => {
  it('renders the divider layout with a read-only label input', () => {
    const { container } = render(
      <DividerCard task={makeTask({ is_divider: true, title: 'Later' })} />,
    );
    expect(container.querySelector('.divider-card')).not.toBeNull();
    const input = container.querySelector('.divider-text')!;
    expect(input).toHaveValue('Later');
    expect(input).toHaveAttribute('readonly');
  });
});

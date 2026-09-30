import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CompletedSection } from './CompletedSection';
import type { TaskOut } from '../api';

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
  return render(
    <MemoryRouter>
      <CompletedSection
        tasks={tasks}
        labelColors={new Map()}
        autoOpen={autoOpen}
      />
    </MemoryRouter>,
  );
}

describe('CompletedSection', () => {
  it('renders collapsed with the completed count and toggles open', () => {
    render(
      <MemoryRouter>
        <CompletedSection tasks={tasks} labelColors={new Map()} />
      </MemoryRouter>,
    );
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
    const { container } = render(
      <MemoryRouter>
        <CompletedSection tasks={[]} labelColors={new Map()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TaskNavBar } from './TaskNavBar';
import type { DashboardOut } from '../api';

const dashboard: DashboardOut = {
  tasks: [],
  completed: [],
  task_lists: [{ list_id: 'list-1', title: 'Groceries' }],
  labels: [
    { id: 1, name: 'home', color: '#ff0000' },
    { id: 2, name: 'work', color: '#00ff00', task_count: 3 },
  ],
  selected_list: null,
  selected_list_title: null,
  selected_label: null,
  order_by: 'order_asc',
  flags: {
    has_credentials: true,
    is_starred_view: false,
    is_overdue_view: false,
    is_archived_view: false,
    is_trash_view: false,
  },
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.search}</div>;
}

function renderNav(initialSearch = '') {
  return render(
    <MemoryRouter initialEntries={[`/${initialSearch}`]}>
      <TaskNavBar data={dashboard} secondaryLabel="" burgerItems={[]} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const search = () => screen.getByTestId('loc').textContent ?? '';

describe('TaskNavBar filters', () => {
  it('sets ?list= and clears label/secondary_label (filters.js selectList)', () => {
    renderNav('?label=work&secondary_label=home&order=created_desc');
    fireEvent.click(screen.getByRole('button', { name: /work/ }));
    fireEvent.click(screen.getByRole('link', { name: /Groceries/ }));
    const params = new URLSearchParams(search());
    expect(params.get('list')).toBe('list-1');
    expect(params.get('label')).toBeNull();
    expect(params.get('secondary_label')).toBeNull();
    // Order survives the switch, like the full-page reload did.
    expect(params.get('order')).toBe('created_desc');
  });

  it('sets ?order= while keeping the other params (filters.js changeOrder)', () => {
    renderNav('?list=list-1');
    fireEvent.click(screen.getByRole('button', { name: /Order Asc/ }));
    fireEvent.click(screen.getByRole('link', { name: /Due Desc/ }));
    const params = new URLSearchParams(search());
    expect(params.get('order')).toBe('due_desc');
    expect(params.get('list')).toBe('list-1');
  });

  it('writes secondary_label into the URL for the client-side filter', () => {
    renderNav('?label=work');
    fireEvent.click(screen.getByRole('button', { name: /All$/ }));
    // The view dropdown and the secondary-label dropdown both render a
    // 'home' link — click the one in the secondary (second) menu.
    fireEvent.click(screen.getAllByRole('link', { name: 'home' })[1]);
    const params = new URLSearchParams(search());
    expect(params.get('secondary_label')).toBe('home');
    expect(params.get('label')).toBe('work');
  });

  it('hides the filter dropdowns without credentials', () => {
    render(
      <MemoryRouter>
        <TaskNavBar
          data={{
            ...dashboard,
            flags: { ...dashboard.flags, has_credentials: false },
          }}
          secondaryLabel=""
          burgerItems={[]}
        />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole('button', { name: /All Tasks/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Search tasks' }),
    ).toBeInTheDocument();
  });
});

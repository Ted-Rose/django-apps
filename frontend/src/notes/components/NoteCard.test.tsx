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
import { NoteCard } from './NoteCard';
import { apiPatch, apiPost } from '../../shared/api/client';
import { clearToasts } from '../../shared/toasts';
import type { NoteCategoryOut, TaskOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiPost = vi.mocked(apiPost);
const mockedApiPatch = vi.mocked(apiPatch);

const CATEGORIES: NoteCategoryOut[] = [
  { id: 1, name: 'God', slug: 'god', parent_id: null, note_count: 4 },
  { id: 2, name: 'Prayer', slug: 'prayer', parent_id: 1, note_count: 2 },
  {
    id: 3,
    name: 'Projects',
    slug: 'projects',
    parent_id: null,
    note_count: 3,
  },
  {
    id: 4,
    name: 'Django',
    slug: 'django',
    parent_id: 3,
    note_count: 2,
  },
  { id: 5, name: 'Apps', slug: 'apps', parent_id: 4, note_count: 1 },
];

function makeNote(overrides: Partial<TaskOut> = {}): TaskOut {
  return {
    task_id: 'note-1',
    title: 'Prayer list #notes-god-prayer',
    notes: null,
    status: 'needsAction',
    due: null,
    completed: null,
    updated: '2026-10-01T10:00:00Z',
    position: null,
    task_list: null,
    is_starred: false,
    is_divider: false,
    task_order: null,
    starred_order: null,
    labels: [],
    is_archived: false,
    is_deleted: false,
    deleted_at: null,
    needs_push: false,
    is_note: true,
    note_category: {
      id: 2,
      name: 'Prayer',
      slug: 'prayer',
      parent_id: 1,
    },
    ...overrides,
  };
}

function withQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderCard(note: TaskOut, completed = false) {
  return render(
    <MemoryRouter>
      {withQueryClient(
        <NoteCard note={note} categories={CATEGORIES} completed={completed} />,
      )}
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiPost.mockReset();
  mockedApiPatch.mockReset();
  clearToasts();
});

describe('NoteCard', () => {
  it('renders the marker-hidden title linking to the editor', () => {
    renderCard(makeNote());
    const link = screen.getByRole('link', { name: 'Prayer list' });
    expect(link).toHaveAttribute('href', '/note/note-1');
    // The #notes marker must never be visible.
    expect(screen.queryByText(/#notes/)).toBeNull();
  });

  it('shows a 40-word body preview, the category chip and date', () => {
    const words = Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ');
    renderCard(
      makeNote({
        notes: `${words} #notes-god-prayer`,
        updated: '2026-10-05T08:00:00Z',
      }),
    );
    const preview = screen.getByText(/w0/);
    expect(preview.textContent).toContain('…');
    expect(preview.textContent).not.toContain('#notes');
    const chip = screen.getByRole('link', { name: /God \/ Prayer/ });
    expect(chip).toHaveAttribute('href', '/category/2');
    expect(screen.getByText('Oct 5, 2026')).toBeInTheDocument();
  });

  it('renders the full ancestor path on a deep category chip', () => {
    renderCard(
      makeNote({
        note_category: {
          id: 5,
          name: 'Apps',
          slug: 'apps',
          parent_id: 4,
        },
      }),
    );
    const chip = screen.getByRole('link', {
      name: /Projects \/ Django \/ Apps/,
    });
    expect(chip).toHaveAttribute('href', '/category/5');
  });

  it('renders an Inbox chip for uncategorized notes', () => {
    renderCard(makeNote({ note_category: null }));
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
  });

  it('has no complete checkbox, star or order badge', () => {
    const { container } = renderCard(makeNote());
    expect(container.querySelector('.complete-btn')).toBeNull();
    expect(container.querySelector('.star-btn')).toBeNull();
    expect(container.querySelector('.task-order-badge')).toBeNull();
  });

  it('confirms then posts the shared task delete endpoint', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    renderCard(makeNote());
    fireEvent.click(screen.getByRole('button', { name: 'Note actions' }));
    fireEvent.click(screen.getByRole('link', { name: /Delete/ }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Move this note to trash?'),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/note-1/delete/',
      ),
    );
  });

  it('moves the note via PATCH with the picked category_id', async () => {
    mockedApiPatch.mockResolvedValue({ success: true, task_id: 'note-1' });
    renderCard(makeNote());
    fireEvent.click(screen.getByRole('button', { name: 'Note actions' }));
    fireEvent.click(screen.getByRole('link', { name: /Move to category/ }));
    const dialog = await screen.findByRole('dialog');
    // Uncategorized row is a real option in the picker.
    fireEvent.click(
      within(dialog).getByRole('option', { name: /Uncategorized/ }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(mockedApiPatch).toHaveBeenCalledWith('/api/notes/note-1/', {
        category_id: null,
      }),
    );
  });

  it('offers uncomplete on completed notes', async () => {
    mockedApiPost.mockResolvedValue({ success: true });
    renderCard(
      makeNote({ status: 'completed', completed: '2026-10-03' }),
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Note actions' }));
    fireEvent.click(
      screen.getByRole('link', { name: /Mark as not completed/ }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Mark as Not Completed',
      }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/tasks/task/note-1/uncomplete/',
      ),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NoteDetail from './NoteDetail';
import { apiGet, apiPatch } from '../../shared/api/client';
import { clearToasts } from '../../shared/toasts';
import type {
  NoteCategoryOut,
  NotesDashboardOut,
  TaskDetailOut,
  TaskOut,
} from '../api';

vi.mock('../../shared/components/RichTextEditor', async () => ({
  default: (await import('../../test/RichTextEditorStub')).default,
}));

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPatch = vi.mocked(apiPatch);

const CATEGORIES: NoteCategoryOut[] = [
  { id: 1, name: 'God', slug: 'god', parent_id: null, note_count: 4 },
  { id: 2, name: 'Prayer', slug: 'prayer', parent_id: 1, note_count: 2 },
];

function makeNote(overrides: Partial<TaskOut> = {}): TaskOut {
  return {
    task_id: 'note-1',
    title: 'Prayer list #notes-god-prayer',
    notes: 'remember Tuesday\n\n#notes-god-prayer',
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

const DETAIL: TaskDetailOut = {
  task: makeNote(),
  labels: [],
  has_credentials: true,
};

const DASHBOARD: NotesDashboardOut = {
  notes: [makeNote()],
  completed: [],
  categories: CATEGORIES,
  selected_category: null,
  order_by: 'created_desc',
  flags: {
    has_credentials: true,
    is_starred_view: false,
    is_overdue_view: false,
    is_archived_view: false,
    is_trash_view: false,
  },
};

function withQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/note/note-1']}>
      {withQueryClient(
        <Routes>
          <Route path="/note/:id" element={<NoteDetail />} />
        </Routes>,
      )}
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPatch.mockReset();
  clearToasts();
  mockedApiGet.mockImplementation((url: string) => {
    if (url.startsWith('/api/tasks/task/')) {
      return Promise.resolve(DETAIL);
    }
    if (url.startsWith('/api/notes/')) {
      return Promise.resolve(DASHBOARD);
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
});

describe('NoteDetail', () => {
  it('loads marker-stripped title and body into the inputs', async () => {
    renderEditor();
    const title = await screen.findByLabelText(/Title/);
    const body = screen.getByLabelText(/Body/);
    await waitFor(() => expect(title).toHaveValue('Prayer list'));
    expect(body).toHaveValue('remember Tuesday');
    // No #notes marker may appear in either input.
    expect((title as HTMLTextAreaElement).value).not.toContain('#notes');
    expect((body as HTMLTextAreaElement).value).not.toContain('#notes');
  });

  it('shows a notice instead of the editor for a plain task', async () => {
    mockedApiGet.mockImplementation((url: string) => {
      if (url.startsWith('/api/tasks/task/')) {
        return Promise.resolve({
          ...DETAIL,
          task: makeNote({ is_note: false }),
        });
      }
      if (url.startsWith('/api/notes/')) {
        return Promise.resolve(DASHBOARD);
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    renderEditor();
    await screen.findByText(/not a note/i);
    expect(screen.queryByLabelText(/Title/)).not.toBeInTheDocument();
  });

  it('sends only title/body when the category is unchanged', async () => {
    mockedApiPatch.mockResolvedValue({ success: true, task_id: 'note-1' });
    renderEditor();
    const title = await screen.findByLabelText(/Title/);
    await waitFor(() => expect(title).toHaveValue('Prayer list'));
    fireEvent.change(title, { target: { value: 'Prayer list v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(mockedApiPatch).toHaveBeenCalledWith('/api/notes/note-1/', {
        title: 'Prayer list v2',
        body: 'remember Tuesday',
      }),
    );
  });

  it('sends category_id when the picker selection changes', async () => {
    mockedApiPatch.mockResolvedValue({ success: true, task_id: 'note-1' });
    renderEditor();
    await screen.findByLabelText(/Title/);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /God/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('option', { name: /^God/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(mockedApiPatch).toHaveBeenCalledWith('/api/notes/note-1/', {
        title: 'Prayer list',
        body: 'remember Tuesday',
        category_id: 1,
      }),
    );
  });

  it('converts to a plain task via the "Not a note" escape', async () => {
    mockedApiPatch.mockResolvedValue({ success: true, task_id: 'note-1' });
    renderEditor();
    await screen.findByLabelText(/Title/);
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: /Not a note/ }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('option', { name: /Not a note/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(mockedApiPatch).toHaveBeenCalledWith('/api/notes/note-1/', {
        title: 'Prayer list',
        body: 'remember Tuesday',
        is_note: false,
      }),
    );
  });
});

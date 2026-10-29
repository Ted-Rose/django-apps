import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorDetail } from '../../shared/api/errors';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import Toasts from '../../shared/components/Toasts';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { fetchNotes, type NotesDashboardOut, type TaskOut } from '../api';
import NoteCard from '../components/NoteCard';
import NoteFormModal from '../components/NoteFormModal';
import NotesNavBar, { INBOX_FILTER } from '../components/NotesNavBar';
import { useSync } from '../mutations';

/**
 * The notes list (`/` — also what `/category/:id` redirects to).
 * `?category=<id>` filters via the API's subtree-aware filter,
 * `?category=inbox` is a client-side uncategorized filter (the API
 * has no uncategorized id), `?q=` searches title+body server-side,
 * `?order=` picks the ordering. Notes default to newest-first —
 * the task_order positions notes inherit mean nothing, so the
 * backend's order_asc default would surface the stalest notes.
 */
export function NotesPage() {
  const { t } = useTranslation('notes');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const categoryParam = searchParams.get('category');
  const inboxSelected = categoryParam === INBOX_FILTER;
  const categoryId =
    categoryParam && !inboxSelected && /^\d+$/.test(categoryParam)
      ? Number(categoryParam)
      : null;
  const q = searchParams.get('q') || null;
  const order = searchParams.get('order') ?? 'created_desc';

  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['notes', { category: categoryId, q, order }],
    queryFn: () => fetchNotes({ category: categoryId, q, order }),
    // Keep the current list visible while a filter change refetches.
    placeholderData: keepPreviousData,
  });

  const syncMutation = useSync();
  const [creating, setCreating] = useState(false);

  const hasCredentials = data?.flags.has_credentials ?? false;

  // The inbox filter is client-side: drop categorized rows.
  const visibleNotes = (items: TaskOut[] | undefined) =>
    inboxSelected
      ? (items ?? []).filter((note) => !note.note_category)
      : (items ?? []);

  const notes = visibleNotes(data?.notes);
  const completed = visibleNotes(data?.completed);
  const [completedOpen, setCompletedOpen] = useState(false);

  const loginUrl = `/login/?next=${encodeURIComponent(
    window.location.pathname + window.location.search,
  )}`;

  const burgerItems: BurgerMenuItem[] = [
    {
      label: t('common:common.home'),
      url: '/',
      icon: 'house',
      btn_class: 'btn-light',
    },
    {
      label: t('menu.tasks'),
      url: '/tasks/',
      icon: 'list-task',
      btn_class: 'btn-light',
    },
  ];
  if (hasCredentials) {
    burgerItems.push(
      {
        label: t('menu.manageCategories'),
        icon: 'tags',
        btn_class: 'btn-light',
        onClick: () => navigate('/categories'),
      },
      {
        label: syncMutation.isPending ? t('menu.syncing') : t('menu.syncNow'),
        icon: 'arrow-repeat',
        btn_class: 'btn-light',
        onClick: () => syncMutation.mutate(),
      },
      {
        label: t('common:common.logout', { user }),
        url: '/admin/logout/',
        icon: 'box-arrow-right',
        btn_class: 'btn-outline-light',
      },
    );
  } else {
    burgerItems.push({
      label: t('menu.loginGoogle'),
      url: loginUrl,
      icon: 'google',
      btn_class: 'btn-warning',
    });
  }

  return (
    <>
      <NotesNavBar data={data} burgerItems={burgerItems} />
      <div className="container-fluid px-2 py-4">
        {isPending && <LoadingSkeleton />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data && (
          <>
            {notes.length > 0 ? (
              <div id="note-list">
                {notes.map((note) => (
                  <NoteCard
                    key={note.task_id}
                    note={note}
                    categories={data.categories}
                  />
                ))}
              </div>
            ) : (
              completed.length === 0 && <EmptyState data={data} q={q} />
            )}
            {completed.length > 0 && (
              <div className="mt-2">
                <button
                  className="btn btn-link text-muted text-decoration-none ps-0"
                  type="button"
                  aria-expanded={completedOpen}
                  onClick={() => setCompletedOpen((prev) => !prev)}
                >
                  <i
                    className={`bi ${
                      completedOpen ? 'bi-chevron-down' : 'bi-chevron-right'
                    }`}
                  />{' '}
                  {t('completed.header', { count: completed.length })}
                </button>
                <div className={`collapse${completedOpen ? ' show' : ''}`}>
                  <div className="mt-2">
                    {completed.map((note) => (
                      <NoteCard
                        key={note.task_id}
                        note={note}
                        categories={data.categories}
                        completed
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {data && hasCredentials && (
        <>
          <button
            className="floating-add-btn"
            type="button"
            title={t('list.createNote')}
            onClick={() => setCreating(true)}
          >
            <i className="bi bi-plus" />
          </button>
          <NoteFormModal
            show={creating}
            categories={data.categories}
            initialCategoryId={categoryId}
            onClose={() => setCreating(false)}
          />
        </>
      )}

      <Toasts />
    </>
  );
}

export function LoadingSkeleton() {
  const { t } = useTranslation('notes');
  return (
    <div id="note-list" aria-busy="true" aria-label={t('list.loading')}>
      {[0, 1, 2].map((i) => (
        <div className="task-container d-flex mb-2" key={i}>
          <div className="card task-card flex-grow-1 task-content">
            <div className="card-body placeholder-glow">
              <span className="placeholder col-5" />
              <p className="card-text mb-0 mt-2">
                <span className="placeholder col-8" />
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useTranslation('notes');
  return (
    <div className="alert alert-danger text-center py-5" role="alert">
      <i className="bi bi-exclamation-circle fs-1 d-block mb-3" />
      <h5>{t('list.errorTitle')}</h5>
      <p className="mb-3">{errorDetail(error)}</p>
      <button
        type="button"
        className="btn btn-outline-danger"
        onClick={onRetry}
      >
        <i className="bi bi-arrow-repeat" /> {t('common:common.retry')}
      </button>
    </div>
  );
}

/** Empty state: auth prompt, search-no-hit, or the zero-notes hint. */
export function EmptyState({
  data,
  q,
}: {
  data: NotesDashboardOut;
  q: string | null;
}) {
  const { t } = useTranslation('notes');
  if (!data.flags.has_credentials) {
    const loginUrl = `/login/?next=${encodeURIComponent(
      window.location.pathname + window.location.search,
    )}`;
    return (
      <div className="alert alert-info text-center py-5">
        <i className="bi bi-shield-lock fs-1 d-block mb-3 text-warning" />
        <h5>{t('list.authTitle')}</h5>
        <p className="mb-3">{t('list.authBody')}</p>
        <a href={loginUrl} className="btn btn-warning btn-lg">
          <i className="bi bi-google" /> {t('menu.loginGoogle')}
        </a>
      </div>
    );
  }
  return (
    <div className="alert alert-info text-center py-5">
      <i className="bi bi-info-circle fs-1 d-block mb-3" />
      <h5>{q ? t('list.searchEmpty', { q }) : t('list.noNotes')}</h5>
      {!q && <p className="mb-0">{t('list.emptyHint')}</p>}
    </div>
  );
}

export default NotesPage;

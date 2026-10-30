import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BurgerMenu,
  type BurgerMenuItem,
} from '../../shared/components/BurgerMenu';
import Toasts from '../../shared/components/Toasts';
import { errorDetail } from '../../shared/api/errors';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { fetchNoteDetail, fetchNotes } from '../api';
import CategoryPicker, {
  NOT_A_NOTE,
  type CategorySelection,
} from '../components/CategoryPicker';
import { useUpdateNote } from '../mutations';
import {
  formatDateTime,
  formatFullDate,
  spaPathFromStoredUrl,
  stripNoteMarker,
} from '../utils';
import { ErrorState, LoadingSkeleton } from './NotesPage';

/**
 * The note editor (`/note/:id`) — a TaskDetail-style page with
 * auto-resizing title/body textareas and a CategoryPicker
 * (Uncategorized + the tree at any depth + a "Not a note" escape
 * sends is_note: false and converts the note into a plain task).
 * Saves via PATCH /api/notes/{id}/ — the server recomposes the
 * `#notes…` marker, so the inputs always show marker-stripped text.
 * Back-nav restores `notesListReferrer` like tasks' referrer flow.
 */
const SAVED_REDIRECT_MS = 1500;

export default function NoteDetail() {
  const { t } = useTranslation('notes');
  const { id: taskId = '' } = useParams();
  const navigate = useNavigate();
  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['notes', 'note', taskId],
    queryFn: () => fetchNoteDetail(taskId),
    enabled: Boolean(taskId),
  });
  const task = data?.task;

  // The category tree isn't part of TaskDetailOut — the dashboard
  // endpoint carries it (with counts for the picker).
  const { data: dashboard } = useQuery({
    queryKey: ['notes', 'categories'],
    queryFn: () => fetchNotes({}),
  });
  const categories = dashboard?.categories ?? [];

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<CategorySelection>(null);
  const [alert, setAlert] = useState<{
    kind: 'success' | 'danger';
    text: string;
  } | null>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // The template auto-resizes both textareas to their content.
  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Populate the form when the note arrives — marker-stripped so
  // the #notes tag never shows inside the inputs.
  useEffect(() => {
    if (task) {
      setTitle(stripNoteMarker(task.title));
      setBody(stripNoteMarker(task.notes));
      setCategory(task.note_category?.id ?? null);
    }
  }, [task]);

  useEffect(() => {
    autoResize(titleRef.current);
    autoResize(bodyRef.current);
  }, [title, body]);

  const updateNote = useUpdateNote();

  const backTarget =
    spaPathFromStoredUrl(
      (() => {
        try {
          return localStorage.getItem('notesListReferrer');
        } catch {
          return null;
        }
      })(),
    ) ?? '/';

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setAlert({ kind: 'danger', text: t('detail.titleEmpty') });
      return;
    }
    setAlert(null);
    const payload: {
      title: string;
      body: string;
      category_id?: number | null;
      is_note?: boolean;
    } = { title: trimmed, body: body.trim() };
    if (category === NOT_A_NOTE) {
      // The escape hatch — strips the marker server-side; the row
      // becomes a plain task and leaves the notes views.
      payload.is_note = false;
    } else if (category !== (task?.note_category?.id ?? null)) {
      // Tri-state: only send when the selection actually changed;
      // null is the explicit "uncategorize" the API understands.
      payload.category_id = category;
    }
    updateNote.mutate(
      { taskId, payload },
      {
        onSuccess: () => {
          if (payload.is_note === false) {
            navigate(backTarget);
            return;
          }
          setAlert({ kind: 'success', text: t('detail.saved') });
          setTimeout(() => navigate(backTarget), SAVED_REDIRECT_MS);
        },
        onError: (mutationError) =>
          setAlert({ kind: 'danger', text: errorDetail(mutationError) }),
      },
    );
  };

  const burgerItems: BurgerMenuItem[] = [
    {
      label: t('common:common.home'),
      url: '/',
      icon: 'house',
      btn_class: 'btn-light',
    },
    {
      label: t('nav.title'),
      icon: 'journal-text',
      btn_class: 'btn-primary',
      onClick: () => navigate(backTarget),
    },
    {
      label: t('common:common.logout', { user }),
      url: '/admin/logout/',
      icon: 'box-arrow-right',
      btn_class: 'btn-outline-light',
    },
  ];

  return (
    <>
      {/* Dark like the list navbar — never bg-primary, so the page
          still reads as notes. */}
      <nav
        className="navbar navbar-expand-lg navbar-dark bg-dark"
        style={{ padding: '0.1rem 0', minHeight: 'auto' }}
      >
        <div className="container-fluid" style={{ padding: '0 0.5rem' }}>
          <div className="d-flex align-items-center gap-1 flex-wrap">
            <Link
              to={backTarget}
              className="btn btn-outline-light btn-sm"
              style={{ padding: '0.15rem 0.4rem' }}
            >
              <i className="bi bi-arrow-left" /> {t('detail.back')}
            </Link>
            <Link
              className="navbar-brand mb-0"
              to="/"
              style={{ fontSize: '1rem', padding: '0.25rem 0.5rem' }}
            >
              <i className="bi bi-journal-text" /> {t('nav.title')}
            </Link>
          </div>
          <div className="ms-auto d-flex flex-row align-items-center gap-2">
            <BurgerMenu items={burgerItems} />
          </div>
        </div>
      </nav>
      <div className="container-fluid task-detail-container">
        {isPending && <LoadingSkeleton />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data && !task && (
          <div className="alert alert-info">{t('detail.missing')}</div>
        )}
        {data && task && !task.is_note && (
          // The task detail endpoint doesn't exclude non-notes —
          // a plain task id must not open a working note editor.
          <div className="alert alert-info mt-3">
            <i className="bi bi-info-circle" /> {t('detail.notANote')}
          </div>
        )}
        {data && task && task.is_note && (
          <>
            <div className="d-flex align-items-center mb-3 header-section">
              <Link
                to={backTarget}
                className="btn btn-secondary btn-sm me-2"
                id="back-btn"
              >
                <i className="bi bi-arrow-left" /> {t('detail.back')}
              </Link>
              <h5 className="mb-0">{t('detail.editNote')}</h5>
            </div>

            <div className="task-meta">
              <div className="d-flex flex-wrap gap-2 align-items-center">
                {task.due && (
                  <span className="badge bg-secondary">
                    <i className="bi bi-calendar" /> {formatFullDate(task.due)}
                  </span>
                )}
                {task.task_list && (
                  <span
                    className="badge bg-light text-dark border"
                    title={t('note.googleList')}
                  >
                    <i className="bi bi-folder" /> {task.task_list.title}
                  </span>
                )}
              </div>
              {task.updated && (
                <small className="text-muted d-block mt-2">
                  <i className="bi bi-clock" />{' '}
                  {t('detail.lastUpdated', {
                    datetime: formatDateTime(task.updated),
                  })}
                </small>
              )}
            </div>

            <form
              id="note-form"
              className="mt-3"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="mb-4">
                <label htmlFor="note-title" className="form-label fw-bold">
                  <i className="bi bi-text-left" /> {t('detail.titleLabel')}
                </label>
                <textarea
                  className="form-control form-control-lg"
                  id="note-title"
                  name="title"
                  required
                  maxLength={500}
                  rows={1}
                  placeholder={t('detail.titlePlaceholder')}
                  ref={titleRef}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>

              <div className="mb-4">
                <label htmlFor="note-body" className="form-label fw-bold">
                  <i className="bi bi-journal-text" /> {t('detail.bodyLabel')}
                </label>
                <textarea
                  className="form-control"
                  id="note-body"
                  name="body"
                  rows={6}
                  placeholder={t('detail.bodyPlaceholder')}
                  ref={bodyRef}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </div>

              <div className="mb-4">
                <span className="form-label fw-bold d-block">
                  <i className="bi bi-folder" /> {t('detail.categoryLabel')}
                </span>
                <CategoryPicker
                  categories={categories}
                  value={category}
                  allowNotANote
                  onChange={setCategory}
                />
              </div>

              <div className="d-flex gap-2">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={updateNote.isPending}
                >
                  {updateNote.isPending ? (
                    <span className="spinner-border spinner-border-sm me-2" />
                  ) : (
                    <i className="bi bi-save" />
                  )}{' '}
                  {t('detail.save')}
                </button>
                <Link to={backTarget} className="btn btn-outline-secondary">
                  <i className="bi bi-x-circle" /> {t('common:common.cancel')}
                </Link>
              </div>
            </form>

            <div id="alert-container" className="mt-3">
              {alert && (
                <div
                  className={[
                    `alert alert-${alert.kind}`,
                    'alert-dismissible fade show',
                  ].join(' ')}
                  role="alert"
                >
                  <i
                    className={`bi bi-${
                      alert.kind === 'success'
                        ? 'check-circle'
                        : 'exclamation-triangle'
                    }`}
                  />{' '}
                  {alert.text}
                  <button
                    type="button"
                    className="btn-close"
                    aria-label={t('common:common.close')}
                    onClick={() => setAlert(null)}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <Toasts />
    </>
  );
}

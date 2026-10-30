import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import EmptyState from '../../shared/components/EmptyState';
import ErrorState from '../../shared/components/ErrorState';
import ListSkeleton from '../../shared/components/ListSkeleton';
import PageNavBar from '../../shared/components/PageNavBar';
import Toasts from '../../shared/components/Toasts';
import { errorDetail } from '../../shared/api/errors';
import useBootstrap from '../../shared/hooks/useBootstrap';
import RichTextEditor from '../../shared/components/RichTextEditor';
import { isTiptapDocString } from '../../shared/tiptapContent';
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

  // The template auto-resizes the title textarea to its content;
  // the body editor grows itself (ProseMirror max-height).
  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Populate the form when the note arrives — marker-stripped so
  // the #notes tag never shows inside the inputs. The rich doc
  // is marker-free by contract; legacy notes markdown-parse on
  // load inside the editor.
  useEffect(() => {
    if (task) {
      setTitle(stripNoteMarker(task.title));
      setBody(task.notes_doc ?? stripNoteMarker(task.notes));
      setCategory(task.note_category?.id ?? null);
    }
  }, [task]);

  useEffect(() => {
    autoResize(titleRef.current);
  }, [title]);

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
    // An untouched legacy body stays plain text; once the
    // editor emits doc-JSON the server derives the synced
    // markdown projection (empty doc clears the body).
    const bodyField = isTiptapDocString(body)
      ? { body_doc: body }
      : { body: body.trim() };
    const payload: {
      title: string;
      body?: string;
      body_doc?: string;
      category_id?: number | null;
      is_note?: boolean;
    } = { title: trimmed, ...bodyField };
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
      <PageNavBar variant="dark" burgerItems={burgerItems}>
        <Link
          to={backTarget}
          className="btn btn-outline-light btn-sm ui-nav-toggle"
        >
          <i className="bi bi-arrow-left" /> {t('detail.back')}
        </Link>
        <Link className="navbar-brand mb-0" to="/">
          <i className="bi bi-journal-text" /> {t('nav.title')}
        </Link>
      </PageNavBar>
      <div className="container-fluid task-detail-container">
        {isPending && <ListSkeleton label={t('list.loading')} />}
        {isError && (
          <ErrorState
            title={t('list.errorTitle')}
            detail={errorDetail(error)}
            onRetry={() => refetch()}
          />
        )}
        {data && !task && (
          <EmptyState icon="journal-x" title={t('detail.missing')} />
        )}
        {data && task && !task.is_note && (
          // The task detail endpoint doesn't exclude non-notes —
          // a plain task id must not open a working note editor.
          <EmptyState icon="info-circle" title={t('detail.notANote')} />
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
                <label className="form-label fw-bold">
                  <i className="bi bi-journal-text" /> {t('detail.bodyLabel')}
                </label>
                <RichTextEditor
                  id="note-body"
                  placeholder={t('detail.bodyPlaceholder')}
                  ariaLabel={t('detail.bodyLabel')}
                  value={body}
                  onChange={setBody}
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

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import NavBar from '../../shared/components/NavBar';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { fetchTaskDetail } from '../api';
import Toasts from '../../shared/components/Toasts';
import { errorDetail, useToggleStar, useUpdateTask } from '../mutations';
import { formatDateTime, formatFullDate, spaPathFromStoredUrl } from '../utils';
import { ErrorState, LoadingSkeleton } from './TaskListPage';

/**
 * React port of task_detail.html — GET /api/tasks/task/{id}/ →
 * TaskDetailOut, editable title/notes/label-checkboxes form posting
 * to /api/tasks/task/{id}/update/ (the same endpoint the template's
 * form hit). On save the template showed an alert then bounced back
 * to `taskListReferrer` after 1.5s — kept here as SPA navigation.
 *
 * The star button posts toggle-star and patches the ['task', id]
 * cache entry directly (list-view optimistic patching in mutations
 * doesn't know this query root).
 */
const SAVED_REDIRECT_MS = 1500;

export default function TaskDetail() {
  const { t } = useTranslation('tasks');
  const { taskId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => fetchTaskDetail(taskId),
    enabled: Boolean(taskId),
  });
  const task = data?.task;

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [labelIds, setLabelIds] = useState<number[]>([]);
  const [taskOrder, setTaskOrder] = useState('');
  const [starredOrder, setStarredOrder] = useState('');
  const [alert, setAlert] = useState<{
    kind: 'success' | 'danger';
    text: string;
  } | null>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // The template auto-resizes both textareas to their content.
  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Populate the form when the task arrives (and after a refetch).
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setNotes(task.notes ?? '');
      setLabelIds(task.labels.map((l) => l.id));
      setTaskOrder(task.task_order != null ? String(task.task_order) : '');
      setStarredOrder(
        task.starred_order != null ? String(task.starred_order) : '',
      );
    }
  }, [task]);

  useEffect(() => {
    autoResize(titleRef.current);
    autoResize(notesRef.current);
  }, [title, notes]);

  const updateTask = useUpdateTask();
  const toggleStar = useToggleStar();

  const backTarget =
    spaPathFromStoredUrl(
      (() => {
        try {
          return localStorage.getItem('taskListReferrer');
        } catch {
          return null;
        }
      })(),
    ) ?? '/';

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      // task_detail.html showAlert('Title cannot be empty', 'danger')
      setAlert({ kind: 'danger', text: t('detail.titleEmpty') });
      return;
    }
    const orderRaw = taskOrder.trim();
    const starredRaw = starredOrder.trim();
    // Empty task_order keeps the current value (the key is omitted);
    // empty starred_order posts null and clears the position.
    const parsedOrder = orderRaw === '' ? undefined : Number(orderRaw);
    const parsedStarred = starredRaw === '' ? null : Number(starredRaw);
    if (
      (parsedOrder !== undefined && !Number.isFinite(parsedOrder)) ||
      (parsedStarred !== null && !Number.isFinite(parsedStarred))
    ) {
      setAlert({ kind: 'danger', text: t('detail.orderNumbers') });
      return;
    }
    setAlert(null);
    updateTask.mutate(
      {
        taskId,
        payload: {
          title: trimmed,
          // The view calls notes.strip() — string, never null.
          notes: notes.trim(),
          label_ids: labelIds,
          starred_order: parsedStarred,
          ...(parsedOrder !== undefined
            ? { task_order: parsedOrder }
            : {}),
        },
      },
      {
        onSuccess: () => {
          setAlert({ kind: 'success', text: t('detail.updated') });
          setTimeout(() => navigate(backTarget), SAVED_REDIRECT_MS);
        },
        onError: (mutationError) =>
          setAlert({ kind: 'danger', text: errorDetail(mutationError) }),
      },
    );
  };

  const flipStar = () => {
    if (!task) return;
    toggleStar.mutate(task.task_id, {
      onSuccess: (result) =>
        queryClient.setQueryData(
          ['task', taskId],
          (old: typeof data | undefined) =>
            old
              ? {
                  ...old,
                  task: {
                    ...old.task,
                    is_starred: result.is_starred ?? !old.task.is_starred,
                  },
                }
              : old,
        ),
    });
  };

  const burgerItems: BurgerMenuItem[] = [
    {
      label: t('common:common.home'),
      url: '/',
      icon: 'house',
      btn_class: 'btn-light',
    },
    {
      label: t('common:common.dashboard'),
      icon: 'list-task',
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
      <NavBar title={t('nav.title')} items={burgerItems} />
      <div className="container-fluid task-detail-container">
        {isPending && <LoadingSkeleton />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data && task && (
          <>
            <div className="d-flex align-items-center mb-3 header-section">
              <Link
                to={backTarget}
                className="btn btn-secondary btn-sm me-2"
                id="back-btn"
              >
                <i className="bi bi-arrow-left" /> {t('detail.back')}
              </Link>
              <h5 className="mb-0">{t('detail.editTask')}</h5>
              <span
                className={`star-btn ms-auto${task.is_starred ? ' starred' : ''}`}
                id="star-btn"
                role="button"
                title={
                  task.is_starred ? t('task.unstar') : t('task.star')
                }
                onClick={flipStar}
              >
                <i
                  className={`bi ${task.is_starred ? 'bi-star-fill' : 'bi-star'}`}
                  id="star-icon"
                />
              </span>
            </div>

            <div className="task-meta">
              <div className="d-flex flex-wrap gap-2 align-items-center">
                <span
                  className="badge bg-secondary"
                  id="starred-badge"
                  style={{ display: task.is_starred ? '' : 'none' }}
                >
                  <i className="bi bi-star-fill" /> {t('detail.starred')}
                </span>
                {task.due && (
                  <span className="badge bg-secondary">
                    <i className="bi bi-calendar" />{' '}
                    {t('detail.due', {
                      date: formatFullDate(task.due),
                    })}
                  </span>
                )}
                {task.labels.map((label) => {
                  const color =
                    data.labels.find((l) => l.id === label.id)?.color ??
                    '#6c757d';
                  return (
                    <span
                      key={label.id}
                      className="badge"
                      style={{ backgroundColor: color }}
                    >
                      <i className="bi bi-tag" /> {label.name}
                    </span>
                  );
                })}
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
              id="task-form"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="mb-4">
                <label htmlFor="task-title" className="form-label fw-bold">
                  <i className="bi bi-text-left" /> {t('detail.titleLabel')}
                </label>
                <textarea
                  className="form-control form-control-lg"
                  id="task-title"
                  name="title"
                  required
                  maxLength={500}
                  rows={1}
                  placeholder={t('detail.titlePlaceholder')}
                  ref={titleRef}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <div className="form-text">{t('detail.titleHint')}</div>
              </div>

              <div className="mb-4">
                <label htmlFor="task-notes" className="form-label fw-bold">
                  <i className="bi bi-journal-text" />{' '}
                  {t('detail.notesLabel')}
                </label>
                <textarea
                  className="form-control"
                  id="task-notes"
                  name="notes"
                  rows={3}
                  placeholder={t('detail.notesPlaceholder')}
                  ref={notesRef}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
                <div className="form-text">{t('detail.notesHint')}</div>
              </div>

              <div className="mb-4">
                <label className="form-label fw-bold">
                  <i className="bi bi-tags" /> {t('detail.labelsLabel')}
                </label>
                <div id="label-selector" className="d-flex flex-wrap gap-2">
                  {data.labels.length > 0 ? (
                    data.labels.map((label) => (
                      <div className="form-check" key={label.id}>
                        <input
                          className="form-check-input label-checkbox"
                          type="checkbox"
                          value={label.id}
                          id={`label-${label.id}`}
                          checked={labelIds.includes(label.id)}
                          onChange={() =>
                            setLabelIds((prev) =>
                              prev.includes(label.id)
                                ? prev.filter((id) => id !== label.id)
                                : [...prev, label.id],
                            )
                          }
                        />
                        <label
                          className="form-check-label badge"
                          htmlFor={`label-${label.id}`}
                          style={{
                            backgroundColor: label.color,
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                          }}
                        >
                          {label.name}
                        </label>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted mb-0">{t('detail.noLabels')}</p>
                  )}
                </div>
                <div className="form-text">{t('detail.labelsHint')}</div>
              </div>

              <div className="row mb-4">
                <div className="col-md-6">
                  <label
                    htmlFor="task-order"
                    className="form-label fw-bold"
                  >
                    <i className="bi bi-sort-numeric-down" />{' '}
                    {t('detail.listOrder')}
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="form-control"
                    id="task-order"
                    name="task_order"
                    value={taskOrder}
                    onChange={(event) =>
                      setTaskOrder(event.target.value)
                    }
                  />
                  <div className="form-text">
                    {t('detail.listOrderHint')}
                  </div>
                </div>
                <div className="col-md-6">
                  <label
                    htmlFor="starred-order"
                    className="form-label fw-bold"
                  >
                    <i className="bi bi-star" /> {t('detail.starredOrder')}
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="form-control"
                    id="starred-order"
                    name="starred_order"
                    value={starredOrder}
                    onChange={(event) =>
                      setStarredOrder(event.target.value)
                    }
                  />
                  <div className="form-text">
                    {t('detail.starredOrderHint')}
                  </div>
                </div>
              </div>

              <div className="d-flex gap-2">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={updateTask.isPending}
                >
                  {updateTask.isPending ? (
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
                  className={`alert alert-${alert.kind} alert-dismissible fade show`}
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

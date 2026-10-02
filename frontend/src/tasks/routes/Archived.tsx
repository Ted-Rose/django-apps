import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import { BurgerMenu } from '../../shared/components/BurgerMenu';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { actionHistory } from '../actionHistory';
import { fetchArchived, type TaskOut } from '../api';
import SecondaryLabelDropdown from '../components/SecondaryLabelDropdown';
import Toasts from '../../shared/components/Toasts';
import { useToggleStar, useUnarchiveTask } from '../mutations';
import { formatFullDate, formatShortDate, truncateWords } from '../utils';
import { ErrorState, LoadingSkeleton } from './TaskListPage';

/**
 * React port of archived.html — a standalone template (not
 * dashboard.html), so its navbar is minimal: brand link, the
 * client-side secondary-label funnel, the search button and the
 * burger menu — no view/order dropdowns. `?label=`/`?order=` still
 * reach the API for deep links; `secondary_label` stays client-side
 * like the template JS.
 *
 * Cards match the template: star toggle, title, label badges, notes
 * (20-word truncate), due date and an Unarchive button — including on
 * the "Completed archived tasks" collapse, which auto-opens when the
 * secondary filter matches completed rows (archived.html's
 * selectSecondaryLabel).
 */
export default function Archived() {
  const { t } = useTranslation('tasks');
  const [searchParams] = useSearchParams();
  const label = searchParams.get('label');
  const order = searchParams.get('order') ?? 'order_asc';
  const secondaryLabel = searchParams.get('secondary_label') ?? '';
  const navigate = useNavigate();

  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  // ['dashboard', …] root key so unarchive/star mutations invalidate
  // and optimistic-patch this page like every other list view.
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', { view: 'archived', label, order }],
    queryFn: () => fetchArchived({ label, order }),
    placeholderData: keepPreviousData,
  });

  // filters.js saveCurrentView() — same as every tasks page.
  useEffect(() => {
    try {
      localStorage.setItem(
        'lastTasksView',
        window.location.pathname + window.location.search,
      );
    } catch {
      // Storage unavailable — non-fatal.
    }
  }, [label, order, secondaryLabel]);

  const labelColors = useMemo(
    () => new Map((data?.labels ?? []).map((l) => [l.name, l.color])),
    [data],
  );

  const visibleTasks = useMemo(() => {
    const tasks = data?.tasks ?? [];
    if (!secondaryLabel) return tasks;
    return tasks.filter((task) =>
      task.labels.some((l) => l.name === secondaryLabel),
    );
  }, [data, secondaryLabel]);

  const visibleCompleted = useMemo(() => {
    const completed = data?.completed ?? [];
    if (!secondaryLabel) return completed;
    return completed.filter((task) =>
      task.labels.some((l) => l.name === secondaryLabel),
    );
  }, [data, secondaryLabel]);

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
      onClick: () => navigate('/'),
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
      <nav
        className="navbar navbar-expand-lg navbar-dark bg-primary"
        style={{ padding: '0.1rem 0', minHeight: 'auto' }}
      >
        <div className="container-fluid" style={{ padding: '0 0.5rem' }}>
          <div className="d-flex align-items-center gap-1 flex-wrap flex-grow-1">
            <Link
              className="navbar-brand mb-0"
              to="/archived"
              style={{ fontSize: '1rem', padding: '0.25rem 0.5rem' }}
            >
              <i className="bi bi-archive" /> {t('archived.title')}
            </Link>
            {data && (
              <SecondaryLabelDropdown
                labels={data.labels}
                secondaryLabel={secondaryLabel}
              />
            )}
          </div>
          <div className="ms-auto d-flex flex-row align-items-center gap-2">
            <Link
              to="/search"
              className="btn btn-outline-light btn-sm"
              style={{ padding: '0.25rem 0.5rem' }}
              title={t('menu.searchTasks')}
            >
              <i className="bi bi-search" />
            </Link>
            <BurgerMenu items={burgerItems} />
          </div>
        </div>
      </nav>

      <div className="container-fluid px-2 py-4">
        {isPending && <LoadingSkeleton />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data && (
          <>
            {data.tasks.length > 0 ? (
              <div id="task-list">
                {visibleTasks.map((task) => (
                  <ArchivedTaskCard
                    key={task.task_id}
                    task={task}
                    labelColors={labelColors}
                  />
                ))}
              </div>
            ) : (
              data.completed.length === 0 && (
                <div className="alert alert-info">
                  <i className="bi bi-info-circle" /> {t('archived.empty')}
                </div>
              )
            )}
            {data.completed.length > 0 && (
              <ArchivedCompletedSection
                tasks={visibleCompleted}
                totalCount={data.completed.length}
                autoOpen={Boolean(
                  secondaryLabel && visibleCompleted.length > 0,
                )}
              />
            )}
          </>
        )}
      </div>
      <Toasts />
    </>
  );
}

function UnarchiveButton({ taskId }: { taskId: string }) {
  const { t } = useTranslation('tasks');
  const unarchiveTask = useUnarchiveTask();
  return (
    <button
      className="btn btn-sm btn-outline-primary"
      type="button"
      disabled={unarchiveTask.isPending}
      onClick={(event) => {
        event.stopPropagation();
        unarchiveTask.mutate(taskId);
      }}
    >
      <i className="bi bi-arrow-counterclockwise" />{' '}
      {t('archived.unarchive')}
    </button>
  );
}

function ArchivedTaskCard({
  task,
  labelColors,
}: {
  task: TaskOut;
  labelColors: Map<string, string>;
}) {
  const { t } = useTranslation('tasks');
  const toggleStar = useToggleStar();
  const due = formatFullDate(task.due);

  return (
    <div className="card task-card mb-2" data-task-id={task.task_id}>
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start">
          <div className="d-flex align-items-start flex-grow-1">
            <div className="flex-grow-1">
              <h5 className="card-title">
                <span
                  className={`star-btn me-1${task.is_starred ? ' starred' : ''}`}
                  role="button"
                  title={
                    task.is_starred ? t('task.unstar') : t('task.star')
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    actionHistory.recordAction({
                      type: 'TOGGLE_STAR',
                      taskId: task.task_id,
                      previousState: task.is_starred,
                    });
                    toggleStar.mutate(task.task_id);
                  }}
                >
                  <i
                    className={`bi ${
                      task.is_starred ? 'bi-star-fill' : 'bi-star'
                    }`}
                  />
                </span>
                {task.title}
              </h5>
              {task.labels.length > 0 && (
                <div className="mb-2">
                  {task.labels.map((label) => (
                    <span
                      key={label.id}
                      className="badge me-1"
                      style={{
                        backgroundColor:
                          labelColors.get(label.name) ?? '#6c757d',
                      }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              )}
              {task.notes && (
                <p className="card-text text-muted">
                  {truncateWords(task.notes, 20)}
                </p>
              )}
              {due && (
                <small className="text-muted">
                  <i className="bi bi-calendar" />{' '}
                  {t('task.due', { date: due })}
                </small>
              )}
            </div>
          </div>
          <div>
            <UnarchiveButton taskId={task.task_id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ArchivedCompletedSection({
  tasks,
  totalCount,
  autoOpen,
}: {
  tasks: TaskOut[];
  totalCount: number;
  autoOpen: boolean;
}) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  return (
    <div className="mt-2">
      <button
        className="btn btn-link text-muted text-decoration-none ps-0"
        type="button"
        aria-expanded={open}
        aria-controls="completedTasksCollapse"
        onClick={() => setOpen((prev) => !prev)}
      >
        <i
          className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`}
          id="completedChevron"
        />{' '}
        {t('archived.completedHeader', { count: totalCount })}
      </button>
      <div
        className={`collapse${open ? ' show' : ''}`}
        id="completedTasksCollapse"
      >
        <div className="mt-2">
          {tasks.map((task) => (
            <div
              className="card task-card mb-1 border-0 bg-light"
              data-task-id={task.task_id}
              key={task.task_id}
            >
              <div className="card-body py-1">
                <div className="d-flex justify-content-between align-items-center">
                  <div className="flex-grow-1">
                    <span className="text-decoration-line-through text-muted">
                      {task.title}
                    </span>
                    {task.completed && (
                      <small className="text-muted ms-2">
                        {formatShortDate(task.completed)}
                      </small>
                    )}
                  </div>
                  <div>
                    <UnarchiveButton taskId={task.task_id} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

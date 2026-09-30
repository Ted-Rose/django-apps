import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import { BurgerMenu } from '../../shared/components/BurgerMenu';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { fetchTrash, type TaskOut } from '../api';
import ConfirmModal from '../components/ConfirmModal';
import SecondaryLabelDropdown from '../components/SecondaryLabelDropdown';
import Toasts from '../components/Toasts';
import { usePermanentDeleteTask, useRestoreTask } from '../mutations';
import { formatFullDate, truncateWords } from '../utils';
import { ErrorState, LoadingSkeleton } from './TaskListPage';

/**
 * React port of trash.html — another standalone template, hence the
 * minimal navbar again (bg-danger this time, matching the template)
 * with only the secondary-label funnel besides brand/search/burger.
 *
 * Page extras the template shows and we keep: the "deleted after 30
 * days" warning note, the "Deleted: <date>" line from deleted_at
 * (TaskOut exposes it), Restore (POST /restore/) and Delete Forever
 * (POST /permanent-delete/, gated by the same warning modal —
 * irreversible, unlike the soft delete-to-trash flow).
 *
 * Ordering is deleted_at-driven on the server (`?order=deleted_asc`
 * is the only override), so there is no ordering dropdown — the
 * template doesn't render one either.
 */
export default function Trash() {
  const [searchParams] = useSearchParams();
  const label = searchParams.get('label');
  const order = searchParams.get('order') ?? 'deleted_desc';
  const secondaryLabel = searchParams.get('secondary_label') ?? '';
  const navigate = useNavigate();

  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', { view: 'trash', label, order }],
    queryFn: () => fetchTrash({ label, order }),
    placeholderData: keepPreviousData,
  });

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

  const burgerItems: BurgerMenuItem[] = [
    { label: 'Home', url: '/', icon: 'house', btn_class: 'btn-light' },
    {
      label: 'Dashboard',
      icon: 'list-task',
      btn_class: 'btn-primary',
      onClick: () => navigate('/'),
    },
    {
      label: `Logout (${user})`,
      url: '/admin/logout/',
      icon: 'box-arrow-right',
      btn_class: 'btn-outline-light',
    },
  ];

  return (
    <>
      <nav
        className="navbar navbar-expand-lg navbar-dark bg-danger"
        style={{ padding: '0.1rem 0', minHeight: 'auto' }}
      >
        <div className="container-fluid" style={{ padding: '0 0.5rem' }}>
          <div className="d-flex align-items-center gap-1 flex-wrap flex-grow-1">
            <Link
              className="navbar-brand mb-0"
              to="/trash"
              style={{ fontSize: '1rem', padding: '0.25rem 0.5rem' }}
            >
              <i className="bi bi-trash" /> Trash
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
              title="Search tasks"
            >
              <i className="bi bi-search" />
            </Link>
            <BurgerMenu items={burgerItems} />
          </div>
        </div>
      </nav>

      <div className="container-fluid px-2 py-4">
        <div className="alert alert-warning">
          <i className="bi bi-exclamation-triangle" /> <strong>Note:</strong>{' '}
          Tasks in trash will be automatically deleted after 30 days.
        </div>

        {isPending && <LoadingSkeleton />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data &&
          (data.tasks.length > 0 ? (
            <div id="task-list">
              {visibleTasks.map((task) => (
                <TrashTaskCard
                  key={task.task_id}
                  task={task}
                  labelColors={labelColors}
                />
              ))}
            </div>
          ) : (
            <div className="alert alert-info">
              <i className="bi bi-info-circle" /> Trash is empty.
            </div>
          ))}
      </div>
      <Toasts />
    </>
  );
}

function TrashTaskCard({
  task,
  labelColors,
}: {
  task: TaskOut;
  labelColors: Map<string, string>;
}) {
  const restoreTask = useRestoreTask();
  const permanentDelete = usePermanentDeleteTask();
  const [confirming, setConfirming] = useState(false);
  const deletedAt = formatFullDate(task.deleted_at);

  return (
    <div
      className="card task-card mb-2 border-danger"
      data-task-id={task.task_id}
    >
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start">
          <div className="d-flex align-items-start flex-grow-1">
            <div className="flex-grow-1">
              <h5 className="card-title text-muted">{task.title}</h5>
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
              {deletedAt && (
                <small className="text-muted">
                  <i className="bi bi-trash" /> Deleted: {deletedAt}
                </small>
              )}
            </div>
          </div>
          <div className="d-flex gap-2">
            <button
              className="btn btn-sm btn-outline-primary"
              type="button"
              disabled={restoreTask.isPending}
              onClick={() => restoreTask.mutate(task.task_id)}
            >
              <i className="bi bi-arrow-counterclockwise" /> Restore
            </button>
            <button
              className="btn btn-sm btn-outline-danger"
              type="button"
              onClick={() => setConfirming(true)}
            >
              <i className="bi bi-x-circle" /> Delete Forever
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        show={confirming}
        title="Permanently Delete Task"
        confirmLabel="Delete Forever"
        confirmIcon="x-circle"
        confirmClassName="btn-danger"
        busy={permanentDelete.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() =>
          permanentDelete.mutate(task.task_id, {
            onSuccess: () => setConfirming(false),
          })
        }
      >
        <p>
          <strong>Warning:</strong> This action cannot be undone!
        </p>
        <p>Are you sure you want to permanently delete this task?</p>
        <p className="fw-bold">{task.title}</p>
      </ConfirmModal>
    </div>
  );
}

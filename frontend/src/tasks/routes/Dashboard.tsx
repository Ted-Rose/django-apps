import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiPost } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { fetchDashboard, type DashboardOut } from '../api';
import CompletedSection from '../components/CompletedSection';
import DividerCard from '../components/DividerCard';
import TaskCard from '../components/TaskCard';
import TaskFormModal from '../components/TaskFormModal';
import TaskNavBar from '../components/TaskNavBar';
import Toasts from '../components/Toasts';
import { useCreateDivider, useProcessLabels } from '../mutations';
import { pushToast } from '../toasts';

/**
 * React port of dashboard.html — the `?list=&label=&order=` params
 * drive GET /api/tasks/dashboard/ (shareable URL state, same contract
 * as the template view), while `secondary_label` stays a client-side
 * filter exactly like filters.js.
 *
 * Stage 3: task mutations are wired (star/complete/archive/delete/
 * edit on the cards, Add Divider / Process Labels / Sync Now in the
 * burger menu, and the floating "+" create-task button). Reorder,
 * undo/redo and autosync arrive in Stage 4.
 */
export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const list = searchParams.get('list');
  const label = searchParams.get('label');
  const order = searchParams.get('order') ?? 'order_asc';
  const secondaryLabel = searchParams.get('secondary_label') ?? '';

  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';
  const queryClient = useQueryClient();

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', { list, label, order }],
    queryFn: () => fetchDashboard({ list, label, order }),
    // Keep the current list visible while a filter change refetches.
    placeholderData: keepPreviousData,
  });

  const syncMutation = useMutation({
    mutationFn: () => apiPost('/api/tasks/sync/'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
  });

  const createDivider = useCreateDivider();
  const processLabels = useProcessLabels();
  const [creatingTask, setCreatingTask] = useState(false);

  // filters.js saveCurrentView(): remember the last tasks view so a
  // future "back from search" flow can restore it.
  useEffect(() => {
    try {
      localStorage.setItem(
        'lastTasksView',
        window.location.pathname + window.location.search,
      );
    } catch {
      // Storage unavailable — non-fatal.
    }
  }, [list, label, order, secondaryLabel]);

  const labelColors = useMemo(
    () => new Map((data?.labels ?? []).map((l) => [l.name, l.color])),
    [data],
  );

  // Client-side secondary_label filter (filters.js selectSecondaryLabel):
  // a row stays visible when it carries a label badge with that name.
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

  const hasCredentials = data?.flags.has_credentials ?? false;
  const loginUrl = `/login/?next=${encodeURIComponent(
    window.location.pathname + window.location.search,
  )}`;

  const burgerItems: BurgerMenuItem[] = [
    { label: 'Home', url: '/', icon: 'house', btn_class: 'btn-light' },
    {
      label: 'Template UI',
      url: '/tasks/',
      icon: 'card-list',
      btn_class: 'btn-light',
    },
  ];
  if (hasCredentials) {
    burgerItems.push(
      {
        label: 'Add Divider',
        icon: 'dash-lg',
        btn_class: 'btn-primary',
        onClick: () => {
          // dividers.js: ?list= first, else the first task list;
          // without either the template alerted the user to pick one.
          const listId = list ?? data?.task_lists[0]?.list_id;
          if (!listId) {
            pushToast(
              'Please select a specific task list first — ' +
                'dividers must belong to a task list.',
              'warning',
            );
            return;
          }
          createDivider.mutate({ task_list_id: listId, is_starred: false });
        },
      },
      {
        label: processLabels.isPending ? 'Processing…' : 'Process Labels',
        icon: 'tags',
        btn_class: 'btn-success',
        onClick: () => processLabels.mutate(),
      },
      {
        label: syncMutation.isPending ? 'Syncing…' : 'Sync Now',
        icon: 'arrow-repeat',
        btn_class: 'btn-light',
        onClick: () => syncMutation.mutate(),
      },
      {
        label: `Logout (${user})`,
        url: '/admin/logout/',
        icon: 'box-arrow-right',
        btn_class: 'btn-outline-light',
      },
    );
  } else {
    burgerItems.push({
      label: 'Login with Google',
      url: loginUrl,
      icon: 'google',
      btn_class: 'btn-warning',
    });
  }

  return (
    <>
      <TaskNavBar
        data={data}
        secondaryLabel={secondaryLabel}
        burgerItems={burgerItems}
      />
      <div className="container-fluid px-2 py-4">
        {isPending && <LoadingSkeleton />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {syncMutation.isError && (
          <div className="alert alert-warning py-2" role="alert">
            <i className="bi bi-exclamation-triangle" /> Sync failed — the task
            list may be stale.
          </div>
        )}
        {data && (
          <>
            {data.tasks.length > 0 ? (
              <div id="task-list">
                {visibleTasks.map((task, index) =>
                  task.is_divider ? (
                    <DividerCard key={task.task_id} task={task} />
                  ) : (
                    <TaskCard
                      key={task.task_id}
                      task={task}
                      position={index + 1}
                      labelColors={labelColors}
                      labels={data.labels}
                      starredView={data.flags.is_starred_view}
                    />
                  ),
                )}
              </div>
            ) : (
              data.completed.length === 0 && <EmptyState data={data} />
            )}
            {data.completed.length > 0 && (
              <CompletedSection
                tasks={visibleCompleted}
                totalCount={data.completed.length}
                labelColors={labelColors}
                autoOpen={Boolean(secondaryLabel)}
              />
            )}
          </>
        )}
      </div>

      {data && hasCredentials && (
        <>
          {/* floating_controls.html: "+" opens the create modal */}
          <button
            className="floating-add-btn"
            type="button"
            title="Create new task"
            onClick={() => setCreatingTask(true)}
          >
            <i className="bi bi-plus" />
          </button>
          <TaskFormModal
            show={creatingTask}
            mode="create"
            labels={data.labels}
            taskListId={list}
            onClose={() => setCreatingTask(false)}
          />
        </>
      )}
      <Toasts />
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div id="task-list" aria-busy="true" aria-label="Loading tasks">
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

function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const message =
    error instanceof ApiError
      ? `${error.message}`
      : 'Could not reach the server. Check your connection.';
  return (
    <div className="alert alert-danger text-center py-5" role="alert">
      <i className="bi bi-exclamation-circle fs-1 d-block mb-3" />
      <h5>Couldn&apos;t load tasks</h5>
      <p className="mb-3">{message}</p>
      <button
        type="button"
        className="btn btn-outline-danger"
        onClick={onRetry}
      >
        <i className="bi bi-arrow-repeat" /> Retry
      </button>
    </div>
  );
}

/** dashboard.html's empty state: auth prompt or "no tasks" hint. */
function EmptyState({ data }: { data: DashboardOut }) {
  if (!data.flags.has_credentials) {
    const loginUrl = `/login/?next=${encodeURIComponent(
      window.location.pathname + window.location.search,
    )}`;
    return (
      <div className="alert alert-info text-center py-5">
        <i className="bi bi-shield-lock fs-1 d-block mb-3 text-warning" />
        <h5>Google Authentication Required</h5>
        <p className="mb-3">
          You need to authenticate with Google to access your tasks.
        </p>
        <a href={loginUrl} className="btn btn-warning btn-lg">
          <i className="bi bi-google" /> Login with Google
        </a>
      </div>
    );
  }
  const starred = data.flags.is_starred_view;
  return (
    <div className="alert alert-info text-center py-5">
      <i className="bi bi-info-circle fs-1 d-block mb-3" />
      <h5>{starred ? 'No starred tasks yet' : 'No tasks found'}</h5>
      <p className="mb-0">
        {starred
          ? 'Star tasks from the main dashboard to see them here.'
          : 'Click "Sync Now" in the menu to fetch your tasks from Google.'}
      </p>
    </div>
  );
}

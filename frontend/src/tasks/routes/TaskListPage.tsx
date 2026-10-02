import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useTranslation } from 'react-i18next';
import { errorDetail } from '../../shared/api/errors';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { actionHistory } from '../actionHistory';
import {
  fetchDashboard,
  fetchOverdue,
  fetchStarred,
  type DashboardOut,
} from '../api';
import CompletedSection from '../components/CompletedSection';
import DividerCard from '../components/DividerCard';
import TaskCard from '../components/TaskCard';
import TaskFormModal from '../components/TaskFormModal';
import TaskNavBar from '../components/TaskNavBar';
import Toasts from '../../shared/components/Toasts';
import {
  useCreateDivider,
  useProcessLabels,
  useReorderTasks,
  useSync,
} from '../mutations';
import {
  computeDropReorder,
  computeRankReorder,
  isManualOrder,
  noteDragFinished,
  positionField,
} from '../reorder';
import { pushToast } from '../../shared/toasts';
import useAutosync from '../useAutosync';
import useUndoRedo from '../useUndoRedo';

/**
 * The dashboard.html-shaped pages share one implementation: the
 * template renders dashboard.html for `dashboard`, `starred_tasks`
 * and `overdue_tasks` (same navbar dropdowns, task list, completed
 * section and floating controls — the view flags decide details),
 * and the API returns the same DashboardOut shape per view.
 *
 * Stage 5: the page takes a `view` so /starred and /overdue reuse
 * everything Dashboard introduced in Stages 2–4 (star toggles,
 * complete/delete/edit, dividers, dnd-kit reorder, undo/redo,
 * autosync). Differences vs the dashboard:
 *
 * - `?list=` filtering is dashboard-only — the special-view API
 *   endpoints don't accept it (filters.js navigates back to the
 *   dashboard when a list/label is picked from a special view, which
 *   TaskNavBar replicates).
 * - The starred view drags/posts starred_order through
 *   /api/tasks/starred/reorder/ (reorder.ts pickers handle that) and
 *   Add Divider posts {is_starred: true} like dividers.js.
 *
 * Every dashboard-shaped page queries under the ['dashboard', …]
 * root (with a `view` discriminator) so the mutations module's
 * optimistic patches and invalidations reach every list view.
 */
export type ListView = 'dashboard' | 'starred' | 'overdue';

const FETCHERS: Record<
  'dashboard' | 'starred' | 'overdue',
  (params: {
    list?: string | null;
    label?: string | null;
    order?: string;
  }) => Promise<DashboardOut>
> = {
  dashboard: fetchDashboard,
  starred: fetchStarred,
  overdue: fetchOverdue,
};

export function TaskListPage({ view }: { view: ListView }) {
  const { t } = useTranslation('tasks');
  const [searchParams] = useSearchParams();
  // Only the main dashboard carries the ?list= filter.
  const list = view === 'dashboard' ? searchParams.get('list') : null;
  const label = searchParams.get('label');
  const order = searchParams.get('order') ?? 'order_asc';
  const secondaryLabel = searchParams.get('secondary_label') ?? '';

  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', { view, list, label, order }],
    queryFn: () => FETCHERS[view]({ list, label, order }),
    // Keep the current list visible while a filter change refetches.
    placeholderData: keepPreviousData,
  });

  // Failure surfaces as a shared toast inside useSync; isPending
  // drives the "Syncing…" menu label.
  const syncMutation = useSync();

  const createDivider = useCreateDivider();
  const processLabels = useProcessLabels();
  const reorder = useReorderTasks();
  const [creatingTask, setCreatingTask] = useState(false);

  const starredView = data?.flags.is_starred_view ?? false;
  const field = positionField(starredView);

  const { undo, redo, canUndo, canRedo } = useUndoRedo({
    tasks: data?.tasks ?? [],
    starredView,
    taskListId: starredView ? null : list,
  });

  // autosync.js — 5-minute loop + stale-load/visible-tab catch-up,
  // gated on has_credentials. The API's sync op runs server-side
  // label processing already, so no second call is needed.
  const hasCredentials = data?.flags.has_credentials ?? false;
  useAutosync(hasCredentials, syncMutation.mutate);

  // Drag sensors — SortableJS used a plain mouse/pointer drag plus a
  // 200ms long-press on touch (delayOnTouchOnly).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // The floating_controls.html "Order saved" badge, shown ~2s after a
  // successful reorder POST.
  const [orderSaved, setOrderSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashOrderSaved = useCallback(() => {
    setOrderSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setOrderSaved(false), 2000);
  }, []);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

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

  // main.js keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or
  // Ctrl/Cmd+Shift+Z redo. (Small fix over the original: skip while
  // typing in an input/textarea so text fields keep native undo.)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && !event.shiftKey && key === 'z') {
        event.preventDefault();
        undo();
      } else if (mod && (key === 'y' || (event.shiftKey && key === 'z'))) {
        event.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  const labelColors = useMemo(
    () => new Map((data?.labels ?? []).map((l) => [l.name, l.color])),
    [data],
  );

  // Client-side secondary_label filter (filters.js selectSecondaryLabel):
  // a row stays visible when it carries a label badge with that name.
  // Divider cards are not .task-container in the template, so the
  // original filter never hides them — keep them visible here too.
  const visibleTasks = useMemo(() => {
    const tasks = data?.tasks ?? [];
    if (!secondaryLabel) return tasks;
    return tasks.filter(
      (task) =>
        task.is_divider || task.labels.some((l) => l.name === secondaryLabel),
    );
  }, [data, secondaryLabel]);

  // Order badge positions in the UNFILTERED list. The template renders
  // forloop.counter and selectSecondaryLabel only hides rows (no
  // renumbering), so filtered lists keep their original numbers —
  // gaps included. forloop.counter counts dividers too, hence the map
  // is built over data.tasks.
  const taskPositions = useMemo(
    () =>
      new Map(
        (data?.tasks ?? []).map((task, index) => [task.task_id, index + 1]),
      ),
    [data],
  );

  const visibleCompleted = useMemo(() => {
    const completed = data?.completed ?? [];
    if (!secondaryLabel) return completed;
    return completed.filter((task) =>
      task.labels.some((l) => l.name === secondaryLabel),
    );
  }, [data, secondaryLabel]);

  const visibleIds = useMemo(
    () => visibleTasks.map((task) => task.task_id),
    [visibleTasks],
  );

  // Drag is only meaningful when the displayed order is the manual
  // position field — see the component docstring. The old UI also
  // kept it on under secondary_label filtering, so we do too.
  const dragEnabled = isManualOrder(order);

  const postReorder = useCallback(
    (result: {
      order: string[];
      updates: { task_id: string; position: number }[];
      positions: Record<string, number>;
    }) => {
      reorder.mutate(
        {
          updates: result.updates,
          order: result.order,
          positions: result.positions,
          starredView,
          taskListId: starredView ? null : list,
        },
        { onSuccess: flashOrderSaved },
      );
    },
    [reorder, starredView, list, flashOrderSaved],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      noteDragFinished();
      const { active, over } = event;
      if (!over || active.id === over.id || !data) return;
      const result = computeDropReorder(
        data.tasks,
        visibleIds,
        String(active.id),
        String(over.id),
        field,
      );
      if (!result) return;
      // reorder.js onEnd records before posting; the snapshot is the
      // pre-drag order (the cache is untouched until onMutate).
      actionHistory.recordAction({
        type: 'REORDER_TASKS',
        previousOrder: data.tasks.map((task) => task.task_id),
        newOrder: result.order,
      });
      postReorder(result);
    },
    [data, visibleIds, field, postReorder],
  );

  /** task_actions.js setTaskOrder — order-badge preset ranks. */
  const handleSetRank = useCallback(
    (taskId: string, rank: number) => {
      if (!data) return;
      const result = computeRankReorder(data.tasks, taskId, rank, field);
      if (result) postReorder(result);
    },
    [data, field, postReorder],
  );

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
  ];
  if (hasCredentials) {
    burgerItems.push(
      {
        label: t('menu.addDivider'),
        icon: 'dash-lg',
        btn_class: 'btn-primary',
        onClick: () => {
          if (starredView) {
            // dividers.js createDivider starred branch: no task_list,
            // the view assigns starred_order = max+1.
            createDivider.mutate({ is_starred: true });
            return;
          }
          // dividers.js: ?list= first, else the first task list;
          // without either the template alerted the user to pick one.
          const listId = list ?? data?.task_lists[0]?.list_id;
          if (!listId) {
            pushToast(t('list.dividerNoList'), 'warning');
            return;
          }
          createDivider.mutate({ task_list_id: listId, is_starred: false });
        },
      },
      {
        label: processLabels.isPending
          ? t('menu.processing')
          : t('menu.processLabels'),
        icon: 'tags',
        btn_class: 'btn-success',
        onClick: () => processLabels.mutate(),
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
      <TaskNavBar
        data={data}
        secondaryLabel={secondaryLabel}
        burgerItems={burgerItems}
      />
      <div className="container-fluid px-2 py-4">
        {isPending && <LoadingSkeleton />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data && (
          <>
            {data.tasks.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                onDragCancel={noteDragFinished}
              >
                <SortableContext
                  items={visibleIds}
                  strategy={verticalListSortingStrategy}
                >
                  <div id="task-list">
                    {visibleTasks.map((task) =>
                      task.is_divider ? (
                        <DividerCard
                          key={task.task_id}
                          task={task}
                          draggable={dragEnabled}
                          starredView={starredView}
                        />
                      ) : (
                        <TaskCard
                          key={task.task_id}
                          task={task}
                          position={taskPositions.get(task.task_id) ?? 0}
                          labelColors={labelColors}
                          labels={data.labels}
                          starredView={starredView}
                          draggable={dragEnabled}
                          onSetRank={(rank) =>
                            handleSetRank(task.task_id, rank)
                          }
                        />
                      ),
                    )}
                  </div>
                </SortableContext>
              </DndContext>
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
            title={t('list.createTask')}
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
          {/* floating_controls.html undo/redo (hidden without creds) */}
          <div className="undo-redo-controls">
            <button
              id="undo-btn"
              className="btn btn-primary"
              type="button"
              title={t('list.undo')}
              disabled={!canUndo}
              onClick={undo}
            >
              <i className="bi bi-arrow-counterclockwise" />
            </button>
            <button
              id="redo-btn"
              className="btn btn-secondary"
              type="button"
              title={t('list.redo')}
              disabled={!canRedo}
              onClick={redo}
            >
              <i className="bi bi-arrow-clockwise" />
            </button>
          </div>
        </>
      )}

      {/* floating_controls.html save indicator — CSS keeps it hidden
          by default, so visibility is toggled inline. */}
      <div
        id="save-indicator"
        style={{ display: orderSaved ? 'block' : 'none' }}
      >
        <span className="badge bg-success fs-6 px-3 py-2">
          <i className="bi bi-check-circle" /> {t('list.orderSaved')}
        </span>
      </div>

      <Toasts />
    </>
  );
}

export function LoadingSkeleton() {
  const { t } = useTranslation('tasks');
  return (
    <div id="task-list" aria-busy="true" aria-label={t('list.loading')}>
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
  const { t } = useTranslation('tasks');
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

/** dashboard.html's empty state: auth prompt or "no tasks" hint. */
export function EmptyState({ data }: { data: DashboardOut }) {
  const { t } = useTranslation('tasks');
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
  const starred = data.flags.is_starred_view;
  return (
    <div className="alert alert-info text-center py-5">
      <i className="bi bi-info-circle fs-1 d-block mb-3" />
      <h5>{starred ? t('list.noStarred') : t('list.noTasks')}</h5>
      <p className="mb-0">
        {starred ? t('list.starHint') : t('list.syncHint')}
      </p>
    </div>
  );
}

export default TaskListPage;

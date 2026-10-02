/**
 * Undo/redo dispatch — port of action_history.js performUndo/performRedo
 * and reorder.js reorderTasksToOrder (the full-order restore posts
 * sequential positions through the same reorder mutation a drag uses).
 *
 * The hook closes over the current view context; callers pass the
 * dashboard's tasks + flags so a REORDER restore only submits ids that
 * still exist (the old code skipped cards absent from the DOM).
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { actionHistory, useActionHistory } from './actionHistory';
import type { TaskOut } from './api';
import {
  useCompleteTask,
  useReorderTasks,
  useToggleStar,
  useUncompleteTask,
  useUpdateDivider,
} from './mutations';
import { fullOrderUpdates } from './reorder';
import { pushToast } from '../shared/toasts';

interface UndoRedoContext {
  /** Current full active list (for REORDER id filtering). */
  tasks: TaskOut[];
  starredView: boolean;
  /** ?list= filter — forwarded as task_list_id on the dashboard
   *  reorder endpoint, like postReorderUpdates. */
  taskListId: string | null;
}

export function useUndoRedo({
  tasks,
  starredView,
  taskListId,
}: UndoRedoContext) {
  const { t } = useTranslation('tasks');
  const { canUndo, canRedo } = useActionHistory();

  const toggleStar = useToggleStar();
  const completeTask = useCompleteTask();
  const uncompleteTask = useUncompleteTask();
  const updateDivider = useUpdateDivider();
  const reorder = useReorderTasks();

  /** reorderTasksToOrder(order): POST sequential positions + patch
   *  the cache to the snapshot order. */
  const restoreOrder = useCallback(
    (order: string[]) => {
      const updates = fullOrderUpdates(order, tasks);
      if (updates.length === 0) return;
      reorder.mutate({
        updates,
        order,
        positions: Object.fromEntries(
          updates.map((u) => [u.task_id, u.position]),
        ),
        starredView,
        taskListId,
      });
    },
    [tasks, reorder, starredView, taskListId],
  );

  const undo = useCallback(() => {
    const action = actionHistory.undo();
    if (!action) return;

    switch (action.type) {
      case 'TOGGLE_STAR':
        toggleStar.mutate(action.taskId);
        pushToast(
          t(action.previousState ? 'undo.unstar' : 'undo.star'),
          'info',
        );
        break;
      case 'COMPLETE_TASK':
        uncompleteTask.mutate(action.taskId);
        pushToast(t('undo.complete', { title: action.taskTitle }), 'info');
        break;
      case 'UNCOMPLETE_TASK':
        completeTask.mutate(action.taskId);
        pushToast(t('undo.uncomplete', { title: action.taskTitle }), 'info');
        break;
      case 'ARCHIVE_TASK':
        pushToast(t('undo.archiveUnavailable'), 'info');
        actionHistory.recordAction(action);
        break;
      case 'DELETE_TASK':
        pushToast(t('undo.deleteUnavailable'), 'info');
        actionHistory.recordAction(action);
        break;
      case 'DELETE_DIVIDER':
        pushToast(t('undo.dividerUnavailable'), 'info');
        actionHistory.recordAction(action);
        break;
      case 'UPDATE_DIVIDER':
        updateDivider.mutate({
          taskId: action.taskId,
          title: action.previousText,
        });
        pushToast(t('undo.dividerText'), 'info');
        break;
      case 'REORDER_TASKS':
        restoreOrder(action.previousOrder);
        pushToast(t('undo.reorder'), 'info');
        break;
    }
  }, [
    t,
    toggleStar,
    uncompleteTask,
    completeTask,
    updateDivider,
    restoreOrder,
  ]);

  const redo = useCallback(() => {
    const action = actionHistory.redo();
    if (!action) return;

    switch (action.type) {
      case 'TOGGLE_STAR':
        toggleStar.mutate(action.taskId);
        pushToast(
          t(action.previousState ? 'redo.star' : 'redo.unstar'),
          'info',
        );
        break;
      case 'COMPLETE_TASK':
        completeTask.mutate(action.taskId);
        pushToast(t('redo.complete', { title: action.taskTitle }), 'info');
        break;
      case 'UNCOMPLETE_TASK':
        uncompleteTask.mutate(action.taskId);
        pushToast(t('redo.uncomplete', { title: action.taskTitle }), 'info');
        break;
      case 'UPDATE_DIVIDER':
        updateDivider.mutate({
          taskId: action.taskId,
          title: action.newText,
        });
        pushToast(t('redo.dividerText'), 'info');
        break;
      case 'REORDER_TASKS':
        restoreOrder(action.newOrder);
        pushToast(t('redo.reorder'), 'info');
        break;
      default:
        pushToast(t('redo.cannot'), 'info');
        break;
    }
  }, [
    t,
    toggleStar,
    completeTask,
    uncompleteTask,
    updateDivider,
    restoreOrder,
  ]);

  return { undo, redo, canUndo, canRedo };
}

export default useUndoRedo;

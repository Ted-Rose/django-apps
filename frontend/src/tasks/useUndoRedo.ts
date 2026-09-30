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
import { pushToast } from './toasts';

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
          `Undid ${action.previousState ? 'unstar' : 'star'} action`,
          'info',
        );
        break;
      case 'COMPLETE_TASK':
        uncompleteTask.mutate(action.taskId);
        pushToast(`Undid complete: ${action.taskTitle}`, 'info');
        break;
      case 'UNCOMPLETE_TASK':
        completeTask.mutate(action.taskId);
        pushToast(`Undid uncomplete: ${action.taskTitle}`, 'info');
        break;
      case 'ARCHIVE_TASK':
        pushToast(
          'Cannot undo archive - please restore from Archive view',
          'info',
        );
        actionHistory.recordAction(action);
        break;
      case 'DELETE_TASK':
        pushToast(
          'Cannot undo delete - please restore from Trash view',
          'info',
        );
        actionHistory.recordAction(action);
        break;
      case 'DELETE_DIVIDER':
        pushToast(
          'Cannot undo divider deletion - please recreate manually',
          'info',
        );
        actionHistory.recordAction(action);
        break;
      case 'UPDATE_DIVIDER':
        updateDivider.mutate({
          taskId: action.taskId,
          title: action.previousText,
        });
        pushToast('Undid divider text update', 'info');
        break;
      case 'REORDER_TASKS':
        restoreOrder(action.previousOrder);
        pushToast('Undid task reorder', 'info');
        break;
    }
  }, [toggleStar, uncompleteTask, completeTask, updateDivider, restoreOrder]);

  const redo = useCallback(() => {
    const action = actionHistory.redo();
    if (!action) return;

    switch (action.type) {
      case 'TOGGLE_STAR':
        toggleStar.mutate(action.taskId);
        pushToast(
          `Redid ${action.previousState ? 'star' : 'unstar'} action`,
          'info',
        );
        break;
      case 'COMPLETE_TASK':
        completeTask.mutate(action.taskId);
        pushToast(`Redid complete: ${action.taskTitle}`, 'info');
        break;
      case 'UNCOMPLETE_TASK':
        uncompleteTask.mutate(action.taskId);
        pushToast(`Redid uncomplete: ${action.taskTitle}`, 'info');
        break;
      case 'UPDATE_DIVIDER':
        updateDivider.mutate({
          taskId: action.taskId,
          title: action.newText,
        });
        pushToast('Redid divider text update', 'info');
        break;
      case 'REORDER_TASKS':
        restoreOrder(action.newOrder);
        pushToast('Redid task reorder', 'info');
        break;
      default:
        pushToast('Cannot redo this action', 'info');
        break;
    }
  }, [toggleStar, completeTask, uncompleteTask, updateDivider, restoreOrder]);

  return { undo, redo, canUndo, canRedo };
}

export default useUndoRedo;

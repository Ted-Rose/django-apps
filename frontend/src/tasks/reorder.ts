/**
 * Reorder helpers — pure functions ported from the template UI's
 * js/dashboard/utils.js + reorder.js + task_actions.js (setTaskOrder).
 *
 * Ordering model: float positions on `task_order` (dashboard/overdue)
 * or `starred_order` (starred view). A single-task drop computes the
 * midpoint of its new neighbours; undo/redo restores a full order by
 * assigning sequential positions 1..n (the server's two-phase swap
 * keeps that safe under the per-user unique constraint).
 */
import type { TaskOut } from './api';

export type PositionField = 'task_order' | 'starred_order';

export interface ReorderUpdate {
  task_id: string;
  position: number;
}

/** Server-side REORDER_CAP (views.py) — payloads above it are 400/422. */
export const REORDER_CAP = 500;

/**
 * reorder.js/SortableJS was active on every `#task-list` render
 * regardless of `?order=` — but under non-manual sorts a position
 * write has no visible effect (the server ordering doesn't read
 * task_order), so the dragged row would snap back on the next
 * refetch. The SPA therefore only enables drag when the displayed
 * order IS the manual position order.
 */
export function isManualOrder(orderBy: string): boolean {
  return orderBy === 'order_asc' || orderBy === 'order_desc';
}

/** The reorder endpoint and position field depend on the view. */
export function reorderUrl(starredView: boolean): string {
  return starredView
    ? '/api/tasks/starred/reorder/'
    : '/api/tasks/tasks/reorder/';
}

export function positionField(starredView: boolean): PositionField {
  return starredView ? 'starred_order' : 'task_order';
}

export function positionOf(task: TaskOut, field: PositionField): number | null {
  const value = task[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * utils.js midpointPosition — midpoint between neighbours; drops at
 * the top take `next - 1`, at the bottom `prev + 1`, and a positionless
 * list falls back to a timestamp seed.
 */
export function midpointPosition(
  prev: number | null | undefined,
  next: number | null | undefined,
): number {
  if (prev != null && next != null) return (prev + next) / 2;
  if (next != null) return next - 1;
  if (prev != null) return prev + 1;
  return Date.now() / 1000;
}

export interface DropReorderResult {
  /** Full id order after the move (optimistic patch + undo snapshot). */
  order: string[];
  /** Single-task update to POST (what reorder.js sends on drop). */
  updates: ReorderUpdate[];
  /** Position to write into the cached task row. */
  positions: Record<string, number>;
}

/**
 * Compute the result of dropping `activeId` onto `overId`.
 *
 * `visibleIds` is the rendered (possibly secondary_label-filtered)
 * row order — it is what dnd-kit moves within. Neighbour positions for
 * the midpoint come from the visible neighbours; in the old UI hidden
 * `.task-hidden` rows stayed in the DOM and could supply a neighbour,
 * here the filtered list simply picks the next rendered one. The
 * optimistic full order inserts the moved id right before its new
 * visible successor (or after its predecessor / at the end).
 *
 * Returns null when the drop is a no-op (unknown id, same slot).
 */
export function computeDropReorder(
  tasks: TaskOut[],
  visibleIds: string[],
  activeId: string,
  overId: string,
  field: PositionField,
): DropReorderResult | null {
  const from = visibleIds.indexOf(activeId);
  const to = visibleIds.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;

  const newVisible = [...visibleIds];
  newVisible.splice(to, 0, newVisible.splice(from, 1)[0]);

  const prevId = to > 0 ? newVisible[to - 1] : undefined;
  const nextId = to < newVisible.length - 1 ? newVisible[to + 1] : undefined;

  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  const pos = (id: string | undefined) => {
    const task = id ? byId.get(id) : undefined;
    return task ? positionOf(task, field) : null;
  };
  const position = midpointPosition(pos(prevId), pos(nextId));

  // Rebuild the full order: the moved id lands just before its new
  // visible successor so any hidden rows keep their relative slots.
  const ids = tasks.map((t) => t.task_id).filter((id) => id !== activeId);
  let insertAt = ids.length;
  if (nextId !== undefined && ids.indexOf(nextId) !== -1) {
    insertAt = ids.indexOf(nextId);
  } else if (prevId !== undefined && ids.indexOf(prevId) !== -1) {
    insertAt = ids.indexOf(prevId) + 1;
  }
  ids.splice(insertAt, 0, activeId);

  return {
    order: ids,
    updates: [{ task_id: activeId, position }],
    positions: { [activeId]: position },
  };
}

/**
 * task_actions.js setTaskOrder — move `taskId` to 1-based `rank`
 * (clamped) by the same midpoint trick as a drag drop. Returns the
 * same shape as computeDropReorder, or null for no-ops.
 */
export function computeRankReorder(
  tasks: TaskOut[],
  taskId: string,
  rank: number,
  field: PositionField,
): DropReorderResult | null {
  const ids = tasks.map((t) => t.task_id);
  if (!ids.includes(taskId) || ids.length < 2) return null;
  const others = ids.filter((id) => id !== taskId);
  const clamped = Math.max(1, Math.min(rank, others.length + 1));
  const prevId = others[clamped - 2];
  const nextId = others[clamped - 1];

  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  const pos = (id: string | undefined) => {
    const task = id ? byId.get(id) : undefined;
    return task ? positionOf(task, field) : null;
  };
  const position = midpointPosition(pos(prevId), pos(nextId));

  const order = [...others];
  order.splice(clamped - 1, 0, taskId);

  return {
    order,
    updates: [{ task_id: taskId, position }],
    positions: { [taskId]: position },
  };
}

/**
 * reorder.js reorderTasksToOrder — the undo/redo restore path. Listed
 * ids get sequential positions 1..n; ids not present in `tasks` are
 * skipped (the old code only posted cards found in the DOM). Capped
 * at REORDER_CAP like the server.
 */
export function fullOrderUpdates(
  order: string[],
  tasks: TaskOut[],
): ReorderUpdate[] {
  const present = new Set(tasks.map((t) => t.task_id));
  const updates: ReorderUpdate[] = [];
  for (const id of order) {
    if (present.has(id)) {
      updates.push({ task_id: id, position: updates.length + 1 });
      if (updates.length >= REORDER_CAP) break;
    }
  }
  return updates;
}

/**
 * Reorder the cached task array to `order`. Mirrors the DOM port:
 * reorderTasksToOrder appended each listed card to the end in order,
 * so ids missing from `order` (e.g. tasks created after the snapshot)
 * end up first, in their original relative order.
 */
export function orderTasksByIds(tasks: TaskOut[], order: string[]): TaskOut[] {
  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  const listed: TaskOut[] = [];
  for (const id of order) {
    const task = byId.get(id);
    if (task) {
      listed.push(task);
      byId.delete(id);
    }
  }
  const unlisted = tasks.filter((t) => byId.has(t.task_id));
  return [...unlisted, ...listed];
}

/* --- Link-click suppression during/just after a drag (reorder.js) ---
 * The old code suppressed .task-title-link clicks while dragging and
 * when the mouse was held >150ms (drag intent), and stashed the
 * current URL as `taskListReferrer` for the detail page's back link.
 * Kept module-level so card components can check it without props. */

let dragFinishedAt: number | null = null;
let pressStartedAt: number | null = null;

/** Pointer went down on a draggable card body. */
export function noteCardPressStart(): void {
  pressStartedAt = Date.now();
}

/** Drag ended or was cancelled. */
export function noteDragFinished(): void {
  dragFinishedAt = Date.now();
}

/**
 * Whether a click on a task title link should be swallowed. The
 * hold-check only applies when a pointer press was actually recorded
 * (a keyboard-triggered click has no pointerdown — the old code
 * accidentally suppressed those too, which broke keyboard nav).
 */
export function shouldSuppressTaskClick(now = Date.now()): boolean {
  const justDragged = dragFinishedAt !== null && now - dragFinishedAt < 150;
  const heldPress = pressStartedAt !== null && now - pressStartedAt > 150;
  pressStartedAt = null;
  return justDragged || heldPress;
}

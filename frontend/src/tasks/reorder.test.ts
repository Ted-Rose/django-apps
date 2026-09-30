import { describe, expect, it } from 'vitest';
import type { TaskOut } from './api';
import {
  REORDER_CAP,
  computeDropReorder,
  computeRankReorder,
  fullOrderUpdates,
  isManualOrder,
  midpointPosition,
  orderTasksByIds,
  positionField,
  reorderUrl,
} from './reorder';

function makeTask(id: string, taskOrder: number | null = null): TaskOut {
  return {
    task_id: id,
    title: id,
    status: 'needsAction',
    is_starred: false,
    is_divider: false,
    labels: [],
    is_archived: false,
    is_deleted: false,
    needs_push: false,
    task_order: taskOrder,
    ...{},
  } as TaskOut;
}

describe('midpointPosition (utils.js port)', () => {
  it('averages two neighbours', () => {
    expect(midpointPosition(2, 6)).toBe(4);
    expect(midpointPosition(1.5, 2.5)).toBe(2);
  });

  it('drops below the first item and above the last', () => {
    expect(midpointPosition(null, 6)).toBe(5);
    expect(midpointPosition(3, null)).toBe(4);
    expect(midpointPosition(undefined, 6)).toBe(5);
  });

  it('falls back to a timestamp seed with no neighbours', () => {
    expect(midpointPosition(null, null)).toBeCloseTo(Date.now() / 1000, -2);
  });
});

describe('isManualOrder / reorderUrl / positionField (gating)', () => {
  it('enables drag only for the manual position sorts', () => {
    expect(isManualOrder('order_asc')).toBe(true);
    expect(isManualOrder('order_desc')).toBe(true);
    for (const other of [
      'due_asc',
      'due_desc',
      'created_asc',
      'created_desc',
      'completed_first',
      'completed_last',
    ]) {
      expect(isManualOrder(other)).toBe(false);
    }
  });

  it('targets the dashboard endpoint/field by default', () => {
    expect(reorderUrl(false)).toBe('/api/tasks/tasks/reorder/');
    expect(positionField(false)).toBe('task_order');
  });

  it('targets the starred endpoint/field in the starred view', () => {
    expect(reorderUrl(true)).toBe('/api/tasks/starred/reorder/');
    expect(positionField(true)).toBe('starred_order');
  });
});

describe('computeDropReorder', () => {
  const tasks = [
    makeTask('a', 1),
    makeTask('b', 2),
    makeTask('c', 3),
    makeTask('d', 4),
  ];
  const ids = tasks.map((t) => t.task_id);

  it('computes the midpoint between new neighbours on a mid-list drop', () => {
    const result = computeDropReorder(tasks, ids, 'd', 'b', 'task_order')!;
    expect(result.updates).toEqual([{ task_id: 'd', position: 1.5 }]);
    expect(result.order).toEqual(['a', 'd', 'b', 'c']);
    expect(result.positions).toEqual({ d: 1.5 });
  });

  it('drops on top take next-1, drops at the bottom take prev+1', () => {
    const top = computeDropReorder(tasks, ids, 'c', 'a', 'task_order')!;
    expect(top.updates).toEqual([{ task_id: 'c', position: 0 }]);
    expect(top.order).toEqual(['c', 'a', 'b', 'd']);

    const bottom = computeDropReorder(tasks, ids, 'a', 'd', 'task_order')!;
    expect(bottom.updates).toEqual([{ task_id: 'a', position: 5 }]);
    expect(bottom.order).toEqual(['b', 'c', 'd', 'a']);
  });

  it('returns null for a no-op drop', () => {
    expect(computeDropReorder(tasks, ids, 'b', 'b', 'task_order')).toBeNull();
    expect(computeDropReorder(tasks, ids, 'x', 'b', 'task_order')).toBeNull();
    expect(computeDropReorder(tasks, ids, 'b', 'x', 'task_order')).toBeNull();
  });

  it('handles a secondary_label-filtered view (visibleIds is a subset)', () => {
    // 'b' is filtered out of the rendered list; drop 'd' between the
    // two visible neighbours 'a' and 'c'.
    const visible = ['a', 'c', 'd'];
    const result = computeDropReorder(tasks, visible, 'd', 'c', 'task_order')!;
    expect(result.updates).toEqual([{ task_id: 'd', position: 2 }]);
    // Inserted before 'c' in the full order — hidden 'b' keeps its slot.
    expect(result.order).toEqual(['a', 'b', 'd', 'c']);
  });

  it('uses starred_order positions in the starred view', () => {
    const starred = tasks.map((t) => ({
      ...t,
      task_order: null,
      starred_order: t.task_order,
    }));
    const result = computeDropReorder(starred, ids, 'd', 'b', 'starred_order')!;
    expect(result.updates[0].position).toBe(1.5);
  });

  it('treats missing positions like the parseFloat NaN fallbacks', () => {
    const noPos = [makeTask('a'), makeTask('b'), makeTask('c')];
    const ids2 = noPos.map((t) => t.task_id);
    const result = computeDropReorder(noPos, ids2, 'c', 'a', 'task_order')!;
    // Both neighbours positionless → timestamp seed.
    expect(result.updates[0].position).toBeGreaterThan(1_000_000);
  });
});

describe('computeRankReorder (setTaskOrder port)', () => {
  const tasks = [makeTask('a', 1), makeTask('b', 2), makeTask('c', 3)];

  it('clamps the rank into the list and midpoints the neighbours', () => {
    const result = computeRankReorder(tasks, 'c', 1, 'task_order')!;
    expect(result.updates).toEqual([{ task_id: 'c', position: 0 }]);
    expect(result.order).toEqual(['c', 'a', 'b']);
  });

  it('moves to the end when the rank exceeds the list length', () => {
    const result = computeRankReorder(tasks, 'a', 50, 'task_order')!;
    expect(result.updates).toEqual([{ task_id: 'a', position: 4 }]);
    expect(result.order).toEqual(['b', 'c', 'a']);
  });
});

describe('fullOrderUpdates (reorderTasksToOrder payload)', () => {
  it('assigns sequential 1..n positions to ids still present', () => {
    const tasks = [makeTask('a'), makeTask('b')];
    expect(fullOrderUpdates(['b', 'gone', 'a'], tasks)).toEqual([
      { task_id: 'b', position: 1 },
      { task_id: 'a', position: 2 },
    ]);
  });

  it('caps the payload at REORDER_CAP', () => {
    const order = Array.from({ length: 600 }, (_, i) => `t${i}`);
    const tasks = order.map((id) => makeTask(id));
    const updates = fullOrderUpdates(order, tasks);
    expect(updates).toHaveLength(REORDER_CAP);
    expect(updates[REORDER_CAP - 1].position).toBe(REORDER_CAP);
  });
});

describe('orderTasksByIds (DOM appendChild port)', () => {
  it('reorders the cache rows and keeps unlisted rows first', () => {
    const tasks = [makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d')];
    // Snapshot order predates a 'new' task and skips 'a' (deleted).
    const result = orderTasksByIds(tasks, ['d', 'b']);
    expect(result.map((t) => t.task_id)).toEqual(['a', 'c', 'd', 'b']);
  });
});

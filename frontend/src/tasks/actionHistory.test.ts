import { beforeEach, describe, expect, it } from 'vitest';
import {
  HISTORY_STORAGE_KEY,
  actionHistory,
  resetActionHistory,
  type StoredAction,
} from './actionHistory';

function stored(): { undoStack: StoredAction[]; redoStack: StoredAction[] } {
  const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
  return raw ? JSON.parse(raw) : { undoStack: [], redoStack: [] };
}

beforeEach(() => {
  resetActionHistory();
});

describe('actionHistory (action_history.js port)', () => {
  it('records actions with a timestamp and persists to localStorage', () => {
    actionHistory.recordAction({
      type: 'TOGGLE_STAR',
      taskId: 't1',
      previousState: false,
    });
    expect(actionHistory.canUndo()).toBe(true);
    expect(actionHistory.canRedo()).toBe(false);
    const { undoStack } = stored();
    expect(undoStack).toHaveLength(1);
    expect(undoStack[0].type).toBe('TOGGLE_STAR');
    expect(typeof undoStack[0].timestamp).toBe('number');
  });

  it('caps the undo stack at 50 actions', () => {
    for (let i = 0; i < 60; i++) {
      actionHistory.recordAction({
        type: 'COMPLETE_TASK',
        taskId: `t${i}`,
        taskTitle: `Task ${i}`,
      });
    }
    const { undoStack } = stored();
    expect(undoStack).toHaveLength(50);
    // Oldest actions were shifted out.
    expect(undoStack[0]).toMatchObject({ taskId: 't10' });
    expect(undoStack[49]).toMatchObject({ taskId: 't59' });
  });

  it('recording a new action clears the redo stack', () => {
    actionHistory.recordAction({
      type: 'REORDER_TASKS',
      previousOrder: ['a', 'b'],
      newOrder: ['b', 'a'],
    });
    actionHistory.undo();
    expect(actionHistory.canRedo()).toBe(true);
    actionHistory.recordAction({
      type: 'TOGGLE_STAR',
      taskId: 't1',
      previousState: true,
    });
    expect(actionHistory.canRedo()).toBe(false);
  });

  it('undo pops to the redo stack and redo pops back', () => {
    actionHistory.recordAction({
      type: 'REORDER_TASKS',
      previousOrder: ['a', 'b'],
      newOrder: ['b', 'a'],
    });
    const undone = actionHistory.undo();
    expect(undone?.type).toBe('REORDER_TASKS');
    expect(actionHistory.canUndo()).toBe(false);
    expect(actionHistory.canRedo()).toBe(true);

    const redone = actionHistory.redo();
    expect(redone?.type).toBe('REORDER_TASKS');
    expect(actionHistory.canUndo()).toBe(true);
    expect(actionHistory.canRedo()).toBe(false);
  });

  it('undo/redo on empty stacks return null', () => {
    expect(actionHistory.undo()).toBeNull();
    expect(actionHistory.redo()).toBeNull();
  });

  it('round-trips through localStorage on reload', () => {
    actionHistory.recordAction({
      type: 'UPDATE_DIVIDER',
      taskId: 'd1',
      previousText: 'Old',
      newText: 'New',
    });
    actionHistory.undo(); // now sits on the redo stack

    // Simulate a page reload: clear memory, keep the stored payload.
    const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
    resetActionHistory();
    localStorage.setItem(HISTORY_STORAGE_KEY, saved!);
    actionHistory.loadFromStorage();
    expect(actionHistory.canRedo()).toBe(true);
    const action = actionHistory.redo();
    expect(action).toMatchObject({
      type: 'UPDATE_DIVIDER',
      taskId: 'd1',
      newText: 'New',
    });
  });

  it('survives corrupt localStorage payloads', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, '{not json');
    actionHistory.loadFromStorage();
    expect(actionHistory.canUndo()).toBe(false);
    expect(actionHistory.canRedo()).toBe(false);
  });
});

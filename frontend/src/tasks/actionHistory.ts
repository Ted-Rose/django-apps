/**
 * Undo/redo history — port of js/dashboard/action_history.js.
 *
 * Same semantics: two stacks persisted to localStorage under
 * `taskActionHistory`, each capped at 50 actions; recording a new
 * action clears the redo stack. Module-level singleton (like
 * toasts.ts) so cards can record without prop drilling; React sees
 * `canUndo`/`canRedo` through useSyncExternalStore.
 *
 * Action payloads match the old store. Undo/redo dispatch lives in
 * `useUndoRedo` — it needs the mutation hooks, so it can't be here.
 */
import { useSyncExternalStore } from 'react';

export type HistoryAction =
  | { type: 'TOGGLE_STAR'; taskId: string; previousState: boolean }
  | {
      type:
        'COMPLETE_TASK' | 'UNCOMPLETE_TASK' | 'ARCHIVE_TASK' | 'DELETE_TASK';
      taskId: string;
      taskTitle: string;
    }
  | { type: 'DELETE_DIVIDER'; taskId: string; dividerText?: string }
  | {
      type: 'UPDATE_DIVIDER';
      taskId: string;
      previousText: string;
      newText: string;
    }
  | { type: 'REORDER_TASKS'; previousOrder: string[]; newOrder: string[] };

export type StoredAction = HistoryAction & { timestamp: number };

export const HISTORY_STORAGE_KEY = 'taskActionHistory';
const MAX_STACK_SIZE = 50;

let undoStack: StoredAction[] = [];
let redoStack: StoredAction[] = [];
const listeners = new Set<() => void>();

interface HistoryFlags {
  canUndo: boolean;
  canRedo: boolean;
}

let snapshot: HistoryFlags = { canUndo: false, canRedo: false };

function emit() {
  snapshot = {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
  listeners.forEach((listener) => listener());
}

function saveToStorage() {
  try {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({
        undoStack: undoStack.slice(-MAX_STACK_SIZE),
        redoStack: redoStack.slice(-MAX_STACK_SIZE),
      }),
    );
  } catch {
    // Storage unavailable (private mode etc.) — non-fatal, as before.
  }
}

/** Reload both stacks from localStorage (also the test hook). */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredStacks>) : null;
    undoStack = parsed?.undoStack ?? [];
    redoStack = parsed?.redoStack ?? [];
  } catch {
    undoStack = [];
    redoStack = [];
  }
  emit();
}

interface StoredStacks {
  undoStack: StoredAction[];
  redoStack: StoredAction[];
}

export const actionHistory = {
  recordAction(action: HistoryAction): void {
    undoStack.push({ ...action, timestamp: Date.now() });
    if (undoStack.length > MAX_STACK_SIZE) {
      undoStack.shift();
    }
    redoStack = [];
    saveToStorage();
    emit();
  },

  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,
  lastAction: () => undoStack[undoStack.length - 1],

  /** Pop the top undoable action onto the redo stack. */
  undo(): StoredAction | null {
    const action = undoStack.pop();
    if (!action) return null;
    redoStack.push(action);
    saveToStorage();
    emit();
    return action;
  },

  redo(): StoredAction | null {
    const action = redoStack.pop();
    if (!action) return null;
    undoStack.push(action);
    saveToStorage();
    emit();
    return action;
  },

  clear(): void {
    undoStack = [];
    redoStack = [];
    saveToStorage();
    emit();
  },

  loadFromStorage,
};

/** Test helper — clear stacks and persisted state. */
export function resetActionHistory(): void {
  undoStack = [];
  redoStack = [];
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // ignore
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive {canUndo, canRedo} for the floating buttons. */
export function useActionHistory(): HistoryFlags {
  return useSyncExternalStore(subscribe, () => snapshot);
}

// Hydrate once at module load, like `new ActionHistory()` did.
loadFromStorage();

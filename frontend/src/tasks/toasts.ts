/**
 * Minimal toast store for mutation feedback — the template UI uses
 * alert(); the SPA renders floating Bootstrap alerts in the
 * `.action-toast` corner (styles already in dashboard.css). Lives at
 * module level so any mutation hook can report without prop drilling.
 */
import { useSyncExternalStore } from 'react';

export type ToastKind = 'success' | 'danger' | 'warning' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const AUTO_DISMISS_MS = 6000;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function pushToast(text: string, kind: ToastKind = 'danger') {
  const id = nextId++;
  toasts = [...toasts, { id, kind, text }];
  emit();
  setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
  return id;
}

/** Test helper — empty the stack between tests. */
export function clearToasts() {
  toasts = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts);
}

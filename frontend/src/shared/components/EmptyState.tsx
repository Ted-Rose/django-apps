import type { ReactNode } from 'react';

/**
 * Centered empty state on `.ui-empty` (shared/ui.css): large muted
 * icon, a short title and a hint/CTA below — replaces the hand-rolled
 * `alert alert-*` blocks. Copy comes in via props so callers keep
 * using their own locale namespace (mirror of the finance
 * EmptyState, generalized onto .ui-* classes).
 */
export function EmptyState({
  icon,
  title,
  children,
}: {
  /** Bootstrap icon name without the `bi-` prefix. */
  icon: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <i className={`bi bi-${icon} ui-empty-icon`} aria-hidden="true" />
      <h2 className="h5 mb-1">{title}</h2>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export default EmptyState;

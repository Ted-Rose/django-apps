import type { ReactNode } from 'react';

/**
 * Centered empty state: large muted icon, a short title, and a
 * hint/CTA below — replaces the `alert alert-info` blocks.
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
    <div className="fin-empty">
      <i className={`bi bi-${icon}`} aria-hidden="true" />
      <h2 className="h5 mb-1">{title}</h2>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export default EmptyState;

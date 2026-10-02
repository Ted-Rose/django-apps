import { useState, type ReactNode } from 'react';

/**
 * Card with a clickable header (title + count badge + chevron) that
 * expands/collapses the body — the `collapse`/`show` class toggle
 * from tasks' CompletedSection. `actions` render right-aligned in
 * the header so they stay reachable while the body is collapsed.
 */
export function CollapsibleCard({
  id,
  title,
  count,
  actions,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card fin-card fin-collapsible">
      <div className="card-header d-flex flex-wrap align-items-center gap-2">
        <button
          type="button"
          className="btn btn-link link-body-emphasis text-decoration-none p-0 d-flex align-items-center gap-2"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((prev) => !prev)}
        >
          <i
            className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`}
          />
          <span className="fw-semibold">{title}</span>
          {count !== undefined && (
            <span className="badge rounded-pill text-bg-light border">
              {count}
            </span>
          )}
        </button>
        {actions && (
          <div className="ms-auto d-flex flex-wrap gap-2">{actions}</div>
        )}
      </div>
      <div id={id} className={`collapse${open ? ' show' : ''}`}>
        <div className="card-body">{children}</div>
      </div>
    </div>
  );
}

export default CollapsibleCard;

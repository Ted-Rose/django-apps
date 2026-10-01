import { useId, type ReactNode } from 'react';

/**
 * A Bootstrap card whose body collapses behind a chevron button in
 * the header (right-pointing when closed, down when open — same
 * chevron convention as the tasks app). The body stays mounted and
 * only toggles `collapse`/`show`, so effects inside children keep
 * running while the section is hidden.
 */
export function CollapsibleCard({
  title,
  open,
  onToggle,
  badge,
  children,
}: {
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Optional status chip between the title and the chevron. */
  badge?: ReactNode;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div className="card mb-3">
      <h2 className="card-header h6 mb-0 py-2">
        <button
          type="button"
          className="btn w-100 p-0 d-flex align-items-center gap-2 border-0"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="fw-semibold">{title}</span>
          {badge}
          <i
            className={`bi ms-auto ${
              open ? 'bi-chevron-down' : 'bi-chevron-right'
            }`}
            aria-hidden="true"
          />
        </button>
      </h2>
      <div id={bodyId} className={`collapse${open ? ' show' : ''}`}>
        <div className="card-body">{children}</div>
      </div>
    </div>
  );
}

export default CollapsibleCard;

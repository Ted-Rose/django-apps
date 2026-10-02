import type { ReactNode } from 'react';

/**
 * Uniform page chrome for every finance route: the `.fin-app` gray
 * canvas, a centered `container` at `.fin-page` width (`narrow`
 * caps it at 44rem for single-column flows), and a page header
 * row with title, optional subtitle, and right-aligned actions.
 * Replaces the per-route `container-fluid px-2 py-4` + bare `h1`.
 */
export function PageShell({
  title,
  subtitle,
  actions,
  narrow = false,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fin-app">
      <div className={`container fin-page${narrow ? ' fin-page-narrow' : ''}`}>
        <header className="fin-page-header d-flex flex-wrap justify-content-between align-items-start gap-2 mb-4">
          <div>
            <h1 className="mb-1">{title}</h1>
            {subtitle && <p className="text-muted mb-0">{subtitle}</p>}
          </div>
          {actions && (
            <div className="d-flex gap-2 flex-wrap align-items-center">
              {actions}
            </div>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}

export default PageShell;

import type { ReactNode } from 'react';

/**
 * Headline number tile: muted label (with optional icon) above a
 * large tabular figure and an optional muted subline. Used for
 * totals on Balances and CategoryOverview.
 */
export function StatCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: ReactNode;
  icon?: string;
  sub?: ReactNode;
}) {
  return (
    <div className="fin-card p-3 h-100">
      <div className="d-flex align-items-center gap-2 text-muted small">
        {icon && <i className={`bi bi-${icon}`} aria-hidden="true" />}
        <span>{label}</span>
      </div>
      <div className="fin-money fs-4 fw-semibold mt-1">{value}</div>
      {sub && <div className="text-muted small mt-1">{sub}</div>}
    </div>
  );
}

export default StatCard;

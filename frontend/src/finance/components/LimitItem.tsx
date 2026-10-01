import type { LimitOut, WindowStatOut } from '../api';
import CategoryBadge from './CategoryBadge';
import { useDeleteLimit } from '../mutations';

/** Past-month history rows share the window-stat shape minus
 *  `history` (api.py's WindowStatBase). */
type HistoryMonthOut = WindowStatOut['history'][number];

/**
 * One limit in the overview list — a compact card meant to stack
 * without scrolling on a phone, replacing the old five-column
 * table. The header line carries the category badge ("All" when
 * unset), the account name, a "Paused" badge for inactive limits,
 * and the edit/delete actions; each window renders as one label +
 * amounts line above a thin progress bar, with the past-month
 * <details> history kept on the monthly window.
 *
 * `spent`/`threshold`/`remaining`/`over`/`pct`/`bar_pct` arrive
 * precomputed as Decimal strings from `limit_window_stats` —
 * rendered verbatim, never parsed into floats.
 */
export function LimitItem({
  limit,
  onEdit,
}: {
  limit: LimitOut;
  onEdit: () => void;
}) {
  const deleteLimit = useDeleteLimit();
  const currency = limit.account.currency;

  return (
    <div
      className="border rounded-3 px-2 px-sm-3 py-2 mb-2"
      data-testid={`limit-${limit.id}`}
    >
      <div className="d-flex align-items-center gap-2">
        {limit.category ? (
          <CategoryBadge category={limit.category} />
        ) : (
          <span className="text-muted">All</span>
        )}
        <span
          className="text-muted small text-truncate flex-grow-1"
          style={{ minWidth: 0 }}
        >
          {limit.account.name || limit.account.iban}
        </span>
        {!limit.is_active && (
          <span className="badge text-bg-secondary">Paused</span>
        )}
        <button
          type="button"
          className="btn btn-sm btn-outline-primary"
          title="Edit"
          aria-label={`Edit limit ${limit.id}`}
          onClick={onEdit}
        >
          <i className="bi bi-pencil" />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-danger"
          title="Delete"
          aria-label={`Delete limit ${limit.id}`}
          disabled={deleteLimit.isPending}
          onClick={() => deleteLimit.mutate(limit.id)}
        >
          <i className="bi bi-trash" />
        </button>
      </div>
      {limit.window_stats.length > 0 ? (
        limit.window_stats.map((window) => (
          <WindowStat key={window.label} stat={window} currency={currency} />
        ))
      ) : (
        <div className="small text-muted mt-2">No windows set</div>
      )}
    </div>
  );
}

/**
 * One window's spend-vs-threshold block compressed to two lines:
 * the label + `spent / threshold currency` + colored
 * remaining/over text on one line (wrapping under on narrow
 * screens), then the progress bar (bar_class + bar_pct are
 * precomputed server-side).
 */
function WindowStat({
  stat,
  currency,
}: {
  stat: WindowStatOut;
  currency: string;
}) {
  return (
    <div className="mt-2">
      <div className="d-flex justify-content-between align-items-baseline gap-2 flex-wrap small">
        <span className="text-muted">{stat.label}</span>
        <span className="ms-auto text-nowrap">
          {stat.spent} / {stat.threshold} {currency}{' '}
          <span
            className={stat.over ? 'text-danger fw-semibold' : 'text-muted'}
          >
            {stat.over
              ? `${stat.over} ${currency} over`
              : `${stat.remaining} ${currency} left`}
          </span>
        </span>
      </div>
      <div className="progress mt-1" style={{ height: '5px' }}>
        <div
          className={`progress-bar ${stat.bar_class}`}
          role="progressbar"
          style={{ width: `${stat.bar_pct}%` }}
        />
      </div>
      {stat.history.length > 0 && (
        <details className="mt-1">
          <summary className="small text-muted">Past months</summary>
          {stat.history.map((month) => (
            <HistoryMonth key={month.label} month={month} currency={currency} />
          ))}
        </details>
      )}
    </div>
  );
}

/** One past-month row inside the <details> block. */
function HistoryMonth({
  month,
  currency,
}: {
  month: HistoryMonthOut;
  currency: string;
}) {
  return (
    <div className="mt-2">
      <div className="d-flex justify-content-between small">
        <span>{month.label}</span>
        <span>
          {month.spent} / {month.threshold} {currency}
        </span>
      </div>
      <div className="progress" style={{ height: '4px' }}>
        <div
          className={`progress-bar ${month.bar_class}`}
          style={{ width: `${month.bar_pct}%` }}
        />
      </div>
    </div>
  );
}

export default LimitItem;

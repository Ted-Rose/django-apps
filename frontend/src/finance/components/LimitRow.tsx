import type { LimitOut, WindowStatOut } from '../api';
import CategoryBadge from './CategoryBadge';
import { useDeleteLimit } from '../mutations';

/** Past-month history rows share the window-stat shape minus
 *  `history` (api.py's WindowStatBase). */
type HistoryMonthOut = WindowStatOut['history'][number];

/**
 * One row of the limits table ported from limits.html — account
 * name (iban fallback), category badge ("All" when unset), the
 * per-window progress bars with their past-month <details>
 * history, the active icon, and edit/delete actions.
 *
 * `spent`/`threshold`/`remaining`/`over`/`pct`/`bar_pct` arrive
 * precomputed as Decimal strings from `limit_window_stats` —
 * rendered verbatim, never parsed into floats.
 */
export function LimitRow({
  limit,
  onEdit,
}: {
  limit: LimitOut;
  onEdit: () => void;
}) {
  const deleteLimit = useDeleteLimit();
  const currency = limit.account.currency;

  return (
    <tr>
      <td>{limit.account.name || limit.account.iban}</td>
      <td>
        {limit.category ? (
          <CategoryBadge category={limit.category} />
        ) : (
          <span className="text-muted">All</span>
        )}
      </td>
      <td>
        {limit.window_stats.length > 0 ? (
          limit.window_stats.map((window) => (
            <WindowStat key={window.label} stat={window} currency={currency} />
          ))
        ) : (
          <span className="text-muted">No windows set</span>
        )}
      </td>
      <td>
        {limit.is_active ? (
          <i className="bi bi-check-circle text-success" />
        ) : (
          <i className="bi bi-x-circle text-muted" />
        )}
      </td>
      <td className="text-nowrap">
        <button
          type="button"
          className="btn btn-sm btn-outline-primary"
          title="Edit"
          aria-label={`Edit limit ${limit.id}`}
          onClick={onEdit}
        >
          <i className="bi bi-pencil" />
        </button>{' '}
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
      </td>
    </tr>
  );
}

/**
 * One window's spend-vs-threshold block: label, `spent / threshold
 * currency`, the colored progress bar (bar_class + bar_pct are
 * precomputed server-side), the remaining/over line, and the
 * expandable past-month history the monthly window carries.
 */
function WindowStat({
  stat,
  currency,
}: {
  stat: WindowStatOut;
  currency: string;
}) {
  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between small">
        <span>{stat.label}</span>
        <span>
          {stat.spent} / {stat.threshold} {currency}
        </span>
      </div>
      <div className="progress" style={{ height: '6px' }}>
        <div
          className={`progress-bar ${stat.bar_class}`}
          role="progressbar"
          style={{ width: `${stat.bar_pct}%` }}
        />
      </div>
      <div
        className={`small ${
          stat.over ? 'text-danger fw-semibold' : 'text-muted'
        }`}
      >
        {stat.over ? (
          <>
            {stat.over} {currency} over
          </>
        ) : (
          <>
            {stat.remaining} {currency} left
          </>
        )}
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

export default LimitRow;

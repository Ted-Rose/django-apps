import { useTranslation } from 'react-i18next';
import type { LimitOut, WindowStatOut } from '../api';
import CategoryBadge from './CategoryBadge';
import { fmtMonth } from '../../shared/format';
import { useDeleteLimit } from '../mutations';

/** Past-month history rows share the window-stat shape minus
 *  `history` (api.py's WindowStatBase). */
type HistoryMonthOut = WindowStatOut['history'][number];
type StatBase = Omit<WindowStatOut, 'history'>;

/**
 * One limit in the overview list — a compact card meant to stack
 * without scrolling on a phone, replacing the old five-column
 * table. The header line carries the category badge ("All" when
 * unset), the account names, a "Paused" pill for inactive limits,
 * and the grouped edit/delete ghost icon buttons; each window
 * renders as one label + amounts line above a progress bar, with
 * the past-month <details> history kept on the monthly window.
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
  const { t } = useTranslation('finance');
  const deleteLimit = useDeleteLimit();
  const currency = limit.accounts[0]?.currency ?? '';

  return (
    <div className="limit-item" data-testid={`limit-${limit.id}`}>
      <div className="d-flex align-items-center gap-2">
        {limit.category ? (
          <CategoryBadge category={limit.category} />
        ) : (
          <span className="text-muted small">{t('limits.item.all')}</span>
        )}
        <span
          className="text-muted small text-truncate flex-grow-1"
          style={{ minWidth: 0 }}
        >
          {limit.accounts.map((a) => a.name || a.iban).join(', ')}
        </span>
        {!limit.is_active && (
          <span className="badge rounded-pill text-bg-secondary">
            {t('limits.item.paused')}
          </span>
        )}
        <div className="btn-group btn-group-sm">
          <button
            type="button"
            className="btn btn-outline-secondary"
            title={t('common:common.edit')}
            aria-label={t('limits.item.editAria', { id: limit.id })}
            onClick={onEdit}
          >
            <i className="bi bi-pencil" />
          </button>
          <button
            type="button"
            className="btn btn-outline-danger"
            title={t('common:common.delete')}
            aria-label={t('limits.item.deleteAria', { id: limit.id })}
            disabled={deleteLimit.isPending}
            onClick={() => deleteLimit.mutate(limit.id)}
          >
            <i className="bi bi-trash" />
          </button>
        </div>
      </div>
      {limit.window_stats.length > 0 ? (
        limit.window_stats.map((window, index) => (
          <WindowStat
            key={window.key ?? window.value ?? index}
            stat={window}
            currency={currency}
          />
        ))
      ) : (
        <div className="small text-muted mt-2">
          {t('limits.item.noWindows')}
        </div>
      )}
    </div>
  );
}

/**
 * A window or history row's label: the server's `key` selects a
 * catalog translation (server:windows.*), `value` (YYYY-MM) goes
 * through fmtMonth, and `label` is the English fallback.
 */
function useStatLabel() {
  const { t } = useTranslation('finance');
  return (stat: StatBase): string => {
    if (stat.key) {
      return t(`server:windows.${stat.key}`, {
        defaultValue: stat.label,
      });
    }
    if (stat.value) return fmtMonth(stat.value);
    return stat.label;
  };
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
  const { t } = useTranslation('finance');
  const statLabel = useStatLabel();
  return (
    <div className="mt-3">
      <div className="d-flex justify-content-between align-items-baseline gap-2 flex-wrap small">
        <span className="text-muted">{statLabel(stat)}</span>
        <span className="ms-auto text-nowrap">
          <span className="fin-money">
            {stat.spent} / {stat.threshold} {currency}
          </span>{' '}
          <span
            className={`fin-money ${
              stat.over ? 'text-danger fw-semibold' : 'text-muted'
            }`}
          >
            {stat.over
              ? t('limits.item.over', {
                  amount: stat.over,
                  currency,
                })
              : t('limits.item.left', {
                  amount: stat.remaining,
                  currency,
                })}
          </span>
        </span>
      </div>
      <div className="progress mt-1" style={{ height: '8px' }}>
        <div
          className={`progress-bar ${stat.bar_class}`}
          role="progressbar"
          style={{ width: `${stat.bar_pct}%` }}
        />
      </div>
      {stat.history.length > 0 && (
        <details className="mt-1">
          <summary className="small text-muted">
            {t('limits.item.pastMonths')}
          </summary>
          {stat.history.map((month) => (
            <HistoryMonth
              key={month.value ?? month.label}
              month={month}
              currency={currency}
            />
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
  const statLabel = useStatLabel();
  return (
    <div className="mt-2">
      <div className="d-flex justify-content-between small">
        <span>{statLabel(month)}</span>
        <span className="fin-money">
          {month.spent} / {month.threshold} {currency}
        </span>
      </div>
      <div className="progress" style={{ height: '5px' }}>
        <div
          className={`progress-bar ${month.bar_class}`}
          style={{ width: `${month.bar_pct}%` }}
        />
      </div>
    </div>
  );
}

export default LimitItem;

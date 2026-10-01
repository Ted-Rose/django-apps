import { Suspense, lazy, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FinanceNavBar from '../components/FinanceNavBar';
import PageShell from '../components/PageShell';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ErrorState from '../components/ErrorState';
import CategoryBadge from '../components/CategoryBadge';
// Lazy-loaded so recharts stays out of the main finance chunk.
const CategoryChart = lazy(() => import('../components/CategoryChart'));
import MoneyText from '../components/MoneyText';
import Toasts from '../../shared/components/Toasts';
import { fetchCategoryOverview, type CategoryRowOut } from '../api';
import './categories.css';

/**
 * React port of category_overview.html — per-category spending
 * totals over a selectable time window. `from`/`to`/`account` live
 * in the URL (the template's GET form + preset hrefs become
 * `useSearchParams` writes), the `periods` list renders the preset
 * chips ("All time" clears the dates), and the table groups rows +
 * totals by currency exactly like the template's `totals` dict.
 *
 * Money arrives as Decimal-serialized strings and renders as-is;
 * `net`'s sign picks the text-danger/success class and the '+'
 * prefix. Headline StatCards surface spent/received per currency,
 * a recharts donut (CategoryChart) shows the spending share, and
 * the breakdown table stays three slim columns so it fits narrow
 * screens — the tx count is secondary text under the badge.
 */
export default function CategoryOverview() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = {
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    account: searchParams.get('account') ?? '',
  };
  // The account filter is a PK — ignore non-numeric garbage the
  // same way the ORM-side int lookup would.
  const accountId = /^\d+$/.test(params.account)
    ? Number(params.account)
    : null;

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'category-overview', params],
    queryFn: () =>
      fetchCategoryOverview({
        from: params.from,
        to: params.to,
        account: accountId,
      }),
  });

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of ['from', 'to', 'account'] as const) {
      const value = String(form.get(key) ?? '').trim();
      if (value) next.set(key, value);
    }
    setSearchParams(next);
  };

  /** Preset period click — the template's `?from=&to=` hrefs. */
  const selectPeriod = (dateFrom: string, dateTo: string) => {
    const next = new URLSearchParams();
    if (dateFrom) next.set('from', dateFrom);
    if (dateTo) next.set('to', dateTo);
    if (params.account) next.set('account', params.account);
    setSearchParams(next);
  };

  return (
    <>
      <FinanceNavBar />
      <PageShell
        title="Category spending"
        subtitle="Per-category totals for the selected period"
      >
        <form className="fin-card p-3 mb-3" onSubmit={applyFilters}>
          <div className="row g-2 align-items-end mb-0">
            <div className="col-6 col-sm-auto">
              <label htmlFor="date-from" className="form-label">
                From
              </label>
              <input
                type="date"
                name="from"
                id="date-from"
                className="form-control"
                key={`from-${params.from}`}
                defaultValue={params.from}
              />
            </div>
            <div className="col-6 col-sm-auto">
              <label htmlFor="date-to" className="form-label">
                To
              </label>
              <input
                type="date"
                name="to"
                id="date-to"
                className="form-control"
                key={`to-${params.to}`}
                defaultValue={params.to}
              />
            </div>
            <div className="col-12 col-sm-auto">
              <label htmlFor="account-filter" className="form-label">
                Account
              </label>
              <select
                name="account"
                id="account-filter"
                className="form-select"
                // Remount once the options load (and on param change)
                // so defaultValue picks up a deep-linked account.
                key={`account-${params.account}-${data ? 'ready' : 'loading'}`}
                defaultValue={params.account}
              >
                <option value="">All accounts</option>
                {(data?.accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 col-sm-auto">
              <button type="submit" className="btn btn-primary w-100">
                Apply
              </button>
            </div>
          </div>
        </form>

        {data && (
          <div className="d-flex flex-wrap gap-2 mb-4">
            {data.periods.map((period) => (
              <button
                key={period.label}
                type="button"
                className={`fin-chip${period.active ? ' active' : ''}`}
                aria-pressed={period.active}
                onClick={() => selectPeriod(period.date_from, period.date_to)}
              >
                {period.label}
              </button>
            ))}
          </div>
        )}

        {isPending && (
          <LoadingSkeleton label="Loading category spending" rows={5} />
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label="category spending"
          />
        )}
        {data && (
          <>
            {Object.keys(data.totals).length > 0 && (
              <div className="row g-3 mb-4">
                {Object.entries(data.totals).flatMap(([currency, total]) => [
                  <div
                    className="col-12 col-sm-6 col-lg-3"
                    key={`${currency}-spent`}
                  >
                    <StatCard
                      label={`Spent (${currency})`}
                      icon="arrow-up-circle"
                      value={
                        <MoneyText
                          amount={`-${total.spent}`}
                          currency={currency}
                        />
                      }
                    />
                  </div>,
                  <div
                    className="col-12 col-sm-6 col-lg-3"
                    key={`${currency}-received`}
                  >
                    <StatCard
                      label={`Received (${currency})`}
                      icon="arrow-down-circle"
                      value={
                        <MoneyText
                          amount={`+${total.received}`}
                          currency={currency}
                        />
                      }
                    />
                  </div>,
                ])}
              </div>
            )}
            {data.rows.length > 0 ? (
              <div className="row g-3">
                <div className="col-12 col-lg-4">
                  <div className="fin-card p-3 h-100">
                    <h2 className="h6 text-muted">Spending by category</h2>
                    <Suspense
                      fallback={
                        <div
                          className="fin-skeleton"
                          style={{ height: '17.5rem' }}
                        />
                      }
                    >
                      <CategoryChart rows={data.rows} />
                    </Suspense>
                  </div>
                </div>
                <div className="col-12 col-lg-8">
                  <div className="fin-card p-3 h-100">
                    <table className="table table-hover cat-table mb-0">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th className="w-25">Share</th>
                          <th className="text-end">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((row, index) => (
                          <OverviewRow
                            key={`${row.category_name}-${index}`}
                            row={row}
                            index={index}
                          />
                        ))}
                      </tbody>
                      <tfoot>
                        {Object.entries(data.totals).map(
                          ([currency, total]) => (
                            <tr className="fw-bold" key={currency}>
                              <td>Total ({currency})</td>
                              <td />
                              <td className="text-end text-nowrap">
                                <div className="text-danger fin-money">
                                  -{total.spent} {currency}
                                </div>
                                <div className="text-success fin-money">
                                  +{total.received} {currency}
                                </div>
                              </td>
                            </tr>
                          ),
                        )}
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon="pie-chart"
                title="No transactions in this period."
              />
            )}
          </>
        )}
      </PageShell>
      <Toasts />
    </>
  );
}

/**
 * One breakdown row: category badge + tx count, a share bar tinted
 * with the category color, and the signed net amount.
 */
function OverviewRow({ row, index }: { row: CategoryRowOut; index: number }) {
  const net = Number(row.net);
  const color = /^#[0-9a-f]{6}$/i.test(row.category_color)
    ? row.category_color
    : '#6c757d';
  const tone =
    net < 0 ? 'text-danger' : net > 0 ? 'text-success' : 'text-muted';
  return (
    <tr>
      <td>
        <CategoryBadge
          category={{
            id: index,
            name: row.category_name,
            color: row.category_color,
          }}
        />
        <div className="small text-muted">
          {row.tx_count} {row.tx_count === 1 ? 'transaction' : 'transactions'}
        </div>
      </td>
      <td className="align-middle">
        <div className="d-flex align-items-center gap-2">
          <div
            className="progress flex-grow-1"
            role="progressbar"
            aria-valuenow={row.share}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ height: '0.5rem', minWidth: '1.5rem' }}
          >
            <div
              className="progress-bar"
              style={{
                width: `${row.share.toFixed(0)}%`,
                backgroundColor: color,
              }}
            />
          </div>
          <small className="text-nowrap">{row.share.toFixed(1)}%</small>
        </div>
      </td>
      <td className={`text-end text-nowrap fin-money ${tone}`}>
        {net > 0 ? `+${row.net}` : row.net} {row.currency}
      </td>
    </tr>
  );
}

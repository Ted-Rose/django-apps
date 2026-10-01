import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FinanceNavBar from '../components/FinanceNavBar';
import ErrorState from '../components/ErrorState';
import CategoryBadge from '../components/CategoryBadge';
import Toasts from '../../shared/components/Toasts';
import { fetchCategoryOverview } from '../api';

/**
 * React port of category_overview.html — per-category spending
 * totals over a selectable time window. `from`/`to`/`account` live
 * in the URL (the template's GET form + preset hrefs become
 * `useSearchParams` writes), the `periods` list renders the preset
 * buttons ("All time" clears the dates), and the table groups
 * rows + totals by currency exactly like the template's
 * `totals` dict.
 *
 * Money arrives as Decimal-serialized strings and renders as-is;
 * `net`'s sign picks the text-danger/success class and the '+'
 * prefix. The table stays three slim columns (no
 * table-responsive scroll) so it fits narrow screens — the tx
 * count is secondary text under the category badge.
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
      <div className="container-fluid px-2 py-4">
        <h1 className="mb-4">Category spending</h1>

        <form className="row g-2 align-items-end mb-3" onSubmit={applyFilters}>
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
              // so defaultValue can pick up a deep-linked account.
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
        </form>

        {data && (
          <div className="mb-4">
            {data.periods.map((period) => (
              <button
                key={period.label}
                type="button"
                className={`btn btn-sm mb-1 me-1 ${
                  period.active ? 'btn-primary' : 'btn-outline-secondary'
                }`}
                onClick={() => selectPeriod(period.date_from, period.date_to)}
              >
                {period.label}
              </button>
            ))}
          </div>
        )}

        {isPending && (
          <div
            className="text-center py-5"
            aria-busy="true"
            aria-label="Loading category spending"
          >
            <div className="spinner-border" role="status" />
          </div>
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label="category spending"
          />
        )}
        {data &&
          (data.rows.length > 0 ? (
            <table className="table table-striped table-hover">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="w-25">Share</th>
                  <th className="text-end">Net</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => {
                  const net = Number(row.net);
                  return (
                    <tr key={`${row.category_name}-${row.currency}-${index}`}>
                      <td>
                        <CategoryBadge
                          category={{
                            id: index,
                            name: row.category_name,
                            color: row.category_color,
                          }}
                        />
                        <div className="small text-muted">
                          {row.tx_count}{' '}
                          {row.tx_count === 1 ? 'transaction' : 'transactions'}
                        </div>
                      </td>
                      <td className="align-middle">
                        <div className="d-flex align-items-center gap-2">
                          <div
                            className="progress flex-grow-1"
                            role="progressbar"
                            style={{ height: '0.5rem', minWidth: '1.5rem' }}
                          >
                            <div
                              className="progress-bar"
                              style={{ width: `${row.share.toFixed(0)}%` }}
                            />
                          </div>
                          <small className="text-nowrap">
                            {row.share.toFixed(1)}%
                          </small>
                        </div>
                      </td>
                      <td
                        className={`text-end text-nowrap ${
                          net < 0
                            ? 'text-danger'
                            : net > 0
                              ? 'text-success'
                              : 'text-muted'
                        }`}
                      >
                        {net > 0 ? `+${row.net}` : row.net} {row.currency}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {Object.entries(data.totals).map(([currency, total]) => (
                  <tr className="fw-bold" key={currency}>
                    <td>Total ({currency})</td>
                    <td />
                    <td className="text-end text-nowrap">
                      <div className="text-danger">
                        -{total.spent} {currency}
                      </div>
                      <div className="text-success">
                        +{total.received} {currency}
                      </div>
                    </td>
                  </tr>
                ))}
              </tfoot>
            </table>
          ) : (
            <div className="alert alert-info">
              No transactions in this period.
            </div>
          ))}
      </div>
      <Toasts />
    </>
  );
}

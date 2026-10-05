import { Fragment, Suspense, lazy, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import FinanceNavBar from '../components/FinanceNavBar';
import PageShell from '../components/PageShell';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ErrorState from '../components/ErrorState';
import CategoryBadge from '../components/CategoryBadge';
import CategoriesCard from '../components/CategoriesCard';
// Lazy-loaded so recharts stays out of the main finance chunk.
const CategoryChart = lazy(() => import('../components/CategoryChart'));
import MoneyText from '../components/MoneyText';
import Toasts from '../../shared/components/Toasts';
import TransactionDrilldown from '../components/TransactionDrilldown';
import type { ParamUpdates } from '../components/TransactionTable';
import { fetchCategoryOverview, type CategoryRowOut } from '../api';
import './categories.css';
// .tx-panel/.tx-table styles — the drill-down reuses the
// transactions page's table chrome.
import './transactions.css';

/**
 * React port of category_overview.html — per-category spending
 * totals over a selectable time window, plus the collapsible
 * categories management card (create/edit/delete, moved here from
 * the rules page). `from`/`to`/`account` live
 * in the URL (the template's GET form + preset hrefs become
 * `useSearchParams` writes), the `periods` list renders the preset
 * chips ("All time" clears the dates), and the table groups rows +
 * totals by currency exactly like the template's `totals` dict.
 *
 * Money arrives as Decimal-serialized strings and renders as-is;
 * each row shows spent and received as separate columns so income
 * can't hide inside a category's net figure. Headline StatCards
 * surface spent/received per currency,
 * a recharts donut (CategoryChart) shows the spending share, and
 * the breakdown table stays three slim columns so it fits narrow
 * screens — the tx count is secondary text under the badge.
 */
export default function CategoryOverview() {
  const { t } = useTranslation('finance');
  const [searchParams, setSearchParams] = useSearchParams();
  const params = {
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    account: searchParams.get('account') ?? '',
    // The category drill-down and everything the embedded
    // transaction table can write (sort/filter/page) share the
    // same URL so drilled-down views stay deep-linkable.
    category: searchParams.get('category') ?? '',
    creditor: searchParams.get('creditor'),
    q: searchParams.get('q'),
    source: searchParams.get('source'),
    sort: searchParams.get('sort'),
    direction: searchParams.get('direction'),
    page: searchParams.get('page'),
  };
  // The account filter is a PK — ignore non-numeric garbage the
  // same way the ORM-side int lookup would.
  const accountId = /^\d+$/.test(params.account)
    ? Number(params.account)
    : null;
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The overview query keys on its own window params only — the
  // drill-down params (category/sort/page/…) must not refetch it.
  const overviewParams = {
    from: params.from,
    to: params.to,
    account: params.account,
  };

  /** Merge updates into the URL; `null`/'' removes the key. Any
      change other than explicit pagination lands back on page 1. */
  const updateParams = (updates: ParamUpdates) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in updates)) next.delete('page');
    setSearchParams(next);
  };

  /** Row click — the drill-down's `?category=` value ('none' for
      the uncategorized bucket, like the transactions filter). */
  const selectCategory = (row: CategoryRowOut) => {
    const value = row.category_id != null ? String(row.category_id) : 'none';
    updateParams({
      category: value === params.category ? null : value,
    });
  };

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'category-overview', overviewParams],
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
    const next = new URLSearchParams(searchParams);
    for (const key of ['from', 'to', 'account'] as const) {
      const value = String(form.get(key) ?? '').trim();
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete('page');
    setSearchParams(next);
    setFiltersOpen(false);
  };

  /** Preset period click — the template's `?from=&to=` hrefs. */
  const selectPeriod = (dateFrom: string, dateTo: string) => {
    const next = new URLSearchParams(searchParams);
    if (dateFrom) next.set('from', dateFrom);
    else next.delete('from');
    if (dateTo) next.set('to', dateTo);
    else next.delete('to');
    next.delete('page');
    setSearchParams(next);
  };

  // One-line recap of the active filters, shown while the filter
  // card is collapsed so a deep-linked range stays visible.
  const accountLabel = data?.accounts.find(
    (account) => String(account.id) === params.account,
  )?.label;
  const filterSummary = [
    [params.from, params.to].filter(Boolean).join(' → '),
    accountLabel ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

  // Display name for the drill-down heading — resolved from the
  // breakdown rows (covers the translated 'uncategorized' bucket);
  // a deep-linked category with no rows in this window falls back
  // to the categories list.
  const selectedLabel =
    params.category === 'none'
      ? t('transactions.uncategorized')
      : (data?.rows.find((row) => String(row.category_id) === params.category)
          ?.category_name ??
        data?.categories.find(
          (category) => String(category.id) === params.category,
        )?.name ??
        '');

  return (
    <>
      <FinanceNavBar />
      <PageShell
        title={t('categories.title')}
        subtitle={t('categories.subtitle')}
      >
        <div className="fin-card p-3 mb-3">
          <button
            type="button"
            className="btn btn-link p-0 text-body text-decoration-none d-flex align-items-center gap-2"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <i
              className={`bi bi-chevron-${filtersOpen ? 'up' : 'down'}`}
              aria-hidden="true"
            />
            {t('categories.filters')}
            {!filtersOpen && filterSummary && (
              <span className="text-muted small">{filterSummary}</span>
            )}
          </button>
          {filtersOpen && (
            <form className="mt-3" onSubmit={applyFilters}>
              <div className="row g-2 align-items-end mb-0">
                <div className="col-6 col-sm-auto">
                  <label htmlFor="date-from" className="form-label">
                    {t('categories.dateFrom')}
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
                    {t('categories.dateTo')}
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
                    {t('categories.account')}
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
                    <option value="">{t('categories.allAccounts')}</option>
                    {(data?.accounts ?? []).map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-12 col-sm-auto">
                  <button type="submit" className="btn btn-primary w-100">
                    {t('common:common.apply')}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>

        {data && (
          <div className="mb-3">
            <CategoriesCard categories={data.categories} />
          </div>
        )}

        {data && (
          <div className="d-flex flex-wrap gap-2 mb-4">
            {data.periods.map((period) => (
              <button
                key={period.key ?? period.label}
                type="button"
                className={`fin-chip${period.active ? ' active' : ''}`}
                aria-pressed={period.active}
                onClick={() => selectPeriod(period.date_from, period.date_to)}
              >
                {period.key
                  ? t(`server:periods.${period.key}`, {
                      defaultValue: period.label,
                    })
                  : period.label}
              </button>
            ))}
          </div>
        )}

        {isPending && (
          <LoadingSkeleton label={t('categories.loading')} rows={5} />
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label={t('categories.loadLabel')}
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
                      label={t('categories.spent', { currency })}
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
                      label={t('categories.received', { currency })}
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
                    <h2 className="h6 text-muted">
                      {t('categories.chartTitle')}
                    </h2>
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
                          <th>{t('transactions.columns.category')}</th>
                          <th className="w-25">{t('categories.share')}</th>
                          <th className="text-end">
                            {t('categories.spentCol')}
                          </th>
                          <th className="text-end">
                            {t('categories.receivedCol')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          // Excluded rows sort last server-side; a
                          // muted section header splits them off.
                          const firstExcluded = data.rows.findIndex(
                            (row) => row.is_excluded,
                          );
                          return data.rows.map((row, index) => (
                            <Fragment key={`${row.category_name}-${index}`}>
                              {index === firstExcluded && (
                                <tr>
                                  <td
                                    colSpan={4}
                                    className="text-muted small border-0 pt-3"
                                  >
                                    {t('categories.excludedSection')}
                                  </td>
                                </tr>
                              )}
                              <OverviewRow
                                row={row}
                                index={index}
                                selected={
                                  (row.category_id != null
                                    ? String(row.category_id)
                                    : 'none') === params.category
                                }
                                onSelect={() => selectCategory(row)}
                              />
                            </Fragment>
                          ));
                        })()}
                      </tbody>
                      <tfoot>
                        {Object.entries(data.totals).map(
                          ([currency, total]) => (
                            <tr className="fw-bold" key={currency}>
                              <td>{t('categories.total', { currency })}</td>
                              <td />
                              <td className="text-end text-nowrap text-danger fin-money">
                                -{total.spent} {currency}
                              </td>
                              <td className="text-end text-nowrap text-success fin-money">
                                +{total.received} {currency}
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
              <EmptyState icon="pie-chart" title={t('categories.emptyTitle')} />
            )}
          </>
        )}
        {params.category && (
          <TransactionDrilldown
            // Remount per category so the panel scrolls into view
            // on every selection change.
            key={params.category}
            label={selectedLabel}
            params={params}
            onUpdate={updateParams}
            onClose={() => updateParams({ category: null })}
          />
        )}
      </PageShell>
      <Toasts />
    </>
  );
}

/**
 * One breakdown row: category badge + tx count, a share bar tinted
 * with the category color, and the spent/received amounts as
 * separate columns — a category with both directions shows both.
 * The row is a click target: selecting it opens the transaction
 * drill-down below the table (`?category=` in the URL).
 */
function OverviewRow({
  row,
  index,
  selected,
  onSelect,
}: {
  row: CategoryRowOut;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('finance');
  const color = /^#[0-9a-f]{6}$/i.test(row.category_color)
    ? row.category_color
    : '#6c757d';
  return (
    <tr
      className={
        `${selected ? 'table-active' : ''}${
          row.is_excluded ? ' text-muted' : ''
        }`.trim() || undefined
      }
      style={{ cursor: 'pointer' }}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <td>
        <CategoryBadge
          category={{
            id: index,
            name:
              row.category_key === 'uncategorized'
                ? t('transactions.uncategorized')
                : row.category_name,
            color: row.category_color,
            is_excluded: row.is_excluded,
          }}
        />
        <div className="small text-muted">
          {t('categories.txCount', { count: row.tx_count })}
        </div>
      </td>
      <td className="align-middle">
        {row.is_excluded ? (
          <small className="text-nowrap">
            <i className="bi bi-eye-slash me-1" aria-hidden="true" />
            {t('categories.excludedFromStats')}
          </small>
        ) : (
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
        )}
      </td>
      <td className="text-end text-nowrap fin-money">
        {Number(row.spent) > 0 ? (
          <span className="text-danger">
            -{row.spent} {row.currency}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="text-end text-nowrap fin-money">
        {Number(row.received) > 0 ? (
          <span className="text-success">
            +{row.received} {row.currency}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </tr>
  );
}

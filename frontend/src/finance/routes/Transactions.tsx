import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FinanceNavBar from '../components/FinanceNavBar';
import ErrorState from '../components/ErrorState';
import Toasts from '../../shared/components/Toasts';
import TransactionTable, {
  type ParamUpdates,
} from '../components/TransactionTable';
import Pagination from '../components/Pagination';
import { fetchTransactions } from '../api';
import { useSyncTransactions } from '../mutations';

/**
 * React port of transactions.html — the biggest finance page:
 * a sortable/filterable/paginated transaction table plus a sync
 * button. All state lives in the URL (`account`, `category`,
 * `creditor`, `q`, `sort`, `direction`, `page`) so filtered views
 * stay shareable/bookmarkable — the SPA rebuilds the template's
 * `page_url`/`sort_links` hrefs with `useSearchParams` instead.
 *
 * Everything the table needs (rows, page metadata, the
 * account/category/counterparty option lists, and the normalized
 * selected_* / search_query echoes) arrives in one TransactionsOut
 * payload — the plan's single-endpoint rule keeps this at one
 * query per state change.
 */
export default function Transactions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = {
    account: searchParams.get('account'),
    category: searchParams.get('category'),
    creditor: searchParams.get('creditor'),
    q: searchParams.get('q'),
    sort: searchParams.get('sort'),
    direction: searchParams.get('direction'),
    page: searchParams.get('page'),
  };

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'transactions', params],
    queryFn: () => fetchTransactions(params),
  });
  const sync = useSyncTransactions();

  const updateParams = (updates: ParamUpdates) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    // Any change other than explicit pagination lands back on
    // page 1 (the template's filter/sort hrefs never carried page).
    if (!('page' in updates)) next.delete('page');
    setSearchParams(next);
  };

  const clearFilters = () =>
    updateParams({ account: null, category: null, creditor: null, q: null });

  // Mirror the template's sync form: the current account filter is
  // posted along ({account?} per the SyncIn contract).
  const accountId =
    params.account && /^\d+$/.test(params.account)
      ? Number(params.account)
      : null;

  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="mb-4">Transactions</h1>

        <div className="mb-4 d-flex align-items-center gap-3">
          <button
            type="button"
            className="btn btn-outline-primary"
            disabled={sync.isPending}
            onClick={() =>
              sync.mutate(
                accountId !== null ? { account: accountId } : undefined,
              )
            }
          >
            {sync.isPending ? (
              <>
                <span
                  className="spinner-border spinner-border-sm"
                  role="status"
                />{' '}
                Syncing...
              </>
            ) : (
              <>
                <i className="bi bi-arrow-repeat" /> Sync transactions
              </>
            )}
          </button>
          {data?.filters_active && (
            <button
              type="button"
              className="btn btn-link btn-sm"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>

        {isPending && (
          <div
            className="text-center py-5"
            aria-busy="true"
            aria-label="Loading transactions"
          >
            <div className="spinner-border" role="status" />
          </div>
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label="transactions"
          />
        )}
        {data && (
          <>
            <TransactionTable data={data} onUpdate={updateParams} />
            <Pagination
              page={data.page}
              numPages={data.num_pages}
              count={data.count}
              hasNext={data.has_next}
              hasPrevious={data.has_previous}
              onPage={(page) => updateParams({ page: String(page) })}
            />
          </>
        )}
      </div>
      <Toasts />
    </>
  );
}

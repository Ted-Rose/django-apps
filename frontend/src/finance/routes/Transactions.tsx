import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import FinanceNavBar from '../components/FinanceNavBar';
import PageShell from '../components/PageShell';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import Toasts from '../../shared/components/Toasts';
import TransactionTable, {
  type ParamUpdates,
} from '../components/TransactionTable';
import Pagination from '../components/Pagination';
import { fetchTransactions } from '../api';
import { useSyncTransactions } from '../mutations';
import useRuleDrawer from '../hooks/useRuleDrawer';
import './transactions.css';

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
  const { t } = useTranslation('finance');
  const [searchParams, setSearchParams] = useSearchParams();
  const params = {
    account: searchParams.get('account'),
    category: searchParams.get('category'),
    creditor: searchParams.get('creditor'),
    q: searchParams.get('q'),
    source: searchParams.get('source'),
    sort: searchParams.get('sort'),
    direction: searchParams.get('direction'),
    page: searchParams.get('page'),
  };

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'transactions', params],
    queryFn: () => fetchTransactions(params),
  });
  const sync = useSyncTransactions();
  const { openRuleDrawer, ruleLoadingId, drawer } = useRuleDrawer();

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
    updateParams({
      account: null,
      category: null,
      creditor: null,
      q: null,
      source: null,
    });

  // Mirror the template's sync form: the current account filter is
  // posted along ({account?} per the SyncIn contract).
  const accountId =
    params.account && /^\d+$/.test(params.account)
      ? Number(params.account)
      : null;

  // One removable chip per active filter — labels come from the
  // payload's option lists/echoes, each × clears just that param.
  const activeFilters: {
    key: string;
    label: string;
    clear: ParamUpdates;
  }[] = [];
  if (data?.filters_active) {
    if (data.selected_account != null) {
      const match = data.accounts.find(
        (option) => option.id === data.selected_account,
      );
      activeFilters.push({
        key: 'account',
        label: t('transactions.filterAccount', {
          label: match?.label ?? data.selected_account,
        }),
        clear: { account: null },
      });
    }
    if (data.selected_category) {
      const match = data.categories.find(
        (option) => String(option.id) === data.selected_category,
      );
      const name =
        data.selected_category === 'none'
          ? t('transactions.uncategorized')
          : (match?.name ?? data.selected_category);
      activeFilters.push({
        key: 'category',
        label: t('transactions.filterCategory', { name }),
        clear: { category: null },
      });
    }
    if (data.selected_source === 'manual') {
      activeFilters.push({
        key: 'source',
        label: t('transactions.filterSourceManual'),
        clear: { source: null },
      });
    }
    if (data.selected_creditor) {
      activeFilters.push({
        key: 'creditor',
        label: t('transactions.filterCreditor', {
          name: data.selected_creditor,
        }),
        clear: { creditor: null },
      });
    }
    if (data.search_query) {
      activeFilters.push({
        key: 'q',
        label: t('transactions.filterSearch', {
          query: data.search_query,
        }),
        clear: { q: null },
      });
    }
  }

  return (
    <>
      <FinanceNavBar />
      <PageShell
        title={t('transactions.title')}
        actions={
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
                {t('transactions.syncing')}
              </>
            ) : (
              <>
                <i className="bi bi-arrow-repeat" />{' '}
                {t('transactions.syncButton')}
              </>
            )}
          </button>
        }
      >
        {isPending && (
          <LoadingSkeleton
            rows={6}
            height="2.5rem"
            label={t('transactions.loading')}
          />
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label={t('transactions.loadLabel')}
          />
        )}
        {data && (
          <>
            {data.filters_active && (
              <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                {activeFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className="fin-chip"
                    aria-label={t('transactions.removeFilterAria', {
                      label: filter.label,
                    })}
                    onClick={() => updateParams(filter.clear)}
                  >
                    {filter.label}
                    <i className="bi bi-x" aria-hidden="true" />
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-link btn-sm"
                  onClick={clearFilters}
                >
                  {t('transactions.clearFilters')}
                </button>
              </div>
            )}
            <div className="tx-panel">
              <TransactionTable
                data={data}
                onUpdate={updateParams}
                onAddRule={openRuleDrawer}
                ruleLoadingId={ruleLoadingId}
              />
              <Pagination
                page={data.page}
                numPages={data.num_pages}
                count={data.count}
                hasNext={data.has_next}
                hasPrevious={data.has_previous}
                onPage={(page) => updateParams({ page: String(page) })}
              />
            </div>
          </>
        )}
      </PageShell>
      {drawer}
      <Toasts />
    </>
  );
}

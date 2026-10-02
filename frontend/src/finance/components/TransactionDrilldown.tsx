/**
 * Drill-down transaction panel shared by pages that offer a
 * "show me these transactions" affordance (the category overview's
 * breakdown rows, the limits page's window stats): the
 * transactions route's own TransactionTable + Pagination fed by
 * the same endpoint, pre-filtered by `params` (category, account,
 * from/to window, …). Column-header sort/filter writes go through
 * `onUpdate` so the whole state stays in the page's URL.
 *
 * Mounting is what triggers the fetch — pages render this only
 * while a selection is open, so closing it also stops the query.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import LoadingSkeleton from './LoadingSkeleton';
import ErrorState from './ErrorState';
import TransactionTable, { type ParamUpdates } from './TransactionTable';
import Pagination from './Pagination';
import useRuleDrawer from '../hooks/useRuleDrawer';
import { fetchTransactions, type TransactionParams } from '../api';

export default function TransactionDrilldown({
  label,
  params,
  onUpdate,
  onClose,
}: {
  /** Heading text — e.g. the category name (and window) being
      drilled into. */
  label: string;
  /** Filters forwarded to GET /api/finance/transactions/. */
  params: TransactionParams;
  onUpdate: (updates: ParamUpdates) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('finance');
  const { openRuleDrawer, ruleLoadingId, drawer } = useRuleDrawer();
  const panelRef = useRef<HTMLElement>(null);
  // jsdom doesn't implement scrollIntoView — the optional call
  // keeps the Vitest suite stub-free.
  useEffect(() => {
    panelRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start',
    });
  }, []);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'transactions', params],
    queryFn: () => fetchTransactions(params),
  });

  return (
    <section className="tx-panel mt-4" ref={panelRef}>
      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
        <h2 className="h6 text-muted mb-0">
          {t('categories.transactionsFor', { name: label })}
        </h2>
        <button
          type="button"
          className="btn btn-link btn-sm p-0 text-decoration-none"
          onClick={onClose}
        >
          {t('common:common.close')}
        </button>
      </div>
      {isPending && (
        <LoadingSkeleton
          rows={4}
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
          <TransactionTable
            data={data}
            onUpdate={onUpdate}
            onAddRule={openRuleDrawer}
            ruleLoadingId={ruleLoadingId}
          />
          <Pagination
            page={data.page}
            numPages={data.num_pages}
            count={data.count}
            hasNext={data.has_next}
            hasPrevious={data.has_previous}
            onPage={(next) => onUpdate({ page: String(next) })}
          />
        </>
      )}
      {drawer}
    </section>
  );
}

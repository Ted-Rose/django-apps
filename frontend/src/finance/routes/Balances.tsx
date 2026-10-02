import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FinanceNavBar from '../components/FinanceNavBar';
import PageShell from '../components/PageShell';
import StatCard from '../components/StatCard';
import MoneyText from '../components/MoneyText';
import EmptyState from '../components/EmptyState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ErrorState from '../components/ErrorState';
import Toasts from '../../shared/components/Toasts';
import { fetchBalances, type AccountOut } from '../api';
import { useRefreshBalances } from '../mutations';
import './balances.css';

/**
 * React port of balances.html — one .fin-card per account opted
 * into the balance check (name/iban, last stored balance +
 * balanceType, "Last updated" rendered via toLocaleString like the
 * template's local-datetime script), a StatCard per-currency total
 * over all retrieved balances, and the "Get latest balance" PageShell
 * action that POSTs /api/finance/balances/refresh/ with an isPending
 * spinner.
 */
export default function Balances() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'balances'],
    queryFn: fetchBalances,
  });
  const refresh = useRefreshBalances();
  const totals = data ? totalByCurrency(data.accounts) : [];
  const hasAccounts = !!data && data.accounts.length > 0;

  return (
    <>
      <FinanceNavBar />
      <PageShell
        title="Balances"
        subtitle="Latest reported balance per account"
        actions={
          hasAccounts ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              {refresh.isPending ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm"
                    role="status"
                  />{' '}
                  Fetching...
                </>
              ) : (
                <>
                  <i
                    className="bi bi-arrow-repeat"
                    aria-hidden="true"
                  />{' '}
                  Get latest balance
                </>
              )}
            </button>
          ) : undefined
        }
      >
        {isPending && (
          <LoadingSkeleton
            rows={3}
            height="6rem"
            label="Loading balances"
          />
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label="balances"
          />
        )}
        {data &&
          (hasAccounts ? (
            <>
              {totals.length > 0 && (
                <div className="balances-totals mb-4">
                  {totals.map(([currency, total]) => (
                    <StatCard
                      key={currency}
                      label={`Total (${currency})`}
                      value={`${total.toFixed(2)} ${currency}`}
                      icon="cash-stack"
                    />
                  ))}
                </div>
              )}
              <div className="row row-cols-1 row-cols-md-2 g-3">
                {data.accounts.map((account) => (
                  <BalanceCard key={account.id} account={account} />
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon="wallet2"
              title="No accounts are included in the balance check"
            >
              Enable them on the{' '}
              <Link to="/accounts">Accounts</Link> page.
            </EmptyState>
          ))}
      </PageShell>
      <Toasts />
    </>
  );
}

/** The raw GoCardless balance dict stored on the account row. */
interface LastBalance {
  balanceAmount?: { amount?: string; currency?: string };
  balanceType?: string;
}

/**
 * Sum balances per currency — GoCardless amounts are strings and
 * mixing currencies without conversion is meaningless, so each
 * currency gets its own total (same rule as CategoryOverview).
 */
function totalByCurrency(accounts: AccountOut[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const account of accounts) {
    const amount = (account.last_balance as LastBalance | null)
      ?.balanceAmount;
    const value = Number(amount?.amount);
    if (!amount?.currency || Number.isNaN(value)) continue;
    totals.set(amount.currency, (totals.get(amount.currency) ?? 0) + value);
  }
  return [...totals.entries()];
}

/** One balance card — mirrors the template's balance block. */
function BalanceCard({ account }: { account: AccountOut }) {
  const balance = (account.last_balance ?? null) as LastBalance | null;
  const amount = balance?.balanceAmount;
  const updatedAt = account.balance_updated_at
    ? new Date(account.balance_updated_at)
    : null;
  const updatedLabel =
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? updatedAt.toLocaleString()
      : null;

  return (
    <div className="col">
      <div className="fin-card p-3 h-100 d-flex flex-column">
        <h2 className="h6 fw-semibold mb-1">
          {account.name || account.iban || account.account_id}
        </h2>
        <p className="text-muted small mb-3 text-break">
          {account.iban}
        </p>
        {balance ? (
          <>
            <MoneyText
              amount={amount?.amount ?? '0'}
              currency={amount?.currency}
              className="fs-3 fw-semibold d-block mb-2"
            />
            {(balance.balanceType || updatedLabel) && (
              <p className="balances-card-footer mb-0">
                {balance.balanceType && (
                  <span>{balance.balanceType}</span>
                )}
                {balance.balanceType && updatedLabel && ' · '}
                {updatedLabel && (
                  <span>Last updated: {updatedLabel}</span>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="text-muted small mb-0">
            No balance retrieved yet. Click &quot;Get latest
            balance&quot; to fetch it.
          </p>
        )}
        {account.balance_alert != null && (
          <p className="balances-card-footer mb-0 mt-2">
            <span className="badge text-bg-secondary">
              <i className="bi bi-bell-fill" /> Alert below{' '}
              {account.balance_alert}{' '}
              {amount?.currency ?? account.currency}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

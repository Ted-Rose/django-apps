import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FinanceNavBar from '../components/FinanceNavBar';
import ErrorState from '../components/ErrorState';
import Toasts from '../../shared/components/Toasts';
import { fetchBalances, type AccountOut } from '../api';
import { useRefreshBalances } from '../mutations';

/**
 * React port of balances.html — one card per account opted into
 * the balance check (name/iban, last stored balance + balanceType,
 * "Last updated" rendered via toLocaleString like the template's
 * local-datetime script) and the "Get latest balance" button that
 * POSTs /api/finance/balances/refresh/ with an isPending spinner.
 */
export default function Balances() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'balances'],
    queryFn: fetchBalances,
  });
  const refresh = useRefreshBalances();

  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="mb-4">Balances</h1>

        {isPending && (
          <div
            className="text-center py-5"
            aria-busy="true"
            aria-label="Loading balances"
          >
            <div className="spinner-border" role="status" />
          </div>
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label="balances"
          />
        )}
        {data &&
          (data.accounts.length > 0 ? (
            <>
              <div className="mb-4">
                <button
                  type="button"
                  className="btn btn-outline-primary"
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
                      <i className="bi bi-arrow-repeat" /> Get latest balance
                    </>
                  )}
                </button>
              </div>
              <div className="row row-cols-1 row-cols-md-2 g-3">
                {data.accounts.map((account) => (
                  <BalanceCard key={account.id} account={account} />
                ))}
              </div>
            </>
          ) : (
            <div className="alert alert-info">
              No accounts are included in the balance check. Enable them on the{' '}
              <Link to="/accounts">Accounts</Link> page.
            </div>
          ))}
      </div>
      <Toasts />
    </>
  );
}

/** The raw GoCardless balance dict stored on the account row. */
interface LastBalance {
  balanceAmount?: { amount?: string; currency?: string };
  balanceType?: string;
}

/** One balance card — mirrors the template's balance block. */
function BalanceCard({ account }: { account: AccountOut }) {
  const balance = (account.last_balance ?? null) as LastBalance | null;
  const amount = balance?.balanceAmount;
  const updatedAt = account.balance_updated_at
    ? new Date(account.balance_updated_at)
    : null;

  return (
    <div className="col">
      <div className="card">
        <div className="card-body">
          <h5 className="card-title">
            {account.name || account.iban || account.account_id}
          </h5>
          <p className="card-text text-muted mb-2">{account.iban}</p>
          {balance ? (
            <>
              <p className="fs-3 mb-0">
                {amount?.amount} {amount?.currency}
              </p>
              <p className="text-muted mb-0">
                <small>{balance.balanceType}</small>
              </p>
              {updatedAt && !Number.isNaN(updatedAt.getTime()) && (
                <p className="text-muted mb-0">
                  <small>Last updated: {updatedAt.toLocaleString()}</small>
                </p>
              )}
            </>
          ) : (
            <p className="text-muted mb-0">
              No balance retrieved yet. Click &quot;Get latest balance&quot; to
              fetch it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

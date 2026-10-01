import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FinanceNavBar from '../components/FinanceNavBar';
import ErrorState from '../components/ErrorState';
import Toasts from '../../shared/components/Toasts';
import { fetchAccounts, type AccountOut } from '../api';
import { useShareAccount, useToggleBalanceCheck } from '../mutations';

/**
 * React port of accounts.html — the account list with a per-row
 * balance-check toggle (each user's own UserAccountPreference, so
 * sharers get the button too) and an owner-only share icon that
 * expands into an inline share form. The
 * "Connect Bank" button routes in-SPA to /connect.
 */
export default function Accounts() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: fetchAccounts,
  });

  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h1 className="mb-0">Accounts</h1>
          <Link to="/connect" className="btn btn-primary">
            <i className="bi bi-plus-lg" /> Connect Bank
          </Link>
        </div>

        {isPending && (
          <div
            className="text-center py-5"
            aria-busy="true"
            aria-label="Loading accounts"
          >
            <div className="spinner-border" role="status" />
          </div>
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label="accounts"
          />
        )}
        {data &&
          (data.accounts.length > 0 ? (
            <div className="list-group">
              {data.accounts.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </div>
          ) : (
            <div className="alert alert-info">
              No accounts yet. <Link to="/connect">Connect a bank</Link> to get
              started.
            </div>
          ))}
      </div>
      <Toasts />
    </>
  );
}

/**
 * One list-group row: display name + iban/institution/currency,
 * a "Shared by …" badge for non-owned accounts, the balance-check
 * toggle button, and (owners only) a share icon that expands into
 * the inline share form.
 */
function AccountRow({ account }: { account: AccountOut }) {
  const toggle = useToggleBalanceCheck();
  const share = useShareAccount();
  const [username, setUsername] = useState('');
  const [shareOpen, setShareOpen] = useState(false);

  const toggling = toggle.isPending && toggle.variables === account.id;
  const sharing = share.isPending && share.variables?.accountId === account.id;
  const details = [account.iban, account.institution_id, account.currency]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="list-group-item">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <h5 className="mb-1">{account.display_name}</h5>
          <p className="mb-1 text-muted">{details}</p>
          {!account.is_owner && (
            <span className="badge bg-info text-dark">
              Shared by {account.owner_username}
            </span>
          )}
        </div>
        <div className="d-flex gap-2 align-items-center flex-wrap">
          <button
            type="button"
            className={`btn btn-sm ${
              account.included_in_balance_check
                ? 'btn-success'
                : 'btn-outline-secondary'
            }`}
            title="Include in balance check"
            aria-pressed={account.included_in_balance_check}
            disabled={toggling}
            onClick={() => toggle.mutate(account.id)}
          >
            {toggling ? (
              <span
                className="spinner-border spinner-border-sm"
                role="status"
              />
            ) : (
              <i className="bi bi-check-circle" />
            )}{' '}
            Balance check
          </button>
          {account.is_owner &&
            (shareOpen ? (
              <form
                className="d-flex gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = username.trim();
                  if (!trimmed) return;
                  share.mutate(
                    { accountId: account.id, username: trimmed },
                    {
                      onSuccess: () => {
                        setUsername('');
                        setShareOpen(false);
                      },
                    },
                  );
                }}
              >
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="Username"
                  aria-label="Username to share with"
                  required
                  autoFocus
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-sm btn-outline-primary"
                  disabled={sharing}
                >
                  {sharing ? (
                    <span
                      className="spinner-border spinner-border-sm"
                      role="status"
                    />
                  ) : (
                    <i className="bi bi-share" />
                  )}{' '}
                  Share
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  title="Cancel"
                  aria-label="Cancel sharing"
                  onClick={() => {
                    setShareOpen(false);
                    setUsername('');
                  }}
                >
                  <i className="bi bi-x-lg" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                title="Share account"
                aria-label="Share account"
                onClick={() => setShareOpen(true)}
              >
                <i className="bi bi-share" />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

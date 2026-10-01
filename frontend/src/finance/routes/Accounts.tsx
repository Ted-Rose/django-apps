import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FinanceNavBar from '../components/FinanceNavBar';
import PageShell from '../components/PageShell';
import EmptyState from '../components/EmptyState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ErrorState from '../components/ErrorState';
import Toasts from '../../shared/components/Toasts';
import { fetchAccounts, type AccountOut } from '../api';
import { useShareAccount, useToggleBalanceCheck } from '../mutations';
import './accounts.css';

/**
 * React port of accounts.html — the account list with a per-card
 * balance-check switch (each user's own UserAccountPreference, so
 * sharers get the switch too) and an owner-only share icon that
 * expands an inline share form below the card header. The
 * "Connect Bank" action routes in-SPA to /connect.
 */
export default function Accounts() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: fetchAccounts,
  });

  return (
    <>
      <FinanceNavBar />
      <PageShell
        title="Accounts"
        subtitle="Linked bank accounts and who can see them"
        actions={
          <Link to="/connect" className="btn btn-primary">
            <i className="bi bi-plus-lg" /> Connect Bank
          </Link>
        }
      >
        {isPending && (
          <LoadingSkeleton
            rows={3}
            height="5rem"
            label="Loading accounts"
          />
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
            <div className="acct-list">
              {data.accounts.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </div>
          ) : (
            <EmptyState icon="wallet2" title="No accounts yet">
              <p className="mb-3">
                Link a bank account to start tracking balances and
                transactions.
              </p>
              <Link to="/connect" className="btn btn-primary">
                <i className="bi bi-plus-lg" /> Connect a bank
              </Link>
            </EmptyState>
          ))}
      </PageShell>
      <Toasts />
    </>
  );
}

/**
 * One account card: display name + iban/institution/currency, a
 * "Shared by …" badge for non-owned accounts, the balance-check
 * switch, and (owners only) a share icon that expands the inline
 * share form below the header row.
 */
function AccountRow({ account }: { account: AccountOut }) {
  const toggle = useToggleBalanceCheck();
  const share = useShareAccount();
  const [username, setUsername] = useState('');
  const [shareOpen, setShareOpen] = useState(false);

  const toggling = toggle.isPending && toggle.variables === account.id;
  const sharing =
    share.isPending && share.variables?.accountId === account.id;
  const details = [account.iban, account.institution_id, account.currency]
    .filter(Boolean)
    .join(' · ');
  const switchId = `balance-check-${account.id}`;

  return (
    <div className="fin-card acct-card">
      <div className="acct-card-head">
        <div>
          <h2 className="h5 mb-1">{account.display_name}</h2>
          <p className="mb-1 text-muted small">{details}</p>
          {!account.is_owner && (
            <span className="badge acct-shared-badge">
              Shared by {account.owner_username}
            </span>
          )}
        </div>
        <div className="d-flex gap-3 align-items-center flex-wrap">
          <div className="form-check form-switch m-0">
            <input
              id={switchId}
              type="checkbox"
              role="switch"
              className="form-check-input"
              title="Include in balance check"
              checked={account.included_in_balance_check}
              disabled={toggling}
              onChange={() => toggle.mutate(account.id)}
            />
            <label className="form-check-label" htmlFor={switchId}>
              Balance check
            </label>
          </div>
          {toggling && (
            <span
              className="spinner-border spinner-border-sm"
              role="status"
            />
          )}
          {account.is_owner && !shareOpen && (
            <button
              type="button"
              className="btn btn-sm acct-icon-btn"
              title="Share account"
              aria-label="Share account"
              onClick={() => setShareOpen(true)}
            >
              <i className="bi bi-share" />
            </button>
          )}
        </div>
      </div>
      {account.is_owner && shareOpen && (
        <form
          className="acct-share-form d-flex gap-2"
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
            className="btn btn-sm btn-primary"
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
      )}
    </div>
  );
}

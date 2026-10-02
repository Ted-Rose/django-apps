import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import FinanceNavBar from '../components/FinanceNavBar';
import PageShell from '../components/PageShell';
import EmptyState from '../components/EmptyState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ErrorState from '../components/ErrorState';
import Toasts from '../../shared/components/Toasts';
import {
  fetchAccounts,
  type AccountOut,
  type PushConfigOut,
} from '../api';
import {
  useDeleteBalanceAlert,
  useSaveBalanceAlert,
  useShareAccount,
  useToggleBalanceCheck,
} from '../mutations';
import './accounts.css';

/**
 * React port of accounts.html — the account list with a per-card
 * balance-check switch (each user's own UserAccountPreference, so
 * sharers get the switch too), an owner-only share icon that
 * expands an inline share form below the card header, and a bell
 * icon that expands the inline low-balance alert form. The
 * "Connect Bank" action routes in-SPA to /connect.
 */
export default function Accounts() {
  const { t } = useTranslation('finance');
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'accounts'],
    queryFn: fetchAccounts,
  });

  return (
    <>
      <FinanceNavBar />
      <PageShell
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        actions={
          <Link to="/connect" className="btn btn-primary">
            <i className="bi bi-plus-lg" /> {t('nav.connectBank')}
          </Link>
        }
      >
        {isPending && (
          <LoadingSkeleton
            rows={3}
            height="5rem"
            label={t('accounts.loading')}
          />
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label={t('accounts.loadLabel')}
          />
        )}
        {data &&
          (data.accounts.length > 0 ? (
            <div className="acct-list">
              {data.accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  pushConfig={data.push_config}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon="wallet2" title={t('accounts.emptyTitle')}>
              <p className="mb-3">{t('accounts.emptyBody')}</p>
              <Link to="/connect" className="btn btn-primary">
                <i className="bi bi-plus-lg" /> {t('accounts.connectABank')}
              </Link>
            </EmptyState>
          ))}
      </PageShell>
      <Toasts />
    </>
  );
}

interface LastBalance {
  balanceAmount?: { amount?: string; currency?: string };
}

/**
 * One account card: display name + iban/institution/currency, a
 * "Shared by …" badge for non-owned accounts, the balance-check
 * switch, a balance-alert bell that expands the inline alert form,
 * and (owners only) a share icon that expands the inline share
 * form. The two inline forms are mutually exclusive — opening one
 * closes the other.
 */
function AccountRow({
  account,
  pushConfig,
}: {
  account: AccountOut;
  pushConfig: PushConfigOut;
}) {
  const { t } = useTranslation('finance');
  const toggle = useToggleBalanceCheck();
  const share = useShareAccount();
  const saveAlert = useSaveBalanceAlert();
  const deleteAlert = useDeleteBalanceAlert();
  const [username, setUsername] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [threshold, setThreshold] = useState('');

  const toggling = toggle.isPending && toggle.variables === account.id;
  const sharing =
    share.isPending && share.variables?.accountId === account.id;
  const savingAlert =
    saveAlert.isPending &&
    saveAlert.variables?.accountId === account.id;
  const removingAlert =
    deleteAlert.isPending && deleteAlert.variables === account.id;
  const details = [account.iban, account.institution_id, account.currency]
    .filter(Boolean)
    .join(' · ');
  const switchId = `balance-check-${account.id}`;
  const lastBalance = (account.last_balance ?? null) as
    | LastBalance
    | null;
  const lastAmount = lastBalance?.balanceAmount;

  const openAlertForm = () => {
    setThreshold(account.balance_alert ?? '');
    setShareOpen(false);
    setAlertOpen(true);
  };

  return (
    <div className="fin-card acct-card">
      <div className="acct-card-head">
        <div>
          <h2 className="h5 mb-1">{account.display_name}</h2>
          <p className="mb-1 text-muted small">{details}</p>
          {!account.is_owner && (
            <span className="badge acct-shared-badge">
              {t('accounts.sharedBy', {
                username: account.owner_username,
              })}
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
              title={t('accounts.includeInBalanceCheck')}
              checked={account.included_in_balance_check}
              disabled={toggling}
              onChange={() => toggle.mutate(account.id)}
            />
            <label className="form-check-label" htmlFor={switchId}>
              {t('accounts.balanceCheck')}
            </label>
          </div>
          {toggling && (
            <span
              className="spinner-border spinner-border-sm"
              role="status"
            />
          )}
          {!alertOpen && (
            <button
              type="button"
              className={`btn btn-sm acct-icon-btn${
                account.balance_alert != null ? ' acct-alert-on' : ''
              }`}
              title={
                account.balance_alert != null
                  ? t('accounts.balanceAlert', {
                      threshold: account.balance_alert,
                      currency: account.currency,
                    })
                  : t('accounts.setBalanceAlert')
              }
              aria-label={
                account.balance_alert != null
                  ? t('accounts.balanceAlert', {
                      threshold: account.balance_alert,
                      currency: account.currency,
                    })
                  : t('accounts.setBalanceAlert')
              }
              onClick={openAlertForm}
            >
              <i
                className={`bi ${
                  account.balance_alert != null
                    ? 'bi-bell-fill'
                    : 'bi-bell'
                }`}
              />
            </button>
          )}
          {account.is_owner && !shareOpen && (
            <button
              type="button"
              className="btn btn-sm acct-icon-btn"
              title={t('accounts.shareAccount')}
              aria-label={t('accounts.shareAccount')}
              onClick={() => {
                setAlertOpen(false);
                setShareOpen(true);
              }}
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
            placeholder={t('accounts.username')}
            aria-label={t('accounts.usernameAria')}
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
            {t('common:common.share')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            title={t('common:common.cancel')}
            aria-label={t('accounts.cancelSharing')}
            onClick={() => {
              setShareOpen(false);
              setUsername('');
            }}
          >
            <i className="bi bi-x-lg" />
          </button>
        </form>
      )}
      {alertOpen && (
        <form
          className="acct-alert-form d-flex gap-2 flex-wrap"
          onSubmit={(event) => {
            event.preventDefault();
            if (!threshold.trim()) return;
            saveAlert.mutate(
              { accountId: account.id, threshold: threshold.trim() },
              { onSuccess: () => setAlertOpen(false) },
            );
          }}
        >
          <label
            className="col-form-label-sm text-muted mb-0"
            htmlFor={`alert-threshold-${account.id}`}
          >
            {t('accounts.alertPrompt')}
          </label>
          <input
            id={`alert-threshold-${account.id}`}
            type="number"
            step="0.01"
            className="form-control form-control-sm acct-alert-input"
            placeholder="0.00"
            aria-label={t('accounts.thresholdAria', {
              currency: account.currency,
            })}
            required
            autoFocus
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
          <span className="col-form-label-sm text-muted mb-0">
            {account.currency}
          </span>
          <button
            type="submit"
            className="btn btn-sm btn-primary"
            disabled={savingAlert}
          >
            {savingAlert ? (
              <span
                className="spinner-border spinner-border-sm"
                role="status"
              />
            ) : (
              <i className="bi bi-bell" />
            )}{' '}
            {t('common:common.save')}
          </button>
          {account.balance_alert != null && (
            <button
              type="button"
              className="btn btn-sm btn-outline-danger"
              disabled={savingAlert || removingAlert}
              onClick={() =>
                deleteAlert.mutate(account.id, {
                  onSuccess: () => setAlertOpen(false),
                })
              }
            >
              {removingAlert ? (
                <span
                  className="spinner-border spinner-border-sm"
                  role="status"
                />
              ) : (
                <i className="bi bi-trash" />
              )}{' '}
              {t('common:common.remove')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            title={t('common:common.cancel')}
            aria-label={t('accounts.cancelBalanceAlert')}
            onClick={() => setAlertOpen(false)}
          >
            <i className="bi bi-x-lg" />
          </button>
          <p className="small text-muted mb-0 w-100">
            {lastAmount?.amount != null && (
              <>
                {t('accounts.lastBalance', {
                  amount: lastAmount.amount,
                  currency: lastAmount.currency ?? account.currency,
                })}{' '}
              </>
            )}
            {pushConfig.subscription_count === 0 ? (
              <Trans
                i18nKey="accounts.noDevices"
                ns="finance"
                components={{ link: <Link to="/limits" /> }}
              />
            ) : (
              t('accounts.pushEnabled', {
                count: pushConfig.subscription_count,
              })
            )}
          </p>
        </form>
      )}
    </div>
  );
}

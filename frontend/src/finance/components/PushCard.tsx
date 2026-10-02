import { useTranslation } from 'react-i18next';
import usePushSubscription from '../hooks/usePushSubscription';
import type { PushConfigOut } from '../api';

/**
 * The "Spending alerts" card ported from limits.html — hidden
 * entirely when `VAPID_PUBLIC_KEY` is empty (the template's
 * `{% if vapid_public_key %}` guard), so callers render it
 * unconditionally. The enable/disable buttons port
 * push_subscribe.js via `usePushSubscription`.
 */
export function PushCard({ config }: { config: PushConfigOut }) {
  if (!config.vapid_public_key) return null;
  return <PushCardBody config={config} />;
}

function PushCardBody({ config }: { config: PushConfigOut }) {
  const { t } = useTranslation('finance');
  const { supported, subscribed, status, busy, subscribe, unsubscribe } =
    usePushSubscription(config);

  return (
    <>
      <p className="text-muted mb-2">{t('limits.push.description')}</p>
      <p className="small text-muted mb-3">
        {t('limits.push.enabledOn', {
          count: config.subscription_count,
        })}{' '}
        <span data-testid="push-status">{status}</span>
      </p>
      {subscribed ? (
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={busy}
          onClick={() => void unsubscribe()}
        >
          {t('limits.push.disable')}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          disabled={!supported || busy}
          onClick={() => void subscribe()}
        >
          <i className="bi bi-bell me-1" aria-hidden="true" />
          {t('limits.push.enable')}
        </button>
      )}
    </>
  );
}

export default PushCard;

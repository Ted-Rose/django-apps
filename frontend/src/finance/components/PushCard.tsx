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
  const { supported, subscribed, status, busy, subscribe, unsubscribe } =
    usePushSubscription(config);

  return (
    <>
      <p className="text-muted mb-2">
        Get a browser push notification when a spending limit is
        exceeded — even when this site is closed.
      </p>
      <p className="small text-muted mb-3">
        Enabled on {config.subscription_count} device(s){' '}
        <span data-testid="push-status">{status}</span>
      </p>
      {subscribed ? (
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={busy}
          onClick={() => void unsubscribe()}
        >
          Disable on this browser
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          disabled={!supported || busy}
          onClick={() => void subscribe()}
        >
          <i className="bi bi-bell me-1" aria-hidden="true" />
          Enable spending alerts
        </button>
      )}
    </>
  );
}

export default PushCard;

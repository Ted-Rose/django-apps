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
    <div className="card mb-4">
      <div className="card-body">
        <h5 className="card-title">Spending alerts</h5>
        <p className="card-text text-muted">
          Get a browser push notification when a spending limit is exceeded —
          even when this site is closed.
        </p>
        <p className="mb-2">
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
            Enable spending alerts
          </button>
        )}
      </div>
    </div>
  );
}

export default PushCard;

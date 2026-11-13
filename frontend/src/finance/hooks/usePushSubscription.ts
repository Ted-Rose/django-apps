/**
 * This browser's Web Push subscription for finance alerts.
 *
 * The service worker is the site's shared `sw.js` (registered at
 * root scope by pwa/head.html inside spa_shell.html), so
 * `navigator.serviceWorker.ready` resolves to that registration —
 * nothing here registers a new worker. The POST targets come from
 * the payload's `push_config` (`/api/finance/push/*`).
 *
 * There is no standalone "enable notifications" UI: the caller
 * invokes `ensureSubscribed()` when the user enables an alerting
 * resource (spending limit, balance check, balance alert). It
 * checks the current subscription/permission state, prompts the
 * browser permission only when needed, and reports whether alerts
 * can reach this browser — a denied or unsupported result means
 * the resource must stay disabled. Failures surface as toasts.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiPost } from '../../shared/api/client';
import { ApiError, errorDetail } from '../../shared/api/errors';
import { pushToast } from '../../shared/toasts';
import type { PushConfigOut, PushSubscribeIn } from '../api';

export interface PushSubscriptionState {
  /** Push API + Notification + service worker are all available. */
  supported: boolean;
  /** A permission/subscribe round trip is in flight. */
  busy: boolean;
  /**
   * Ensure this browser can receive push alerts. Resolves true
   * when a subscription is registered server-side — only then may
   * the caller enable its resource.
   */
  ensureSubscribed: () => Promise<boolean>;
}

/** URL-safe base64 → bytes, for PushManager's applicationServerKey. */
export function urlBase64ToUint8Array(
  base64String: string,
): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * True when the browser subscription was created with the currently
 * configured VAPID public key.
 */
function sameKey(subscription: PushSubscription, vapidKey: string): boolean {
  const key = subscription.options?.applicationServerKey;
  if (!key) return true; // cannot tell — assume it is ours
  const expected = urlBase64ToUint8Array(vapidKey);
  const actual = new Uint8Array(key);
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < expected.length; ++i) {
    if (actual[i] !== expected[i]) return false;
  }
  return true;
}

/** Best-effort message for a failed subscribe step. */
function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return errorDetail(error);
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** PushSubscribeIn payload out of a PushSubscription (toJSON shape). */
function subscribePayload(subscription: PushSubscription): PushSubscribeIn {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
  };
}

/** ms to wait for the service worker before giving up — `ready`
 *  can pend forever (e.g. Firefox private windows). */
const SW_READY_TIMEOUT_MS = 5000;

function readyWithTimeout(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), SW_READY_TIMEOUT_MS),
    ),
  ]);
}

export function usePushSubscription(
  config: PushConfigOut,
): PushSubscriptionState {
  const { t } = useTranslation('finance');
  const supported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    Boolean(config.vapid_public_key);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  // Primitives, not `config` — a refetched payload is a fresh
  // object and would re-run the effect / stale the callback.
  const vapidKey = config.vapid_public_key;
  const subscribeUrl = config.subscribe_url;

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const registration = await readyWithTimeout();
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return;
        if (sameKey(subscription, vapidKey)) {
          // Browser stayed subscribed but the server row may be
          // gone — re-register (best effort).
          if (!cancelled) {
            apiPost(subscribeUrl, subscribePayload(subscription)).catch(
              () => {},
            );
          }
        } else {
          // Bound to a different VAPID key — pushes can never
          // succeed, so drop the stale subscription.
          await subscription.unsubscribe();
        }
      } catch {
        // No subscription or no worker yet — ensureSubscribed
        // reports the failure when the user actually enables an
        // alerting resource.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, vapidKey, subscribeUrl]);

  const ensureSubscribed = useCallback(async (): Promise<boolean> => {
    if (!supported) {
      pushToast(t('push.notSupported'), 'warning');
      return false;
    }
    setBusy(true);
    try {
      // Permission first — a subscription can outlive a revoked
      // grant. On 'default' this prompts; on 'granted' it resolves
      // instantly, on 'denied' without prompting.
      if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          pushToast(t('push.permissionDenied'), 'warning');
          return false;
        }
      }
      const registration = await readyWithTimeout();
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !sameKey(subscription, vapidKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }
      await apiPost(subscribeUrl, subscribePayload(subscription));
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      return true;
    } catch (error) {
      pushToast(describeError(error, t('push.subscribeFailed')), 'warning');
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, vapidKey, subscribeUrl, queryClient, t]);

  return { supported, busy, ensureSubscribed };
}

export default usePushSubscription;

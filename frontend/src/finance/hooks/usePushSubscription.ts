/**
 * Port of finance/static/finance/js/push_subscribe.js — manages this
 * browser's Web Push subscription for spending-limit alerts.
 *
 * The service worker is the site's shared `sw.js` (registered at
 * root scope by pwa/head.html inside spa_shell.html), so
 * `navigator.serviceWorker.ready` resolves to that registration —
 * nothing here registers a new worker. The POST targets come from
 * the limits payload's `push_config` (`/api/finance/push/*`), not
 * the template's old `/finance/push/*` URLs.
 *
 * The vanilla version reloaded the page after subscribe/unsubscribe
 * to refresh the device count; the hook instead invalidates the
 * limits query so `subscription_count` refetches.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiPost } from '../../shared/api/client';
import { ApiError, errorDetail } from '../../shared/api/errors';
import type { PushConfigOut, PushSubscribeIn, PushUnsubscribeIn } from '../api';

export interface PushSubscriptionState {
  /** Push API + Notification + service worker are all available. */
  supported: boolean;
  /** This browser currently holds a push subscription. */
  subscribed: boolean;
  /** Suffix text for the device-count line ('— …' or ''). */
  status: string;
  /** A subscribe/unsubscribe round trip is in flight. */
  busy: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
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

/** Best-effort message for a failed subscribe/unsubscribe step. */
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

export function usePushSubscription(
  config: PushConfigOut,
): PushSubscriptionState {
  const { t } = useTranslation('finance');
  const supported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  const [subscribed, setSubscribed] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  // Refetch the limits payload so `subscription_count` updates —
  // the template reached for window.location.reload() instead.
  const refreshCount = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['finance', 'limits'] }),
    [queryClient],
  );

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (subscription && !sameKey(subscription, config.vapid_public_key)) {
          // Bound to a different VAPID key — pushes can never
          // succeed, so drop the stale subscription.
          await subscription.unsubscribe();
          subscription = null;
        }
        if (subscription) {
          // Browser stayed subscribed but the server row may be
          // gone — re-register (best effort).
          apiPost(config.subscribe_url, subscribePayload(subscription)).catch(
            () => {},
          );
        }
        if (!cancelled) setSubscribed(Boolean(subscription));
      } catch {
        if (!cancelled) setSubscribed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, config.vapid_public_key, config.subscribe_url]);

  const subscribe = useCallback(async () => {
    setBusy(true);
    setStatus('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(`— ${t('limits.push.permissionDenied')}`);
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      // Replace any existing subscription so it is bound to the
      // current VAPID key.
      const existing = await registration.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapid_public_key),
      });
      await apiPost(config.subscribe_url, subscribePayload(subscription));
      setSubscribed(true);
      await refreshCount();
    } catch (error) {
      setStatus(`— ${describeError(error, t('limits.push.subscribeFailed'))}`);
    } finally {
      setBusy(false);
    }
  }, [config.vapid_public_key, config.subscribe_url, refreshCount, t]);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    setStatus('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // The server row may already be gone; the local
        // unsubscribe still has to happen.
        await apiPost(config.unsubscribe_url, {
          endpoint: subscription.endpoint,
        } satisfies PushUnsubscribeIn).catch(() => {});
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      await refreshCount();
    } catch (error) {
      setStatus(
        `— ${describeError(error, t('limits.push.unsubscribeFailed'))}`,
      );
    } finally {
      setBusy(false);
    }
  }, [config.unsubscribe_url, refreshCount, t]);

  const displayStatus = !supported
    ? t('limits.push.notSupported')
    : status || (subscribed ? t('limits.push.subscribed') : '');

  return {
    supported,
    subscribed,
    status: displayStatus,
    busy,
    subscribe,
    unsubscribe,
  };
}

export default usePushSubscription;

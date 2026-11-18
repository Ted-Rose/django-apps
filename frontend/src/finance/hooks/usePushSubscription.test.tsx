/**
 * The subscribe failure path reports to Sentry — the toast covers
 * the user, but a broken subscribe step (SW timeout, VAPID
 * mismatch, POST failure) must also reach the error tracker.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/react';
import { apiPost } from '../../shared/api/client';
import { pushToast } from '../../shared/toasts';
import type { PushConfigOut } from '../api';
import usePushSubscription from './usePushSubscription';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('../../shared/api/client', () => ({ apiPost: vi.fn() }));
vi.mock('../../shared/toasts', () => ({ pushToast: vi.fn() }));

const config: PushConfigOut = {
  vapid_public_key: 'AAAA',
  subscription_count: 0,
  subscribe_url: '/api/finance/push/subscribe/',
  unsubscribe_url: '/api/finance/push/unsubscribe/',
};

const subscribe = vi.fn();
const getSubscription = vi.fn();

function mockPushGlobals() {
  const registration = { pushManager: { getSubscription, subscribe } };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration) },
  });
  Object.defineProperty(window, 'PushManager', {
    configurable: true,
    value: function PushManager() {},
  });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission: 'granted', requestPermission: vi.fn() },
  });
}

function renderPushHook() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePushSubscription(config), { wrapper });
}

async function ensureSubscribed(result: {
  current: ReturnType<typeof usePushSubscription>;
}): Promise<boolean> {
  let ok = true;
  await act(async () => {
    ok = await result.current.ensureSubscribed();
  });
  return ok;
}

beforeEach(() => {
  mockPushGlobals();
  getSubscription.mockResolvedValue(null);
});

afterEach(() => {
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  delete (window as { PushManager?: unknown }).PushManager;
  delete (window as { Notification?: unknown }).Notification;
  vi.clearAllMocks();
});

describe('usePushSubscription — Sentry reporting', () => {
  it('captures a failed subscribe step while still toasting', async () => {
    const error = new Error('push service down');
    subscribe.mockRejectedValue(error);
    const { result } = renderPushHook();

    const ok = await ensureSubscribed(result);

    expect(ok).toBe(false);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { context: 'push-subscribe' },
    });
    expect(pushToast).toHaveBeenCalledOnce();
  });

  it('captures a failed server registration POST', async () => {
    const error = new Error('502');
    subscribe.mockResolvedValue({
      endpoint: 'https://push.example/sub',
      toJSON: () => ({ keys: { p256dh: 'a', auth: 'b' } }),
    });
    vi.mocked(apiPost).mockRejectedValue(error);
    const { result } = renderPushHook();

    const ok = await ensureSubscribed(result);

    expect(ok).toBe(false);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { context: 'push-subscribe' },
    });
  });

  it('does not capture on a clean subscribe', async () => {
    subscribe.mockResolvedValue({
      endpoint: 'https://push.example/sub',
      toJSON: () => ({ keys: { p256dh: 'a', auth: 'b' } }),
    });
    vi.mocked(apiPost).mockResolvedValue({});
    const { result } = renderPushHook();

    const ok = await ensureSubscribed(result);

    expect(ok).toBe(true);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App, { resetApplyRulesLatch } from './App';
import { apiGet, apiPost } from '../shared/api/client';
import { clearToasts } from '../shared/toasts';

vi.mock('../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

const PUSH_CONFIG = {
  vapid_public_key: '',
  subscription_count: 0,
  subscribe_url: '/api/finance/push/subscribe/',
  unsubscribe_url: '/api/finance/push/unsubscribe/',
};

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/accounts']}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** URL-aware apiGet: notifications payload, empty accounts page. */
function mockGet(notifications: object[]) {
  mockedApiGet.mockImplementation((url: string) =>
    Promise.resolve(
      url === '/api/finance/notifications/'
        ? { notifications }
        : { accounts: [], push_config: PUSH_CONFIG },
    ),
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  // The mount effect fires POST /rules/apply/ fire-and-forget —
  // give it a resolved promise so its .then chain can't throw.
  mockedApiPost.mockResolvedValue({ success: true });
  clearToasts();
  resetApplyRulesLatch();
});

describe('App notification drain', () => {
  it('toasts unread notifications once and marks them read', async () => {
    mockGet([
      {
        id: 7,
        title: 'Low balance',
        body: 'Everyday: €38.20 — below your €50.00 alert',
        url: '/finance/balances/',
        created_at: '2026-10-01T03:00:00Z',
      },
    ]);
    renderApp();
    expect(
      await screen.findByText(
        'Low balance — Everyday: €38.20 — below your €50.00 alert',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/notifications/read/',
        { ids: [7] },
      ),
    );
  });

  it('marks nothing read when there are no notifications', async () => {
    mockGet([]);
    renderApp();
    // The page settles (empty accounts state) without any
    // mark-read POST — the mount-time /rules/apply/ call aside.
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith('/api/finance/notifications/'),
    );
    expect(
      mockedApiPost.mock.calls.some(([url]) =>
        url.includes('/notifications/read/'),
      ),
    ).toBe(false);
  });

  it('re-runs categorization rules once per shell session', async () => {
    mockGet([]);
    renderApp();
    // Client-side replacement for the old per-page-load
    // apply_rules — the edge-cached shell means page GETs no
    // longer reach Django.
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/rules/apply/',
        {},
      ),
    );
    // A client-side remount must not re-fire the POST — the
    // module-level latch holds for the whole shell session.
    renderApp();
    await screen.findAllByText(/No accounts yet/);
    const applyCalls = mockedApiPost.mock.calls.filter(([url]) =>
      String(url).includes('/rules/apply/'),
    );
    expect(applyCalls).toHaveLength(1);
  });
});

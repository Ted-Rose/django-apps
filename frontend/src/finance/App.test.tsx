import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
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
  clearToasts();
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
    mockedApiPost.mockResolvedValue({ success: true });
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

  it('fetches nothing to read out when there are no notifications', async () => {
    mockGet([]);
    renderApp();
    // The page settles (empty accounts state) without any
    // mark-read POST.
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith('/api/finance/notifications/'),
    );
    expect(mockedApiPost).not.toHaveBeenCalled();
  });
});

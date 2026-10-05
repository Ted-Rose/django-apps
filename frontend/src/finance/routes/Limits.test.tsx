import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Limits from './Limits';
import { apiGet, apiPost } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import { clearToasts } from '../../shared/toasts';
import type {
  LimitOut,
  LimitsOut,
  TransactionsOut,
  WindowStatOut,
} from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

const ACCOUNTS = [
  { id: 5, label: 'Everyday account' },
  { id: 6, label: 'Savings' },
];

const CATEGORIES = [
  { id: 3, name: 'Groceries', color: '#00aa00', is_excluded: false },
];

const PUSH_CONFIG = {
  vapid_public_key: '',
  subscription_count: 0,
  subscribe_url: '/api/finance/push/subscribe/',
  unsubscribe_url: '/api/finance/push/unsubscribe/',
};

function makeWindowStat(overrides: Partial<WindowStatOut> = {}): WindowStatOut {
  return {
    label: '7 days',
    spent: '12.00',
    threshold: '100.00',
    pct: '12.0',
    bar_pct: '12.0',
    bar_class: 'bg-success',
    remaining: '88.00',
    over: null,
    history: [],
    ...overrides,
  };
}

function makeLimit(overrides: Partial<LimitOut> = {}): LimitOut {
  return {
    id: 7,
    accounts: [
      { id: 5, name: 'Everyday account', iban: null, currency: 'EUR' },
    ],
    category: {
      id: 3,
      name: 'Groceries',
      color: '#00aa00',
      is_excluded: false,
    },
    is_active: true,
    limit_7_days: '100.00',
    limit_30_days: null,
    limit_monthly: '400.00',
    window_stats: [makeWindowStat()],
    ...overrides,
  };
}

function makeLimits(overrides: Partial<LimitsOut> = {}): LimitsOut {
  return {
    limits: [],
    overview_months: [
      { value: '', label: 'This month', active: true },
      { value: '2024-12', label: 'December 2024', active: false },
    ],
    selected_month: null,
    as_of: null,
    accounts: ACCOUNTS,
    categories: CATEGORIES,
    push_config: PUSH_CONFIG,
    ...overrides,
  };
}

function makeTransactions(
  overrides: Partial<TransactionsOut> = {},
): TransactionsOut {
  return {
    transactions: [
      {
        id: 11,
        transaction_id: 'tx-11',
        occurrence_date: '2025-01-10',
        booking_date: '2025-01-10',
        account: {
          id: 5,
          name: 'Everyday',
          iban: 'LV…',
          currency: 'EUR',
        },
        remittance_information: 'Coffee',
        counterparty: 'Cafe',
        effective_category: {
          id: 3,
          name: 'Groceries',
          color: '#00aa00',
          is_excluded: false,
        },
        category_is_manual: false,
        amount: '-4.50',
        excluded_amount: '0.00',
        counted_amount: '-4.50',
        currency: 'EUR',
      },
    ],
    page: 1,
    num_pages: 1,
    count: 1,
    has_next: false,
    has_previous: false,
    accounts: ACCOUNTS,
    categories: CATEGORIES,
    counterparties: ['Cafe'],
    selected_account: null,
    selected_category: '3',
    selected_creditor: '',
    selected_source: '',
    search_query: '',
    sort: 'date',
    direction: 'desc',
    filters_active: true,
    ...overrides,
  };
}

function renderLimits(initialEntry = '/limits') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Limits />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** A PushSubscription-shaped stub — only the members the hook uses. */
function makeSubscription(endpoint = 'https://push.example/sub-1') {
  return {
    endpoint,
    options: {},
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({
      endpoint,
      keys: { p256dh: 'key-p256dh', auth: 'key-auth' },
    }),
  } as unknown as PushSubscription;
}

/** jsdom has no Push API — install the globals the hook probes. */
function mockPushApis(subscription: PushSubscription | null = null) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscription),
    subscribe: vi
      .fn()
      .mockResolvedValue(makeSubscription('https://push.example/new-sub')),
  };
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
  Object.defineProperty(window, 'PushManager', {
    value: class PushManager {},
    configurable: true,
  });
  Object.defineProperty(window, 'Notification', {
    value: {
      requestPermission: vi.fn().mockResolvedValue('granted'),
    },
    configurable: true,
  });
  return pushManager;
}

function removePushApis() {
  delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
  delete (window as { PushManager?: unknown }).PushManager;
  delete (window as { Notification?: unknown }).Notification;
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
});

afterEach(() => {
  removePushApis();
});

describe('Limits', () => {
  it('fetches /api/finance/limits/ and renders the form and table', async () => {
    mockedApiGet.mockResolvedValue(
      makeLimits({
        limits: [
          makeLimit({
            window_stats: [
              makeWindowStat(),
              makeWindowStat({
                label: 'This month',
                spent: '410.00',
                threshold: '400.00',
                pct: '102.5',
                bar_pct: '100.0',
                bar_class: 'bg-danger',
                remaining: '-10.00',
                over: '10.00',
                history: [
                  {
                    label: 'Nov 2024',
                    spent: '390.00',
                    threshold: '400.00',
                    pct: '97.5',
                    bar_pct: '97.5',
                    bar_class: 'bg-warning',
                    remaining: '10.00',
                    over: null,
                  },
                ],
              }),
            ],
          }),
        ],
      }),
    );
    renderLimits();
    // The account name also appears as a form checkbox label —
    // scope the assertion to the limit item.
    const item = await screen.findByTestId('limit-7');
    expect(within(item).getByText('Everyday account')).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith('/api/finance/limits/');

    // Window progress bars: label, spent / threshold, bar class +
    // width, remaining/over lines — all precomputed strings.
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getByText(/12\.00 \/ 100\.00 EUR/)).toBeInTheDocument();
    expect(screen.getByText('88.00 EUR left')).toBeInTheDocument();
    const okBar = document.querySelector('.progress-bar.bg-success');
    expect(okBar).toHaveStyle({ width: '12%' });
    const dangerBar = document.querySelector('.progress-bar.bg-danger');
    expect(dangerBar).toHaveStyle({ width: '100%' });
    expect(screen.getByText('10.00 EUR over')).toBeInTheDocument();

    // Past-month history renders inside a <details> block.
    const details = document.querySelector('details');
    expect(details).not.toBeNull();
    expect(screen.getByText('Past months')).toBeInTheDocument();
    expect(screen.getByText('Nov 2024')).toBeInTheDocument();
    expect(screen.getByText(/390\.00 \/ 400\.00 EUR/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no limits', async () => {
    mockedApiGet.mockResolvedValue(makeLimits());
    renderLimits();
    expect(await screen.findByText('No limits set yet.')).toBeInTheDocument();
    // The overview dropdown only renders when limits exist.
    expect(screen.queryByLabelText('Overview')).not.toBeInTheDocument();
  });

  it('collapses and expands sections via their chevron headers', async () => {
    mockedApiGet.mockResolvedValue(makeLimits({ limits: [makeLimit()] }));
    renderLimits();
    const overviewToggle = await screen.findByRole('button', {
      name: 'Limit overview',
    });
    expect(overviewToggle).toHaveAttribute('aria-expanded', 'true');
    const body = document.getElementById(
      overviewToggle.getAttribute('aria-controls')!,
    )!;
    expect(body).toHaveClass('show');

    fireEvent.click(overviewToggle);
    expect(overviewToggle).toHaveAttribute('aria-expanded', 'false');
    expect(body).toHaveClass('collapse');
    expect(body).not.toHaveClass('show');

    // The form section starts collapsed when not editing.
    const formToggle = screen.getByRole('button', { name: 'Set a limit' });
    expect(formToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(formToggle);
    expect(formToggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('creates a limit via POST limits/save/', async () => {
    mockedApiGet.mockResolvedValue(makeLimits());
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Spending limit saved.',
    });
    renderLimits();
    // Accounts are checkboxes — a limit can cover several at once.
    fireEvent.click(await screen.findByLabelText('Everyday account'));
    fireEvent.click(screen.getByLabelText('Savings'));
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('Limit per calendar month'), {
      target: { value: '400' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/finance/limits/save/', {
        accounts: [5, 6],
        category: 3,
        limit_7_days: null,
        limit_30_days: null,
        limit_monthly: '400',
        is_active: true,
      }),
    );
    expect(
      await screen.findByText('Spending limit saved.'),
    ).toBeInTheDocument();
  });

  it('?edit= prefills the form and posts limit_id', async () => {
    mockedApiGet.mockResolvedValue(makeLimits({ limits: [makeLimit()] }));
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Spending limit updated.',
    });
    renderLimits('/limits?edit=7');
    expect(
      await screen.findByRole('heading', { name: 'Edit limit' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Everyday account')).toBeChecked();
    expect(screen.getByLabelText('Savings')).not.toBeChecked();
    expect(screen.getByLabelText('Category')).toHaveValue('3');
    expect(screen.getByLabelText('Limit per 7 days')).toHaveValue(100);
    expect(screen.getByLabelText('Limit per calendar month')).toHaveValue(400);
    expect(screen.getByLabelText('Is active')).toBeChecked();

    fireEvent.change(screen.getByLabelText('Limit per 7 days'), {
      target: { value: '80' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/limits/save/',
        expect.objectContaining({
          limit_id: 7,
          accounts: [5],
          category: 3,
          limit_7_days: '80',
          limit_monthly: '400.00',
          is_active: true,
        }),
      ),
    );
    // After save the ?edit= param clears and the form flips back
    // to create mode.
    expect(
      await screen.findByRole('heading', { name: 'Set a limit' }),
    ).toBeInTheDocument();
  });

  it('toasts the detail on a 409 account+category conflict', async () => {
    mockedApiGet.mockResolvedValue(makeLimits());
    mockedApiPost.mockRejectedValue(
      new ApiError('Request failed: 409 Conflict', 409, 'Conflict', {
        detail:
          'A limit already exists for one of these accounts and this category.',
      }),
    );
    renderLimits();
    fireEvent.click(await screen.findByLabelText('Everyday account'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'A limit already exists for one of these accounts and this category.',
      ),
    ).toBeInTheDocument();
  });

  it('deletes a limit via POST limits/{id}/delete/', async () => {
    mockedApiGet.mockResolvedValue(makeLimits({ limits: [makeLimit()] }));
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Spending limit deleted.',
    });
    renderLimits();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete limit 7' }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/limits/7/delete/',
      ),
    );
    expect(
      await screen.findByText('Spending limit deleted.'),
    ).toBeInTheDocument();
  });

  it('sets ?month= from the overview dropdown', async () => {
    mockedApiGet.mockResolvedValue(
      makeLimits({
        limits: [makeLimit()],
        overview_months: [
          { value: '', label: 'This month', active: false },
          { value: '2024-12', label: 'December 2024', active: true },
        ],
        selected_month: '2024-12',
        as_of: '2024-12-31',
      }),
    );
    renderLimits('/limits?month=2024-12');
    expect(
      await screen.findByText(/Windows evaluated as of December 31, 2024/),
    ).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/finance/limits/?month=2024-12',
    );

    // Switching back to the current month clears the param.
    fireEvent.change(screen.getByLabelText('Overview'), {
      target: { value: '' },
    });
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith('/api/finance/limits/'),
    );
  });

  it('navigates back to this month via the link', async () => {
    mockedApiGet.mockResolvedValue(
      makeLimits({
        limits: [makeLimit()],
        overview_months: [
          { value: '', label: 'This month', active: false },
          { value: '2024-12', label: 'December 2024', active: true },
        ],
        selected_month: '2024-12',
        as_of: '2024-12-31',
      }),
    );
    renderLimits('/limits?month=2024-12');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Back to this month' }),
    );
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith('/api/finance/limits/'),
    );
  });

  it('drills into a window stat: transactions load below scoped to the limit', async () => {
    const limits = makeLimits({
      limits: [
        makeLimit({
          accounts: [
            { id: 5, name: 'Everyday account', iban: null, currency: 'EUR' },
            { id: 6, name: 'Savings', iban: null, currency: 'EUR' },
          ],
          window_stats: [
            makeWindowStat({
              key: 'days7',
              date_from: '2025-01-09',
              date_to: '2025-01-15',
            }),
          ],
        }),
      ],
    });
    mockedApiGet.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/api/finance/transactions/')
          ? makeTransactions()
          : limits,
      ),
    );
    renderLimits();

    const stat = await screen.findByRole('button', { name: /7 days/ });
    fireEvent.click(stat);

    // Category + every limit account + the stat's exact date range.
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/finance/transactions/?account=5%2C6&category=3&from=2025-01-09&to=2025-01-15',
      ),
    );
    expect(
      await screen.findByText('Transactions — Groceries · 7 days'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Coffee')).toBeInTheDocument();

    // The stat click only ran the transaction query — the limits
    // payload wasn't refetched and no navigation happened.
    expect(
      mockedApiGet.mock.calls.filter(([url]) =>
        String(url).startsWith('/api/finance/limits'),
      ),
    ).toHaveLength(1);

    // Clicking the open stat again closes the drill-down.
    fireEvent.click(stat);
    await waitFor(() =>
      expect(
        screen.queryByText('Transactions — Groceries · 7 days'),
      ).not.toBeInTheDocument(),
    );
  });

  it("drills into a past-month history row with that month's range", async () => {
    const limits = makeLimits({
      limits: [
        makeLimit({
          window_stats: [
            makeWindowStat({
              label: 'This month',
              key: 'thisMonth',
              value: '2025-01',
              date_from: '2025-01-01',
              date_to: '2025-01-31',
              history: [
                {
                  label: 'Nov 2024',
                  value: '2024-11',
                  date_from: '2024-11-01',
                  date_to: '2024-11-30',
                  spent: '390.00',
                  threshold: '400.00',
                  pct: '97.5',
                  bar_pct: '97.5',
                  bar_class: 'bg-warning',
                  remaining: '10.00',
                  over: null,
                },
              ],
            }),
          ],
        }),
      ],
    });
    mockedApiGet.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/api/finance/transactions/')
          ? makeTransactions()
          : limits,
      ),
    );
    renderLimits();
    // `value` is formatted via fmtMonth — 'November 2024'.
    await screen.findByText('November 2024');
    // Expand the history <details> — its rows are only clickable
    // once open (and only enter the a11y tree then).
    const details = document.querySelector('details')!;
    details.open = true;

    fireEvent.click(
      await screen.findByRole('button', { name: /November 2024/ }),
    );
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/finance/transactions/?account=5&category=3&from=2024-11-01&to=2024-11-30',
      ),
    );
  });

  it('keeps all-category limit stats non-clickable', async () => {
    mockedApiGet.mockResolvedValue(
      makeLimits({
        limits: [
          makeLimit({
            category: null,
            window_stats: [makeWindowStat({ key: 'days7' })],
          }),
        ],
      }),
    );
    renderLimits();
    await screen.findByTestId('limit-7');
    expect(
      screen.queryByRole('button', { name: /7 days/ }),
    ).not.toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledTimes(1);
  });

  it('hides the push card when no VAPID key is configured', async () => {
    mockedApiGet.mockResolvedValue(makeLimits());
    renderLimits();
    await screen.findByText('No limits set yet.');
    expect(screen.queryByText('Spending alerts')).not.toBeInTheDocument();
  });

  it('subscribes this browser and POSTs to subscribe_url', async () => {
    const pushManager = mockPushApis(null);
    mockedApiGet.mockResolvedValue(
      makeLimits({
        push_config: { ...PUSH_CONFIG, vapid_public_key: 'dGVzdA' },
      }),
    );
    mockedApiPost.mockResolvedValue({ success: true });
    renderLimits();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Spending alerts' }),
    );
    const enable = await screen.findByRole('button', {
      name: 'Enable spending alerts',
    });
    fireEvent.click(enable);
    await waitFor(() =>
      expect(pushManager.subscribe).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/push/subscribe/',
        {
          endpoint: 'https://push.example/new-sub',
          keys: { p256dh: 'key-p256dh', auth: 'key-auth' },
        },
      ),
    );
    expect(
      await screen.findByRole('button', { name: 'Disable on this browser' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('push-status')).toHaveTextContent(
      'this browser is subscribed',
    );
  });

  it('unsubscribes via POST unsubscribe_url then browser unsubscribe', async () => {
    const subscription = makeSubscription();
    mockPushApis(subscription);
    mockedApiGet.mockResolvedValue(
      makeLimits({
        push_config: { ...PUSH_CONFIG, vapid_public_key: 'dGVzdA' },
      }),
    );
    mockedApiPost.mockResolvedValue({ success: true });
    renderLimits();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Spending alerts' }),
    );
    const disable = await screen.findByRole('button', {
      name: 'Disable on this browser',
    });
    // The effect re-registered the live subscription best-effort.
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/push/subscribe/',
        expect.objectContaining({ endpoint: 'https://push.example/sub-1' }),
      ),
    );
    fireEvent.click(disable);
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/push/unsubscribe/',
        { endpoint: 'https://push.example/sub-1' },
      ),
    );
    await waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalled());
    expect(
      await screen.findByRole('button', { name: 'Enable spending alerts' }),
    ).toBeInTheDocument();
  });

  it('disables the push button when the browser lacks push support', async () => {
    mockedApiGet.mockResolvedValue(
      makeLimits({
        push_config: { ...PUSH_CONFIG, vapid_public_key: 'dGVzdA' },
      }),
    );
    renderLimits();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Spending alerts' }),
    );
    const enable = await screen.findByRole('button', {
      name: 'Enable spending alerts',
    });
    expect(enable).toBeDisabled();
    expect(screen.getByTestId('push-status')).toHaveTextContent(
      'push notifications are not supported',
    );
  });

  it('shows an error alert with a working retry', async () => {
    mockedApiGet.mockRejectedValueOnce(
      new ApiError('Request failed: 500', 500, 'Internal Server Error'),
    );
    mockedApiGet.mockResolvedValue(makeLimits({ limits: [makeLimit()] }));
    renderLimits();
    expect(await screen.findByText(/Couldn't load limits/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    const item = await screen.findByTestId('limit-7');
    expect(within(item).getByText('Everyday account')).toBeInTheDocument();
  });
});

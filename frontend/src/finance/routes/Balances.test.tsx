import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Balances from './Balances';
import { apiGet, apiPost } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import { clearToasts } from '../../shared/toasts';
import type { AccountOut, BalancesOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

function makeAccount(overrides: Partial<AccountOut> = {}): AccountOut {
  return {
    id: 5,
    account_id: 'remote-acct-5',
    name: 'Everyday account',
    iban: 'LV80BANK0000435195001',
    institution_id: 'SWEDBANK_HABALV22',
    currency: 'EUR',
    display_name: 'Everyday account',
    is_owner: true,
    owner_username: 'tedis',
    included_in_balance_check: true,
    last_balance: {
      balanceAmount: { amount: '123.45', currency: 'EUR' },
      balanceType: 'interimAvailable',
    },
    balance_updated_at: '2025-01-15T10:30:00Z',
    ...overrides,
  };
}

function makeBalances(accounts: AccountOut[] = []): BalancesOut {
  return { accounts };
}

function renderBalances() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/balances']}>
      <QueryClientProvider client={queryClient}>
        <Balances />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
});

describe('Balances', () => {
  it('fetches /api/finance/balances/ and renders a card per account', async () => {
    mockedApiGet.mockResolvedValue(
      makeBalances([
        makeAccount(),
        makeAccount({
          id: 6,
          name: '',
          account_id: 'remote-acct-6',
          iban: 'GB29NWBK60161331926819',
          last_balance: null,
          balance_updated_at: null,
        }),
      ]),
    );
    renderBalances();
    expect(await screen.findByText('Everyday account')).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith('/api/finance/balances/');

    // Card fields mirror the template: iban, amount + currency,
    // balanceType and the localized "Last updated" timestamp.
    // (Scoped to the account card — the same amount also feeds the
    // per-currency Total stat cards.)
    expect(screen.getByText('LV80BANK0000435195001')).toBeInTheDocument();
    const card = screen.getByText('LV80BANK0000435195001').closest('.fin-card');
    expect(
      within(card as HTMLElement).getByText(/123\.45/),
    ).toBeInTheDocument();
    expect(screen.getByText('interimAvailable')).toBeInTheDocument();
    const expected = new Date('2025-01-15T10:30:00Z').toLocaleString();
    expect(screen.getByText(`Last updated: ${expected}`)).toBeInTheDocument();

    // Nameless accounts fall back to the iban — shown as both the
    // card title and the muted card text, like the template.
    expect(screen.getAllByText('GB29NWBK60161331926819')).toHaveLength(2);
    expect(
      screen.getByText(/No balance retrieved yet\. Click "Get latest balance"/),
    ).toBeInTheDocument();
  });

  it('shows a per-currency total over the retrieved balances', async () => {
    mockedApiGet.mockResolvedValue(
      makeBalances([
        makeAccount(),
        makeAccount({
          id: 6,
          account_id: 'remote-acct-6',
          last_balance: {
            balanceAmount: { amount: '6.55', currency: 'EUR' },
            balanceType: 'interimAvailable',
          },
        }),
        makeAccount({
          id: 7,
          account_id: 'remote-acct-7',
          last_balance: {
            balanceAmount: { amount: '50', currency: 'USD' },
            balanceType: 'interimAvailable',
          },
        }),
        // No balance yet — contributes nothing to the totals.
        makeAccount({
          id: 8,
          account_id: 'remote-acct-8',
          last_balance: null,
          balance_updated_at: null,
        }),
      ]),
    );
    renderBalances();
    expect(await screen.findByText('Total (EUR)')).toBeInTheDocument();
    expect(screen.getByText('Total (USD)')).toBeInTheDocument();
    expect(screen.getByText('130.00 EUR')).toBeInTheDocument();
    expect(screen.getByText('50.00 USD')).toBeInTheDocument();
  });

  it('shows the alert badge only when balance_alert is set', async () => {
    mockedApiGet.mockResolvedValue(
      makeBalances([
        makeAccount({ balance_alert: '50.00' }),
        makeAccount({
          id: 6,
          name: 'Shared savings',
          account_id: 'remote-acct-6',
          balance_alert: null,
        }),
      ]),
    );
    renderBalances();
    const card = (await screen.findByText('Everyday account')).closest(
      '.fin-card',
    ) as HTMLElement;
    expect(
      within(card).getByText(/Alert below 50\.00 EUR/),
    ).toBeInTheDocument();
    const other = screen
      .getByText('Shared savings')
      .closest('.fin-card') as HTMLElement;
    expect(within(other).queryByText(/Alert below/)).not.toBeInTheDocument();
  });

  it('hides the total when no account has a balance yet', async () => {
    mockedApiGet.mockResolvedValue(
      makeBalances([
        makeAccount({ last_balance: null, balance_updated_at: null }),
      ]),
    );
    renderBalances();
    expect(
      await screen.findByText(/No balance retrieved yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Total \(/)).not.toBeInTheDocument();
  });

  it('shows the empty state linking to the Accounts page', async () => {
    mockedApiGet.mockResolvedValue(makeBalances());
    renderBalances();
    expect(
      await screen.findByText(/No accounts are included in the balance check/),
    ).toBeInTheDocument();
    // The burger menu also links to Accounts — scope to the empty
    // state block.
    const empty = document.querySelector('.fin-empty');
    expect(empty?.querySelector('a')).toHaveAttribute('href', '/accounts');
    expect(
      screen.queryByRole('button', { name: /Get latest balance/ }),
    ).not.toBeInTheDocument();
  });

  it('POSTs balances/refresh and toasts the message', async () => {
    mockedApiGet.mockResolvedValue(makeBalances([makeAccount()]));
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Updated 1 balance(s).',
      updated: 1,
      rate_limited: 0,
      failed: 0,
    });
    renderBalances();
    fireEvent.click(
      await screen.findByRole('button', { name: /Get latest balance/ }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/balances/refresh/',
      ),
    );
    expect(
      await screen.findByText('Updated 1 balance(s).'),
    ).toBeInTheDocument();
  });

  it('toasts a warning when the refresh reports failures', async () => {
    mockedApiGet.mockResolvedValue(makeBalances([makeAccount()]));
    mockedApiPost.mockResolvedValue({
      success: false,
      message: '1 failed to fetch.',
      updated: 0,
      rate_limited: 0,
      failed: 1,
    });
    renderBalances();
    fireEvent.click(
      await screen.findByRole('button', { name: /Get latest balance/ }),
    );
    expect(await screen.findByText('1 failed to fetch.')).toBeInTheDocument();
  });

  it('shows an error alert with a working retry', async () => {
    mockedApiGet.mockRejectedValueOnce(
      new ApiError('Request failed: 500', 500, 'Internal Server Error'),
    );
    mockedApiGet.mockResolvedValue(makeBalances([makeAccount()]));
    renderBalances();
    expect(
      await screen.findByText(/Couldn't load balances/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Everyday account')).toBeInTheDocument();
  });
});

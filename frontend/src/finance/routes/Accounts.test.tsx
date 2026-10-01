import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Accounts from './Accounts';
import { apiGet, apiPost } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import { clearToasts } from '../../shared/toasts';
import type { AccountOut, AccountsOut } from '../api';

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
    included_in_balance_check: false,
    last_balance: null,
    balance_updated_at: null,
    ...overrides,
  };
}

function makeAccounts(accounts: AccountOut[] = []): AccountsOut {
  return { accounts };
}

function renderAccounts() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/accounts']}>
      <QueryClientProvider client={queryClient}>
        <Accounts />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
});

describe('Accounts', () => {
  it('fetches /api/finance/accounts/ and renders each account', async () => {
    mockedApiGet.mockResolvedValue(
      makeAccounts([
        makeAccount(),
        makeAccount({
          id: 6,
          name: 'Shared savings',
          display_name: 'Shared savings',
          iban: 'GB29NWBK60161331926819',
          institution_id: 'REVOLUT_REVOGB21',
          is_owner: false,
          owner_username: 'anna',
          included_in_balance_check: true,
        }),
      ]),
    );
    renderAccounts();
    expect(await screen.findByText('Everyday account')).toBeInTheDocument();
    expect(screen.getByText('Shared savings')).toBeInTheDocument();
    expect(screen.getByText('Shared by anna')).toBeInTheDocument();
    expect(screen.getByText(/SWEDBANK_HABALV22 · EUR/)).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith('/api/finance/accounts/');
  });

  it('shows the empty state with a connect link', async () => {
    mockedApiGet.mockResolvedValue(makeAccounts());
    renderAccounts();
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Connect a bank' }),
    ).toHaveAttribute('href', '/connect');
  });

  it('toggles balance check and toasts the API message', async () => {
    mockedApiGet.mockResolvedValue(makeAccounts([makeAccount()]));
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Account included in the balance check.',
      included_in_balance_check: true,
    });
    renderAccounts();
    const toggle = await screen.findByRole('button', {
      name: /Balance check/,
    });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/accounts/5/toggle-balance-check/',
      ),
    );
    expect(
      await screen.findByText('Account included in the balance check.'),
    ).toBeInTheDocument();
  });

  it('submits the share form with the typed username', async () => {
    mockedApiGet.mockResolvedValue(makeAccounts([makeAccount()]));
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Account shared with bob.',
    });
    renderAccounts();
    const input = await screen.findByLabelText('Username to share with');
    fireEvent.change(input, { target: { value: 'bob' } });
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/accounts/5/share/',
        { username: 'bob' },
      ),
    );
    expect(
      await screen.findByText('Account shared with bob.'),
    ).toBeInTheDocument();
    // The field resets after a successful share.
    expect(input).toHaveValue('');
  });

  it('hides the share form on shared (non-owned) accounts', async () => {
    mockedApiGet.mockResolvedValue(
      makeAccounts([makeAccount({ is_owner: false, owner_username: 'anna' })]),
    );
    renderAccounts();
    await screen.findByText('Shared by anna');
    expect(
      screen.queryByRole('button', { name: /Share/ }),
    ).not.toBeInTheDocument();
    // The balance-check toggle stays available for sharers.
    expect(
      screen.getByRole('button', { name: /Balance check/ }),
    ).toBeInTheDocument();
  });

  it('toasts an error when a mutation fails', async () => {
    mockedApiGet.mockResolvedValue(makeAccounts([makeAccount()]));
    mockedApiPost.mockRejectedValue(
      new ApiError('Request failed: 404 Not Found', 404, 'Not Found', {
        detail: 'No Account matches the given query.',
      }),
    );
    renderAccounts();
    fireEvent.click(
      await screen.findByRole('button', { name: /Balance check/ }),
    );
    expect(
      await screen.findByText(/No Account matches the given query/),
    ).toBeInTheDocument();
  });

  it('shows an error alert with a working retry', async () => {
    mockedApiGet.mockRejectedValueOnce(
      new ApiError('Request failed: 500', 500, 'Internal Server Error'),
    );
    mockedApiGet.mockResolvedValue(makeAccounts([makeAccount()]));
    renderAccounts();
    expect(
      await screen.findByText(/Couldn't load accounts/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Everyday account')).toBeInTheDocument();
  });
});

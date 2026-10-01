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
import Transactions from './Transactions';
import { apiGet, apiPost } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import { clearToasts } from '../../shared/toasts';
import type { TransactionOut, TransactionsOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

function makeTransaction(
  overrides: Partial<TransactionOut> = {},
): TransactionOut {
  return {
    id: 1,
    transaction_id: 'tx-1',
    booking_date: '2025-01-15',
    account: { id: 5, name: 'Everyday account', currency: 'EUR' },
    remittance_information: 'Rent January',
    counterparty: 'Landlord Ltd',
    effective_category: { id: 3, name: 'Housing', color: '#ff0000' },
    amount: '-500.00',
    currency: 'EUR',
    ...overrides,
  };
}

function makeTransactions(
  overrides: Partial<TransactionsOut> = {},
): TransactionsOut {
  return {
    transactions: [],
    page: 1,
    num_pages: 1,
    count: 0,
    has_next: false,
    has_previous: false,
    accounts: [
      { id: 5, label: 'Everyday account' },
      { id: 6, label: 'Savings' },
    ],
    categories: [{ id: 3, name: 'Housing', color: '#ff0000' }],
    counterparties: ['Employer Inc', 'Landlord Ltd'],
    selected_account: null,
    selected_category: '',
    selected_creditor: '',
    search_query: '',
    sort: 'date',
    direction: 'desc',
    filters_active: false,
    ...overrides,
  };
}

function renderTransactions(initialEntry = '/transactions') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Transactions />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Open a column-header dropdown and scope queries to its menu. */
function openHeaderMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  const menu = document.querySelector('.dropdown-menu.show');
  if (!menu) throw new Error(`Dropdown for "${name}" did not open`);
  return within(menu as HTMLElement);
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
});

describe('Transactions', () => {
  it('fetches /api/finance/transactions/ and renders each row', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({
        count: 2,
        transactions: [
          makeTransaction(),
          makeTransaction({
            id: 2,
            booking_date: '2025-01-10',
            account: { id: 6, name: 'Savings', currency: 'EUR' },
            remittance_information: null,
            counterparty: 'Employer Inc',
            effective_category: null,
            amount: '2500.00',
          }),
        ],
      }),
    );
    renderTransactions();
    expect(
      await screen.findByRole('cell', { name: 'Rent January' }),
    ).toBeInTheDocument();
    // booking_date renders via toLocaleDateString (local-datetime port).
    expect(
      screen.getByRole('cell', {
        name: new Date('2025-01-15T00:00:00').toLocaleDateString(),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('cell', { name: 'Everyday account' }),
    ).toBeInTheDocument();
    // Category badge (name) and the uncategorized dash.
    expect(screen.getByRole('cell', { name: 'Housing' })).toBeInTheDocument();
    // Amount keeps the raw string + currency, signed colored cell.
    const amountCell = screen.getByRole('cell', { name: '-500.00 EUR' });
    expect(amountCell).toHaveClass('text-danger');
    expect(screen.getByRole('cell', { name: '2500.00 EUR' })).toHaveClass(
      'text-success',
    );
    expect(mockedApiGet).toHaveBeenCalledWith('/api/finance/transactions/');
  });

  it('shows the filtered/unfiltered empty states', async () => {
    mockedApiGet.mockResolvedValue(makeTransactions());
    const { unmount } = renderTransactions();
    expect(
      await screen.findByText(/No transactions synced yet/),
    ).toBeInTheDocument();
    unmount();

    mockedApiGet.mockResolvedValue(
      makeTransactions({ filters_active: true, selected_account: 5 }),
    );
    renderTransactions('/transactions?account=5');
    expect(
      await screen.findByText(/No transactions match the selected filters/),
    ).toBeInTheDocument();
  });

  it('sorts a column from its header dropdown', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({ sort: 'amount', direction: 'desc' }),
    );
    renderTransactions();
    await screen.findByRole('button', { name: 'Amount' });
    const menu = openHeaderMenu('Amount');
    fireEvent.click(menu.getByRole('button', { name: 'Largest first' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/transactions/?sort=amount&direction=desc',
      ),
    );
  });

  it('filters by account via the column dropdown', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({ selected_account: 5, filters_active: true }),
    );
    renderTransactions();
    await screen.findByRole('button', { name: 'Account' });
    const menu = openHeaderMenu('Account');
    fireEvent.click(menu.getByRole('button', { name: 'Everyday account' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/transactions/?account=5',
      ),
    );
  });

  it('filters by category including the Uncategorized option', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({ selected_category: 'none', filters_active: true }),
    );
    renderTransactions();
    await screen.findByRole('button', { name: 'Category' });
    const menu = openHeaderMenu('Category');
    fireEvent.click(menu.getByRole('button', { name: 'Uncategorized' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/transactions/?category=none',
      ),
    );
  });

  it('typeahead-filters the creditor list and selects one', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({
        selected_creditor: 'Landlord Ltd',
        filters_active: true,
      }),
    );
    renderTransactions();
    await screen.findByRole('button', { name: 'Creditor' });
    const menu = openHeaderMenu('Creditor');
    // The typeahead hides non-matching options without closing the menu.
    fireEvent.change(menu.getByLabelText('Search creditors'), {
      target: { value: 'land' },
    });
    expect(
      menu.queryByRole('button', { name: 'Employer Inc' }),
    ).not.toBeInTheDocument();
    fireEvent.click(menu.getByRole('button', { name: 'Landlord Ltd' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/transactions/?creditor=Landlord+Ltd',
      ),
    );
  });

  it('searches descriptions via the q param', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({ search_query: 'rent', filters_active: true }),
    );
    renderTransactions();
    await screen.findByRole('button', { name: 'Description' });
    const menu = openHeaderMenu('Description');
    fireEvent.change(menu.getByLabelText('Search descriptions'), {
      target: { value: 'rent' },
    });
    fireEvent.click(menu.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/transactions/?q=rent',
      ),
    );
  });

  it('paginates with the elided page buttons', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({
        page: 1,
        num_pages: 3,
        count: 250,
        has_next: true,
      }),
    );
    renderTransactions();
    expect(
      await screen.findByText('Page 1 of 3 — 250 transactions'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/transactions/?page=2',
      ),
    );
  });

  it('resets the page when a filter changes', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({ selected_account: 5, filters_active: true }),
    );
    renderTransactions('/transactions?account=5&page=2');
    await screen.findByRole('button', { name: 'Category' });
    const menu = openHeaderMenu('Category');
    fireEvent.click(menu.getByRole('button', { name: 'Uncategorized' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/transactions/?account=5&category=none',
      ),
    );
  });

  it('clears every filter via the Clear filters link', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({
        selected_account: 5,
        search_query: 'rent',
        filters_active: true,
      }),
    );
    renderTransactions('/transactions?account=5&q=rent');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear filters' }),
    );
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/transactions/',
      ),
    );
  });

  it('posts the sync mutation and toasts the message', async () => {
    mockedApiGet.mockResolvedValue(makeTransactions());
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Synced 3 new transactions (1 updated).',
      created: 3,
      updated: 1,
      failed: 0,
    });
    renderTransactions();
    fireEvent.click(
      await screen.findByRole('button', { name: /Sync transactions/ }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/transactions/sync/',
        undefined,
      ),
    );
    expect(
      await screen.findByText('Synced 3 new transactions (1 updated).'),
    ).toBeInTheDocument();
  });

  it('passes the account filter through to the sync POST', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({ selected_account: 5, filters_active: true }),
    );
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Synced 1 new transactions (0 updated).',
      created: 1,
      updated: 0,
      failed: 0,
    });
    renderTransactions('/transactions?account=5');
    fireEvent.click(
      await screen.findByRole('button', { name: /Sync transactions/ }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/transactions/sync/',
        { account: 5 },
      ),
    );
  });

  it('shows an error alert with a working retry', async () => {
    mockedApiGet.mockRejectedValueOnce(
      new ApiError('Request failed: 500', 500, 'Internal Server Error'),
    );
    mockedApiGet.mockResolvedValue(makeTransactions());
    renderTransactions();
    expect(
      await screen.findByText(/Couldn't load transactions/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/transactions/',
      ),
    );
  });
});

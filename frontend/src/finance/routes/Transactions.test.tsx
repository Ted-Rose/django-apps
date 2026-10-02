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
    occurrence_date: '2025-01-15',
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
    selected_source: '',
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
            occurrence_date: '2025-01-10',
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
    // occurrence_date renders via toLocaleDateString (local-datetime
    // port).
    expect(
      screen.getByRole('cell', {
        name: new Date('2025-01-15T00:00:00').toLocaleDateString(),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('cell', { name: 'Everyday account' }),
    ).toBeInTheDocument();
    // Category badge (name) and the uncategorized placeholder — the
    // badge is the assign-category dropdown toggle. (The name also
    // appears in closed dropdown menus, so assert on the badge
    // element itself.)
    const firstRow = screen
      .getByRole('cell', { name: 'Rent January' })
      .closest('tr') as HTMLElement;
    const secondRow = screen
      .getByRole('cell', { name: '-' })
      .closest('tr') as HTMLElement;
    expect(firstRow.querySelector('.fin-cat-badge')).toHaveTextContent(
      'Housing',
    );
    expect(within(secondRow).getByText('Set category')).toBeInTheDocument();
    // Amount keeps the raw string + currency, signed colored cell.
    const amountCell = screen.getByRole('cell', { name: '-500.00 EUR' });
    expect(amountCell).toHaveClass('text-danger');
    expect(screen.getByRole('cell', { name: '2500.00 EUR' })).toHaveClass(
      'text-success',
    );
    expect(mockedApiGet).toHaveBeenCalledWith('/api/finance/transactions/');
  });

  it('tags each cell with the tx-cell-* hook the responsive CSS uses', async () => {
    // Below lg, finance.css turns rows into cards and reorders cells
    // via these classes — a refactor dropping them breaks mobile.
    mockedApiGet.mockResolvedValue(
      makeTransactions({ count: 1, transactions: [makeTransaction()] }),
    );
    renderTransactions();
    const cell = await screen.findByRole('cell', { name: 'Rent January' });
    const row = cell.closest('tr') as HTMLElement;
    for (const cls of [
      'tx-cell-date',
      'tx-cell-account',
      'tx-cell-desc',
      'tx-cell-counterparty',
      'tx-cell-category',
      'tx-cell-amount',
    ]) {
      expect(row.querySelector(`.${cls}`)).not.toBeNull();
    }
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

  it('toasts a per-account breakdown after sync', async () => {
    mockedApiGet.mockResolvedValue(makeTransactions());
    mockedApiPost.mockResolvedValue({
      success: false,
      message: 'Synced 1 new transactions, but 1 account(s) failed.',
      created: 1,
      updated: 0,
      failed: 1,
      accounts: [
        {
          account: 'Everyday account',
          status: 'synced',
          created: 1,
          updated: 0,
          detail: '',
        },
        {
          account: 'Savings',
          status: 'failed',
          created: 0,
          updated: 0,
          detail: 'GoCardless API error 429',
        },
        {
          account: 'Joint',
          status: 'skipped',
          created: 0,
          updated: 0,
          detail: 'Requisition status is EX (not LN)',
        },
      ],
    });
    renderTransactions();
    fireEvent.click(
      await screen.findByRole('button', { name: /Sync transactions/ }),
    );
    expect(
      await screen.findByText(/Everyday account: \+1 new \(0 updated\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Savings: failed — GoCardless API error 429/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Joint: skipped — Requisition status is EX/),
    ).toBeInTheDocument();
  });

  it('opens a prefilled rule drawer from a transaction row', async () => {
    // The drawer needs the rules payload (categories, match types,
    // scopes, operators) — fetched lazily on the first click.
    const rulesPayload = {
      rules: [],
      categories: [{ id: 3, name: 'Housing', color: '#ff0000' }],
      match_types: [{ value: 'contains', label: 'Contains' }],
      counterparty_scopes: [{ value: 'any', label: 'Debtor or creditor' }],
      operators: [{ value: 'AND', label: 'AND' }],
    };
    mockedApiGet.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/api/finance/rules/')
          ? rulesPayload
          : makeTransactions({
              count: 1,
              transactions: [makeTransaction()],
            }),
      ),
    );
    mockedApiPost.mockResolvedValue({
      success: true,
      match_count: 1,
      apply_count: 1,
      is_active: true,
      category: 'Housing',
      changes_total: 0,
      gains: 0,
      losses: 0,
      other_changes: 0,
      changes: [],
    });
    renderTransactions();
    // The category badge opens the per-row menu; the rule action is
    // a menu item at its bottom.
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Change category for transaction 1',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Create categorization rule for transaction 1',
      }),
    );
    const drawer = await screen.findByTestId('rule-drawer');
    expect(
      within(drawer).getByRole('heading', { name: 'New rule' }),
    ).toBeInTheDocument();
    expect(within(drawer).getByLabelText('Counterparty name')).toHaveValue(
      'Landlord Ltd',
    );
    expect(within(drawer).getByLabelText('Description')).toHaveValue(
      'Rent January',
    );
    await waitFor(
      () =>
        expect(mockedApiPost).toHaveBeenCalledWith(
          '/api/finance/rules/preview/',
          expect.objectContaining({
            rule_id: null,
            category_id: 3,
            counterparty_pattern: 'Landlord Ltd',
            description_pattern: 'Rent January',
            is_active: true,
          }),
        ),
      { timeout: 2000 },
    );
  });

  it('disables the rule menu item when no categories exist', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({
        count: 1,
        categories: [],
        transactions: [makeTransaction()],
      }),
    );
    renderTransactions();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Change category for transaction 1',
      }),
    );
    expect(
      screen.getByRole('button', {
        name: 'Create categorization rule for transaction 1',
      }),
    ).toBeDisabled();
  });

  it('assigns a category from the badge dropdown menu', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({
        count: 1,
        transactions: [makeTransaction({ effective_category: null })],
      }),
    );
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Category "Housing" assigned.',
    });
    renderTransactions();
    // Uncategorized rows show a "Set category" placeholder toggle.
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Change category for transaction 1',
      }),
    );
    const menu = document.querySelector('.dropdown-menu.show');
    expect(menu).not.toBeNull();
    fireEvent.click(
      within(menu as HTMLElement).getByRole('button', {
        name: 'Housing',
      }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/transactions/1/category/',
        { category: 3 },
      ),
    );
    expect(
      await screen.findByText('Category "Housing" assigned.'),
    ).toBeInTheDocument();
  });

  it('marks manual overrides and offers revert in the menu', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({
        count: 1,
        transactions: [makeTransaction({ category_is_manual: true })],
      }),
    );
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Reverted to automatic categorization.',
    });
    renderTransactions();
    const toggle = await screen.findByRole('button', {
      name: 'Change category for transaction 1',
    });
    expect(toggle.querySelector('.bi-pencil-fill')).not.toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(
      screen.getByRole('button', { name: /Revert to automatic/ }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/transactions/1/category/clear/',
      ),
    );
  });

  it('filters to manual overrides via the source menu item', async () => {
    mockedApiGet.mockResolvedValue(
      makeTransactions({
        selected_source: 'manual',
        filters_active: true,
      }),
    );
    renderTransactions();
    await screen.findByRole('button', { name: 'Category' });
    const menu = openHeaderMenu('Category');
    fireEvent.click(menu.getByRole('button', { name: 'Manual only' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/transactions/?source=manual',
      ),
    );
    // The audit view renders a removable filter chip.
    expect(
      await screen.findByRole('button', {
        name: 'Remove filter: Source: manual',
      }),
    ).toBeInTheDocument();
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

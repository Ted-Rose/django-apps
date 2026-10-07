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
import CategoryOverview from './CategoryOverview';
import { apiGet, apiPost } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import { clearToasts } from '../../shared/toasts';
import type { CategoryOut, CategoryOverviewOut, TransactionsOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

// ResponsiveContainer renders 0-size under jsdom — stub the donut
// so the suite exercises the page, not recharts internals.
vi.mock('../components/CategoryChart', () => ({
  default: () => <div data-testid="category-chart" />,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

// Deliberately different names from the breakdown rows so queries
// can tell the management card and the spending table apart.
const CATEGORIES: CategoryOut[] = [
  { id: 3, name: 'Dining', color: '#00aa00', is_excluded: false },
  { id: 4, name: 'Housing', color: '#0000ff', is_excluded: false },
];

function makeOverview(
  overrides: Partial<CategoryOverviewOut> = {},
): CategoryOverviewOut {
  return {
    rows: [
      {
        category_id: 1,
        category_name: 'Groceries',
        is_excluded: false,
        category_color: '#00aa00',
        spent: '120.50',
        received: '0.00',
        net: '-120.50',
        share: 75.5,
        currency: 'EUR',
        tx_count: 12,
      },
      {
        category_id: 2,
        category_name: 'Salary',
        is_excluded: false,
        category_color: '#0000ff',
        spent: '0.00',
        received: '2000.00',
        net: '2000.00',
        share: 0,
        currency: 'EUR',
        tx_count: 1,
      },
      {
        category_id: null,
        category_name: 'Uncategorized',
        is_excluded: false,
        category_key: 'uncategorized',
        category_color: '#6c757d',
        spent: '39.00',
        received: '0.00',
        net: '-39.00',
        share: 24.5,
        currency: 'USD',
        tx_count: 2,
      },
    ],
    totals: {
      EUR: { spent: '120.50', received: '2000.00' },
      USD: { spent: '39.00', received: '0.00' },
    },
    periods: [
      {
        label: 'This month',
        key: 'thisMonth',
        date_from: '2025-01-01',
        date_to: '2025-01-15',
        active: true,
      },
      {
        label: 'All time',
        key: 'allTime',
        date_from: '',
        date_to: '',
        active: false,
      },
    ],
    date_from: '2025-01-09',
    date_to: '2025-01-15',
    accounts: [{ id: 5, label: 'Everyday account' }],
    selected_account: '',
    categories: CATEGORIES,
    view_owner: null,
    shared_with_me: [],
    my_shares: [],
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
        status: 'booked',
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
          id: 1,
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
    accounts: [{ id: 5, label: 'Everyday account' }],
    categories: CATEGORIES,
    counterparties: ['Cafe'],
    selected_account: null,
    selected_category: '1',
    selected_creditor: '',
    selected_source: '',
    search_query: '',
    sort: 'date',
    direction: 'desc',
    filters_active: true,
    ...overrides,
  };
}

function renderOverview(initialEntry = '/categories') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <CategoryOverview />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
});

describe('CategoryOverview', () => {
  it('fetches the overview and renders rows plus per-currency totals', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/finance/categories/overview/',
    );

    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('Salary')).toBeInTheDocument();
    // Spent and received render as separate columns per category —
    // a mixed-direction row shows both sides instead of a net sum.
    const groceriesRow = screen.getByText('Groceries').closest('tr')!;
    expect(within(groceriesRow).getByText('-120.50 EUR')).toHaveClass(
      'text-danger',
    );
    const salaryRow = screen.getByText('Salary').closest('tr')!;
    expect(within(salaryRow).getByText('+2000.00 EUR')).toHaveClass(
      'text-success',
    );
    // Zero-amount cells render a muted dash.
    expect(within(salaryRow).getByText('—')).toHaveClass('text-muted');
    const uncategorizedRow = screen.getByText('Uncategorized').closest('tr')!;
    expect(within(uncategorizedRow).getByText('-39.00 USD')).toHaveClass(
      'text-danger',
    );
    // Share column and the secondary tx-count subtext.
    expect(screen.getByText('75.5%')).toBeInTheDocument();
    expect(screen.getByText('12 transactions')).toBeInTheDocument();
    expect(screen.getByText('1 transaction')).toBeInTheDocument();
    // Totals footer keeps spent and received separate per currency.
    const eurTotal = screen.getByText('Total (EUR)').closest('tr');
    expect(eurTotal).not.toBeNull();
    expect(within(eurTotal!).getByText('-120.50 EUR')).toHaveClass(
      'text-danger',
    );
    expect(within(eurTotal!).getByText('+2000.00 EUR')).toHaveClass(
      'text-success',
    );
    const usdTotal = screen.getByText('Total (USD)').closest('tr');
    expect(usdTotal).not.toBeNull();
    expect(within(usdTotal!).getByText('-39.00 USD')).toHaveClass(
      'text-danger',
    );
    expect(within(usdTotal!).getByText('+0.00 USD')).toHaveClass(
      'text-success',
    );
    // The active preset is rendered as the pressed chip.
    const active = screen.getByRole('button', { name: 'This month' });
    expect(active).toHaveClass('fin-chip', 'active');
    expect(active).toHaveAttribute('aria-pressed', 'true');
    const inactive = screen.getByRole('button', { name: 'All time' });
    expect(inactive).toHaveClass('fin-chip');
    expect(inactive).toHaveAttribute('aria-pressed', 'false');
    // The recharts donut is stubbed (jsdom renders it 0-size) but
    // the chart card is still wired into the layout.
    expect(await screen.findByTestId('category-chart')).toBeInTheDocument();
  });

  it('writes from/to params when a preset is clicked', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'This month' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/categories/overview/?from=2025-01-01&to=2025-01-15',
      ),
    );
  });

  it('clears the date params via the All time preset', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview('/categories?from=2025-01-09&to=2025-01-15');
    fireEvent.click(await screen.findByRole('button', { name: 'All time' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/categories/overview/',
      ),
    );
  });

  it('applies the account filter via the form', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
    // The filter card is collapsed by default — expand it first.
    fireEvent.click(await screen.findByRole('button', { name: /Filters/ }));
    // The account options render once the overview has loaded.
    await screen.findByRole('option', { name: 'Everyday account' });
    fireEvent.change(screen.getByLabelText('Account'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/categories/overview/?account=5',
      ),
    );
  });

  it('keeps the account param when a preset is clicked', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview('/categories?account=5');
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/finance/categories/overview/?account=5',
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'This month' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/categories/overview/?from=2025-01-01&to=2025-01-15&account=5',
      ),
    );
  });

  it('applies the date range via the form', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: /Filters/ }));
    fireEvent.change(await screen.findByLabelText('From'), {
      target: { value: '2025-02-01' },
    });
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '2025-02-28' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/categories/overview/?from=2025-02-01&to=2025-02-28',
      ),
    );
  });

  it('drills into a category: the transaction table loads below with the same window', async () => {
    mockedApiGet.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/api/finance/transactions/')
          ? makeTransactions()
          : makeOverview(),
      ),
    );
    renderOverview('/categories?from=2025-01-09&to=2025-01-15');

    const row = (await screen.findByText('Groceries')).closest('tr')!;
    fireEvent.click(row);
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/finance/transactions/?category=1&from=2025-01-09&to=2025-01-15',
      ),
    );
    expect(
      await screen.findByText('Transactions — Groceries'),
    ).toBeInTheDocument();
    // The embedded table renders the fetched transaction rows.
    expect(await screen.findByText('Coffee')).toBeInTheDocument();
    // The selected row is highlighted.
    expect(row).toHaveClass('table-active');

    // Clicking the same row again collapses the drill-down.
    fireEvent.click(row);
    await waitFor(() =>
      expect(
        screen.queryByText('Transactions — Groceries'),
      ).not.toBeInTheDocument(),
    );
  });

  it('maps the uncategorized bucket to category=none', async () => {
    mockedApiGet.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/api/finance/transactions/')
          ? makeTransactions({ selected_category: 'none' })
          : makeOverview(),
      ),
    );
    renderOverview();

    fireEvent.click((await screen.findByText('Uncategorized')).closest('tr')!);
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/finance/transactions/?category=none',
      ),
    );
  });

  it('keeps the filter card collapsed with a summary of active filters', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview('/categories?from=2025-01-01&to=2025-01-15&account=5');
    const toggle = await screen.findByRole('button', { name: /Filters/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Account')).not.toBeInTheDocument();
    // Wait for the overview so the account label joins the summary.
    await screen.findByText('Groceries');
    expect(
      screen.getByText('2025-01-01 → 2025-01-15 · Everyday account'),
    ).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByLabelText('Account')).toBeInTheDocument();
  });

  it('shows the empty state when there are no rows', async () => {
    mockedApiGet.mockResolvedValue(makeOverview({ rows: [], totals: {} }));
    renderOverview();
    expect(
      await screen.findByText('No transactions in this period.'),
    ).toBeInTheDocument();
  });

  it('shows an error alert with a working retry', async () => {
    mockedApiGet.mockRejectedValueOnce(
      new ApiError('Request failed: 500', 500, 'Internal Server Error'),
    );
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
    expect(
      await screen.findByText(/Couldn't load category spending/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
  });

  it('renders the categories card and collapses it via the header', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();

    // The management card lists every category (jsdom has no
    // matchMedia, so the narrow-screen default-collapsed branch
    // doesn't kick in).
    const list = await screen.findByRole('list');
    expect(within(list).getByText('Dining')).toBeInTheDocument();
    expect(within(list).getByText('Housing')).toBeInTheDocument();

    const section = document.getElementById('categoriesCollapse')!;
    expect(section).toHaveClass('collapse', 'show');
    const toggle = screen.getByRole('button', { name: /Categories/ });
    fireEvent.click(toggle);
    expect(section).not.toHaveClass('show');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(section).toHaveClass('show');
  });

  it('creates a category and toasts the API message', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Category "Travel" saved.',
    });
    renderOverview();
    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Travel' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/categories/save/',
        {
          category_id: null,
          name: 'Travel',
          color: '#6c757d',
          is_excluded: false,
        },
      ),
    );
    expect(
      await screen.findByText('Category "Travel" saved.'),
    ).toBeInTheDocument();
  });

  it('saves the exclude-from-statistics flag and marks excluded rows', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Category "Travel" saved.',
    });
    renderOverview();
    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Travel' },
    });
    fireEvent.click(screen.getByLabelText('Exclude from statistics'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/categories/save/',
        {
          category_id: null,
          name: 'Travel',
          color: '#6c757d',
          is_excluded: true,
        },
      ),
    );
  });

  it('marks an excluded category in the list and refills the checkbox on edit', async () => {
    mockedApiGet.mockResolvedValue(
      makeOverview({
        categories: [
          {
            id: 9,
            name: 'Excluded',
            color: '#6c757d',
            is_excluded: true,
          },
        ],
      }),
    );
    mockedApiPost.mockResolvedValue({ success: true });
    renderOverview();
    const list = await screen.findByRole('list');
    const row = within(list).getByText('Excluded').closest('li')!;
    expect(row.querySelector('.bi-eye-slash')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Excluded' }));
    expect(screen.getByLabelText('Exclude from statistics')).toBeChecked();
    // Saving an edit sends the id so the API renames the row in
    // place instead of creating a second category.
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Hidden' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/categories/save/',
        {
          category_id: 9,
          name: 'Hidden',
          color: '#6c757d',
          is_excluded: true,
        },
      ),
    );
  });

  it('renders excluded rows in a muted section without a share bar', async () => {
    mockedApiGet.mockResolvedValue(
      makeOverview({
        rows: [
          {
            category_id: 1,
            category_name: 'Groceries',
            category_color: '#00aa00',
            is_excluded: false,
            spent: '120.50',
            received: '0.00',
            net: '-120.50',
            share: 100,
            currency: 'EUR',
            tx_count: 12,
          },
          {
            category_id: 9,
            category_name: 'Excluded',
            category_color: '#6c757d',
            is_excluded: true,
            spent: '200.00',
            received: '0.00',
            net: '-200.00',
            share: 0,
            currency: 'EUR',
            tx_count: 3,
          },
        ],
      }),
    );
    renderOverview();
    // A muted section header separates excluded rows; the row shows
    // a marker instead of a share bar but keeps its own sums.
    expect(
      await screen.findByText('Excluded categories — not counted in totals'),
    ).toBeInTheDocument();
    const row = screen.getByText('Excluded').closest('tr')!;
    expect(row).toHaveClass('text-muted');
    expect(
      within(row).getByText('Excluded from statistics'),
    ).toBeInTheDocument();
    expect(row.querySelector('.progress')).toBeNull();
    expect(within(row).getByText('-200.00 EUR')).toBeInTheDocument();
    expect(within(row).getByText('3 transactions')).toBeInTheDocument();
  });

  it('loads a category into the form for editing', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Dining' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Dining');
    expect(screen.getByLabelText('Color')).toHaveValue('#00aa00');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    // Cancel restores the plain "Add" form.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('renders no owner chips when nobody shared their overview', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
    await screen.findByText('Groceries');
    expect(
      screen.queryByRole('button', { name: 'My overview' }),
    ).not.toBeInTheDocument();
    // The share affordance is still there in the caller's own view.
    expect(
      screen.getByRole('button', { name: 'Share overview' }),
    ).toBeInTheDocument();
  });

  it('renders sharer chips and selects a shared view via ?owner=', async () => {
    mockedApiGet.mockResolvedValue(makeOverview({ shared_with_me: ['alice'] }));
    renderOverview();
    const mine = await screen.findByRole('button', {
      name: 'My overview',
    });
    expect(mine).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'alice' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/categories/overview/?owner=alice',
      ),
    );
    // The shared view reports the owner — chips keep rendering and
    // "My overview" navigates back.
    fireEvent.click(await screen.findByRole('button', { name: 'My overview' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/categories/overview/',
      ),
    );
  });

  it('shared view hides the categories card and share button, and the drill-down is read-only', async () => {
    mockedApiGet.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/api/finance/transactions/')
          ? makeTransactions()
          : makeOverview({
              view_owner: 'alice',
              shared_with_me: ['alice'],
            }),
      ),
    );
    renderOverview('/categories?owner=alice');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/finance/categories/overview/?owner=alice',
    );
    expect(await screen.findByText('Shared by alice')).toBeInTheDocument();
    // Category management and the share affordance are owner-only.
    expect(
      screen.queryByRole('button', { name: 'Share overview' }),
    ).not.toBeInTheDocument();
    expect(document.getElementById('categoriesCollapse')).toBeNull();

    // The drill-down forwards the owner and renders a plain badge —
    // no category dropdown/menu on shared rows.
    fireEvent.click((await screen.findByText('Groceries')).closest('tr')!);
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/finance/transactions/?category=1&owner=alice',
      ),
    );
    expect(
      await screen.findByText('Transactions — Groceries'),
    ).toBeInTheDocument();
    expect(document.querySelector('.tx-cat-toggle')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Create rule/ }),
    ).not.toBeInTheDocument();
  });

  it('posts a share limited to the checked accounts', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Category overview shared with bob.',
    });
    renderOverview();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Share overview' }),
    );
    fireEvent.change(screen.getByPlaceholderText('Username'), {
      target: { value: 'bob' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Everyday account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/categories/overview/share/',
        { username: 'bob', accounts: [5] },
      ),
    );
    expect(
      await screen.findByText('Category overview shared with bob.'),
    ).toBeInTheDocument();
  });

  it('lists outgoing shares and revokes them', async () => {
    mockedApiGet.mockResolvedValue(
      makeOverview({
        my_shares: [{ username: 'bob', accounts: ['Everyday account'] }],
      }),
    );
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Category overview share removed.',
    });
    renderOverview();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Share overview' }),
    );
    expect(
      await screen.findByText(/bob \(Everyday account\)/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Stop sharing with bob' }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/categories/overview/unshare/',
        { username: 'bob' },
      ),
    );
  });

  it('deletes a category after confirming in the modal', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Category deleted; 2 transaction(s) recategorized.',
      changed: 2,
    });
    renderOverview();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete Dining' }),
    );
    // The confirm modal gates the POST.
    expect(mockedApiPost).not.toHaveBeenCalled();
    expect(await screen.findByText(/Delete "Dining"\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/categories/3/delete/',
      ),
    );
    expect(
      await screen.findByText(
        'Category deleted; 2 transaction(s) recategorized.',
      ),
    ).toBeInTheDocument();
  });

  it('posts nothing when the delete confirm is cancelled', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete Dining' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(mockedApiPost).not.toHaveBeenCalled();
  });
});

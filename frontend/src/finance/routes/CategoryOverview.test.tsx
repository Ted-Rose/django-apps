import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CategoryOverview from './CategoryOverview';
import { apiGet } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import type { CategoryOverviewOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);

function makeOverview(
  overrides: Partial<CategoryOverviewOut> = {},
): CategoryOverviewOut {
  return {
    rows: [
      {
        category_name: 'Groceries',
        category_color: '#00aa00',
        spent: '120.50',
        received: '0.00',
        net: '-120.50',
        share: 75.5,
        currency: 'EUR',
        tx_count: 12,
      },
      {
        category_name: 'Salary',
        category_color: '#0000ff',
        spent: '0.00',
        received: '2000.00',
        net: '2000.00',
        share: 0,
        currency: 'EUR',
        tx_count: 1,
      },
      {
        category_name: 'Uncategorized',
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
        label: 'Last 7 days',
        date_from: '2025-01-09',
        date_to: '2025-01-15',
        active: true,
      },
      { label: 'All time', date_from: '', date_to: '', active: false },
    ],
    date_from: '2025-01-09',
    date_to: '2025-01-15',
    accounts: [{ id: 5, label: 'Everyday account' }],
    selected_account: '',
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
});

describe('CategoryOverview', () => {
  it('fetches the overview and renders rows plus per-currency totals', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/finance/categories/overview/',
    );

    expect(
      await screen.findByRole('cell', { name: 'Groceries' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Salary' })).toBeInTheDocument();
    // Money strings render as-is with their currency.
    expect(
      screen.getAllByRole('cell', { name: '120.50 EUR' }),
    ).not.toHaveLength(0);
    expect(screen.getAllByRole('cell', { name: '39.00 USD' })).not.toHaveLength(
      0,
    );
    // Negative net is danger-styled, positive net success-styled.
    expect(screen.getByRole('cell', { name: '-120.50 EUR' })).toHaveClass(
      'text-danger',
    );
    // '2000.00 EUR' appears in the Salary row and the EUR total.
    for (const cell of screen.getAllByRole('cell', {
      name: '2000.00 EUR',
    })) {
      expect(cell).toHaveClass('text-success');
    }
    expect(screen.getByRole('cell', { name: '-39.00 USD' })).toHaveClass(
      'text-danger',
    );
    // Share column and tx counts.
    expect(screen.getByText('75.5%')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '12' })).toBeInTheDocument();
    // Totals footer keyed by currency.
    expect(screen.getByText('Total (EUR)')).toBeInTheDocument();
    expect(screen.getByText('Total (USD)')).toBeInTheDocument();
    // The active preset is rendered as the primary button.
    const active = screen.getByRole('button', { name: 'Last 7 days' });
    expect(active).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: 'All time' })).toHaveClass(
      'btn-outline-secondary',
    );
  });

  it('writes from/to params when a preset is clicked', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Last 7 days' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/categories/overview/?from=2025-01-09&to=2025-01-15',
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
    fireEvent.click(await screen.findByRole('button', { name: 'Last 7 days' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/finance/categories/overview/?from=2025-01-09&to=2025-01-15&account=5',
      ),
    );
  });

  it('applies the date range via the form', async () => {
    mockedApiGet.mockResolvedValue(makeOverview());
    renderOverview();
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
    expect(
      await screen.findByRole('cell', { name: 'Groceries' }),
    ).toBeInTheDocument();
  });
});

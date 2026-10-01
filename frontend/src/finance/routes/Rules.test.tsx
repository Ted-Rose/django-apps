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
import Rules from './Rules';
import { apiGet, apiPost } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import { clearToasts } from '../../shared/toasts';
import type { CategoryOut, RuleOut, RulePreviewOut, RulesOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

const CATEGORIES: CategoryOut[] = [
  { id: 3, name: 'Groceries', color: '#00aa00' },
  { id: 4, name: 'Housing', color: '#0000ff' },
];

const MATCH_TYPES = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: 'Equals' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
];

const SCOPES = [
  { value: 'any', label: 'Debtor or creditor' },
  { value: 'debtor', label: 'Debtor (sender)' },
  { value: 'creditor', label: 'Creditor (receiver)' },
];

const OPERATORS = [
  { value: 'AND', label: 'AND' },
  { value: 'OR', label: 'OR' },
];

function makeRule(overrides: Partial<RuleOut> = {}): RuleOut {
  return {
    id: 7,
    category_id: 3,
    priority: 1,
    counterparty_scope: 'any',
    counterparty_pattern: 'rimi',
    counterparty_match_type: 'contains',
    description_pattern: 'grocery',
    description_match_type: 'contains',
    description_exclusion: 'refund',
    operator: 'AND',
    is_active: true,
    ...overrides,
  };
}

function makeRules(overrides: Partial<RulesOut> = {}): RulesOut {
  return {
    rules: [makeRule()],
    categories: CATEGORIES,
    match_types: MATCH_TYPES,
    counterparty_scopes: SCOPES,
    operators: OPERATORS,
    ...overrides,
  };
}

function makePreview(overrides: Partial<RulePreviewOut> = {}): RulePreviewOut {
  return {
    success: true,
    match_count: 3,
    apply_count: 2,
    is_active: true,
    category: 'Groceries',
    changes_total: 1,
    gains: 1,
    losses: 0,
    other_changes: 0,
    changes: [
      {
        id: 11,
        booking_date: '2025-01-10',
        account: 'Everyday account',
        counterparty: 'Rimi',
        description: 'card payment',
        amount: '-25.40',
        currency: 'EUR',
        old_category: null,
        new_category: 'Groceries',
      },
    ],
    ...overrides,
  };
}

function renderRules() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/rules']}>
      <QueryClientProvider client={queryClient}>
        <Rules />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
});

describe('Rules', () => {
  it('fetches /api/finance/rules/ and renders the table plus categories card', async () => {
    mockedApiGet.mockResolvedValue(
      makeRules({
        rules: [
          makeRule(),
          makeRule({
            id: 8,
            category_id: 4,
            priority: 2,
            counterparty_pattern: '',
            description_pattern: 'rent',
            description_exclusion: '',
            is_active: false,
          }),
        ],
      }),
    );
    renderRules();
    expect(mockedApiGet).toHaveBeenCalledWith('/api/finance/rules/');

    // Categories card lists both categories.
    expect(
      await screen.findAllByRole('cell', { name: 'Groceries' }),
    ).not.toHaveLength(0);
    const categoriesList = screen.getByRole('list');
    expect(within(categoriesList).getByText('Housing')).toBeInTheDocument();

    // Condition summary mirrors the template: lowercased scope and
    // match-type labels, operator badge, "except" exclusion.
    expect(
      screen.getByText(/debtor or creditor contains "rimi"/),
    ).toBeInTheDocument();
    expect(screen.getByText('AND')).toBeInTheDocument();
    expect(
      screen.getByText(/description contains "grocery"/),
    ).toBeInTheDocument();
    expect(screen.getByText('except')).toBeInTheDocument();
    expect(
      screen.getByText(/description contains "refund"/),
    ).toBeInTheDocument();
    expect(screen.getByText(/description contains "rent"/)).toBeInTheDocument();

    // First row can't move up, last can't move down.
    expect(
      screen.getByRole('button', { name: 'Move rule 1 up' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move rule 2 down' }),
    ).toBeDisabled();
  });

  it('collapses and expands the categories and rules cards', async () => {
    mockedApiGet.mockResolvedValue(makeRules());
    renderRules();
    await screen.findByText(/debtor or creditor contains "rimi"/);

    // Both sections render expanded (jsdom has no matchMedia, so the
    // narrow-screen default-collapsed branch doesn't kick in).
    for (const id of ['categoriesCollapse', 'rulesCollapse']) {
      const section = document.getElementById(id)!;
      expect(section).toHaveClass('collapse', 'show');
    }

    const categoriesToggle = screen.getByRole('button', {
      name: /Categories/,
    });
    fireEvent.click(categoriesToggle);
    expect(document.getElementById('categoriesCollapse')!).toHaveClass(
      'collapse',
    );
    expect(
      document.getElementById('categoriesCollapse')!,
    ).not.toHaveClass('show');
    expect(categoriesToggle).toHaveAttribute('aria-expanded', 'false');

    // Collapsing categories keeps the rules section (and its header
    // actions) usable.
    fireEvent.click(screen.getByRole('button', { name: /Rules/ }));
    expect(document.getElementById('rulesCollapse')!).not.toHaveClass('show');

    fireEvent.click(categoriesToggle);
    expect(document.getElementById('categoriesCollapse')!).toHaveClass('show');
  });

  it('shows the empty state when there are no rules', async () => {
    mockedApiGet.mockResolvedValue(makeRules({ rules: [] }));
    renderRules();
    expect(await screen.findByText(/No rules yet/)).toBeInTheDocument();
  });

  it('creates a category and toasts the API message', async () => {
    mockedApiGet.mockResolvedValue(makeRules());
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Category "Travel" saved.',
    });
    renderRules();
    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Travel' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/categories/save/',
        { name: 'Travel', color: '#6c757d' },
      ),
    );
    expect(
      await screen.findByText('Category "Travel" saved.'),
    ).toBeInTheDocument();
  });

  it('loads a category into the form for editing', async () => {
    mockedApiGet.mockResolvedValue(makeRules());
    renderRules();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Groceries' }),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Groceries');
    expect(screen.getByLabelText('Color')).toHaveValue('#00aa00');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    // Cancel restores the plain "Add" form.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('deletes a category and toasts the recategorized count', async () => {
    mockedApiGet.mockResolvedValue(makeRules());
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Category deleted; 2 transaction(s) recategorized.',
      changed: 2,
    });
    renderRules();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete Groceries' }),
    );
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

  it('moves a rule via POST rules/{id}/move/ {direction}', async () => {
    mockedApiGet.mockResolvedValue(
      makeRules({ rules: [makeRule(), makeRule({ id: 8, priority: 2 })] }),
    );
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Rule moved; 0 transaction(s) recategorized.',
      changed: 0,
    });
    renderRules();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Move rule 1 down' }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/finance/rules/7/move/', {
        direction: 'down',
      }),
    );
  });

  it('deletes a rule via POST rules/{id}/delete/', async () => {
    mockedApiGet.mockResolvedValue(makeRules());
    mockedApiPost.mockResolvedValue({
      success: true,
      message: 'Rule deleted; 5 transaction(s) recategorized.',
      changed: 5,
    });
    renderRules();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete rule 1' }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/rules/7/delete/',
      ),
    );
    expect(
      await screen.findByText('Rule deleted; 5 transaction(s) recategorized.'),
    ).toBeInTheDocument();
  });

  it('re-applies rules and toasts the changed count', async () => {
    mockedApiGet.mockResolvedValue(makeRules());
    mockedApiPost.mockResolvedValue({
      success: true,
      message: '4 transaction(s) recategorized.',
      changed: 4,
    });
    renderRules();
    fireEvent.click(
      await screen.findByRole('button', { name: /Re-apply rules/ }),
    );
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/finance/rules/apply/'),
    );
    expect(
      await screen.findByText('4 transaction(s) recategorized.'),
    ).toBeInTheDocument();
  });

  it('opens the drawer on edit and debounces a preview call', async () => {
    mockedApiGet.mockResolvedValue(makeRules());
    mockedApiPost.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('preview')
          ? makePreview()
          : { success: true, message: 'ok' },
      ),
    );
    renderRules();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rule 1' }));
    expect(
      await screen.findByRole('heading', { name: 'Edit rule #1' }),
    ).toBeInTheDocument();
    // The form is populated from the rule.
    expect(screen.getByLabelText('Counterparty name')).toHaveValue('rimi');
    expect(screen.getByLabelText('Description')).toHaveValue('grocery');
    expect(
      screen.getByLabelText('Exclude when description contains'),
    ).toHaveValue('refund');
    expect(screen.getByLabelText('Active')).toBeChecked();

    // Debounced sandbox preview posts the rule fields.
    await waitFor(
      () =>
        expect(mockedApiPost).toHaveBeenCalledWith(
          '/api/finance/rules/preview/',
          expect.objectContaining({
            rule_id: 7,
            category_id: 3,
            counterparty_pattern: 'rimi',
            description_pattern: 'grocery',
            description_exclusion: 'refund',
            operator: 'AND',
            is_active: true,
          }),
        ),
      { timeout: 2000 },
    );

    // The summary and the capped diff list render from the preview.
    expect(
      await screen.findByText(
        /3 transaction\(s\) match, rule would apply to 2/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/would change category/)).toBeInTheDocument();
    expect(screen.getByText('— → Groceries')).toBeInTheDocument();
    expect(screen.getByText('-25.40 EUR')).toBeInTheDocument();
  });

  it('posts the form to rules/save and closes the drawer', async () => {
    mockedApiGet.mockResolvedValue(makeRules());
    mockedApiPost.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('preview')
          ? makePreview()
          : {
              success: true,
              message: 'Rule saved; 6 transaction(s) recategorized.',
              changed: 6,
            },
      ),
    );
    renderRules();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rule 1' }));
    const description = await screen.findByLabelText('Description');
    fireEvent.change(description, { target: { value: 'supermarket' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/api/finance/rules/save/',
        expect.objectContaining({
          rule_id: 7,
          category: 3,
          priority: 1,
          description_pattern: 'supermarket',
          is_active: true,
        }),
      ),
    );
    expect(
      await screen.findByText('Rule saved; 6 transaction(s) recategorized.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId('rule-drawer')).not.toBeInTheDocument(),
    );
  });

  it('opens an empty drawer for a new rule with next priority', async () => {
    mockedApiGet.mockResolvedValue(
      makeRules({ rules: [makeRule(), makeRule({ id: 8, priority: 2 })] }),
    );
    mockedApiPost.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('preview')
          ? makePreview()
          : { success: true, message: 'ok' },
      ),
    );
    renderRules();
    fireEvent.click(await screen.findByRole('button', { name: /New rule/ }));
    expect(
      await screen.findByRole('heading', { name: 'New rule' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Priority')).toHaveValue(3);
    await waitFor(
      () =>
        expect(mockedApiPost).toHaveBeenCalledWith(
          '/api/finance/rules/preview/',
          expect.objectContaining({
            rule_id: null,
            category_id: 3,
            priority: 3,
            is_active: true,
          }),
        ),
      { timeout: 2000 },
    );
  });

  it('disables New rule when no categories exist', async () => {
    mockedApiGet.mockResolvedValue(makeRules({ categories: [] }));
    renderRules();
    expect(
      await screen.findByRole('button', { name: /New rule/ }),
    ).toBeDisabled();
    expect(
      screen.getByText(/No categories yet — create one/),
    ).toBeInTheDocument();
  });

  it('shows an error alert with a working retry', async () => {
    mockedApiGet.mockRejectedValueOnce(
      new ApiError('Request failed: 500', 500, 'Internal Server Error'),
    );
    mockedApiGet.mockResolvedValue(makeRules());
    renderRules();
    expect(await screen.findByText(/Couldn't load rules/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(
      await screen.findByText(/debtor or creditor contains "rimi"/),
    ).toBeInTheDocument();
  });
});

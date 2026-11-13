import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RuleDrawer from './RuleDrawer';
import type { RulesOut } from '../api';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.priority ? `${key} ${options.priority}` : key,
  }),
}));
vi.mock('../mutations', () => ({
  usePreviewRule: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveRule: () => ({ mutate: vi.fn(), isPending: false }),
}));

const rulesData: RulesOut = {
  rules: [],
  categories: [
    { id: 3, name: 'Groceries', color: '#00aa00', is_excluded: false },
    { id: 4, name: 'Housing', color: '#0000ff', is_excluded: false },
  ],
  match_types: [{ value: 'contains', label: 'Contains' }],
  counterparty_scopes: [{ value: 'any', label: 'Any' }],
  operators: [{ value: 'AND', label: 'AND' }],
} as RulesOut;

function renderDrawer() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <RuleDrawer
        rule={null}
        data={rulesData}
        maxPriority={0}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('RuleDrawer', () => {
  it('folds counterparty/exclusion/options by default', () => {
    renderDrawer();
    for (const name of [
      'rules.drawer.counterpartyName',
      'rules.drawer.excludeLabel',
      'rules.drawer.options',
    ]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
    expect(
      document.querySelector('#rule-counterparty-section.collapse.show'),
    ).toBeNull();
    // Unfolding reveals the fields.
    fireEvent.click(
      screen.getByRole('button', {
        name: 'rules.drawer.counterpartyName',
      }),
    );
    expect(
      document.querySelector('#rule-counterparty-section.collapse.show'),
    ).not.toBeNull();
  });

  it('shows the color dot and marks selection in the category menu', () => {
    renderDrawer();
    const toggle = screen.getByLabelText('rules.drawer.categoryLabel');
    const toggleDot = toggle.querySelector('.rule-cat-dot');
    expect(toggleDot).toHaveStyle({ backgroundColor: '#00aa00' });
    fireEvent.click(toggle);
    const menu = document.querySelector('.dropdown-menu.show');
    expect(menu).not.toBeNull();
    const items = within(menu as HTMLElement).getAllByRole('button');
    expect(items).toHaveLength(2);
    expect(items[1].querySelector('.rule-cat-dot')).toHaveStyle({
      backgroundColor: '#0000ff',
    });
    fireEvent.click(items[1]);
    const retoggled = screen.getByLabelText('rules.drawer.categoryLabel');
    expect(retoggled.querySelector('.rule-cat-dot')).toHaveStyle({
      backgroundColor: '#0000ff',
    });
    expect(retoggled).toHaveTextContent('Housing');
  });
});

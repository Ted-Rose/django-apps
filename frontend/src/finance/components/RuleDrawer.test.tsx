import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RuleDrawer from './RuleDrawer';
import type { RuleOut, RulesOut } from '../api';

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
  } as RuleOut;
}

function renderDrawer({
  rule = null,
  data = rulesData,
  onClose = () => {},
}: {
  rule?: RuleOut | null;
  data?: RulesOut;
  onClose?: () => void;
} = {}) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <RuleDrawer rule={rule} data={data} maxPriority={0} onClose={onClose} />
    </QueryClientProvider>,
  );
}

/** The category toggle's accessible name is "label: value". */
function categoryToggle() {
  return screen.getByRole('button', {
    name: /categoryLabel/,
  });
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
      const toggle = screen.getByRole('button', { name });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      // aria-controls points at the folded section body.
      const body = document.getElementById(
        toggle.getAttribute('aria-controls') as string,
      );
      expect(body).toHaveClass('collapse');
      expect(body).not.toHaveClass('show');
    }
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

  it('auto-expands sections holding values when editing a rule', () => {
    renderDrawer({ rule: makeRule() });
    expect(
      document.querySelector('#rule-counterparty-section.collapse.show'),
    ).not.toBeNull();
    expect(
      document.querySelector('#rule-exclusion-section.collapse.show'),
    ).not.toBeNull();
    // All options are default — it stays folded.
    expect(
      document.querySelector('#rule-options-section.collapse.show'),
    ).toBeNull();
  });

  it('expands the options section for non-default values', () => {
    renderDrawer({ rule: makeRule({ is_active: false }) });
    expect(
      document.querySelector('#rule-options-section.collapse.show'),
    ).not.toBeNull();
  });

  it('previews filter values on the folded headers', () => {
    // Sections holding values auto-open; folding them by hand
    // previews the value on the header.
    renderDrawer({ rule: makeRule({ is_active: false }) });
    const counterpartyToggle = screen.getByRole('button', {
      name: /rules.drawer.counterpartyName/,
    });
    expect(counterpartyToggle).not.toHaveTextContent('rimi');
    fireEvent.click(counterpartyToggle);
    expect(counterpartyToggle).toHaveTextContent('rimi');
    // The Options summary shows non-default values translated.
    const optionsToggle = screen.getByRole('button', {
      name: /rules.drawer.options/,
    });
    fireEvent.click(optionsToggle);
    expect(optionsToggle).toHaveTextContent('rules.inactiveTitle');
    // Re-expanding hides the summary (the field itself is visible).
    fireEvent.click(optionsToggle);
    expect(optionsToggle).not.toHaveTextContent('rules.inactiveTitle');
  });

  it('disables Save when there are no categories', () => {
    renderDrawer({
      data: { ...rulesData, categories: [] },
    });
    expect(
      screen.getByRole('button', { name: 'rules.drawer.save' }),
    ).toBeDisabled();
  });

  it('shows the color dot and marks selection in the category menu', () => {
    renderDrawer();
    const toggle = categoryToggle();
    expect(toggle.querySelector('.rule-cat-dot')).toHaveStyle({
      backgroundColor: '#00aa00',
    });
    fireEvent.click(toggle);
    const menu = document.querySelector('.dropdown-menu.show');
    expect(menu).not.toBeNull();
    const items = within(menu as HTMLElement).getAllByRole('button');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    expect(items[1].querySelector('.rule-cat-dot')).toHaveStyle({
      backgroundColor: '#0000ff',
    });
    fireEvent.click(items[1]);
    const retoggled = categoryToggle();
    expect(retoggled.querySelector('.rule-cat-dot')).toHaveStyle({
      backgroundColor: '#0000ff',
    });
    expect(retoggled).toHaveTextContent('Housing');
  });

  it('Escape closes the category menu but keeps the drawer open', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    fireEvent.click(categoryToggle());
    expect(document.querySelector('.dropdown-menu.show')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.dropdown-menu.show')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // A second Escape reaches the drawer's own handler.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

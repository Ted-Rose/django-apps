import { describe, expect, it } from 'vitest';
import { chartValueLabel, resolveSlice } from './CategoryChart';
import type { CategoryRowOut } from '../api';

function makeRow(overrides: Partial<CategoryRowOut> = {}): CategoryRowOut {
  return {
    category_id: 1,
    category_name: 'Groceries',
    category_color: '#00aa00',
    is_excluded: false,
    spent: '120.50',
    received: '0.00',
    net: '-120.50',
    share: 75.5,
    currency: 'EUR',
    tx_count: 12,
    ...overrides,
  };
}

const SLICES: CategoryRowOut[] = [
  makeRow(),
  makeRow({
    category_id: null,
    category_name: 'Uncategorized',
    category_key: 'uncategorized',
    category_color: '#6c757d',
    spent: '39.00',
    net: '-39.00',
    share: 24.5,
    currency: 'USD',
    tx_count: 2,
  }),
];

describe('chartValueLabel', () => {
  it('rounds the share and appends the spent amount', () => {
    expect(chartValueLabel(makeRow())).toBe('76% · -120.50 EUR');
    const label = chartValueLabel(makeRow({ share: 24.4 }));
    expect(label).toBe('24% · -120.50 EUR');
  });

  it('omits the amount when the category spent nothing', () => {
    expect(chartValueLabel(makeRow({ spent: '0.00', share: 33.3 }))).toBe(
      '33%',
    );
  });
});

describe('resolveSlice', () => {
  it('resolves a payload carrying the original datum', () => {
    // The recharts Legend and Pie click payloads nest the row
    // under `.payload`.
    expect(
      resolveSlice(SLICES, { value: 'Groceries', payload: SLICES[0] }),
    ).toBe(SLICES[0]);
    expect(resolveSlice(SLICES, { value: 'x', payload: SLICES[1] })).toBe(
      SLICES[1],
    );
  });

  it('matches the datum on name AND id (null-safe)', () => {
    // A same-named datum with a different id must not resolve to
    // the wrong slice.
    const impostor = { ...SLICES[0], category_id: 999 };
    expect(resolveSlice(SLICES, { payload: impostor })).toBeUndefined();
  });

  it('falls back to a bare name string', () => {
    expect(resolveSlice(SLICES, 'Groceries')).toBe(SLICES[0]);
  });

  it('falls back to the payload value name', () => {
    expect(resolveSlice(SLICES, { value: 'Uncategorized' })).toBe(SLICES[1]);
  });

  it('returns undefined for unrelated entries', () => {
    expect(resolveSlice(SLICES, null)).toBeUndefined();
    expect(resolveSlice(SLICES, { value: 42 })).toBeUndefined();
    expect(resolveSlice(SLICES, 'Nope')).toBeUndefined();
  });
});

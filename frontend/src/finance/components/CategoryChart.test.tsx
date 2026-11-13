import { describe, expect, it } from 'vitest';
import { resolveSlice, rowKey, shareLabel, spentLabel } from './CategoryChart';
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

describe('shareLabel', () => {
  it('rounds the share to a whole-number percentage', () => {
    expect(shareLabel(makeRow())).toBe('76%');
    expect(shareLabel(makeRow({ share: 24.4 }))).toBe('24%');
  });
});

describe('spentLabel', () => {
  it('formats the absolute spent amount with currency', () => {
    expect(spentLabel(makeRow())).toBe('-120.50 EUR');
  });

  it('returns empty when the category spent nothing', () => {
    expect(spentLabel(makeRow({ spent: '0.00' }))).toBe('');
  });
});

describe('rowKey', () => {
  it('keys rows on category id + currency, bucket on its marker', () => {
    // The overview groups by (category, currency) — the same
    // category can appear once per currency.
    expect(rowKey(makeRow())).toBe('1:EUR');
    expect(rowKey(makeRow({ category_id: 7, currency: 'USD' }))).toBe('7:USD');
    // The uncategorized bucket keeps its own selectable key.
    expect(rowKey(SLICES[1])).toBe('uncategorized:USD');
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

  it('tells same-category slices in different currencies apart', () => {
    const eur = makeRow();
    const usd = makeRow({ currency: 'USD' });
    const slices = [eur, usd];
    expect(resolveSlice(slices, { payload: usd })).toBe(usd);
    expect(resolveSlice(slices, { payload: eur })).toBe(eur);
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

import { useState } from 'react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import type { CategoryRowOut } from '../api';

const FALLBACK_COLOR = '#6c757d';

/**
 * Whole-number share — the first line of both the slice tooltip
 * and the click-selection readout.
 */
export function shareLabel(row: CategoryRowOut): string {
  return `${Math.round(row.share)}%`;
}

/**
 * Absolute spent figure — the second line under the share. A
 * zero-spent row (share-0 slices never render, but the guard
 * keeps the helper total) produces an empty string.
 */
export function spentLabel(row: CategoryRowOut): string {
  return Number(row.spent) > 0 ? `-${row.spent} ${row.currency}` : '';
}

/**
 * Stable identity for a slice row — the overview groups by
 * (category, currency), so the key pairs the category id (the
 * 'uncategorized' bucket has none) with the currency. Selection
 * state stores this string, not the row object: react-query
 * replaces `rows` on every refetch and an object selection would
 * silently match nothing.
 */
export function rowKey(
  row: Pick<CategoryRowOut, 'category_id' | 'currency'>,
): string {
  return `${row.category_id ?? 'uncategorized'}:${row.currency}`;
}

/**
 * Resolve a recharts click payload back to its slice row. Legend
 * entries and Pie sectors carry the datum under `.payload`, but
 * the shape varies across recharts versions — match on
 * `category_name` + `category_id` (+ `currency` when the datum
 * carries it, since the same category can repeat per currency),
 * falling back to a bare name string (or the payload's `value`).
 */
export function resolveSlice(
  slices: CategoryRowOut[],
  entry: unknown,
): CategoryRowOut | undefined {
  const payload =
    entry && typeof entry === 'object' && 'payload' in entry
      ? (entry as { payload: unknown }).payload
      : null;
  if (payload && typeof payload === 'object') {
    const datum = payload as Partial<CategoryRowOut>;
    if (typeof datum.category_name === 'string') {
      return slices.find(
        (row) =>
          row.category_name === datum.category_name &&
          row.category_id === (datum.category_id ?? null) &&
          (datum.currency == null || row.currency === datum.currency),
      );
    }
  }
  let name: string | null = null;
  if (typeof entry === 'string') {
    name = entry;
  } else if (entry && typeof entry === 'object' && 'value' in entry) {
    const value = (entry as { value: unknown }).value;
    if (typeof value === 'string') name = value;
  }
  return name == null
    ? undefined
    : slices.find((row) => row.category_name === name);
}

/**
 * Spending-share donut for the category overview — one slice per
 * spending row (`share` > 0; income rows come back with share 0),
 * filled with the category's own color so slices match the badges
 * in the breakdown table. Hovering a slice shows its rounded
 * share plus the spent amount; clicking a slice or its legend
 * entry pins the same readout under the donut (re-click clears,
 * non-selected slices dim). The `.cat-chart` wrapper fixes the
 * height: ResponsiveContainer only measures its parent box (jsdom
 * renders it at 0×0 — the route's tests stub this component).
 */
export function CategoryChart({ rows }: { rows: CategoryRowOut[] }) {
  const { t } = useTranslation('finance');
  // The key, not the row — a refetch swaps the rows array and a
  // stored object would match nothing, dimming every slice.
  const [selected, setSelected] = useState<string | null>(null);
  const slices = rows.filter((row) => row.share > 0);
  if (slices.length === 0) return null;

  // A slice click and a legend click funnel through the same
  // resolver; picking the active row again clears the readout.
  const toggle = (entry: unknown) => {
    const row = resolveSlice(slices, entry);
    if (row) {
      const key = rowKey(row);
      setSelected((prev) => (prev === key ? null : key));
    }
  };

  // Re-resolve the live row each render — if a refetch dropped
  // the selected category from the window, nothing dims and the
  // readout hides instead of showing stale figures.
  const selectedRow = selected
    ? slices.find((row) => rowKey(row) === selected)
    : undefined;
  const selectedName = selectedRow
    ? selectedRow.category_key === 'uncategorized'
      ? t('transactions.uncategorized')
      : selectedRow.category_name
    : '';

  return (
    <>
      <div
        className="cat-chart"
        role="img"
        aria-label={t('categories.chartAria')}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="share"
              nameKey="category_name"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
              strokeWidth={0}
              onClick={toggle}
            >
              {slices.map((row, index) => (
                <Cell
                  key={`${row.category_name}-${index}`}
                  fill={
                    /^#[0-9a-f]{6}$/i.test(row.category_color)
                      ? row.category_color
                      : FALLBACK_COLOR
                  }
                  // Once a slice is picked the rest dim instead of
                  // resizing — keeps recharts from re-layouting.
                  fillOpacity={
                    selectedRow && rowKey(row) !== selected ? 0.4 : 1
                  }
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, _name, item) => {
                const row = resolveSlice(slices, item);
                if (!row) return `${Math.round(Number(value))}%`;
                const spent = spentLabel(row);
                // Percentage on the first line, the absolute
                // amount beneath it — same layout as the
                // selection readout.
                return (
                  <>
                    <div>{shareLabel(row)}</div>
                    {spent && <div>{spent}</div>}
                  </>
                );
              }}
            />
            <Legend iconType="circle" iconSize={8} onClick={toggle} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {selectedRow && (
        <p className="text-muted small text-center mt-2 mb-0">
          {selectedName} — {shareLabel(selectedRow)}
          {spentLabel(selectedRow) && (
            <>
              <br />
              {spentLabel(selectedRow)}
            </>
          )}
        </p>
      )}
    </>
  );
}

export default CategoryChart;

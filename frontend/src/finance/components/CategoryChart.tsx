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
import type { PieSectorDataItem } from 'recharts';
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
  // Selection also carries the clicked slice's mid-point so the
  // pop-up can anchor itself — recharts keeps tooltip state
  // internal and only refreshes it on mouse events, so a second
  // click on another slice would leave the first pop-up stuck.
  // Legend clicks carry no sector geometry → key only.
  const [selected, setSelected] = useState<{
    key: string;
    x?: number;
    y?: number;
  } | null>(null);
  const slices = rows.filter((row) => row.share > 0);
  if (slices.length === 0) return null;

  // A slice click and a legend click funnel through the same
  // resolver; picking the active row again clears the readout.
  const toggle = (entry: unknown) => {
    const row = resolveSlice(slices, entry);
    if (!row) return;
    const key = rowKey(row);
    setSelected((prev) => {
      if (prev?.key === key) return null;
      const sector = entry as PieSectorDataItem;
      if (
        typeof sector.midAngle === 'number' &&
        typeof sector.innerRadius === 'number' &&
        typeof sector.outerRadius === 'number'
      ) {
        // Sector mid-point — recharts measures angles clockwise
        // from 12 o'clock, hence the negated midAngle.
        const r =
          sector.innerRadius + (sector.outerRadius - sector.innerRadius) / 2;
        const rad = (-sector.midAngle * Math.PI) / 180;
        return {
          key,
          x: sector.cx + r * Math.cos(rad),
          y: sector.cy + r * Math.sin(rad),
        };
      }
      return { key };
    });
  };

  // Re-resolve the live row each render — if a refetch dropped
  // the selected category from the window, nothing dims and the
  // readout hides instead of showing stale figures.
  const selectedRow = selected
    ? slices.find((row) => rowKey(row) === selected.key)
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
                    selectedRow && rowKey(row) !== selected?.key ? 0.4 : 1
                  }
                />
              ))}
            </Pie>
            {/* Hover tooltips only — once a slice is selected the
                anchored pop-up takes over (recharts can't retarget
                its tooltip on click alone). */}
            <Tooltip
              active={selectedRow ? false : undefined}
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
        {/* Click pop-up anchored at the slice's mid-point — driven
            by selection state, so every slice click updates it. */}
        {selectedRow && selected?.x !== undefined && (
          <div
            className="cat-chart-pop"
            style={{ left: selected.x, top: selected.y }}
          >
            <div>{selectedName}</div>
            <div>{shareLabel(selectedRow)}</div>
            {spentLabel(selectedRow) && <div>{spentLabel(selectedRow)}</div>}
          </div>
        )}
      </div>
      {selectedRow && (
        <p className="text-muted small text-center mt-2 mb-0">
          {selectedName}
          <br />
          {shareLabel(selectedRow)}
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

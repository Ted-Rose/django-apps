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
 * Spending-share donut for the category overview — one slice per
 * spending row (`share` > 0; income rows come back with share 0),
 * filled with the category's own color so slices match the badges
 * in the breakdown table. The `.cat-chart` wrapper fixes the
 * height: ResponsiveContainer only measures its parent box (jsdom
 * renders it at 0×0 — the route's tests stub this component).
 */
export function CategoryChart({ rows }: { rows: CategoryRowOut[] }) {
  const { t } = useTranslation('finance');
  const slices = rows.filter((row) => row.share > 0);
  if (slices.length === 0) return null;
  return (
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
          >
            {slices.map((row, index) => (
              <Cell
                key={`${row.category_name}-${index}`}
                fill={
                  /^#[0-9a-f]{6}$/i.test(row.category_color)
                    ? row.category_color
                    : FALLBACK_COLOR
                }
              />
            ))}
          </Pie>
          <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
          <Legend iconType="circle" iconSize={8} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default CategoryChart;

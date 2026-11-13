import type { CategoryOut } from '../api';

const FALLBACK_COLOR = '#6c757d';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The category color is user input — fall back to muted grey on
 * anything that is not `#rrggbb` (the badge's tint is built by
 * appending a hex alpha channel to the value).
 */
export function categoryColor(
  category: Pick<CategoryOut, 'color'> | undefined,
): string {
  return category && HEX_COLOR.test(category.color)
    ? category.color
    : FALLBACK_COLOR;
}

/**
 * Category badge — a soft tinted pill: the category color at low
 * opacity as background + ring, with a solid color dot before the
 * name.
 */
export function CategoryBadge({ category }: { category: CategoryOut }) {
  const color = categoryColor(category);
  return (
    <span
      className="fin-cat-badge"
      style={{
        backgroundColor: `${color}14`,
        borderColor: `${color}59`,
      }}
    >
      <span
        className="d-inline-block rounded-circle"
        style={{
          width: '0.5rem',
          height: '0.5rem',
          backgroundColor: color,
        }}
        aria-hidden="true"
      />
      {category.name}
    </span>
  );
}

/**
 * The badge's solid color dot as a standalone marker — for
 * plain-text category lists (filter dropdowns, the rule drawer's
 * picker) where the whole pill would be too heavy. Slightly
 * larger than the badge's inner dot so it reads without the tint
 * around it.
 */
export function CategoryDot({
  category,
}: {
  category: Pick<CategoryOut, 'color'> | undefined;
}) {
  return (
    <span
      className="fin-cat-dot"
      style={{ backgroundColor: categoryColor(category) }}
      aria-hidden="true"
    />
  );
}

export default CategoryBadge;

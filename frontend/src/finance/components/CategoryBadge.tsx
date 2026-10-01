import type { CategoryOut } from '../api';

const FALLBACK_COLOR = '#6c757d';

/**
 * Category badge — a soft tinted pill: the category color at low
 * opacity as background + ring, with a solid color dot before the
 * name. Non-hex colors fall back to muted grey (the tint is built
 * by appending a hex alpha channel to a `#rrggbb` value).
 */
export function CategoryBadge({ category }: { category: CategoryOut }) {
  const color = /^#[0-9a-f]{6}$/i.test(category.color)
    ? category.color
    : FALLBACK_COLOR;
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

export default CategoryBadge;

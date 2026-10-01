import type { CategoryOut } from '../api';

/**
 * Category badge for the transactions table — the category name
 * next to a color dot. The template colored the badge background
 * directly; a dot + bordered badge keeps the name legible for any
 * user-picked color. Falls back to the template's muted grey when
 * the category has no color.
 */
export function CategoryBadge({ category }: { category: CategoryOut }) {
  return (
    <span className="badge border text-dark fw-normal">
      <span
        className="d-inline-block rounded-circle me-1"
        style={{
          width: '0.55rem',
          height: '0.55rem',
          backgroundColor: category.color || '#6c757d',
        }}
        aria-hidden="true"
      />
      {category.name}
    </span>
  );
}

export default CategoryBadge;

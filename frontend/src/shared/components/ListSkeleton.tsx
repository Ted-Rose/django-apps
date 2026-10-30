import { useTranslation } from 'react-i18next';

/**
 * Shimmer loading placeholder — `rows` blocks of `.ui-skeleton`
 * (shared/ui.css) replacing the stock `placeholder-glow` bars. The
 * container is a `role="status"` live region so the label is
 * announced; callers wrap it in their own list container when they
 * need the `#task-list`/`#note-list` hooks.
 */
interface ListSkeletonProps {
  /** Number of shimmer rows. */
  rows?: number;
  /** CSS height of each row. */
  height?: string;
  /** Screen-reader label — defaults to `common:common.loading`. */
  label?: string;
}

export function ListSkeleton({
  rows = 3,
  height = '3.5rem',
  label,
}: ListSkeletonProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('common:common.loading');
  return (
    <div role="status" aria-busy="true">
      <span className="visually-hidden">{resolvedLabel}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="ui-skeleton mb-2"
          style={{ height }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export default ListSkeleton;

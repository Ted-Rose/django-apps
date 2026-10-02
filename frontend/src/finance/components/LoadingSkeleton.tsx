import { useTranslation } from 'react-i18next';

/**
 * Shimmer placeholder rows shown while a page query is pending —
 * replaces the bare centered `spinner-border`. `height`/`rows`
 * should roughly match the loaded layout to avoid a jump.
 */
export function LoadingSkeleton({
  rows = 4,
  height = '3.5rem',
  label,
}: {
  rows?: number;
  height?: string;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      aria-busy="true"
      aria-label={label ?? t('common:common.loading')}
      role="status"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="fin-skeleton mb-2"
          style={{ height }}
        />
      ))}
    </div>
  );
}

export default LoadingSkeleton;

/**
 * Shimmer placeholder rows shown while a page query is pending —
 * replaces the bare centered `spinner-border`. `height`/`rows`
 * should roughly match the loaded layout to avoid a jump.
 */
export function LoadingSkeleton({
  rows = 4,
  height = '3.5rem',
  label = 'Loading',
}: {
  rows?: number;
  height?: string;
  label?: string;
}) {
  return (
    <div aria-busy="true" aria-label={label} role="status">
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

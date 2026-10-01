import { ApiError } from '../../shared/api/errors';

/**
 * Full-width alert for a failed page-level query — the finance twin
 * of tasks' `ErrorState` (routes/TaskListPage.tsx), parameterized
 * by `label` so every route shares one implementation.
 */
export function ErrorState({
  error,
  onRetry,
  label = 'data',
}: {
  error: unknown;
  onRetry: () => void;
  label?: string;
}) {
  const message =
    error instanceof ApiError
      ? `${error.message}`
      : 'Could not reach the server. Check your connection.';
  return (
    <div className="alert alert-danger text-center py-5" role="alert">
      <i className="bi bi-exclamation-circle fs-1 d-block mb-3" />
      <h5>Couldn&apos;t load {label}</h5>
      <p className="mb-3">{message}</p>
      <button
        type="button"
        className="btn btn-outline-danger"
        onClick={onRetry}
      >
        <i className="bi bi-arrow-repeat" /> Retry
      </button>
    </div>
  );
}

export default ErrorState;

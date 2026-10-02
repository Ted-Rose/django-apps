import { useTranslation } from 'react-i18next';
import { errorDetail } from '../../shared/api/errors';

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
  const { t } = useTranslation();
  return (
    <div className="alert alert-danger text-center py-5" role="alert">
      <i className="bi bi-exclamation-circle fs-1 d-block mb-3" />
      <h5>{t('errors.loadFailed', { label })}</h5>
      <p className="mb-3">{errorDetail(error)}</p>
      <button
        type="button"
        className="btn btn-outline-danger"
        onClick={onRetry}
      >
        <i className="bi bi-arrow-repeat" /> {t('common.retry')}
      </button>
    </div>
  );
}

export default ErrorState;

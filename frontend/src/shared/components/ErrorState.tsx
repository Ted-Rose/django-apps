import { useTranslation } from 'react-i18next';

/**
 * Centered error state — reuses the `.ui-empty` layout with a
 * danger-tinted `bi-exclamation-circle`, the page's localized title
 * and detail text (both via props), and a retry button labeled
 * `common:common.retry`. `role="alert"` announces it like the old
 * `alert alert-danger` blocks did.
 */
interface ErrorStateProps {
  title: string;
  detail?: string;
  onRetry: () => void;
}

export function ErrorState({ title, detail, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div className="ui-empty" role="alert">
      <i className="bi bi-exclamation-circle text-danger" aria-hidden="true" />
      <h2 className="h5 mb-1">{title}</h2>
      {detail && <div className="small mb-3">{detail}</div>}
      <button
        type="button"
        className="btn btn-outline-danger"
        onClick={onRetry}
      >
        <i className="bi bi-arrow-repeat" /> {t('common:common.retry')}
      </button>
    </div>
  );
}

export default ErrorState;

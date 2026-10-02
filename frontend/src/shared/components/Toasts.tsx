import { useTranslation } from 'react-i18next';
import { dismissToast, useToasts, type ToastKind } from '../toasts';
import './Toasts.css';

const ICONS: Record<ToastKind, string> = {
  success: 'check-circle',
  danger: 'exclamation-circle',
  warning: 'exclamation-triangle',
  info: 'info-circle',
};

/**
 * Fixed bottom-left stack of mutation feedback alerts — the React
 * counterpart of floating_controls.html's `#action-toast` (the
 * `.action-toast` styles come from the sibling Toasts.css).
 */
export function Toasts() {
  const { t } = useTranslation();
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="action-toast show">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`alert alert-${toast.kind} py-2 mb-1 d-flex align-items-center`}
          role="alert"
        >
          <i className={`bi bi-${ICONS[toast.kind]} me-2`} />
          <span className="flex-grow-1">{toast.text}</span>
          <button
            type="button"
            className="btn-close ms-2"
            aria-label={t('toasts.dismiss')}
            onClick={() => dismissToast(toast.id)}
          />
        </div>
      ))}
    </div>
  );
}

export default Toasts;

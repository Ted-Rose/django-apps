import { useEffect, type ReactNode } from 'react';

/**
 * Bootstrap 5 modal markup driven by React state — the SPA shell
 * doesn't load bootstrap.bundle.js, so open/close and the backdrop
 * are handled here. `show` toggles visibility; ESC and backdrop
 * clicks call `onClose`.
 */
interface ModalProps {
  show: boolean;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /** Extra classes for `.modal-dialog`, e.g. 'modal-lg'. */
  dialogClassName?: string;
}

export function Modal({
  show,
  title,
  children,
  footer,
  onClose,
  dialogClassName = '',
}: ModalProps) {
  useEffect(() => {
    if (!show) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [show, onClose]);

  if (!show) return null;

  return (
    <>
      <div
        className="modal fade show"
        style={{ display: 'block' }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
      >
        <div className={`modal-dialog ${dialogClassName}`.trim()}>
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button
                type="button"
                className="btn-close"
                aria-label="Close"
                onClick={onClose}
              />
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" onClick={onClose} />
    </>
  );
}

export default Modal;

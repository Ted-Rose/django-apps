import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Bootstrap 5 modal markup driven by React state — the SPA shell
 * doesn't load bootstrap.bundle.js, so open/close and the backdrop
 * are handled here. `show` toggles visibility; ESC and backdrop
 * clicks call `onClose`. Focus moves into the modal on open and
 * returns to the previously focused element on close.
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
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [show, onClose]);

  // Move focus into the modal on open; return it to whatever was
  // focused before on close.
  useEffect(() => {
    if (!show) return;
    const previous = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    return () => previous?.focus?.();
  }, [show]);

  if (!show) return null;

  return (
    <>
      <div
        ref={modalRef}
        className="modal fade show"
        style={{ display: 'block' }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
      >
        <div className={`modal-dialog ${dialogClassName}`.trim()}>
          <div className="modal-content">
            <div className="modal-header">
              {title && (
                <h5 className="modal-title" id={titleId}>
                  {title}
                </h5>
              )}
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

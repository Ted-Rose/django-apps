import type { ReactNode } from 'react';
import Modal from '../../shared/components/Modal';

/**
 * Shared confirm dialog matching modals.html's complete/uncomplete
 * pattern (title + question + bold subject + Cancel/Confirm). Used
 * for the destructive/irreversible-ish actions the template gated
 * behind confirm() or a Bootstrap modal: complete, uncomplete,
 * delete task, delete divider.
 */
interface ConfirmModalProps {
  show: boolean;
  title: string;
  confirmLabel: string;
  confirmIcon?: string;
  /** Bootstrap button class for the confirm action. */
  confirmClassName?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}

export function ConfirmModal({
  show,
  title,
  confirmLabel,
  confirmIcon,
  confirmClassName = 'btn-primary',
  busy = false,
  onConfirm,
  onClose,
  children,
}: ConfirmModalProps) {
  return (
    <Modal
      show={show}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${confirmClassName}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <span className="spinner-border spinner-border-sm me-1" />
            ) : (
              confirmIcon && <i className={`bi bi-${confirmIcon}`} />
            )}{' '}
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export default ConfirmModal;

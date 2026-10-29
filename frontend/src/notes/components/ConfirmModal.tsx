import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../shared/components/Modal';

/**
 * Shared confirm dialog — same pattern as
 * src/tasks/components/ConfirmModal.tsx (title + question +
 * Cancel/Confirm) for the destructive-ish actions: delete note,
 * uncomplete, category rename/merge/delete.
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
  const { t } = useTranslation();
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
            {t('common:common.cancel')}
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

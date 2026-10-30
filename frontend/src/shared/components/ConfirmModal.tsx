import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';

/**
 * Shared confirm dialog — merged superset of the (now deleted)
 * per-app copies in src/tasks and src/notes: title + question +
 * Cancel/Confirm for destructive-ish actions (delete, uncomplete,
 * category rename/merge). `confirmDisabled` covers the notes
 * variant's extra gate (e.g. no target picked); Cancel comes from
 * `common:common.cancel` like the app versions.
 */
interface ConfirmModalProps {
  show: boolean;
  title: string;
  confirmLabel: string;
  confirmIcon?: string;
  /** Bootstrap button class for the confirm action. */
  confirmClassName?: string;
  /** Extra disable for the confirm button (e.g. no target picked). */
  confirmDisabled?: boolean;
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
  confirmDisabled = false,
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
            disabled={busy || confirmDisabled}
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

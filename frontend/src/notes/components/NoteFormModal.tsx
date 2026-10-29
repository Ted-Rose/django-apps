import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../shared/components/Modal';
import type { NoteCategoryOut } from '../api';
import { useCreateNote } from '../mutations';
import CategoryPicker from './CategoryPicker';

/**
 * Floating-"+" create modal: title + body + a category picker
 * preselected from the current list filter. Posts
 * `POST /api/notes/` — the server composes/appends the `#notes`
 * marker itself, so the form never sees one.
 */
interface NoteFormModalProps {
  show: boolean;
  categories: NoteCategoryOut[];
  /** Preselected category (the active ?category= filter), or null. */
  initialCategoryId?: number | null;
  onClose: () => void;
}

export function NoteFormModal({
  show,
  categories,
  initialCategoryId = null,
  onClose,
}: NoteFormModalProps) {
  const { t } = useTranslation('notes');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(
    initialCategoryId,
  );
  const [error, setError] = useState<string | null>(null);

  const createNote = useCreateNote();

  // Reset the form each time the modal opens (and re-apply the
  // preselected category — the filter may have changed).
  useEffect(() => {
    if (show) {
      setTitle('');
      setBody('');
      setCategoryId(initialCategoryId);
      setError(null);
    }
  }, [show, initialCategoryId]);

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError(t('form.titleRequired'));
      return;
    }
    createNote.mutate(
      {
        title: trimmed,
        body: body.trim() || null,
        category_id: categoryId,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Modal
      show={show}
      title={t('form.createTitle')}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={createNote.isPending}
          >
            {t('common:common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={createNote.isPending}
          >
            {createNote.isPending ? (
              <span className="spinner-border spinner-border-sm me-1" />
            ) : (
              <i className="bi bi-journal-plus" />
            )}{' '}
            {t('form.createSubmit')}
          </button>
        </>
      }
    >
      <div className="mb-3">
        <label htmlFor="note-title" className="form-label fw-bold">
          {t('form.titleLabel')}
        </label>
        <input
          type="text"
          className="form-control"
          id="note-title"
          maxLength={500}
          placeholder={t('form.titlePlaceholder')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="mb-3">
        <label htmlFor="note-body" className="form-label fw-bold">
          {t('form.bodyLabel')}
        </label>
        <textarea
          className="form-control"
          id="note-body"
          rows={4}
          placeholder={t('form.bodyPlaceholder')}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      <div className="mb-2">
        <span className="form-label fw-bold d-block">
          {t('form.categoryLabel')}
        </span>
        <CategoryPicker
          categories={categories}
          value={categoryId}
          onChange={(selection) =>
            setCategoryId(typeof selection === 'number' ? selection : null)
          }
        />
      </div>
      {error && (
        <div className="alert alert-danger py-1 mb-0" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}

export default NoteFormModal;

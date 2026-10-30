import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Dropdown from '../../shared/components/Dropdown';
import Modal from '../../shared/components/Modal';
import type { NoteCategoryOut, TaskOut } from '../api';
import { categoryPathLabel } from '../categories';
import { useDeleteNote, useUncompleteNote, useUpdateNote } from '../mutations';
import {
  formatFullDate,
  formatShortDate,
  stripNoteMarker,
  truncateWords,
} from '../utils';
import CategoryPicker, {
  NOT_A_NOTE,
  type CategorySelection,
} from './CategoryPicker';
import ConfirmModal from '../../shared/components/ConfirmModal';

/**
 * A note row — the tasks TaskCard counterpart with the task
 * affordances stripped: no complete checkbox, no star, no order
 * badge. The title link goes to the note editor with the marker
 * hidden (stripNoteMarker), the body shows a ~40-word preview, and
 * the ⋮ menu exposes Edit, Move to category and Delete (the shared
 * /api/tasks/task/{id}/delete/ endpoint — trash stays unified).
 * `completed` renders the line-through variant the Completed notes
 * section uses.
 */
interface NoteCardProps {
  note: TaskOut;
  categories: NoteCategoryOut[];
  /** Line-through completed-section rendering. */
  completed?: boolean;
}

export function NoteCard({
  note,
  categories,
  completed = false,
}: NoteCardProps) {
  const { t } = useTranslation('notes');
  const navigate = useNavigate();
  const [moving, setMoving] = useState(false);
  const [moveTarget, setMoveTarget] = useState<CategorySelection>(null);
  const [confirming, setConfirming] = useState<'delete' | 'uncomplete' | null>(
    null,
  );

  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const uncompleteNote = useUncompleteNote();

  const title = stripNoteMarker(note.title);
  const body = stripNoteMarker(note.notes);
  const dateLabel = completed
    ? formatShortDate(note.completed)
    : formatFullDate(note.updated);

  const openMove = () => {
    setMoveTarget(note.note_category?.id ?? null);
    setMoving(true);
  };

  const submitMove = () => {
    if (moveTarget === NOT_A_NOTE) return;
    updateNote.mutate(
      {
        taskId: note.task_id,
        payload: { category_id: moveTarget },
      },
      { onSuccess: () => setMoving(false) },
    );
  };

  return (
    <div className="task-container d-flex mb-2" data-task-id={note.task_id}>
      <div
        className={`card task-card flex-grow-1 task-content${
          completed ? ' border-0 bg-light' : ''
        }`}
      >
        <div className={`card-body${completed ? ' py-1' : ''}`}>
          <div className="d-flex justify-content-between align-items-start">
            <div className="flex-grow-1">
              <h5 className="card-title">
                <Link
                  to={`/note/${note.task_id}`}
                  className={`task-title-link${
                    completed ? ' text-decoration-line-through text-muted' : ''
                  }`}
                  onClick={() => {
                    try {
                      localStorage.setItem(
                        'notesListReferrer',
                        window.location.pathname + window.location.search,
                      );
                    } catch {
                      // Storage unavailable — non-fatal.
                    }
                  }}
                >
                  {title}
                </Link>
                {note.needs_push && (
                  <i
                    className="bi bi-cloud-arrow-up text-warning ms-1"
                    title={t('note.pendingSync')}
                  />
                )}
              </h5>
              {!completed && body && (
                <p className="card-text text-muted">
                  {truncateWords(body, 40)}
                </p>
              )}
              <small className="text-muted">
                {note.note_category ? (
                  <Link
                    to={`/category/${note.note_category.id}`}
                    className="note-category-chip me-2"
                  >
                    <i className="bi bi-folder" />{' '}
                    {categoryPathLabel(categories, note.note_category.id) ||
                      note.note_category.name}
                  </Link>
                ) : (
                  <span
                    className={
                      'note-category-chip ' + 'note-category-chip--muted me-2'
                    }
                  >
                    <i className="bi bi-inbox" /> {t('note.uncategorized')}
                  </span>
                )}
                {dateLabel && (
                  <>
                    <i className="bi bi-clock" /> {dateLabel}
                  </>
                )}
              </small>
            </div>
            <div className="ms-2">
              <Dropdown
                label={<i className="bi bi-three-dots-vertical" />}
                buttonClassName="btn btn-sm ui-ghost-btn"
                ariaLabel={t('note.actions')}
                menuClassName="dropdown-menu-end"
              >
                <li>
                  <a
                    className="dropdown-item"
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(`/note/${note.task_id}`);
                    }}
                  >
                    <i className="bi bi-pencil" /> {t('note.edit')}
                  </a>
                </li>
                <li>
                  <a
                    className="dropdown-item"
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      openMove();
                    }}
                  >
                    <i className="bi bi-folder-symlink" />{' '}
                    {t('note.moveToCategory')}
                  </a>
                </li>
                {completed && (
                  <li>
                    <a
                      className="dropdown-item"
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        setConfirming('uncomplete');
                      }}
                    >
                      <i className="bi bi-arrow-counterclockwise" />{' '}
                      {t('completed.markNotCompleted')}
                    </a>
                  </li>
                )}
                <li>
                  <a
                    className="dropdown-item text-danger"
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setConfirming('delete');
                    }}
                  >
                    <i className="bi bi-trash" /> {t('note.delete')}
                  </a>
                </li>
              </Dropdown>
            </div>
          </div>
        </div>
      </div>

      <Modal
        show={moving}
        title={t('picker.title')}
        onClose={() => setMoving(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setMoving(false)}
              disabled={updateNote.isPending}
            >
              {t('common:common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitMove}
              disabled={updateNote.isPending || moveTarget === NOT_A_NOTE}
            >
              {updateNote.isPending ? (
                <span className="spinner-border spinner-border-sm me-1" />
              ) : (
                <i className="bi bi-folder-symlink" />
              )}{' '}
              {t('picker.apply')}
            </button>
          </>
        }
      >
        <CategoryPicker
          categories={categories}
          value={moveTarget}
          onChange={setMoveTarget}
        />
      </Modal>

      <ConfirmModal
        show={confirming === 'delete'}
        title={t('note.deleteTitle')}
        confirmLabel={t('note.delete')}
        confirmIcon="trash"
        confirmClassName="btn-danger"
        busy={deleteNote.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() =>
          deleteNote.mutate(note.task_id, {
            onSuccess: () => setConfirming(null),
          })
        }
      >
        <p>{t('note.deleteConfirm')}</p>
        <p className="fw-bold">{title}</p>
      </ConfirmModal>

      <ConfirmModal
        show={confirming === 'uncomplete'}
        title={t('completed.modalTitle')}
        confirmLabel={t('completed.modalTitle')}
        confirmIcon="arrow-counterclockwise"
        busy={uncompleteNote.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() =>
          uncompleteNote.mutate(note.task_id, {
            onSuccess: () => setConfirming(null),
          })
        }
      >
        <p>{t('completed.confirm')}</p>
        <p className="fw-bold">{title}</p>
      </ConfirmModal>
    </div>
  );
}

export default NoteCard;

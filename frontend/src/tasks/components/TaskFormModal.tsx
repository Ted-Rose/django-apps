import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../shared/components/Modal';
import type { LabelOut, TaskOut } from '../api';
import { errorDetail, useCreateTask, useUpdateTask } from '../mutations';

/**
 * Create/edit task modal — a merge of create_task_modal.html (title,
 * notes, label checkboxes, "star this task") and the task_detail.html
 * edit form (same fields minus the star checkbox).
 *
 * `mode="create"` posts to /api/tasks/task/create/ (carrying the
 * `?list=` filter as task_list_id like create_task.js); `mode="edit"`
 * posts to /api/tasks/task/{id}/update/. On success the dashboard
 * queries are invalidated by the mutation hooks.
 */
interface TaskFormModalProps {
  show: boolean;
  mode: 'create' | 'edit';
  /** All user labels for the checkbox list. */
  labels: LabelOut[];
  /** Edit mode: the task being edited. */
  task?: TaskOut;
  /** Create mode: current `?list=` filter (create_task.js behavior). */
  taskListId?: string | null;
  onClose: () => void;
}

export function TaskFormModal({
  show,
  mode,
  labels,
  task,
  taskListId,
  onClose,
}: TaskFormModalProps) {
  const { t } = useTranslation('tasks');
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [starred, setStarred] = useState(false);
  const [labelIds, setLabelIds] = useState<number[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reinitialize the form each time the modal opens — the template's
  // showCreateTaskModal cleared the fields the same way.
  useEffect(() => {
    if (show) {
      setTitle(task?.title ?? '');
      setNotes(task?.notes ?? '');
      setStarred(false);
      setLabelIds(task?.labels.map((label) => label.id) ?? []);
      setValidationError(null);
    }
  }, [show, task]);

  const pending = createTask.isPending || updateTask.isPending;
  const mutationError =
    (mode === 'create' ? createTask.error : updateTask.error) ?? null;

  const toggleLabel = (id: number) => {
    setLabelIds((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    );
  };

  const submit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      // create_task.js: alert('Please enter a task title')
      setValidationError(t('form.titleRequired'));
      return;
    }
    setValidationError(null);
    if (mode === 'create') {
      createTask.mutate(
        {
          title: trimmedTitle,
          notes: notes.trim() || null,
          is_starred: starred,
          // Only send when set, like create_task.js.
          ...(taskListId ? { task_list_id: taskListId } : {}),
          label_ids: labelIds,
        },
        { onSuccess: () => onClose() },
      );
    } else if (task) {
      updateTask.mutate(
        {
          taskId: task.task_id,
          payload: {
            title: trimmedTitle,
            // The view calls notes.strip() — send a string, never
            // null (empty string clears the notes).
            notes: notes.trim(),
            label_ids: labelIds,
          },
        },
        { onSuccess: () => onClose() },
      );
    }
  };

  return (
    <Modal
      show={show}
      title={
        mode === 'create' ? t('form.createTitle') : t('form.editTitle')
      }
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={pending}
          >
            {t('common:common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={pending}
          >
            {pending ? (
              <span className="spinner-border spinner-border-sm me-1" />
            ) : (
              <i
                className={`bi ${
                  mode === 'create' ? 'bi-plus-circle' : 'bi-save'
                }`}
              />
            )}{' '}
            {mode === 'create'
              ? t('form.createSubmit')
              : t('form.saveSubmit')}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {(validationError || mutationError) && (
          <div className="alert alert-danger py-2" role="alert">
            {validationError ?? errorDetail(mutationError)}
          </div>
        )}
        <div className="mb-3">
          <label htmlFor="taskFormTitle" className="form-label">
            {t('form.titleLabel')}{' '}
            <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            className="form-control"
            id="taskFormTitle"
            placeholder={t('form.titlePlaceholder')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </div>
        <div className="mb-3">
          <label htmlFor="taskFormNotes" className="form-label">
            {t('form.notesLabel')}
          </label>
          <textarea
            className="form-control"
            id="taskFormNotes"
            rows={4}
            placeholder={t('form.notesPlaceholder')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        {labels.length > 0 && (
          <div className="mb-3">
            <label className="form-label">{t('form.labelsLabel')}</label>
            <div
              className="border rounded p-2"
              style={{ maxHeight: '150px', overflowY: 'auto' }}
            >
              {labels.map((label) => (
                <div className="form-check" key={label.id}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`taskFormLabel_${label.id}`}
                    checked={labelIds.includes(label.id)}
                    onChange={() => toggleLabel(label.id)}
                  />
                  <label
                    className="form-check-label"
                    htmlFor={`taskFormLabel_${label.id}`}
                  >
                    <span
                      className="badge"
                      style={{ backgroundColor: label.color }}
                    >
                      {label.name}
                    </span>
                  </label>
                </div>
              ))}
            </div>
            <small className="text-muted">{t('form.labelsHint')}</small>
          </div>
        )}
        {mode === 'create' && (
          <div className="form-check">
            <input
              className="form-check-input"
              type="checkbox"
              id="taskFormStarred"
              checked={starred}
              onChange={(event) => setStarred(event.target.checked)}
            />
            <label className="form-check-label" htmlFor="taskFormStarred">
              <i className="bi bi-star-fill text-warning" />{' '}
              {t('form.starThis')}
            </label>
          </div>
        )}
        {/* Hidden submit so Enter inside a field submits the form. */}
        <button type="submit" className="d-none" aria-hidden="true" />
      </form>
    </Modal>
  );
}

export default TaskFormModal;

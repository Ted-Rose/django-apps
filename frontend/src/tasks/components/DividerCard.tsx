import { useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { actionHistory } from '../actionHistory';
import type { TaskOut } from '../api';
import { useDeleteDivider, useUpdateDivider } from '../mutations';
import ConfirmModal from './ConfirmModal';

/**
 * React port of components/dashboard/divider_card.html.
 *
 * Stage 3: the label input is editable — blurring it (or pressing
 * Enter, which blurs) posts the rename like `updateDividerText`, and
 * the × button asks for confirmation then deletes (the template used
 * confirm()). Stage 4: the card is a dnd-kit sortable row — only the
 * `.divider-drag-handle` grip starts a drag, matching the SortableJS
 * `handle` option — and rename/delete record undoable actions.
 */
interface DividerCardProps {
  task: TaskOut;
  /** Drag-to-reorder is active (manual order modes only). */
  draggable?: boolean;
  /** Position field depends on the view (dashboard vs starred). */
  starredView?: boolean;
}

export function DividerCard({
  task,
  draggable = false,
  starredView = false,
}: DividerCardProps) {
  const { t } = useTranslation('tasks');
  const [text, setText] = useState(task.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const updateDivider = useUpdateDivider();
  const deleteDivider = useDeleteDivider();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.task_id, disabled: !draggable });

  // Resync the draft when the refetched title changes (e.g. after a
  // sync or a failed mutation rolled the cache back).
  useEffect(() => {
    setText(task.title);
  }, [task.title]);

  const commit = () => {
    const title = text.trim();
    if (title === task.title) return;
    // updateDividerText records the old→new text for undo.
    actionHistory.recordAction({
      type: 'UPDATE_DIVIDER',
      taskId: task.task_id,
      previousText: task.title,
      newText: title,
    });
    updateDivider.mutate(
      { taskId: task.task_id, title },
      { onError: () => setText(task.title) },
    );
  };

  const orderValue = starredView ? task.starred_order : task.task_order;

  return (
    <div
      ref={setNodeRef}
      className={`card task-card divider-card mb-2${isDragging ? ' sortable-chosen' : ''}`}
      data-task-id={task.task_id}
      data-position={orderValue ?? ''}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: 'relative',
        zIndex: isDragging ? 5 : undefined,
      }}
    >
      <div className="card-body divider-body">
        <div className="d-flex align-items-center">
          <span
            className="divider-drag-handle"
            title={t('divider.dragToReorder')}
            {...(draggable ? attributes : {})}
            {...(draggable ? listeners : {})}
          >
            <i className="bi bi-grip-vertical text-muted" />
          </span>
          <hr className="flex-grow-1 my-0 me-2" />
          <input
            type="text"
            className="divider-text"
            value={text}
            placeholder={t('divider.placeholder')}
            data-task-id={task.task_id}
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            onClick={(event) => event.stopPropagation()}
          />
          <hr className="flex-grow-1 my-0 ms-2" />
          <button
            className="btn btn-sm btn-link text-danger delete-divider-btn"
            type="button"
            data-task-id={task.task_id}
            title={t('divider.delete')}
            onClick={(event) => {
              event.stopPropagation();
              setConfirmingDelete(true);
            }}
          >
            <i className="bi bi-x-circle" />
          </button>
        </div>
      </div>

      <ConfirmModal
        show={confirmingDelete}
        title={t('divider.deleteTitle')}
        confirmLabel={t('common:common.delete')}
        confirmIcon="trash"
        confirmClassName="btn-danger"
        busy={deleteDivider.isPending}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => {
          actionHistory.recordAction({
            type: 'DELETE_DIVIDER',
            taskId: task.task_id,
            dividerText: task.title,
          });
          deleteDivider.mutate(task.task_id, {
            onSuccess: () => setConfirmingDelete(false),
          });
        }}
      >
        <p>{t('divider.deleteConfirm')}</p>
        {task.title && <p className="fw-bold">{task.title}</p>}
      </ConfirmModal>
    </div>
  );
}

export default DividerCard;

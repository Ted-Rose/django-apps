import { useEffect, useState } from 'react';
import type { TaskOut } from '../api';
import { useDeleteDivider, useUpdateDivider } from '../mutations';
import ConfirmModal from './ConfirmModal';

/**
 * React port of components/dashboard/divider_card.html.
 *
 * Stage 3: the label input is editable — blurring it (or pressing
 * Enter, which blurs) posts the rename like `updateDividerText`, and
 * the × button asks for confirmation then deletes (the template used
 * confirm()). Drag to reorder stays a visual affordance until Stage 4.
 */
export function DividerCard({ task }: { task: TaskOut }) {
  const [text, setText] = useState(task.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const updateDivider = useUpdateDivider();
  const deleteDivider = useDeleteDivider();

  // Resync the draft when the refetched title changes (e.g. after a
  // sync or a failed mutation rolled the cache back).
  useEffect(() => {
    setText(task.title);
  }, [task.title]);

  const commit = () => {
    const title = text.trim();
    if (title === task.title) return;
    updateDivider.mutate(
      { taskId: task.task_id, title },
      { onError: () => setText(task.title) },
    );
  };

  return (
    <div
      className="card task-card divider-card mb-2"
      data-task-id={task.task_id}
      data-position={task.task_order ?? ''}
    >
      <div className="card-body divider-body">
        <div className="d-flex align-items-center">
          <span className="divider-drag-handle" title="Drag to reorder">
            <i className="bi bi-grip-vertical text-muted" />
          </span>
          <hr className="flex-grow-1 my-0 me-2" />
          <input
            type="text"
            className="divider-text"
            value={text}
            placeholder="Click to label..."
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
            title="Delete divider"
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
        title="Delete Divider"
        confirmLabel="Delete"
        confirmIcon="trash"
        confirmClassName="btn-danger"
        busy={deleteDivider.isPending}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() =>
          deleteDivider.mutate(task.task_id, {
            onSuccess: () => setConfirmingDelete(false),
          })
        }
      >
        <p>Delete this divider?</p>
        {task.title && <p className="fw-bold">{task.title}</p>}
      </ConfirmModal>
    </div>
  );
}

export default DividerCard;

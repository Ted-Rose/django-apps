import type { TaskOut } from '../api';

/**
 * React port of components/dashboard/divider_card.html.
 *
 * Read-only this stage: the label input is `readOnly` and the delete
 * button is omitted — divider edit/delete arrive in the interactions
 * stage (Stage 4).
 */
export function DividerCard({ task }: { task: TaskOut }) {
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
            value={task.title}
            placeholder="Click to label..."
            data-task-id={task.task_id}
            readOnly
            title="Divider editing arrives in a later stage"
          />
          <hr className="flex-grow-1 my-0 ms-2" />
        </div>
      </div>
    </div>
  );
}

export default DividerCard;

import { Link } from 'react-router-dom';
import type { LabelRef, TaskOut } from '../api';
import { formatFullDate, truncateWords } from '../utils';

/**
 * React port of components/dashboard/task_card.html.
 *
 * Read-only this stage (Stage 2): the complete/star icons render for
 * visual parity but have no handlers, and the three-dots actions menu
 * (archive/delete) plus the order-presets dropdown are omitted — they
 * arrive with the mutation stages.
 */
interface TaskCardProps {
  task: TaskOut;
  /** 1-based row index, matching the template's `forloop.counter`. */
  position: number;
  /** label name → color (task labels only carry id/name). */
  labelColors: Map<string, string>;
  /** Position field depends on the view (dashboard vs starred). */
  starredView?: boolean;
}

function LabelBadge({
  label,
  labelColors,
}: {
  label: LabelRef;
  labelColors: Map<string, string>;
}) {
  return (
    <span
      className="badge me-1"
      style={{ backgroundColor: labelColors.get(label.name) ?? '#6c757d' }}
    >
      {label.name}
    </span>
  );
}

export function TaskCard({
  task,
  position,
  labelColors,
  starredView = false,
}: TaskCardProps) {
  const orderValue = starredView ? task.starred_order : task.task_order;
  const due = formatFullDate(task.due);

  return (
    <div
      className="task-container d-flex mb-2"
      data-task-id={task.task_id}
      data-position={orderValue ?? ''}
    >
      <div className="card task-card flex-grow-1 task-content">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-start">
            <div className="flex-grow-1">
              <h5 className="card-title">
                <span
                  className="complete-btn me-1"
                  title="Complete (available in a later stage)"
                >
                  <i className="bi bi-check-circle" />
                </span>
                <span
                  className={`star-btn me-1${task.is_starred ? ' starred' : ''}`}
                  title={task.is_starred ? 'Unstar' : 'Star'}
                >
                  <i
                    className={`bi ${
                      task.is_starred ? 'bi-star-fill' : 'bi-star'
                    }`}
                  />
                </span>
                <Link to={`/task/${task.task_id}`} className="task-title-link">
                  {task.title}
                </Link>
                {task.needs_push && (
                  <i
                    className="bi bi-cloud-arrow-up text-warning ms-1"
                    title="Pending sync to Google"
                  />
                )}
              </h5>
              {task.labels.length > 0 && (
                <div className="mb-2">
                  {task.labels.map((label) => (
                    <LabelBadge
                      key={label.id}
                      label={label}
                      labelColors={labelColors}
                    />
                  ))}
                </div>
              )}
              {task.notes && (
                <p className="card-text text-muted">
                  {truncateWords(task.notes, 20)}
                </p>
              )}
              {(due || task.task_list) && (
                <small className="text-muted">
                  {due && (
                    <>
                      <i className="bi bi-calendar" /> Due: {due}
                    </>
                  )}
                  {task.task_list && (
                    <span
                      className="badge bg-light text-dark border ms-2"
                      title="Google task list"
                    >
                      <i className="bi bi-folder" /> {task.task_list.title}
                    </span>
                  )}
                </small>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="task-order-badge ms-2">
        <button
          className="btn btn-sm btn-outline-secondary order-btn"
          type="button"
          title="Change order (available in a later stage)"
        >
          {position}
        </button>
      </div>
    </div>
  );
}

export default TaskCard;

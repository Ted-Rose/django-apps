import { useState } from 'react';
import { Link } from 'react-router-dom';
import Dropdown from '../../shared/components/Dropdown';
import type { LabelOut, LabelRef, TaskOut } from '../api';
import {
  useArchiveTask,
  useCompleteTask,
  useDeleteTask,
  useToggleStar,
} from '../mutations';
import { formatFullDate, truncateWords } from '../utils';
import ConfirmModal from './ConfirmModal';
import TaskFormModal from './TaskFormModal';

/**
 * React port of components/dashboard/task_card.html.
 *
 * Stage 3: the complete icon opens the "Complete Task" confirm modal,
 * the star toggles optimistically, and the three-dots menu exposes
 * Edit (title/notes/labels modal — the fields task_detail.html edits),
 * Archive and Delete (confirm modal, like the template's confirm()).
 * The order-presets dropdown stays inert until Stage 4 (reorder).
 */
interface TaskCardProps {
  task: TaskOut;
  /** 1-based row index, matching the template's `forloop.counter`. */
  position: number;
  /** label name → color (task labels only carry id/name). */
  labelColors: Map<string, string>;
  /** All labels — powers the edit modal's label picker. */
  labels?: LabelOut[];
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
  labels = [],
  starredView = false,
}: TaskCardProps) {
  const orderValue = starredView ? task.starred_order : task.task_order;
  const due = formatFullDate(task.due);

  const toggleStar = useToggleStar();
  const completeTask = useCompleteTask();
  const archiveTask = useArchiveTask();
  const deleteTask = useDeleteTask();

  const [confirming, setConfirming] = useState<'complete' | 'delete' | null>(
    null,
  );
  const [editing, setEditing] = useState(false);

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
                  role="button"
                  title="Complete"
                  onClick={(event) => {
                    event.stopPropagation();
                    setConfirming('complete');
                  }}
                >
                  <i className="bi bi-check-circle" />
                </span>
                <span
                  className={`star-btn me-1${task.is_starred ? ' starred' : ''}`}
                  role="button"
                  title={task.is_starred ? 'Unstar' : 'Star'}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleStar.mutate(task.task_id);
                  }}
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
            <div className="ms-2">
              <Dropdown
                label={<i className="bi bi-three-dots-vertical" />}
                buttonClassName="btn btn-sm btn-link text-muted"
                ariaLabel="Task actions"
                menuClassName="dropdown-menu-end"
              >
                <li>
                  <a
                    className="dropdown-item"
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setEditing(true);
                    }}
                  >
                    <i className="bi bi-pencil" /> Edit
                  </a>
                </li>
                <li>
                  <a
                    className="dropdown-item"
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      archiveTask.mutate(task.task_id);
                    }}
                  >
                    <i className="bi bi-archive" /> Archive
                  </a>
                </li>
                <li>
                  <a
                    className="dropdown-item text-danger"
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setConfirming('delete');
                    }}
                  >
                    <i className="bi bi-trash" /> Delete
                  </a>
                </li>
              </Dropdown>
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

      <ConfirmModal
        show={confirming === 'complete'}
        title="Complete Task"
        confirmLabel="Complete"
        confirmIcon="check-circle"
        confirmClassName="btn-success"
        busy={completeTask.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() =>
          completeTask.mutate(task.task_id, {
            onSuccess: () => setConfirming(null),
          })
        }
      >
        <p>Are you sure you want to mark this task as completed?</p>
        <p className="fw-bold">{task.title}</p>
      </ConfirmModal>

      <ConfirmModal
        show={confirming === 'delete'}
        title="Delete Task"
        confirmLabel="Delete"
        confirmIcon="trash"
        confirmClassName="btn-danger"
        busy={deleteTask.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() =>
          deleteTask.mutate(task.task_id, {
            onSuccess: () => setConfirming(null),
          })
        }
      >
        <p>Move this task to trash?</p>
        <p className="fw-bold">{task.title}</p>
      </ConfirmModal>

      <TaskFormModal
        show={editing}
        mode="edit"
        task={task}
        labels={labels}
        onClose={() => setEditing(false)}
      />
    </div>
  );
}

export default TaskCard;

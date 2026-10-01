import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Dropdown from '../../shared/components/Dropdown';
import { actionHistory } from '../actionHistory';
import type { LabelOut, LabelRef, TaskOut } from '../api';
import {
  useArchiveTask,
  useCompleteTask,
  useDeleteTask,
  useToggleStar,
} from '../mutations';
import { noteCardPressStart, shouldSuppressTaskClick } from '../reorder';
import { formatFullDate, truncateWords } from '../utils';
import ConfirmModal from './ConfirmModal';
import TaskFormModal from './TaskFormModal';

/** task_card.html's preset ranks for the order-badge dropdown. */
const ORDER_PRESETS = [1, 5, 10, 15, 20, 50];

/**
 * React port of components/dashboard/task_card.html.
 *
 * Stage 3: the complete icon opens the "Complete Task" confirm modal,
 * the star toggles optimistically, and the three-dots menu exposes
 * Edit (title/notes/labels modal — the fields task_detail.html edits),
 * Archive and Delete (confirm modal, like the template's confirm()).
 * Stage 4: the card is a dnd-kit sortable row (`.task-content` is the
 * drag handle, like SortableJS's `handle` option), the order badge
 * offers the same preset ranks `setTaskOrder` used, and the mutation
 * clicks record undoable actions in the localStorage history store.
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
  /** Drag-to-reorder is active (manual order modes only). */
  draggable?: boolean;
  /** Order-badge preset click (task_actions.js setTaskOrder). */
  onSetRank?: (rank: number) => void;
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
  draggable = false,
  onSetRank,
}: TaskCardProps) {
  const orderValue = starredView ? task.starred_order : task.task_order;
  const due = formatFullDate(task.due);

  const toggleStar = useToggleStar();
  const completeTask = useCompleteTask();
  const archiveTask = useArchiveTask();
  const deleteTask = useDeleteTask();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.task_id, disabled: !draggable });

  const [confirming, setConfirming] = useState<'complete' | 'delete' | null>(
    null,
  );
  const [editing, setEditing] = useState(false);

  return (
    <div
      ref={setNodeRef}
      className={`task-container d-flex mb-2${isDragging ? ' sortable-chosen' : ''}`}
      data-task-id={task.task_id}
      data-position={orderValue ?? ''}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: 'relative',
        zIndex: isDragging ? 5 : undefined,
      }}
    >
      <div
        className="card task-card flex-grow-1 task-content flex-row"
        onPointerDownCapture={noteCardPressStart}
        {...(draggable ? attributes : {})}
        {...(draggable ? listeners : {})}
      >
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
                    // task_actions.js toggleStar records before POSTing.
                    actionHistory.recordAction({
                      type: 'TOGGLE_STAR',
                      taskId: task.task_id,
                      previousState: task.is_starred,
                    });
                    toggleStar.mutate(task.task_id);
                  }}
                >
                  <i
                    className={`bi ${
                      task.is_starred ? 'bi-star-fill' : 'bi-star'
                    }`}
                  />
                </span>
                <Link
                  to={`/task/${task.task_id}`}
                  className="task-title-link"
                  onClick={(event) => {
                    // reorder.js swallowed link clicks during/right
                    // after a drag; otherwise it saved the referrer.
                    if (shouldSuppressTaskClick()) {
                      event.preventDefault();
                      return;
                    }
                    try {
                      localStorage.setItem(
                        'taskListReferrer',
                        window.location.pathname + window.location.search,
                      );
                    } catch {
                      // Storage unavailable — non-fatal.
                    }
                  }}
                >
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
                      actionHistory.recordAction({
                        type: 'ARCHIVE_TASK',
                        taskId: task.task_id,
                        taskTitle: task.title,
                      });
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
        <div className="task-order-badge">
          {onSetRank ? (
            <Dropdown
              label={<>{position}</>}
              buttonClassName="btn btn-sm order-btn"
              ariaLabel="Change order"
              menuClassName="dropdown-menu-end"
            >
              {ORDER_PRESETS.map((rank) => (
                <li key={rank}>
                  <a
                    className="dropdown-item"
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onSetRank(rank);
                    }}
                  >
                    {rank}
                  </a>
                </li>
              ))}
            </Dropdown>
          ) : (
            <button
              className="btn btn-sm order-btn"
              type="button"
              title="Priority — change order"
            >
              {position}
            </button>
          )}
        </div>
      </div>

      <ConfirmModal
        show={confirming === 'complete'}
        title="Complete Task"
        confirmLabel="Complete"
        confirmIcon="check-circle"
        confirmClassName="btn-success"
        busy={completeTask.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          actionHistory.recordAction({
            type: 'COMPLETE_TASK',
            taskId: task.task_id,
            taskTitle: task.title,
          });
          completeTask.mutate(task.task_id, {
            onSuccess: () => setConfirming(null),
          });
        }}
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
        onConfirm={() => {
          actionHistory.recordAction({
            type: 'DELETE_TASK',
            taskId: task.task_id,
            taskTitle: task.title,
          });
          deleteTask.mutate(task.task_id, {
            onSuccess: () => setConfirming(null),
          });
        }}
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

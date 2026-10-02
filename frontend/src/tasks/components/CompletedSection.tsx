import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { actionHistory } from '../actionHistory';
import type { TaskOut } from '../api';
import { useToggleStar, useUncompleteTask } from '../mutations';
import { formatShortDate } from '../utils';
import ConfirmModal from './ConfirmModal';

/**
 * React port of components/dashboard/completed_tasks.html.
 *
 * The template uses a Bootstrap collapse + a chevron swap driven by
 * main.js; here it's plain React state (`collapse`/`show` classes are
 * kept so the copied dashboard.css and any CSS hooks still apply).
 * Stage 3: the star toggles optimistically and the uncomplete icon
 * opens the "Mark as Not Completed" confirm modal, like the template.
 *
 * `autoOpen` mirrors filters.js: selecting a secondary_label that
 * matches completed tasks expands the section automatically.
 */
interface CompletedSectionProps {
  tasks: TaskOut[];
  /** Header count — the template shows the total completed count even
   *  when the secondary_label filter hides some rows. */
  totalCount?: number;
  labelColors: Map<string, string>;
  autoOpen?: boolean;
}

export function CompletedSection({
  tasks,
  totalCount,
  labelColors,
  autoOpen = false,
}: CompletedSectionProps) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const count = totalCount ?? tasks.length;

  useEffect(() => {
    if (autoOpen && tasks.length > 0) {
      setOpen(true);
    }
  }, [autoOpen, tasks.length]);

  if (count === 0) return null;

  return (
    <div className="mt-2">
      <button
        className="btn btn-link text-muted text-decoration-none ps-0"
        type="button"
        aria-expanded={open}
        aria-controls="completedTasksCollapse"
        onClick={() => setOpen((prev) => !prev)}
      >
        <i
          className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`}
          id="completedChevron"
        />{' '}
        {t('completed.header', { count })}
      </button>
      <div
        className={`collapse${open ? ' show' : ''}`}
        id="completedTasksCollapse"
      >
        <div className="mt-2">
          {tasks.map((task) => (
            <CompletedTaskCard
              key={task.task_id}
              task={task}
              labelColors={labelColors}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CompletedTaskCard({
  task,
  labelColors,
}: {
  task: TaskOut;
  labelColors: Map<string, string>;
}) {
  const { t } = useTranslation('tasks');
  const completed = formatShortDate(task.completed);
  const [confirming, setConfirming] = useState(false);
  const toggleStar = useToggleStar();
  const uncompleteTask = useUncompleteTask();

  return (
    <div
      className="card task-card mb-1 border-0 bg-light"
      data-task-id={task.task_id}
    >
      <div className="card-body py-1">
        <div className="d-flex justify-content-between align-items-center">
          <div className="flex-grow-1">
            <Link
              to={`/task/${task.task_id}`}
              className="task-title-link text-decoration-line-through text-muted"
            >
              {task.title}
            </Link>
            {task.labels.map((label) => (
              <span
                key={label.id}
                className="badge ms-1"
                style={{
                  backgroundColor: labelColors.get(label.name) ?? '#6c757d',
                }}
              >
                {label.name}
              </span>
            ))}
            {completed && (
              <small className="text-muted ms-2">{completed}</small>
            )}
          </div>
          <div className="d-flex align-items-center gap-2">
            <span
              className={`star-btn${task.is_starred ? ' starred' : ''}`}
              role="button"
              title={
                task.is_starred ? t('task.unstar') : t('task.star')
              }
              onClick={(event) => {
                event.stopPropagation();
                actionHistory.recordAction({
                  type: 'TOGGLE_STAR',
                  taskId: task.task_id,
                  previousState: task.is_starred,
                });
                toggleStar.mutate(task.task_id);
              }}
            >
              <i
                className={`bi ${task.is_starred ? 'bi-star-fill' : 'bi-star'}`}
              />
            </span>
            <span
              className="uncomplete-btn"
              role="button"
              title={t('completed.markNotCompleted')}
              onClick={(event) => {
                event.stopPropagation();
                setConfirming(true);
              }}
            >
              <i className="bi bi-arrow-counterclockwise" />
            </span>
          </div>
        </div>
      </div>

      <ConfirmModal
        show={confirming}
        title={t('completed.modalTitle')}
        confirmLabel={t('completed.modalTitle')}
        confirmIcon="arrow-counterclockwise"
        confirmClassName="btn-primary"
        busy={uncompleteTask.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          actionHistory.recordAction({
            type: 'UNCOMPLETE_TASK',
            taskId: task.task_id,
            taskTitle: task.title,
          });
          uncompleteTask.mutate(task.task_id, {
            onSuccess: () => setConfirming(false),
          });
        }}
      >
        <p>{t('completed.confirm')}</p>
        <p className="fw-bold">{task.title}</p>
      </ConfirmModal>
    </div>
  );
}

export default CompletedSection;

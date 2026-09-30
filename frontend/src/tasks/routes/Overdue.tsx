import TaskListPage from './TaskListPage';

/**
 * Overdue view — dashboard.html with is_overdue_view in the template,
 * GET /api/tasks/overdue/ → DashboardOut here. Task-order drag
 * reorder works exactly like the dashboard (task_order is global);
 * only the ?list= filter is absent (the endpoint doesn't take one).
 */
export default function Overdue() {
  return <TaskListPage view="overdue" />;
}

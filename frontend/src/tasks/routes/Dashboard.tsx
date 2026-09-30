import TaskListPage from './TaskListPage';

/**
 * React port of dashboard.html — the `?list=&label=&order=` params
 * drive GET /api/tasks/dashboard/ (shareable URL state, same contract
 * as the template view), while `secondary_label` stays a client-side
 * filter exactly like filters.js. The full implementation lives in
 * TaskListPage, shared with the /starred and /overdue views which
 * render the same template/API shape.
 */
export default function Dashboard() {
  return <TaskListPage view="dashboard" />;
}

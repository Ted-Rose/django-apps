import TaskListPage from './TaskListPage';

/**
 * Starred view — the template renders dashboard.html with
 * is_starred_view; the API mirrors that as GET /api/tasks/starred/
 * → DashboardOut. TaskListPage supplies the whole surface; the
 * view-specific bits key off flags.is_starred_view:
 * starred_order drag reorder via /api/tasks/starred/reorder/ and
 * Add Divider posting {is_starred: true}.
 */
export default function Starred() {
  return <TaskListPage view="starred" />;
}

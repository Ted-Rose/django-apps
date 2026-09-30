import { Navigate, Route, Routes } from 'react-router-dom';
import Archived from './routes/Archived';
import Dashboard from './routes/Dashboard';
import Overdue from './routes/Overdue';
import Search from './routes/Search';
import Starred from './routes/Starred';
import TaskDetail from './routes/TaskDetail';
import Trash from './routes/Trash';

/**
 * Router host for the tasks SPA (mounted at /tasks/app/, see
 * `BrowserRouter basename` in main.tsx). All template routes now
 * have React counterparts: `/` is the dashboard; starred/overdue
 * reuse the dashboard-shaped TaskListPage; archived, trash, search
 * and task detail are standalone pages like their templates. The
 * Django catch-all routes every /tasks/app/<subpath>/ here, so deep
 * links land on the right page.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/starred" element={<Starred />} />
      <Route path="/overdue" element={<Overdue />} />
      <Route path="/archived" element={<Archived />} />
      <Route path="/trash" element={<Trash />} />
      <Route path="/search" element={<Search />} />
      <Route path="/task/:taskId" element={<TaskDetail />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { spaPathFromStoredUrl } from './utils';
import Archived from './routes/Archived';
import Dashboard from './routes/Dashboard';
import Labels from './routes/Labels';
import Overdue from './routes/Overdue';
import Search from './routes/Search';
import Starred from './routes/Starred';
import Stats from './routes/Stats';
import TaskDetail from './routes/TaskDetail';
import Trash from './routes/Trash';

/**
 * Router host for the tasks SPA (mounted at /tasks/ since the Stage 6
 * cutover, see `BrowserRouter basename` in main.tsx). `/` is the
 * dashboard; starred/overdue reuse the dashboard-shaped TaskListPage;
 * archived, trash, search, stats and task detail are standalone pages.
 * The Django catch-all routes every /tasks/<subpath>/ here, so deep
 * links land on the right page — including the old template URLs like
 * /tasks/starred/, which map onto the same route names.
 */
export default function App() {
  const location = useLocation();
  // Relaunch restore: a bare-/ landing navigates to the section
  // recorded in localStorage.lastTasksView so reopening the PWA
  // returns to where the user left off. The read must happen in
  // this initializer — before any child route's saveCurrentView
  // effect rewrites the key to /tasks/. Deep links (a non-/
  // landing path or /?<params>) skip the restore; a null or
  // plain-/ resolution means nothing to restore.
  const [restoreTo] = useState(() => {
    if (location.pathname !== '/' || location.search) return null;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('lastTasksView');
    } catch {
      return null;
    }
    const target = spaPathFromStoredUrl(stored);
    return target && target !== '/' ? target : null;
  });
  // The restore is bound to the initial landing entry only: once
  // the router location object changes (the restore navigation
  // itself or any later one) Routes take over, so in-session
  // navigations back to / are not hijacked.
  const [landing] = useState(location);
  const restore = restoreTo && location === landing ? restoreTo : null;
  return (
    // .app-ui carries the shared design tokens + gray canvas
    // (shared/ui.css via dashboard.css) for every route.
    <div className="app-ui">
      {restore ? (
        // replace keeps the synthetic / entry out of history so
        // Back cannot land on it.
        <Navigate to={restore} replace />
      ) : (
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/starred" element={<Starred />} />
          <Route path="/overdue" element={<Overdue />} />
          <Route path="/archived" element={<Archived />} />
          <Route path="/trash" element={<Trash />} />
          <Route path="/search" element={<Search />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/labels" element={<Labels />} />
          <Route path="/task/:taskId" element={<TaskDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </div>
  );
}

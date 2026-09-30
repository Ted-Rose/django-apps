import { Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from './routes/Dashboard';
import StubPage, { TaskDetailStub } from './routes/StubPage';

/**
 * Router host for the tasks SPA (mounted at /tasks/app/, see
 * `BrowserRouter basename` in main.tsx).
 *
 * `/` is the real dashboard (Stage 2). The other routes are graceful
 * stubs until the Stage 5 secondary pages land — the Django catch-all
 * already routes every /tasks/app/<subpath>/ here, so deep links get
 * a friendly placeholder instead of a blank page.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route
        path="/starred"
        element={
          <StubPage title="Starred" templatePath="starred/" icon="bi-star" />
        }
      />
      <Route
        path="/overdue"
        element={
          <StubPage
            title="Overdue"
            templatePath="overdue/"
            icon="bi-exclamation-triangle"
          />
        }
      />
      <Route
        path="/archived"
        element={
          <StubPage
            title="Archive"
            templatePath="archived/"
            icon="bi-archive"
          />
        }
      />
      <Route
        path="/trash"
        element={
          <StubPage title="Trash" templatePath="trash/" icon="bi-trash" />
        }
      />
      <Route
        path="/search"
        element={
          <StubPage title="Search" templatePath="search/" icon="bi-search" />
        }
      />
      <Route path="/task/:taskId" element={<TaskDetailStub />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

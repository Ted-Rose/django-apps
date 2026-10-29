import { Navigate, Route, Routes } from 'react-router-dom';
import Categories from './routes/Categories';
import CategoryRedirect from './routes/CategoryRedirect';
import NoteDetail from './routes/NoteDetail';
import NotesPage from './routes/NotesPage';

/**
 * Router host for the notes SPA (mounted at /notes/, see
 * `BrowserRouter basename` in main.tsx). `/` is the notes list —
 * `?category=<id>&q=&order=` query params are the source of truth,
 * like the tasks dashboard. `/category/:id` is a deep-linkable
 * alias that redirects onto the query-param form so there is only
 * one filter representation. The Django catch-all routes every
 * /notes/<subpath>/ here.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<NotesPage />} />
      <Route path="/category/:id" element={<CategoryRedirect />} />
      <Route path="/note/:id" element={<NoteDetail />} />
      <Route path="/categories" element={<Categories />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

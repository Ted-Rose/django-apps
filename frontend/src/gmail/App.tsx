import { Navigate, Route, Routes } from 'react-router-dom';
import GmailReader from './routes/GmailReader';

/**
 * Router host for the gmail SPA mounted at /gmail/ (see
 * `BrowserRouter basename` in main.tsx). The app has exactly one
 * page today — the reader — plus a `*` redirect for stray subpaths
 * the gmail/<path:subpath> catch-all serves the shell for.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GmailReader />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

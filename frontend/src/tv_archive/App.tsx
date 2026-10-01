import { Navigate, Route, Routes } from 'react-router-dom';
import Feed from './routes/Feed';

/**
 * Router host for the tv_archive SPA mounted at /tv-arhivs/app/
 * during the strangler stage (see `BrowserRouter basename` in
 * main.tsx — Stage 3 flips it to /tv-arhivs). Django serves the
 * shell for every GET/HEAD under the mount and React Router
 * resolves the page here; unknown paths redirect to the feed.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Feed />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

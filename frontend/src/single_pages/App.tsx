import { Navigate, Route, Routes } from 'react-router-dom';
import Twister from './routes/Twister';
import Spoki from './routes/Spoki';

/**
 * Router host for the single_pages SPA mounted at site root (no
 * basename — see main.tsx). Django's URLconf only serves the shell
 * on /twister and /spoki/, so these absolute paths are the whole
 * app; the `*` fallback covers test mounts and future deep links.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/twister" replace />} />
      <Route path="/twister" element={<Twister />} />
      <Route path="/spoki" element={<Spoki />} />
      <Route path="*" element={<Navigate to="/twister" replace />} />
    </Routes>
  );
}

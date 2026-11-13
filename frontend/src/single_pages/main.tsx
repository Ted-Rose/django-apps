import App from './App';
import { AppRouter } from '../shared/components/AppRouter';
import { ErrorBoundary } from '../shared/ErrorBoundary';
// Ported from the inline <style> of the deleted-at-cutover
// twister.html template (selectors scoped to .twister-page).
import './twister.css';

/**
 * The single_pages app as a mountable component — the unified
 * shell lazy-imports it under /twister and /spoki/. Root-mounted
 * app: Django serves the shell only on those two explicit paths
 * (no root catch-all, ever), so basename '/' keeps its absolute
 * routes (/twister, /spoki) resolving exactly as before.
 */
export default function SinglePagesApp() {
  return (
    <AppRouter basename="/">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AppRouter>
  );
}

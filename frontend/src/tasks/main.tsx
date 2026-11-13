import App from './App';
import { registerI18n } from '../shared/i18n';
import { AppRouter } from '../shared/components/AppRouter';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import en from './locales/en.json';
import lv from './locales/lv.json';
// Restyled on the shared .ui-* design tokens (shared/ui.css is
// @imported at the top of dashboard.css). Provides the fixed-navbar
// offset via .app-ui padding (App.tsx wraps Routes in .app-ui).
import './dashboard.css';

// Registers this app's catalogs on the shell's shared i18next —
// runs at lazy-chunk evaluation, before any component renders.
registerI18n('tasks', { en, lv });

/**
 * The tasks app as a mountable component — the unified shell lazy-
 * imports it under /tasks/*. AppRouter supplies the same basename
 * semantics the old standalone BrowserRouter basename did, so
 * every in-app absolute link (`to="/x"`, `navigate("/")`) resolves
 * inside /tasks unchanged.
 */
export default function TasksApp() {
  return (
    <AppRouter basename="/tasks">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AppRouter>
  );
}

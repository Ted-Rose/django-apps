import App from './App';
import { registerI18n } from '../shared/i18n';
import { AppRouter } from '../shared/components/AppRouter';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import en from './locales/en.json';
import lv from './locales/lv.json';
// Reuses the tasks dashboard stylesheet (task cards, floating +,
// toasts offset) plus the notes-specific tweaks inside.
import './dashboard.css';

// Registers this app's catalogs on the shell's shared i18next —
// runs at lazy-chunk evaluation, before any component renders.
registerI18n('notes', { en, lv });

/**
 * The notes app as a mountable component — the unified shell lazy-
 * imports it under /notes/*. AppRouter supplies the same basename
 * semantics the old standalone BrowserRouter basename did, so
 * every in-app absolute link resolves inside /notes unchanged.
 */
export default function NotesApp() {
  return (
    <AppRouter basename="/notes">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AppRouter>
  );
}

import App from './App';
import { registerI18n } from '../shared/i18n';
import { AppRouter } from '../shared/components/AppRouter';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import en from './locales/en.json';
import lv from './locales/lv.json';
// Ported from the inline <style> in the deleted-at-cutover
// gmail.html template.
import './gmail.css';

// Registers this app's catalogs on the shell's shared i18next —
// runs at lazy-chunk evaluation, before any component renders.
registerI18n('gmail', { en, lv });

/**
 * The gmail app as a mountable component — the unified shell lazy-
 * imports it under /gmail/*. /gmail/ is a root-mounted app (no
 * /app/ intermediate), so the AppRouter basename never flips.
 */
export default function GmailApp() {
  return (
    <AppRouter basename="/gmail">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AppRouter>
  );
}

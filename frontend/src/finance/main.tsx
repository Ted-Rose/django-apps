import App from './App';
import { registerI18n } from '../shared/i18n';
import { AppRouter } from '../shared/components/AppRouter';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import en from './locales/en.json';
import lv from './locales/lv.json';
// Ported from finance/static/finance/css/finance.css — provides the
// fixed navbar offset (`body { padding-top: 60px }`).
import './finance.css';

// Registers this app's catalogs on the shell's shared i18next —
// runs at lazy-chunk evaluation, before any component renders.
registerI18n('finance', { en, lv });

/**
 * The finance app as a mountable component — the unified shell
 * imports it at startup (priority chunk) and mounts it under
 * /finance/*. AppRouter supplies the same basename semantics the
 * old standalone BrowserRouter basename did, so every in-app
 * absolute link resolves inside /finance unchanged.
 */
export default function FinanceApp() {
  return (
    <AppRouter basename="/finance">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AppRouter>
  );
}

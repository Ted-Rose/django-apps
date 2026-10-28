import 'vite/modulepreload-polyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { initI18n } from '../shared/i18n';
import { initSentry } from '../shared/sentry';
import { initGlobalErrorHandlers } from '../shared/errorReporter';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import queryClient from '../shared/queryClient';
import en from './locales/en.json';
import lv from './locales/lv.json';
// Ported from google_tasks/static/google_tasks/css/dashboard.css for
// visual parity (the original was deleted in Stage 6). Also provides
// the fixed navbar offset (`body { padding-top: 60px }`).
import './dashboard.css';

// Before everything else, so even a failing i18n/module init is
// reported. Both no-op without a DSN.
initSentry();
initGlobalErrorHandlers();

// Must run before any component reads t() — catalogs are static
// imports so both languages are already bundled.
initI18n('tasks', { en, lv });

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/tasks">
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

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
// Restyled on the shared .ui-* design tokens (shared/ui.css is
// @imported at the top of dashboard.css). Provides the fixed-navbar
// offset via .app-ui padding (App.tsx wraps Routes in .app-ui).
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

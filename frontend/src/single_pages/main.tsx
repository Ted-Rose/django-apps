import 'vite/modulepreload-polyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { initSentry } from '../shared/sentry';
import { initGlobalErrorHandlers } from '../shared/errorReporter';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import queryClient from '../shared/queryClient';
// Ported from the inline <style> of the deleted-at-cutover
// twister.html template (selectors scoped to .twister-page).
import './twister.css';

// Before everything else, so even a failing module init is
// reported. Both no-op without a DSN.
initSentry();
initGlobalErrorHandlers();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/* Root-mounted app — Django serves the shell only on the
            explicit /twister + /spoki/ routes (no root catch-all,
            ever), so BrowserRouter gets no basename. */}
        <BrowserRouter>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

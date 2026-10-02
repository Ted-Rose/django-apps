import 'vite/modulepreload-polyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { initI18n } from '../shared/i18n';
import queryClient from '../shared/queryClient';
import en from './locales/en.json';
import lv from './locales/lv.json';
// Ported from finance/static/finance/css/finance.css — provides the
// fixed navbar offset (`body { padding-top: 60px }`).
import './finance.css';

// Must run before any component reads t() — catalogs are static
// imports so both languages are already bundled.
initI18n('finance', { en, lv });

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/* Stage 6 cutover: the SPA owns /finance/ — the template
            UI is deleted and /finance/app/* 301-redirects here. */}
        <BrowserRouter basename="/finance">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

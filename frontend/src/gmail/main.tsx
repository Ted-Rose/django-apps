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
// Ported from the inline <style> in the deleted-at-cutover
// gmail.html template.
import './gmail.css';

// Must run before any component reads t() — catalogs are static
// imports so both languages are already bundled.
initI18n('gmail', { en, lv });

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/* /gmail/ is both the staging mount and the final canonical
            URL — basename never flips (root-mounted app, no /app/
            intermediate). */}
        <BrowserRouter basename="/gmail">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

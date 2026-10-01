import 'vite/modulepreload-polyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
// Ported from finance/static/finance/css/finance.css — provides the
// fixed navbar offset (`body { padding-top: 60px }`).
import './finance.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // One retry keeps transient network errors from flashing error
      // states; real failures still surface via ApiError.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/* Strangler mount: during Stages 1–5 the SPA lives under
            /finance/app/ while the template UI keeps serving
            /finance/*. Stage 6 moves the basename to /finance. */}
        <BrowserRouter basename="/finance/app">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
